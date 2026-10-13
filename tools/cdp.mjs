// 用 CDP 打开页面、抓 console/异常、注入交互、截图。零依赖（Node 内置 fetch + WebSocket）。
// 用法：node tools/cdp.mjs <url> <outPrefix> [--game]
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const url = process.argv[2] || 'http://127.0.0.1:8099/index.html';
const prefix = process.argv[3] || 'shot';
const wantGame = process.argv.includes('--game');
const PORT = 9333;

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function findBrowser() {
  const { existsSync } = await import('node:fs');
  for (const p of EDGE_CANDIDATES) if (existsSync(p)) return p;
  throw new Error('找不到 Edge/Chrome');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await findBrowser();
  const profile = join(root, 'test', 'artifacts', 'cdp-profile');
  await mkdir(profile, { recursive: true });
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--hide-scrollbars',
      '--window-size=1280,640',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      targets = await r.json();
      if (targets && targets.length) break;
    } catch (e) {
      /* 还没起来 */
    }
  }
  if (!targets || !targets.length) {
    child.kill();
    throw new Error('浏览器调试端口没起来');
  }
  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const logs = [];
  const errors = [];
  let id = 0;

  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({
        type: msg.params.type,
        text: (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '),
      });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      const desc = (d.exception && (d.exception.description || d.exception.value)) || d.text;
      errors.push({ text: desc, url: d.url, line: d.lineNumber, col: d.columnNumber });
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') errors.push({ text: e.text, url: e.url, line: e.lineNumber });
      else logs.push({ type: e.level, text: e.text });
    }
  });

  const send = (method, params = {}) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(3500);

  const evalJs = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.result && r.result.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  const state = await evalJs(`(() => {
    const cards = document.querySelectorAll('.char-card').length;
    return {
      bootfailVisible: !document.getElementById('bootfail').hidden,
      menuHidden: document.getElementById('screen-menu').hidden,
      cards,
      canvas: (() => { const c = document.getElementById('game'); return c ? c.width + 'x' + c.height : 'none'; })(),
      hasDebug: !!window.__shanhai,
      title: document.title,
    };
  })()`);

  console.log('页面状态:', JSON.stringify(state, null, 2));
  console.log('console 输出:');
  for (const l of logs) console.log(`  [${l.type}] ${l.text}`);
  if (errors.length) {
    console.log('❌ 页面异常/错误:');
    for (const e of errors) console.log(`  ${e.text}${e.url ? `\n     at ${e.url}:${e.line}:${e.col}` : ''}`);
  } else {
    console.log('✓ 没有页面异常');
  }

  await send('Page.captureScreenshot', {}).then(async (r) => {
    if (r.result && r.result.data) {
      const out = join(root, 'test', 'artifacts', `${prefix}.png`);
      await writeFile(out, Buffer.from(r.result.data, 'base64'));
      console.log(`菜单截图: ${out}`);
    }
  });

  if (wantGame && state.hasDebug) {
    // 直接开一局，跑 40 秒模拟 + 渲染，验证局内画面与 HUD 不报错
    console.log('---- 进入局内验证 ----');
    await evalJs(`document.getElementById('btn-start').click()`);
    await sleep(600);
    const g1 = await evalJs(`(() => {
      const s = window.__shanhai;
      return { hasWorld: !!s.world, mode: s.world && s.world.outcome, hp: s.world && s.world.player.hp };
    })()`);
    console.log('开局后:', JSON.stringify(g1));
    // 快进模拟（不依赖真实时间）：直接推进 world
    const fast = await evalJs(
      `(() => { const w = window.__shanhai.world; if (!w) return 'no world';
        for (let i = 0; i < 60 * 210; i++) {
          if (w.awaitingChoice) { w.takeCard(w.cardChoices[0]); continue; }
          w.input.mx = Math.cos(i / 90); w.input.my = Math.sin(i / 90);
          w.step();
          if (!w.running) break;
        }
        return { elapsed: Math.round(w.elapsedMs / 1000), kills: w.runStats.kills, lv: w.player.level, running: w.running }; })()`,
    );
    console.log('快进 210 秒后:', JSON.stringify(fast));
    await sleep(1200);
    const shot2 = await send('Page.captureScreenshot', {});
    if (shot2.result && shot2.result.data) {
      const out = join(root, 'test', 'artifacts', `${prefix}-game.png`);
      await writeFile(out, Buffer.from(shot2.result.data, 'base64'));
      console.log(`局内截图: ${out}`);
    }
    // 顺便验证升级弹窗与试炼/图鉴/关于页能打开
    for (const id of ['btn-trials', 'btn-codex', 'btn-about', 'btn-settings']) {
      const r = await evalJs(`(() => { const b = document.getElementById('${id}'); if (!b) return 'missing'; b.click(); const el = document.querySelector('.modal:not([hidden]) .modal, .screen:not([hidden]) .modal, .screen:not([hidden]) .levelup'); return el ? el.textContent.slice(0, 40) : 'no modal'; })()`);
      console.log(`  ${id} → ${JSON.stringify(r)}`);
      await evalJs(`document.querySelectorAll('[data-back]').forEach(b => b.click())`);
    }
    const errs2 = errors.length;
    console.log(`交互后累计异常数：${errs2}`);
  }

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => {
  console.error('CDP 失败:', e && e.message);
  process.exit(1);
});
