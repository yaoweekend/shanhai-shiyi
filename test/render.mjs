// 渲染层冒烟测试（不需要浏览器）：用 stub 的 Canvas 2D 上下文把所有绘制路径跑一遍，
// 断言渲染层不会因为真实的模拟状态抛异常。
// 用法：node test/render.mjs
import { World } from '../src/sim/world.js';
import { Renderer } from '../src/render/render2d.js';
import { kitingPolicy } from './kite.mjs';
import { autoTakeCards } from './policy.mjs';

let pass = 0;
let fail = 0;
const bad = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else {
    fail++;
    bad.push(name + (detail ? ' — ' + detail : ''));
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---- stub canvas / ctx：只记录被调用的 API，不真的画 ----
function makeCtx() {
  const calls = {};
  const rec = (name) => (...args) => {
    calls[name] = (calls[name] || 0) + 1;
    if (args.some((a) => typeof a === 'number' && !Number.isFinite(a))) {
      throw new Error(`${name} 收到非有限数字：${JSON.stringify(args).slice(0, 120)}`);
    }
    return undefined;
  };
  const gradient = { addColorStop() {} };
  const ctx = {
    canvas: { width: 960, height: 540 },
    calls,
    save: rec('save'),
    restore: rec('restore'),
    setTransform: rec('setTransform'),
    translate: rec('translate'),
    scale: rec('scale'),
    rotate: rec('rotate'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    rect: rec('rect'),
    quadraticCurveTo: (a, b, c, d, e, f) => {
      if (![a, b, c, d, e, f].every(Number.isFinite)) throw new Error('quadraticCurveTo 非有限');
    },
    fill: rec('fill'),
    stroke: rec('stroke'),
    clip: rec('clip'),
    fillRect: rec('fillRect'),
    strokeRect: rec('strokeRect'),
    drawImage: (img, ...rest) => {
      calls.drawImage = (calls.drawImage || 0) + 1;
      if (!img) throw new Error('drawImage 收到空图像');
      if (rest.some((v) => !Number.isFinite(v))) throw new Error('drawImage 非有限坐标');
    },
    fillText: (t) => {
      calls.fillText = (calls.fillText || 0) + 1;
      if (t === undefined) throw new Error('fillText 收到 undefined');
    },
    setLineDash: rec('setLineDash'),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'filter', 'lineCap']) {
    ctx[k] = '';
  }
  return ctx;
}

// ---- stub document：占位生成器要建 canvas ----
function installDom() {
  const makeCanvasEl = () => {
    const el = {
      width: 32,
      height: 32,
      style: {},
      getContext: () => makeCtx(),
      toDataURL: () => 'data:image/png;base64,',
    };
    return el;
  };
  const body = { appendChild() {}, removeChild() {} };
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvasEl() : { style: {}, appendChild() {}, removeChild() {} }),
    body,
    getElementById: () => null,
  };
  globalThis.window = {
    devicePixelRatio: 2,
    innerWidth: 1280,
    innerHeight: 640,
    addEventListener() {},
    requestAnimationFrame: (cb) => setTimeout(() => cb(performance.now()), 16),
    AudioContext: undefined,
  };
  // Node 24 的 navigator 是 getter-only，必须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'test', deviceMemory: 4, hardwareConcurrency: 4 },
    configurable: true,
    writable: true,
  });
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.Image = class {
    set src(v) {
      /* 永不触发 onload：走占位图回退路径 */
    }
  };
}
installDom();

const canvas = { width: 1280, height: 640, style: {}, getContext: () => makeCtx(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 640 }) };

// ================= 1. 菜单态（world = null）不抛异常 =================
{
  const r = new Renderer(canvas, {});
  let threw = null;
  try {
    r.render(null, { showHud: false });
  } catch (e) {
    threw = e;
  }
  check('world 为 null 时渲染不抛异常（菜单态）', !threw, threw && threw.message);
}

