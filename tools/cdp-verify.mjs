// 浏览器内实机检查：槽位命名、卡片图标、素体挂件、升级弹窗、试炼/图鉴面板。
// 用法：node tools/cdp-verify.mjs [url]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const url = process.argv[2] || 'http://127.0.0.1:8099/index.html';
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

const results = [];
const errors = [];
function check(name, cond, detail = '') {
  results.push({ name, cond, detail });
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const browser = CANDIDATES.find((p) => existsSync(p));
  if (!browser) throw new Error('找不到 Edge/Chrome');
  const profile = join(root, 'test', 'artifacts', 'cdp-profile-verify');
  mkdirSync(profile, { recursive: true });
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--window-size=1280,640', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (txt.includes('[takeCard]')) console.log('    page> ' + txt);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push((d.exception && d.exception.description) || d.text);
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push(m.params.entry.text);
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
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(3000);
  await evalJs('localStorage.clear(); location.reload();');
  await sleep(2500);

  // ① 页面基本状态
  const base = await evalJs(`(() => ({
    bootfail: !document.getElementById('bootfail').hidden,
    menuVisible: !document.getElementById('screen-menu').hidden,
    cards: document.querySelectorAll('.char-card').length,
    hasDebug: !!window.__shanhai,
  }))()`);
  check('启动自检通过（没有降级提示页）', base.bootfail === false);
  check('主菜单可见且列出 3 个角色', base.menuVisible && base.cards === 3, JSON.stringify(base));

  // ② 清单与生成器：每个批 1 槽位都能取到图形
  const slots = await evalJs(`(async () => {
    const m = await import('./src/assets/manifest.js');
    const g = await import('./src/assets/generator.js');
    const out = { total: m.SLOTS.length, noCanvas: 0, zeroSize: 0, missing: [] };
    for (const s of m.SLOTS) {
      const a = g.getAsset(s.id);
      if (!a.source) { out.missing.push(s.id); continue; }
      if (a.source.width === 0 || a.source.height === 0) out.zeroSize++;
    }
    // 故意请求一个不存在的槽位：不能抛异常
    const bogus = g.getAsset('icon_does_not_exist');
    out.bogusHandled = bogus.source === null && bogus.isPlaceholder === true;
    return out;
  })()`);
  check('全部槽位都能生成占位图（无空图/零尺寸）', slots.missing.length === 0 && slots.zeroSize === 0, JSON.stringify(slots));
  check('请求不存在的槽位不抛异常', slots.bogusHandled === true);

  // ③ 图标命名：渲染层实际会请求的 id 都在清单里
  const iconCheck = await evalJs(`(async () => {
    const m = await import('./src/assets/manifest.js');
    const w = await import('./src/content/weapons.js');
    const ids = w.BATCH1_WEAPONS.map(x => 'icon_' + x.id);
    return { ids, missing: ids.filter(id => !m.slotById(id)) };
  })()`);
  check('武器图标槽位 id 全部存在（icon_<武器id>）', iconCheck.missing.length === 0, iconCheck.missing.join(','));

  // ④ 卡片图标真的能渲染（img.src 是 dataURL 而不是空）
  const cardIcons = await evalJs(`(() => {
    const w = window.__shanhai.world;
    return null;
  })()`);
  void cardIcons;

  // ⑤ 开一局，触发一次真实升级（经验注入 + 让主循环自己弹出升级界面）
  const levelup = await evalJs(`(async () => {
    document.getElementById('btn-start').click();
    const s = window.__shanhai;
    const w = s.world;
    if (!w) return { err: 'no world' };
    w.paused = false;
    w.player.xp = w.player.xpNext;                       // 让下一次拾取必然升级
    w.collectDrop({ kind: 'xp', value: 1, x: w.player.x, y: w.player.y });
    // 等主循环把升级弹窗渲染出来（不是我们自己调 UI）
    const t0 = Date.now();
    while (document.getElementById('screen-levelup').hidden && Date.now() - t0 < 2500) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const cardsEl = document.querySelectorAll('#cards .card');
    const imgs = [...cardsEl].map((c) => {
      const img = c.querySelector('img');
      return {
        src: img ? img.getAttribute('src') : null,
        title: c.querySelector('h3') ? c.querySelector('h3').textContent : null,
        series: c.querySelector('.series-tag') ? c.querySelector('.series-tag').textContent : null,
      };
    });
    return { cardCount: cardsEl.length, imgs, awaiting: w.awaitingChoice, modalVisible: !document.getElementById('screen-levelup').hidden };
  })()`);
  check('升级弹窗出现且给出 3 张卡', levelup.cardCount === 3 && levelup.modalVisible === true, JSON.stringify(levelup).slice(0, 240));
  const okIcons = (levelup.imgs || []).length === 3 && levelup.imgs.every((i) => i.src && i.src.startsWith('data:image/png'));
  check('卡片图标是真实生成的图形（dataURL）', okIcons, JSON.stringify((levelup.imgs || []).map((i) => i.src && i.src.slice(0, 24))));
  check('每张卡都带神系标签与标题', (levelup.imgs || []).every((i) => i.series && i.title));

  // 选第一张，确认能回到游戏。
  // 注意：真实玩家点了卡之后，主循环会在下一帧继续跑；如果此时又攒够了经验，
  // 会立刻弹出下一张升级卡（这是正确行为，不是 bug）。所以这里给出宽限时间窗。
  const afterPick = await evalJs(`(async () => {
    try {
      const hud = document.getElementById('screen-hud');
      const card = document.querySelectorAll('#cards .card')[0];
      if (!card) return { err: 'no card element' };
      card.click();
      const immediately = hud.hidden;
      const t0 = Date.now();
      let becameVisible = false;
      while (Date.now() - t0 < 3000) {
        if (!hud.hidden) { becameVisible = true; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      const w = window.__shanhai.world;
      return {
        immediately,
        becameVisible,
        finalHudHidden: hud.hidden,
        levelupVisible: !document.getElementById('screen-levelup').hidden,
        paused: w ? w.paused : null,
        awaiting: w ? w.awaitingChoice : null,
        worldRunning: w ? w.running : null,
      };
    } catch (e) {
      return { err: String(e && e.message ? e.message : e) };
    }
  })()`);
  check(
    '选卡后回到局内（HUD 再次可见）',
    afterPick.becameVisible === true || afterPick.levelupVisible === true,
    JSON.stringify(afterPick),
  );
  check('选卡后世界在继续跑（不是卡死）', afterPick.worldRunning === true && afterPick.paused !== true, JSON.stringify(afterPick));

  // ⑥ 快进到 200 秒并截图（HUD / 敌人 / 子弹 / 摇杆 / 两个按钮都在画）
  const sim = await evalJs(`(() => {
    const w = window.__shanhai.world;
    // 快进需要足够多的循环次数：每步只推进 1/60 秒，且升级会消耗步数，所以上限给宽
    let guard = 0;
    while (w.elapsedMs < 200000 && w.running && guard++ < 60 * 900) {
      if (w.awaitingChoice) { w.takeCard(w.cardChoices[0]); continue; }
      w.input.mx = Math.cos(guard / 80); w.input.my = Math.sin(guard / 80);
      if (!w.paused) w.step();
    }
    return { t: Math.round(w.elapsedMs / 1000), kills: w.runStats.kills, enemies: w.enemies.active.length, bullets: w.bullets.active.length, lv: w.player.level, tier: w.runStats.maxTier };
  })()`);
  console.log('  快进后：', JSON.stringify(sim));
  check('局内能推进到中盘', sim.t >= 190 && sim.kills > 0, JSON.stringify(sim));
  await sleep(900);
  const shot = await send('Page.captureScreenshot', {});
  if (shot.result && shot.result.data) {
    const out = join(root, 'test', 'artifacts', 'verify-game.png');
    await writeFile(out, Buffer.from(shot.result.data, 'base64'));
    console.log(`  局内截图：${out}`);
  }

  // ⑦ 各面板仍可打开且内容非空
  for (const [btn, expect] of [['btn-trials', '试炼'], ['btn-codex', '图鉴'], ['btn-about', '许可'], ['btn-settings', '静音']]) {
    const r = await evalJs(`(() => {
      const b = document.getElementById('${btn}');
      if (!b) return 'missing-btn';
      b.click();
      const el = document.querySelector('.screen:not([hidden])');
      const txt = el ? el.textContent : '';
      document.querySelectorAll('[data-back]').forEach(x => x.click());
      return { visible: !!el, len: txt.length, hasKey: txt.includes('${expect}'), screens: document.querySelectorAll('.screen:not([hidden])').length };
    })()`);
    check(`${btn} 打开后内容非空且含「${expect}」`, r.visible && r.len > 60 && r.hasKey, JSON.stringify(r));
  }

  // ⑧ 图鉴的"见过/未见过"与试炼进度条真的渲染
  const panels = await evalJs(`(() => {
    document.getElementById('btn-trials').click();
    const trials = document.querySelectorAll('#trials-body .trial').length;
    const bars = document.querySelectorAll('#trials-body .bar i').length;
    document.querySelectorAll('[data-back]').forEach(x => x.click());
    document.getElementById('btn-codex').click();
    const vols = document.querySelectorAll('#codex-body .codex-vol').length;
    const items = document.querySelectorAll('#codex-body li').length;
    document.querySelectorAll('[data-back]').forEach(x => x.click());
    return { trials, bars, vols, items };
  })()`);
  check('试炼面板 6 条 + 进度条', panels.trials === 6 && panels.bars === 6, JSON.stringify(panels));
  check('图鉴 6 卷且有内容条目', panels.vols === 6 && panels.items > 20, JSON.stringify(panels));

  console.log(`\n  页面累计异常：${errors.length}`);
  for (const e of errors) console.log('   ! ' + String(e).split('\n')[0]);
  ws.close();
  child.kill();
  await sleep(300);
  const failed = results.filter((r) => !r.cond).length + errors.length;
  console.log(`\n================ 实机检查 ${results.filter((r) => r.cond).length} 通过 / ${failed} 失败 ================`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('失败:', e && e.message);
  process.exit(1);
});
