// 真机自动化：连上 WebView 的 CDP，执行一串动作（点击 DOM 元素、求值、截图）。
// 用途：用 adb 盲点坐标验证真机交互极易出错（CSS 逻辑像素 ≠ 物理像素，
// 点不中就会把"弹窗挡住、世界正确暂停"误判成"游戏冻结"——真实踩过）。
// 这里用 DevTools 协议直接点 DOM 元素，并支持 CDP 截图，避免坐标换算。
//
// 用法：
//   node tools/device-act.mjs tap "#cards > *"            点第 1 张升级卡
//   node tools/device-act.mjs tap "#cards > *:nth-child(2)"  点第 2 张
//   node tools/device-act.mjs eval "window.__shanhai.world.player.level"
//   node tools/device-act.mjs shot artifacts/ondevice.png
//   node tools/device-act.mjs seq "tap #cards > *|eval window.__shanhai.world.player.level|shot a.png"
//
// 前置：debug 变体（同包名）+ WebView.setWebContentsDebuggingEnabled(true) + app 在前台。
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

const ADB = process.env.ADB || 'D:\\吴琦姜也\\tools\\android-build\\sdk\\platform-tools\\adb.exe';
const PORT = Number(process.env.CDP_PORT || 9222);
const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const unix = adb('shell', 'cat', '/proc/net/unix');
  const m = /@(webview_devtools_remote_\d+)/.exec(unix);
  if (!m) throw new Error('找不到 webview_devtools_remote_*（app 在跑吗？是 debug 变体吗？）');
  adb('forward', `tcp:${PORT}`, `localabstract:${m[1]}`);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || list[0];
  if (!page) throw new Error('没有可调试的页面目标');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  return { ws, send };
}

const evalJs = async (send, expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    throw new Error('表达式抛出: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
};

/** 用 CDP 在元素中心派发一次真实鼠标点击（对 DOM 按钮/listener 有效，无需坐标换算） */
async function clickSelector(send, selector) {
  const box = await evalJs(
    send,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height }; })()`,
  );
  if (!box) throw new Error(`选择器没匹配到元素: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: Math.round(box.x),
      y: Math.round(box.y),
      button: 'left',
      clickCount: 1,
    });
  }
  return box;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { ws, send } = await connect();
  try {
    if (cmd === 'seq') {
      for (const step of rest.join(' ').split('|')) {
        const [op, ...args] = step.trim().split(/\s+/);
        process.stdout.write(`  ${op} ${args.join(' ')} → `);
        if (op === 'tap') console.log(JSON.stringify(await clickSelector(send, args.join(' '))));
        else if (op === 'eval') console.log(JSON.stringify(await evalJs(send, args.join(' '))));
        else if (op === 'shot') {
          const r = await send('Page.captureScreenshot', { format: 'png' });
          await writeFile(args[0], Buffer.from(r.result.data, 'base64'));
          console.log(args[0]);
        } else if (op === 'wait') await sleep(Number(args[0]) || 500);
        else throw new Error('未知动作: ' + op);
      }
    } else if (cmd === 'tap') {
      console.log(JSON.stringify(await clickSelector(send, rest.join(' '))));
    } else if (cmd === 'eval') {
      const v = await evalJs(send, rest.join(' '));
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
    } else if (cmd === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      await writeFile(rest[0], Buffer.from(r.result.data, 'base64'));
      console.log('已保存', rest[0]);
    } else if (cmd === 'drag') {
      const [x0, y0, x1, y1, ms = 1000] = rest.map(Number);
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1, y: y1, id: 1 }] });
      await sleep(ms);
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      console.log(JSON.stringify({ x0, y0, x1, y1, ms }));
    } else {
      console.error('用法: device-act.mjs tap|eval|shot|drag|seq ...');
      process.exit(2);
    }
  } finally {
    ws.close();
  }
}

main().catch((e) => {
  console.error('失败:', e && e.message);
  process.exit(1);
});