// ================= 2. 局内渲染：覆盖各武器/敌人/特效 =================
{
  const world = new World({ seed: 20260926, characterId: 'shanpo' });
  world.paused = false;
  // 三把武器 + 四个被动，覆盖 orbit / boomerang / strike / zone / sweep / beam / summon / projectile 全部绘制分支
  world.slots.weapons = [
    { id: 'w_shoujia', level: 5, cd: 0, superId: 'f1' },
    { id: 'w_guhai', level: 5, cd: 0, superId: null },
    { id: 'w_lizhao', level: 5, cd: 0, superId: null },
  ];
  world.slots.passives = ['dangkangya', 'jiuweiyi', 'zhulongtong', 'bashetun'];
  world.recompute();
  world.refreshWeaponEntities();

  // 每种武器独立跑一遍开火，确保每条 fire* 分支都执行
  const kinds = ['w_shoujia', 'w_guhai', 'w_lizhao', 'w_linyu', 'w_jiaozhu', 'w_jingxi', 'w_huanglei', 'w_zhangqi', 'w_zhaoyin'];
  let fireErrors = [];
  for (const id of kinds) {
    const w2 = new World({ seed: 7, characterId: 's'.length ? 'huangpo' : 'huangpo' });
    w2.paused = false;
    w2.slots.weapons = [{ id, level: 5, cd: 0, superId: null }];
    w2.recompute();
    w2.refreshWeaponEntities();
    for (let i = 0; i < 240; i++) {
      w2.input.mx = Math.cos(i / 20);
      w2.input.my = Math.sin(i / 20);
      try {
        w2.step();
      } catch (e) {
        fireErrors.push(`${id}: ${e.message}`);
        break;
      }
    }
  }
  check('9 把武器各自开火不抛异常', fireErrors.length === 0, fireErrors.join('; '));

  // 造满屏实体后再渲染
  for (let i = 0; i < 250; i++) {
    world.spawnEnemyFrom({ kind: ['shanxiao', 'bifang', 'huashe', 'xinang', 'qiangliang'][i % 5], tier: 4, x: 200 + (i % 16) * 120, y: 200 + Math.floor(i / 16) * 100, elite: i % 17 === 0, affix: 'rage' });
  }
  world.spawnEnemyFrom({ kind: 'xiangliu', boss: true, x: 1200, y: 600, tier: 5 });
  for (let i = 0; i < 200; i++) {
    world.input.mx = Math.cos(i / 30);
    world.input.my = Math.sin(i / 30);
    world.step();
    if (world.awaitingChoice) autoTakeCards(world);
  }
  // 手工塞一批子弹/粒子/伤害数字/掉落，覆盖所有渲染分支
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    world.spawnPlayerBullet({ x: 1200 + Math.cos(a) * 40, y: 600 + Math.sin(a) * 40, angle: a, speed: 300, damage: 5, radius: 6, weaponId: kinds[i % kinds.length], shape: 'scale', color: '#fff' });
    world.spawnEnemyBullet({ x: 1200, y: 600 }, a, 200, 5, i % 2 ? 'bossOrb' : 'bossArrow');
  }
  for (const e of world.enemies.active) {
    e.hitFlash = 0.1;
    e.fuseUntil = world.elapsedMs + 300;
    e.chargeState = 2;
    e.chargeAngle = 1.2;
  }
  world.hintText = '测试提示';
  world.hintUntil = world.elapsedMs + 5000;
  world.bossActive = true;
  world.shake = 6;

  const r = new Renderer(canvas, {});
  let threw = null;
  let frames = 0;
  try {
    for (let i = 0; i < 30; i++) {
      world.elapsedMs += 16;
      world.player.hp = Math.max(1, world.player.hp);
      r.render(world, { joystick: { dx: 0.5, dy: -0.5 }, showHud: true, showFps: true });
      frames++;
    }
  } catch (e) {
    threw = e;
  }
  check(`高负载局内渲染 ${frames} 帧不抛异常`, !threw, threw && `${threw.message}\n${threw.stack}`);
  check('绘制调用确实发生了', (r.ctx.calls.drawImage || 0) + (r.ctx.calls.fill || 0) > 100, `drawImage=${r.ctx.calls.drawImage} fill=${r.ctx.calls.fill}`);

  // 窗口尺寸变化（不同长宽比）
  let resizeThrew = null;
  try {
    for (const [w, h] of [[2400, 1080], [1024, 768], [640, 360], [1920, 1080], [800, 1280]]) {
      canvas.width = w;
      canvas.height = h;
      window.innerWidth = w;
      window.innerHeight = h;
      r.resize();
      r.render(world, { joystick: { dx: 0, dy: 0 }, showHud: true });
      const v = r.view;
      const ratio = v.dw / v.dh;
      const expect = 960 / 540;
      if (Math.abs(ratio - expect) > 0.001) throw new Error(`长宽比失真 ${w}x${h}: ${ratio.toFixed(4)}`);
      if (v.dw > canvas.width + 0.5 || v.dh > canvas.height + 0.5) throw new Error(`缩放溢出 ${w}x${h}`);
    }
  } catch (e) {
    resizeThrew = e;
  }
  check('不同长宽比下等比缩放、无拉伸（letterbox）', !resizeThrew, resizeThrew && resizeThrew.message);

  // 低画质档
  let lowThrew = null;
  try {
    const r2 = new Renderer(canvas, { quality: 'low', shake: false, damageNumbers: false, effects: false });
    r2.render(world, { joystick: { dx: 0, dy: 0 }, showHud: true });
  } catch (e) {
    lowThrew = e;
  }
  check('低画质档渲染不抛异常', !lowThrew, lowThrew && lowThrew.message);

  // 安全区（刘海）不越界：HUD 元素必须在逻辑画布内
  let safeThrew = null;
  try {
    const r3 = new Renderer(canvas, {});
    r3.safe = { top: 44, right: 32, bottom: 21, left: 32 };
    r3.render(world, { joystick: { dx: 0, dy: 0 }, showHud: true });
  } catch (e) {
    safeThrew = e;
  }
  check('带安全区 inset 的 HUD 渲染不抛异常', !safeThrew, safeThrew && safeThrew.message);
}

