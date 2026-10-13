// 真浏览器回归：终极测试版加载调参面板后，默认仍会受伤；无敌开关能生效并关闭。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
if (!browser) throw new Error('找不到 Edge/Chrome');
const port = 9347;
const profile = join(root, 'test', 'artifacts', 'cdp-profile-dev-damage');
mkdirSync(profile, { recursive: true });
const child = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
try {
  let page;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
    } catch { /* 等浏览器启动 */ }
  }
  if (!page) throw new Error('浏览器调试端口没有启动');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8099/?dev=ultimate,tune' });
  for (let i = 0; i < 40; i++) {
    if (await evalJs('!!window.__shanhai?.tunePanel')) break;
    await sleep(250);
  }
  const result = await evalJs(`(async () => {
    const app = window.__shanhai;
    if (!app?.tunePanel) throw new Error('调参面板未加载');
    app.controller.startRun('shanpo');
    await new Promise(r => setTimeout(r, 150));
    const w = app.world;
    const { hurtPlayer } = await import('./src/sim/stats.js');
    const strike = () => {
      w.player.iframeUntil = 0;
      w.player.shield = 0;
      const hp = w.player.hp;
      hurtPlayer(w, 20);
      return hp - w.player.hp;
    };
    const defaultInv = w.invincible;
    const defaultLoss = strike();
    app.tunePanel.state.inv = true;
    app.tunePanel.applyState();
    await new Promise(r => setTimeout(r, 100));
    const invLoss = strike();
    app.tunePanel.state.inv = false;
    app.tunePanel.applyState();
    await new Promise(r => setTimeout(r, 100));
    const afterOffLoss = strike();
    app.tunePanel.state.inv = true;
    app.tunePanel.applyState();
    app.controller.startRun('haipo');
    await new Promise(r => setTimeout(r, 100));
    const invAfterRestart = app.world.invincible;
    app.controller.saveAndQuit();
    app.controller.resumeRun();
    await new Promise(r => setTimeout(r, 100));
    const invAfterResume = app.world.invincible;
    return { devUltimate: w.devUltimate, defaultInv, defaultLoss, invLoss, afterOffLoss, invAfterRestart, invAfterResume };
  })()`);
  console.log(JSON.stringify(result));
  if (!result.devUltimate || result.defaultInv || result.defaultLoss <= 0 || result.invLoss !== 0 || result.afterOffLoss <= 0 || !result.invAfterRestart || !result.invAfterResume) {
    process.exitCode = 1;
    console.error('终极测试版受击回归失败');
  }
} finally {
  ws?.close();
  child.kill();
}
