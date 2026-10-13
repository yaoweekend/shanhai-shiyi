// 连到真机 WebView（Chrome DevTools Protocol），读页面真实状态 / 求值任意表达式。
// 用法：
//   1) build.gradle 的 debug 变体保持"同包名"，并且 MainActivity 里
//      WebView.setWebContentsDebuggingEnabled(true) 只在 BuildConfig.DEBUG 下执行
//   2) adb install -r app-debug.apk && 启动 app
//   3) node tools/device-probe.mjs "<表达式>"        求值一次
//      node tools/device-probe.mjs --watch "<表达式>" 每 2 秒求值一次（看状态是否在变）
//
// 存在的理由：冻结/异常这类问题，靠截图只能看出"画面不动"，看不出"为什么不动"。
// 这个脚本能直接问页面：world.elapsedMs 还在涨吗？mode 是什么？上一帧的异常是什么？
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'D:\\吴琦姜也\\tools\\android-build\\sdk\\platform-tools\\adb.exe';
const PORT = Number(process.env.CDP_PORT || 9222);

const args = process.argv.slice(2);
const watch = args[0] === '--watch';
const expr = watch ? args[1] : args[0];
if (!expr) {
  console.error('用法: node tools/device-probe.mjs [--watch] "<js 表达式>"');
  process.exit(2);
}

const adb = (...a) => execFileSync(ADB, a, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 找 WebView 的 socket 名（形如 webview_devtools_remote_7107）
  const unix = adb('shell', 'cat', '/proc/net/unix');
  const m = /@(webview_devtools_remote_\d+)/.exec(unix);
  if (!m) {
    console.error('没找到 webview_devtools_remote_*。确认：app 正在运行 + debug 变体 + setWebContentsDebuggingEnabled(true)');
    process.exit(3);
  }
  const sock = m[1];
  adb('forward', `tcp:${PORT}`, `localabstract:${sock}`);

  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || list[0];
  if (!page) {
    console.error('没有可调试的页面目标');
    process.exit(4);
  }
  console.log(`已连上: ${page.title || '(无标题)'}  ${page.url}`);

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

  const evaluate = (expression) =>
    new Promise((res) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(
        JSON.stringify({
          id: myId,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });

  const runOnce = async () => {
    const r = await evaluate(expr);
    if (r.error) return console.log('协议错误:', JSON.stringify(r.error));
    const res = r.result || {};
    if (res.exceptionDetails) {
      return console.log('表达式抛出:', res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    const v = res.result ? res.result.value : undefined;
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  };

  if (!watch) {
    await runOnce();
    ws.close();
    return;
  }
  for (let i = 0; i < 60; i++) {
    process.stdout.write(`[${i}] `);
    await runOnce();
    await sleep(2000);
  }
  ws.close();
}

main().catch((e) => {
  console.error('失败:', e && e.message);
  process.exit(1);
});