// ================= 3. 触控区域不重叠（规格 Testing 10） =================
{
  const { touchLayoutProblems, TOUCH, safeAwareZones, hitTestTouch } = await import('../src/render/touch-layout.js');
  const problems = touchLayoutProblems();
  check('触控区互不重叠、且都在逻辑画布内', problems.length === 0, problems.join('; '));
  // 无安全区：每个控件完整落在逻辑画布内。
  // 摇杆改为浮动之后，它的"基准位置"是 guideX/guideY（提示圈），实际原点跟手指走。
  for (const [name, z] of Object.entries({ joy: { ...TOUCH.joy, cx: TOUCH.joy.guideX, cy: TOUCH.joy.guideY }, dash: TOUCH.dash })) {
    check(`${name} 在无安全区时完整可点`, z.cx - z.hitR >= 0 && z.cx + z.hitR <= 960 && z.cy - z.hitR >= 0 && z.cy + z.hitR <= 540, `cx=${z.cx} cy=${z.cy} r=${z.hitR}`);
  }
  // 浮动摇杆：无论手指按在左半边的哪个合法位置，摇杆圈都必须完整可见
  const { resolveJoyOrigin, inJoyRegion } = await import('../src/render/touch-layout.js');
  let joyOk = true;
  let joyDetail = '';
  for (const [x, y] of [[0, 540], [960 * 0.45, 80], [0, 80], [960 * 0.45, 540], [200, 300]]) {
    if (!inJoyRegion(x, y)) continue;
    const o = resolveJoyOrigin(x, y);
    if (o.x - TOUCH.joy.r < 0 || o.x + TOUCH.joy.r > 960 || o.y - TOUCH.joy.r < 0 || o.y + TOUCH.joy.r > 540) {
      joyOk = false;
      joyDetail = `按在 ${x},${y} → 原点 ${o.x},${o.y}`;
    }
  }
  check('浮动摇杆在触发区内任意位置都完整可见', joyOk, joyDetail);
  check('右半屏不会误触发摇杆（留给闪避键）', !inJoyRegion(960 * 0.6, 300) && !inJoyRegion(400, 40), '');
  // 真实刘海/圆角 inset：控件会被继续内缩，仍必须完整可点且互不重叠
  const insets = [
    { top: 44, right: 32, bottom: 21, left: 32 },
    { top: 0, right: 60, bottom: 34, left: 60 },
    { top: 32, right: 0, bottom: 0, left: 0 },
  ];
  let safeOk = true;
  let detail = '';
  for (const inset of insets) {
    const z = safeAwareZones(inset);
    const list = [
      ['joy', { cx: z.joy.guideX, cy: z.joy.guideY, hitR: z.joy.hitR }],
      ['dash', z.dash],
    ];
    for (const [name, b] of list) {
      if (b.cx - b.hitR < 0 || b.cx + b.hitR > 960 || b.cy - b.hitR < 0 || b.cy + b.hitR > 540) {
        safeOk = false;
        detail = `${JSON.stringify(inset)} 下 ${name} 越界`;
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i][1];
        const b = list[j][1];
        if (Math.hypot(a.cx - b.cx, a.cy - b.cy) <= a.hitR + b.hitR) {
          safeOk = false;
          detail = `${JSON.stringify(inset)} 下 ${list[i][0]}/${list[j][0]} 重叠`;
        }
      }
    }
  }
  check('不同安全区下触控区仍完整且不重叠', safeOk, detail);  // 命中测试：闪避圆心命中闪避，摇杆触发区（左半边）命中摇杆，画布中央不命中任何控件。
  // 注意：摇杆是浮动式的，命中判定走 inJoyRegion，不再是"固定圆心"。
  check('摇杆提示圈位置在触发区内', inJoyRegion(TOUCH.joy.guideX, TOUCH.joy.guideY));
  check('左半边任意位置都能起摇杆', inJoyRegion(120, 400) && inJoyRegion(960 * 0.4, 300));
  check('闪避圆心命中闪避', hitTestTouch(TOUCH.dash.cx, TOUCH.dash.cy) === 'dash');
  check('画布中央不命中任何控件', hitTestTouch(480, 270) === null);
}

