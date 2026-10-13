// 真机/真浏览器验证：干净存档下，升级卡里绝不能出现未解锁系的武器。
// 用法：node tools/cdp-cards.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const url = process.argv[2] || 'http://127.0.0.1:8099/index.html';
const PORT = 9338;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function main() {
  const browser = CANDIDATES.find((p) => existsSync(p));
  if (!browser) throw new Error('找不到 Edge/Chrome');
  const profile = join(root, 'test', 'artifacts', 'cdp-profile-cards');
  mkdirSync_(profile);
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch (e) {
      /* 还没起来 */
    }
  }
  if (!page) {
    child.kill();
    throw new Error('调试端口没起来');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  let id = 0;
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push((d.exception && d.exception.description) || d.text);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(3000);
  await evalJs('localStorage.clear(); location.reload();');
  await sleep(2500);

  // 从"干净存档"开局，连续触发大量升级，逐张记录卡片的所属系
  const report = await evalJs(`(async () => {
    const m = await import('./src/content/weapons.js');
    document.getElementById('btn-start').click();
    const s = window.__shanhai;
    const w = s.world;
    if (!w) return { err: 'no world' };
    const unlockedSeries = JSON.parse(localStorage.getItem('shanhai-save-v1') || '{}').unlocks.series;
    const seen = {};
    const viol = [];
    let rounds = 0;
    for (let i = 0; i < 60 * 240 && w.running && rounds < 60; i++) {
      if (w.awaitingChoice) {
        rounds++;
        for (const c of w.cardChoices) {
          const wid = c.weaponId || c.passiveId;
          if (!wid) continue;
          const def = m.WEAPON_BY_ID[wid] || m.PASSIVE_BY_ID && m.PASSIVE_BY_ID[wid];
          const series = def ? def.series : '?';
          seen[series] = (seen[series] || 0) + 1;
          if (def && def.series && !unlockedSeries.includes(def.series)) {
            viol.push(wid + '(' + def.series + ')');
          }
        }
        w.takeCard(w.cardChoices[0]);
        continue;
      }
      w.input.mx = Math.cos(i / 90);
      w.input.my = Math.sin(i / 90);
      w.step();
    }
    return { unlockedSeries, rounds, seen, viol, char: w.characterId, weapons: w.slots.weapons.map((x) => x.id) };
  })()`);

  console.log('干净存档下跑 4 分钟、尽量多地触发三选一：');
  console.log('  已解锁的系：', JSON.stringify(report.unlockedSeries));
  console.log('  升级次数：', report.rounds);
  console.log('  卡片按系统计：', JSON.stringify(report.seen));
  console.log('  最终武器：', JSON.stringify(report.weapons));
  if (report.viol && report.viol.length) {
    console.log(`  ✗ 出现了未解锁系的卡 ${report.viol.length} 次：`);
    console.log('    ' + [...new Set(report.viol)].join(', '));
  } else {
    console.log('  ✓ 没有出现任何未解锁系的卡');
  }
  if (errors.length) {
    console.log('  页面异常：');
    for (const e of errors) console.log('    ' + String(e).split('\n')[0]);
  }
  ws.close();
  child.kill();
  await sleep(300);
  process.exit(report.viol && report.viol.length ? 1 : 0);
}

function mkdirSync_(p) {
  try {
    require('node:fs').mkdirSync(p, { recursive: true });
  } catch (e) {
    /* 忽略：改用异步创建 */
  }
}

main().catch((e) => {
  console.error('失败:', e && e.message);
  process.exit(1);
});
