// 启动自检 + 老内核降级提示（规格 §15 第三件硬门槛）。
// 目标：老 WebView 上给出**提示页**，而不是白屏或卡死。
// 这是唯一会让玩家直接给差评的失败形态，所以它在最前面跑。

export const BOOT_CHECK_ORDER = ['dom', 'canvas', 'es2015', 'raf', 'storage', 'audio', 'offscreen'];

export function runBootChecks() {
  const results = [];
  const push = (id, ok, detail) => results.push({ id, ok: !!ok, detail: detail || '' });

  push('dom', typeof document !== 'undefined' && !!document.getElementById, 'DOM 可用');
  push('es2015', typeof Promise !== 'undefined' && typeof Symbol !== 'undefined' && typeof Map !== 'undefined', 'ES2015 基础对象');

  let canvasOk = false;
  let canvasDetail = '';
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext && c.getContext('2d');
    canvasOk = !!ctx && typeof ctx.fillRect === 'function' && typeof ctx.createLinearGradient === 'function';
    if (!canvasOk) canvasDetail = 'canvas 2d 上下文不可用';
  } catch (e) {
    canvasDetail = String(e && e.message ? e.message : e);
  }
  push('canvas', canvasOk, canvasDetail);

  push('raf', typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function', 'requestAnimationFrame');

  let storageOk = false;
  try {
    window.localStorage.setItem('__sh_probe', '1');
    window.localStorage.removeItem('__sh_probe');
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
  push('storage', storageOk, storageOk ? 'localStorage 可写' : 'localStorage 不可用（进度无法保存，但游戏可玩）');

  const audioOk = !!(window.AudioContext || window.webkitAudioContext);
  push('audio', audioOk, audioOk ? 'WebAudio 可用' : 'WebAudio 不可用（将静音运行）');

  push('offscreen', typeof Object.assign === 'function' && typeof Array.prototype.includes === 'function', 'ES2017 常用方法');

  // 硬失败：这些不满足就没法跑，必须给提示页
  const HARD = { dom: 1, canvas: 1, es2015: 1, raf: 1, offscreen: 1 };
  const hardFailures = results.filter((r) => HARD[r.id] && !r.ok);
  return { results, ok: hardFailures.length === 0, hardFailures, soft: results.filter((r) => !HARD[r.id] && !r.ok) };
}

/** 用户代理推断（只用于提示文案与默认画质，不做任何网络请求） */
export function guessEnvironment() {
  const ua = (navigator && navigator.userAgent) || '';
  const m = /Android\s+([\d.]+)/.exec(ua);
  const chrome = /Chrome\/(\d+)/.exec(ua);
  const webview = /;\s*wv\)/.test(ua);
  return {
    ua,
    androidVersion: m ? m[1] : null,
    chromeVersion: chrome ? Number(chrome[1]) : null,
    isWebView: webview,
    isMobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
  };
}

/**
 * 低端机自动降档（规格 §11 兜底开关）。
 * 判据：设备内存、CPU 核数、以及 UA 推断的老内核。
 */
export function suggestQuality() {
  const env = guessEnvironment();
  let score = 100;
  if (typeof navigator !== 'undefined') {
    if (navigator.deviceMemory !== undefined) score = Math.min(score, navigator.deviceMemory * 25);
    if (navigator.hardwareConcurrency !== undefined) score = Math.min(score, navigator.hardwareConcurrency * 20);
  }
  if (env.chromeVersion !== null && env.chromeVersion < 70) score -= 40;
  if (env.androidVersion) {
    const major = parseInt(env.androidVersion, 10);
    if (major <= 7) score -= 25;
    else if (major <= 9) score -= 10;
  }
  return score < 45 ? 'low' : 'high';
}

export function renderBootFailure(root, check) {
  const items = check.results
    .map((r) => `<li class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${labelOf(r.id)}${r.detail ? ' — ' + r.detail : ''}</li>`)
    .join('');
  root.innerHTML = `
    <div class="bootfail">
      <h1>这台设备打不开《山海拾遗》</h1>
      <p>游戏需要 Android WebView / 浏览器支持 Canvas 2D。你的环境缺少下面标红的能力，继续下去只会是一屏白，所以这里直接告诉你。</p>
      <ul class="bootlist">${items}</ul>
      <h2>怎么办</h2>
      <ol>
        <li>用手机自带的「Chrome」或「Edge」浏览器打开本页（而不是在微信/QQ 内置浏览器里打开）。</li>
        <li>如果是在 App 内打开：点右上角菜单，选「在浏览器中打开」。</li>
        <li>仍然不行：在应用商店更新「Android System WebView」。Android 7 以下的机型建议换用新一点的设备。</li>
      </ol>
      <p class="muted">本页不发送任何网络请求。诊断结果仅显示在此。</p>
    </div>`;
}

function labelOf(id) {
  const map = {
    dom: '页面结构',
    canvas: 'Canvas 2D 绘图',
    es2015: 'ES2015 语言特性',
    raf: '动画帧接口',
    storage: '本地存档',
    audio: 'WebAudio 音频',
    offscreen: 'ES2017 常用方法',
  };
  return map[id] || id;
}