// ================= 4. 每件道具要用自己那个图标（不许落到通用图标） =================
{
  // 教训：24 个被动图标全画了、全进包了，却一处都没接上 ——
  // 调用点到处手写 'icon_passive'，于是所有被动在卡片/暂停栏/HUD/角色挂件上
  // 长得一模一样。素材不缺、不报错、不崩，只是"等于没画"。
  const { iconSlotForCard } = await import('../src/render/render2d.js');
  const { passiveIconSlot } = await import('../src/assets/generator.js');
  const { BATCH1_PASSIVES } = await import('../src/content/passives.js');
  const { SLOT_BY_ID } = await import('../src/assets/manifest.js');

  // ① 每件被动都要解析到"自己的"槽位，而不是通用图标
  const resolved = BATCH1_PASSIVES.map((p) => ({ pid: p.id, slot: passiveIconSlot(p.id) }));
  const generic = resolved.filter((r) => r.slot === 'icon_passive');
  check('每件被动都解析到专属图标槽位', generic.length === 0, `${generic.length} 件落到通用图标：${generic.map((g) => g.pid).join(',')}`);
  const uniqueSlots = new Set(resolved.map((r) => r.slot));
  check('被动图标槽位两两不同', uniqueSlots.size === resolved.length, `${uniqueSlots.size} 个槽位 / ${resolved.length} 件被动`);

  // ② 每个槽位都要真的指向一个独立文件（防止"槽位有、file 没有"或都指向同一张图）
  const files = resolved.map((r) => (SLOT_BY_ID[r.slot] || {}).file);
  check('每个被动图标槽位都登记了 file', files.every(Boolean), `${files.filter((f) => !f).length} 个缺 file`);
  check('每件被动的图是不同文件', new Set(files).size === files.length, `${new Set(files).size} 个不同文件 / ${files.length}`);

  // ③ 卡片图标解析：被动卡与被动升级卡都必须走各自那件被动
  for (const p of BATCH1_PASSIVES.slice(0, 6)) {
    const a = iconSlotForCard({ type: 'passive', passiveId: p.id });
    const b = iconSlotForCard({ type: 'passive-up', passiveId: p.id, level: 2 });
    check(`被动卡(${p.cn})用自己那张图`, a === passiveIconSlot(p.id) && a !== 'icon_passive', a);
    check(`被动升级卡(${p.cn})用自己那张图`, b === passiveIconSlot(p.id) && b !== 'icon_passive', b);
  }
  // 武器卡也要走各自的图标（同类错误在武器侧也犯过）
  const wSlot = iconSlotForCard({ type: 'weapon-up', weaponId: 'w_shoujia', level: 2 });
  check('武器卡用武器自己的图标', wSlot === 'icon_w_shoujia' && !!SLOT_BY_ID[wSlot], wSlot);
}

