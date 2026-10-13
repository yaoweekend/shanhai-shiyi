// 断点续局 / 存档的浏览器端验证（真实 localStorage）。
// 用法：node tools/cdp-save.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const url = process.argv[2] || 'http://127.0.0.1:8099/index.html';
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function main() {
  const browser = CANDIDATES.find((p) => existsSync(p));
  if (!browser) throw new Error('找不到 Edge/Chrome');
  const profile = join(root, 'test', 'artifacts', 'cdp-profile-save');
  await mkdir(profile, { recursive: true });
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

  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, cond, detail });
    console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 清空存档，从干净状态开始
  await evalJs(`localStorage.clear(); location.reload();`);
  await sleep(2500);

  // 开一局，跑一会，保存并退出
  const step1 = await evalJs(`(() => {
    document.getElementById('btn-start').click();
    const s = window.__shanhai;
    if (!s.world) return { err: 'no world' };
    s.world.paused = false;
    for (let i = 0; i < 60 * 95; i++) {
      if (s.world.awaitingChoice) { s.world.takeCard(s.world.cardChoices[0]); continue; }
      if (!s.world.paused) { s.world.input.mx = Math.cos(i/70); s.world.input.my = Math.sin(i/70); s.world.step(); }
      if (!s.world.running) break;
    }
    return { elapsed: Math.round(s.world.elapsedMs/1000), kills: s.world.runStats.kills, lv: s.world.player.level, char: s.world.characterId };
  })()`);
  console.log('  开局推进到:', JSON.stringify(step1));

  const saveState = await evalJs(`(() => {
    document.getElementById('btn-pause').click();
    document.getElementById('btn-savequit').click();
    const raw = localStorage.getItem('shanhai-save-v1');
    const save = raw ? JSON.parse(raw) : null;
    return {
      hasSave: !!save,
      unfinishedTick: save && save.unfinishedRun ? save.unfinishedRun.tick : null,
      unfinishedElapsed: save && save.unfinishedRun ? save.unfinishedRun.elapsedMs : null,
      continueVisible: !document.getElementById('btn-continue').hidden,
      hasWorld: !!window.__shanhai.world,
    };
  })()`);
  console.log('  保存并退出后:', JSON.stringify(saveState));
  check('保存后 localStorage 里有未完成的一局', !!saveState.hasSave && saveState.unfinishedTick > 0, `tick=${saveState.unfinishedTick}`);
  check('退出后世界已释放', saveState.hasWorld === false);
  check('主菜单出现「接着上一局」', saveState.continueVisible === true);

  // 刷新页面（模拟"手机被打断后重新打开"），再接着打
  await evalJs(`location.reload()`);
  await sleep(2800);
  const afterReload = await evalJs(`(() => {
    const raw = localStorage.getItem('shanhai-save-v1');
    return { continueVisible: !document.getElementById('btn-continue').hidden, hasSave: !!raw };
  })()`);
  check('刷新后仍能续局', afterReload.continueVisible === true && afterReload.hasSave === true, JSON.stringify(afterReload));

  const step2 = await evalJs(`(() => {
    document.getElementById('btn-continue').click();
    const s = window.__shanhai.world;
    if (!s) return { err: 'resume failed' };
    const start = s.elapsedMs;
    s.paused = false;
    for (let i = 0; i < 60 * 20; i++) {
      if (s.awaitingChoice) { s.takeCard(s.cardChoices[0]); continue; }
      s.input.mx = Math.cos(i/70); s.input.my = Math.sin(i/70); s.step();
      if (!s.running) break;
    }
    return { startElapsed: Math.round(start/1000), nowElapsed: Math.round(s.elapsedMs/1000), lv: s.player.level, char: s.characterId };
  })()`);
  console.log('  续局推进:', JSON.stringify(step2));
  check('续局从存档时间点继续', step2.nowElapsed > step2.startElapsed, JSON.stringify(step2));
  check('续局保留了角色与等级', !!step2.char && step2.lv >= 1, JSON.stringify(step2));

  // 结算写盘：直接把世界打死，走结算流程
  const settle = await evalJs(`(() => {
    const s = window.__shanhai.world;
    s.player.hp = 0;
    s.outcome = 'dead';
    s.running = false;
    return true;
  })()`);
  void settle;
  await sleep(1500);
  const afterDeath = await evalJs(`(() => {
    const raw = localStorage.getItem('shanhai-save-v1');
    const save = raw ? JSON.parse(raw) : null;
    return {
      resultVisible: !document.getElementById('screen-result').hidden,
      highScore: save ? save.highScore.kills : null,
      killsTotal: save ? save.counters.killsTotal : null,
      unfinished: save ? !!save.unfinishedRun : null,
      codex: save ? Object.keys(save.codex).length : null,
    };
  })()`);
  console.log('  死亡结算后:', JSON.stringify(afterDeath));
  check('结算画面出现', afterDeath.resultVisible === true);
  check('最高分写盘', afterDeath.highScore > 0, `kills=${afterDeath.highScore}`);
  check('累计击杀写盘', afterDeath.killsTotal > 0, `${afterDeath.killsTotal}`);
  check('图鉴记录写盘', afterDeath.codex > 0, `${afterDeath.codex} 条`);
  check('结算后清空未完成的一局', afterDeath.unfinished === false);

  // 再开一局，检查上一局的记录仍保留（存档不互相覆盖关键字段）
  await evalJs(`document.getElementById('btn-tomenu').click()`);
  await sleep(400);
  const persist = await evalJs(`(() => {
    const raw = localStorage.getItem('shanhai-save-v1');
    const save = JSON.parse(raw);
    return { highScore: save.highScore.kills, trialsShan: save.trials.shan.done, series: save.unlocks.series.length };
  })()`);
  console.log('  回主菜单后存档:', JSON.stringify(persist));
  check('回到主菜单后存档字段完整', persist.series >= 3 && persist.highScore > 0, JSON.stringify(persist));

  console.log(`\n  页面累计异常：${errors.length}`);
  for (const e of errors) console.log('   ! ' + e);
  ws.close();
  child.kill();
  await sleep(300);
  const failed = results.filter((r) => !r.cond).length + errors.length;
  console.log(`\n================ 续局验证 ${results.filter((r) => r.cond).length} 通过 / ${failed} 失败 ================`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.message);
  process.exit(1);
});