// ================= 5. 环绕刃必须画出来（曾整条绘制缺失） =================
{
  // 山魄的初始武器是环绕刃。曾经 drawOrbitBlades 完全不存在：
  // 玩家只看到怪在身边莫名掉血，屏幕上没有任何刀刃。
  const world = new World({ seed: 42, characterId: 'shanpo' });
  world.paused = false;
  world.slots.weapons = [{ id: 'w_shoujia', level: 5, cd: 0, superId: null }];
  world.recompute();
  world.refreshWeaponEntities();
  for (let i = 0; i < 10; i++) world.step();
  const bladeCount = world.orbitBlades.active.length;
  check('山魄初始武器产生环绕刃实体', bladeCount > 0, String(bladeCount));

  // 刃必须真的分散在圆周上，而不是全叠在一个角度（曾经逐片自增角度导致叠在一起）
  const { bladePositions } = await import('../src/render/orbit-view.js');
  const pos = bladePositions(world.player, world.orbitBlades.active);
  const angles = pos.map((b) => Math.round(((b.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 100) / 100);
  const uniqueAngles = new Set(angles);
  check('多个刃分布在不同的角度上', bladeCount === 1 || uniqueAngles.size === bladeCount, `刃 ${bladeCount} 个，不同角度 ${uniqueAngles.size} 个`);
  const dists = pos.map((b) => Math.hypot(b.x - world.player.x, b.y - world.player.y));
  check('刃与玩家的距离等于武器半径', dists.every((d) => Math.abs(d - world.orbitBlades.active[0].radius) < 0.001), dists.map((d) => d.toFixed(1)).join(','));

  // 绘制：先关掉特效只画实体，比较"只有主角"和"主角+刃"的绘制量
  const r = new Renderer(canvas, { quality: 'high', shake: false, damageNumbers: false, effects: false });
  const savedBlades = world.orbitBlades.active.slice();
  world.orbitBlades.clear();
  r.render(world, { showHud: false });
  const fillsWithout = r.ctx.calls.fill || 0;
  for (const b of savedBlades) world.orbitBlades.active.push(b);
  r.ctx.calls.fill = 0;
  r.render(world, { showHud: false });
  const fillsWith = r.ctx.calls.fill || 0;
  console.log(`  绘制 fill 次数：无刃 ${fillsWithout} → 有刃 ${fillsWith}（刃 ${bladeCount} 个）`);
  check('环绕刃真的产生了绘制调用', fillsWith > fillsWithout, `${fillsWithout} → ${fillsWith}`);
}

// ================= 5. 模拟层的实体池必须都有渲染出口 =================
{
  // 通用防线：模拟层里存在的实体池，渲染层必须读它，否则就是"机制在跑但看不见"。
  const { readFileSync } = await import('node:fs');
  const worldSrc = readFileSync('src/sim/world.js', 'utf8');
  const renderSrc = readFileSync('src/render/render2d.js', 'utf8');
  // 找出 world 构造函数里创建的所有 Pool 字段
  const pools = [...worldSrc.matchAll(/this\.(\w+)\s*=\s*new Pool\(/g)].map((m) => m[1]);
  const notRendered = [];
  for (const pool of pools) {
    // 渲染层必须直接读这个字段（某些池是借 world.playerBullets / world.enemyBullets 间接读的）
    if (!renderSrc.includes('world.' + pool)) notRendered.push(pool);
  }
  // bullets 是底层池，渲染层通过 playerBullets / enemyBullets 两个数组读它
  const allowed = new Set(['bullets']);
  const realMissing = notRendered.filter((p) => !allowed.has(p));
  console.log(`  模拟层实体池 ${pools.length} 个：${pools.join(', ')}`);
  console.log(`  渲染层未直接读取的池：${notRendered.length ? notRendered.join(', ') : '（无）'}`);
  check('每个实体池都在渲染层出现（不存在"看不见的实体"）', realMissing.length === 0, realMissing.join(','));
}

// ================= 6. 非法半径不许把渲染循环带走（曾导致画面永久定格） =================
{
  // 背景：drawZones 里用 (maxLife - 0.5) 反推预警进度，
  // 链式落雷那种 maxLife≈0.4 的实体算出 t≈-400，半径变负数 →
  // ctx.arc 抛 IndexSizeError → 主循环的 requestAnimationFrame 断掉 → 游戏卡死。
  const world = new World({ seed: 9, characterId: 'huangpo' });
  world.paused = false;
  world.slots.weapons = [
    { id: 'w_huanglei', level: 5, cd: 0, superId: 'f7' },
    { id: 'w_zhangqi', level: 5, cd: 0, superId: 'f8' },
  ];
  world.slots.passives = ['zhulongtong', 'zhurongjin'];
  world.recompute();
  world.refreshWeaponEntities();
  // 造出会抛异常的那种区域：delay > 0 且 maxLife 很小（链式落雷）
  for (let i = 0; i < 12; i++) {
    const z = world.zones.spawn();
    if (!z) break;
    z.id = world.nextId();
    z.kind = 'warning';
    z.x = 1200 + i * 20;
    z.y = 675;
    z.radius = 40;
    z.delay = 0.22;
    z.warnTotal = 0.22;
    z.life = 0.4;
    z.maxLife = 0.4; // 关键：maxLife < 0.5
    z.strikeDamage = 10;
  }
  // 再加一批"life 超过 maxLife"的区域（震荡波/毒雾的极端情况）
  for (let i = 0; i < 6; i++) {
    const z = world.zones.spawn();
    if (!z) break;
    z.id = world.nextId();
    z.kind = 'shock';
    z.x = 1100;
    z.y = 600 + i * 20;
    z.radius = 90;
    z.life = 3; // 大于 maxLife
    z.maxLife = 0.2;
    z.delay = 0;
  }

  const r = new Renderer(canvas, {});
  let threw = null;
  try {
    for (let i = 0; i < 60; i++) {
      world.elapsedMs += 16;
      r.render(world, { joystick: { dx: 0, dy: 0 }, showHud: true });
    }
  } catch (e) {
    threw = e;
  }
  check('预警圈 maxLife < 0.5 时渲染不抛异常', !threw, threw && threw.message);

  // 直接验证包装函数：负数半径必须被夹成 0，而不是抛异常
  const probeCtx = makeCtx();
  let guardThrew = null;
  try {
    // 通过渲染器暴露的路径触发：直接构造一个半径为负的区域
    const w2 = new World({ seed: 1, characterId: 'huangpo' });
    w2.zones.spawn();
    const z = w2.zones.active[0];
    z.x = 100;
    z.y = 100;
    z.radius = -500;
    z.delay = 0.2;
    z.warnTotal = 0.2;
    z.life = 1;
    z.maxLife = 1;
    const r2 = new Renderer(canvas, {});
    r2.render(w2, { joystick: { dx: 0, dy: 0 }, showHud: true });
  } catch (e) {
    guardThrew = e;
  }
  void probeCtx;
  check('半径为负数的实体也不会让渲染抛异常', !guardThrew, guardThrew && guardThrew.message);
}

console.log(`\n================ 渲染自检 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
