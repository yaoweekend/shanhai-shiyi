// 批 1 改判验收（specs/shanhai-ultimate-rework.md §Testing 的 1–9 项）。
//
// 这是**验收套件**，不是实现细节测试：每一条都对着规格里写死的可验证断言。
// 只测外部行为（给定输入 → 游戏状态与可见结果），不断言内部函数组织方式。
//
// 用法：node test/batch1-rework.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../src/sim/world.js';
import { Renderer } from '../src/render/render2d.js';
import { WEAPONS, WEAPON_BY_ID } from '../src/content/weapons.js';
import { FUSIONS, ULTIMATE_FUSIONS, ACTIVE_SKILLS, ACTIVE_SKILL_BY_ID } from '../src/content/fusions.js';
import { SLOT_WEAPONS, WEAPON_MAX_LEVEL, ARENA_W, ARENA_H } from '../src/config.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
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
function section(t) {
  console.log(`\n=== ${t} ===`);
}
function info(msg) {
  console.log(`  · ${msg}`);
}

// ---------------------------------------------------------------- stub DOM
// 占位图生成器要建 canvas；HUD 用例要真的走 drawImage 路径，所以装一份最小 DOM。
function makeStubCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx = {
    canvas: { width: 960, height: 540 },
    save: noop, restore: noop, setTransform: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, setLineDash: noop,
    quadraticCurveTo: noop,
    drawImage: noop, fillText: noop,
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  for (const k of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'lineCap']) ctx[k] = '';
  return ctx;
}
function installDom() {
  globalThis.document = {
    createElement: (tag) => (tag === 'canvas'
      ? { width: 32, height: 32, style: {}, getContext: () => makeStubCtx(), toDataURL: () => 'data:image/png;base64,' }
      : { style: {}, appendChild() {}, removeChild() {} }),
    body: { appendChild() {}, removeChild() {} },
    getElementById: () => null,
  };
  globalThis.window = {
    devicePixelRatio: 2, innerWidth: 1280, innerHeight: 640,
    addEventListener() {}, requestAnimationFrame: (cb) => setTimeout(() => cb(0), 16), AudioContext: undefined,
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'test', deviceMemory: 4, hardwareConcurrency: 4 }, configurable: true, writable: true,
  });
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.Image = class { set src(_v) { /* 永不 onload：走占位图回退 */ } };
}
installDom();

/** 记录型 ctx：只数 drawImage 次数、收集 fillText 文本 */
function recCtx() {
  const texts = [];
  let images = 0;
  const base = makeStubCtx();
  base.drawImage = () => { images++; };
  base.fillText = (t) => { texts.push(String(t)); };
  return { ctx: base, texts, images: () => images };
}

// ---------------------------------------------------------------- 工具
const BATCH1_ULT_SERIES = ['shan', 'hai', 'huang'];
const ultOf = (sid) => ULTIMATE_FUSIONS.find((u) => u.series === sid);

/** 4 把同系满级武器 + 3 把超武（解锁主动技）+ 合体所需被动 → 返回已合体的世界 */
function fusedWorld(sid, { level = 1, superCount = 3, withPassives = true } = {}) {
  const u = ultOf(sid);
  const w = new World({ seed: 20260926, characterId: 'shanpo' });
  w.paused = false;
  const mine = WEAPONS.filter((x) => x.series === sid && !x.locked).slice(0, 4);
  w.slots.weapons = mine.map((x, i) => ({
    id: x.id,
    level: WEAPON_MAX_LEVEL,
    cd: 0,
    superId: i < superCount ? (FUSIONS.find((f) => f.weapon === x.id) || {}).id || null : null,
  }));
  w.slots.passives = withPassives ? u.passives.slice() : [];
  for (const pid of w.slots.passives) w.passiveLevels[pid] = 1;
  w.recompute();
  w.refreshWeaponEntities();
  // 走**真实路径**：checkFusions() = 血统 → 技能解锁 → 合体 → 重算实体
  w.checkFusions();
  if (w.fusedWeapon && w.slots.weapons[0]) w.slots.weapons[0].level = level;
  w.recompute();
  return w;
}

/** 一个静态高血量靶场（围玩家一圈），用来量"零输入也能输出" */
function staticTargets(w, n = 10, radius = 120) {
  w.enemies.clear();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const e = w.spawnEnemyFrom({
      kind: 'shanxiao', tier: 0,
      x: w.player.x + Math.cos(a) * radius, y: w.player.y + Math.sin(a) * radius,
    });
    if (!e) continue;
    e.maxHp = 4e6;
    e.hp = 4e6;
    e.speed = 0;
    e.touchDamage = 0;
    e.xp = 0;
  }
  return w.enemies.active.length;
}

function runSteps(w, steps, { keepAlive = true, freeze = true } = {}) {
  const before = w.runStats.damageDealt || 0;
  for (let i = 0; i < steps && w.running; i++) {
    if (keepAlive) {
      w.player.hp = w.player.maxHp;
      w.player.shield = 0;
    }
    w.step();
    if (freeze) {
      for (const e of w.enemies.active) {
        e.maxHp = 4e6;
        e.hp = 4e6;
        e.speed = 0;
        e.touchDamage = 0;
      }
    }
    if (w.awaitingChoice) {
      w.awaitingChoice = false;
      w.pendingLevelUps = 0;
      w.cardChoices = [];
      w.paused = false;
    }
  }
  return (w.runStats.damageDealt || 0) - before;
}

// ================================================================ 1
section('1. 合体硬前置：该系主动技已解锁（缺这一条不得合体）');
{
  let ok = 0;
  for (const sid of BATCH1_ULT_SERIES) {
    const w = fusedWorld(sid);
    const u = ultOf(sid);
    const good = w.fusedWeapon === u.id && w.slots.weapons.length === 1 && w.slots.weapons[0].id === u.weaponId;
    if (good) ok++;
    else console.log(`  ✗ ${sid}: fused=${w.fusedWeapon} slots=${w.slots.weapons.length}`);
  }
  check('三系都能合体（4 满级 + 4 被动 + 主动技已解锁）', ok === 3, `${ok}/3`);

  // 硬前置：4 把满级 + 4 件被动，但**主动技未解锁** → 合体判定必须直接拒绝。
  // （这里刻意绕过 checkFusions，单独审 checkUltimateFusion 这一道门；
  //   真实路径下血统会先把技能解锁出来，见下面的正向断言。）
  const gate = new World({ seed: 18, characterId: 'shanpo' });
  gate.slots.weapons = WEAPONS.filter((x) => x.series === 'shan' && !x.locked).slice(0, 4)
    .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));
  gate.slots.passives = ultOf('shan').passives.slice();
  gate.activeSkillUnlocked = null;
  gate.recompute();
  gate.checkUltimateFusion();
  check('缺「主动技已解锁」时 checkUltimateFusion 拒绝合体',
    gate.fusedWeapon === null && gate.slots.weapons.length === 4,
    `fused=${gate.fusedWeapon} slots=${gate.slots.weapons.length}`);

  // 正向：真实路径（checkFusions）里，血统先解锁技能、技能再放行合体
  const viaReal = new World({ seed: 19, characterId: 'shanpo' });
  viaReal.slots.weapons = WEAPONS.filter((x) => x.series === 'shan' && !x.locked).slice(0, 4)
    .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));
  viaReal.slots.passives = ultOf('shan').passives.slice();
  for (const pid of viaReal.slots.passives) viaReal.passiveLevels[pid] = 1;
  viaReal.recompute();
  viaReal.checkFusions();
  check('真实路径：血统先解锁主动技、主动技再放行合体（顺序依赖已消灭）',
    viaReal.activeSkillUnlocked === 'skill_shan' && viaReal.fusedWeapon === 'u_shan',
    `skill=${viaReal.activeSkillUnlocked} fused=${viaReal.fusedWeapon}`);

  // 没有 3 把超武 + 没有血统被动 → 技能无从解锁 → 真实路径也不会合体
  const noSkill = fusedWorld('shan', { superCount: 0, withPassives: false });
  check('技能无从解锁时真实路径也不会合体', noSkill.fusedWeapon === null && noSkill.activeSkillUnlocked === null,
    `fused=${noSkill.fusedWeapon} skill=${noSkill.activeSkillUnlocked}`);

  // 有技能但被动不齐 → 也不得合体
  const noPassive = fusedWorld('shan', { withPassives: false });
  check('被动不齐时不得合体', noPassive.fusedWeapon === null, String(noPassive.fusedWeapon));

  // 满级武器不足 4 把 → 不得合体
  const w2 = new World({ seed: 16, characterId: 'shanpo' });
  w2.slots.weapons = [{ id: 'w_shoujia', level: WEAPON_MAX_LEVEL, cd: 0, superId: 'f1' }];
  w2.slots.passives = ultOf('shan').passives.slice();
  w2.activeSkillUnlocked = 'skill_shan';
  w2.recompute();
  w2.checkUltimateFusion();
  check('满级武器不足 4 把时不得合体', w2.fusedWeapon === null, String(w2.fusedWeapon));

  // 合体产物：单把武器、占满 4 槽、从 Lv1 起步、可升到 Lv5
  const w3 = fusedWorld('shan', { level: 1 });
  check('合体后武器数组只剩 1 把（逻辑占满 4 槽）', w3.slots.weapons.length === 1 && SLOT_WEAPONS === 4, String(w3.slots.weapons.length));
  check('终极武器从 Lv1 起步（可升到 Lv5）', w3.slots.weapons[0].level === 1, String(w3.slots.weapons[0].level));
  const ultDef = WEAPON_BY_ID[w3.slots.weapons[0].id];
  check('终极武器有 Lv1~Lv5 成长表与 Lv3/Lv5 质变点', ultDef.levels.length === 5, String(ultDef.levels.length));
  check('Lv3 与 Lv5 是质变点（该级有自己的机制参数）',
    ultDef.levels[2] && ultDef.levels[4] && Object.keys(ultDef.levels[2]).length > 6 && Object.keys(ultDef.levels[4]).length > 6, '');
}

// ================================================================ 2
section('2. 技能持久化：先解锁 → 再合体 → 技能仍可用（消灭顺序依赖）');
{
  const w = fusedWorld('shan'); // 先解锁 skill_shan，再合体
  check('合体后 activeSkillUnlocked 仍是该系技能', w.activeSkillUnlocked === 'skill_shan', String(w.activeSkillUnlocked));
  w.activeSkillCd = 0;
  const fired = w.triggerActiveSkill();
  check('合体后主动技仍能触发（不依赖武器槽里的超武数量）', fired === true && w.activeSkillCd > 0, `fired=${fired} cd=${w.activeSkillCd}`);
  check('触发后进入冷却', w.activeSkillCd > 0, String(w.activeSkillCd));

  // 反向检验：合体后武器槽里已经没有超武了，但技能不能因此失效
  const superCount = w.slots.weapons.filter((x) => x.superId).length;
  check('此时武器槽里已无超武，技能依然可用', superCount === 0 && w.activeSkillUnlocked === 'skill_shan', `超武 ${superCount} 个`);

  // 冷却走完可以再放
  w.activeSkillCd = 0;
  check('冷却归零后可再次触发', w.triggerActiveSkill() === true, '');
}

// ================================================================ 3
section('3. 机制两两不同（不是"换数值的圈"）');
{
  const kinds = BATCH1_ULT_SERIES.map((sid) => WEAPON_BY_ID[ultOf(sid).weaponId].kind);
  check('批 1 三系终极的机制两两不同', new Set(kinds).size === 3, kinds.join(','));
  check('三系终极覆盖"轨迹型 / 往返环 / 移动轰炸带"三种判定形状',
    kinds[0] === 'rift' && kinds[1] === 'tide' && kinds[2] === 'storm', kinds.join(','));

  const types = ACTIVE_SKILLS.map((s) => s.type);
  check('六个主动技的类型两两不同', new Set(types).size === 6, types.join(','));
  check('六种类型恰好是 位移/地形/控场/瞄准/处决/防御',
    new Set(types).size === 6 && ['terrain', 'dash', 'control', 'aim', 'execute', 'defense'].every((t) => types.includes(t)), types.join(','));

  // 反向检验（§Testing 11）：禁用终极，六个主动技仍彼此不同；禁用主动技，三系终极仍彼此不同
  const ultIds = new Set([...kinds]);
  check('反向检验：三系终极的机制集合与主动技类型集合无交集', [...ultIds].every((k) => !types.includes(k)), '');

  // 后三系（十日 / 百巫 / 玉璧）的机制属批 2，这里只登记事实、不判失败
  const b2 = ULTIMATE_FUSIONS.filter((u) => !BATCH1_ULT_SERIES.includes(u.series))
    .map((u) => `${u.cn}:${WEAPON_BY_ID[u.weaponId].kind}`);
  info(`后三系（批 2 已落地，验收见 test/batch2-rework.mjs）：${b2.join('、')}`);
}

// ================================================================ 4
section('4. 无操作也能运转（裂地按"沿固定路线移动"验证）');
{
  // 潮汐：零输入
  const tide = fusedWorld('hai', { level: 1 });
  staticTargets(tide, 12, 130);
  const tideDmg = runSteps(tide, 60 * 6);
  check('潮汐：玩家零输入时持续输出', tideDmg > 0, `${tideDmg.toFixed(0)}`);

  // 天罚轮转：零输入
  const storm = fusedWorld('huang', { level: 1 });
  staticTargets(storm, 12, 150);
  const stormDmg = runSteps(storm, 60 * 6);
  check('天罚轮转：玩家零输入时持续输出', stormDmg > 0, `${stormDmg.toFixed(0)}`);

  // 裂地：站着不动**没有**输出（刻意的身份表达）
  const still = fusedWorld('shan', { level: 1 });
  staticTargets(still, 12, 90);
  const stillDmg = runSteps(still, 60 * 6);
  check('裂地：零输入站着不动 → 没有输出（奖励冲阵）', stillDmg === 0, `${stillDmg.toFixed(0)}`);

  // 裂地：沿固定路线移动 → 产生地裂与塌陷
  const moving = fusedWorld('shan', { level: 1 });
  moving.enemies.clear();
  // 靶子铺成一条水平带，玩家沿这条带匀速前进（钉住不动）
  for (let i = 0; i < 20; i++) {
    const e = moving.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: 260 + i * 32, y: 400 });
    if (!e) continue;
    e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0; e.xp = 0;
  }
  const before = moving.runStats.damageDealt || 0;
  let x = 260;
  for (let i = 0; i < 60 * 6 && moving.running; i++) {
    x += 2.5;
    if (x > 900) x = 260;
    moving.player.x = x;
    moving.player.y = 400;
    moving.input.mx = 1;
    moving.input.my = 0;
    moving.step();
    for (const e of moving.enemies.active) {
      e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0;
    }
    if (moving.awaitingChoice) {
      moving.awaitingChoice = false;
      moving.pendingLevelUps = 0;
      moving.cardChoices = [];
      moving.paused = false;
    }
  }
  const moveDmg = (moving.runStats.damageDealt || 0) - before;
  check('裂地：沿固定路线移动时产生地裂与塌陷输出', moveDmg > 0, `${moveDmg.toFixed(0)}`);
}

// ================================================================ 5
section('5. 平衡硬要求：终极输出 ≥ 被替换的四把满级武器同条件总输出的 1.5 倍');
{
  // 固定场景：160 个高血量靶子铺在玩家圆周路线两侧 + 固定路线（与 tools/dps-probe.mjs 同一套口径）
  const SEED = 20260926;
  const TARGETS = 160;
  const ROUTE_R = 260;
  const FIELD_R = 420;
  const UNLOCKS = WEAPONS.filter((x) => x.unlock === 'trial').map((x) => x.id);

  const build = (w) => {
    const cx = ARENA_W / 2;
    const cy = ARENA_H / 2;
    const out = [];
    for (let i = 0; i < TARGETS; i++) {
      const a = i * 2.399963;
      const r = FIELD_R * Math.sqrt((i + 0.5) / TARGETS);
      const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      if (!e) continue;
      e.maxHp = 1e6; e.hp = 1e6; e.touchDamage = 0; e.xp = 0;
      e.ax = e.x; e.ay = e.y;
      out.push(e);
    }
    return out;
  };
  const tick = (w, field) => {
    w.player.hp = w.player.maxHp;
    w.player.shield = 0;
    const a = (w.elapsedMs / 1000) * 0.55;
    w.player.x = ARENA_W / 2 + Math.cos(a) * ROUTE_R;
    w.player.y = ARENA_H / 2 + Math.sin(a) * ROUTE_R;
    w.input.mx = -Math.sin(a);
    w.input.my = Math.cos(a);
    for (const e of field) {
      if (!e.__alive) continue;
      e.x = e.ax; e.y = e.ay; e.maxHp = 1e6; e.hp = 1e6; e.touchDamage = 0;
    }
    w.step();
    for (const e of field) {
      if (!e.__alive) continue;
      e.x = e.ax; e.y = e.ay; e.maxHp = 1e6; e.hp = 1e6; e.touchDamage = 0;
    }
    if (w.awaitingChoice) {
      w.awaitingChoice = false; w.pendingLevelUps = 0; w.cardChoices = []; w.paused = false;
    }
  };
  const measure = (loadout, fusedId) => {
    const w = new World({ seed: SEED, characterId: 'shanpo', unlocks: UNLOCKS.slice() });
    w.paused = false;
    w.slots.weapons = loadout.map((l) => ({ id: l.id, level: l.level, cd: 0, superId: null }));
    if (fusedId) {
      w.fusedWeapon = fusedId;
      w.initUltimateState();
    }
    w.slots.passives = [];
    w.passiveLevels = {};
    w.recompute();
    w.refreshWeaponEntities();
    w.spawner.acc = -1e9;
    const field = build(w);
    for (let i = 0; i < 30; i++) tick(w, field);
    const before = w.runStats.damageDealt || 0;
    const t0 = w.elapsedMs;
    for (let i = 0; i < 60 * 20; i++) tick(w, field);
    const dealt = (w.runStats.damageDealt || 0) - before;
    return dealt / Math.max(0.001, (w.elapsedMs - t0) / 1000);
  };

  for (const sid of BATCH1_ULT_SERIES) {
    const u = ultOf(sid);
    const four = WEAPONS.filter((x) => x.series === sid && !x.locked).slice(0, 4)
      .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL }));
    const base = measure(four, null);
    const lv1 = measure([{ id: u.weaponId, level: 1 }], u.id);
    const lv5 = measure([{ id: u.weaponId, level: 5 }], u.id);
    const r1 = lv1 / Math.max(0.1, base);
    const r5 = lv5 / Math.max(0.1, base);
    console.log(`  ${sid}: 四把满级 ${base.toFixed(0)} dps → 终极 Lv1 ${lv1.toFixed(0)}（${r1.toFixed(2)}×）/ Lv5 ${lv5.toFixed(0)}（${r5.toFixed(2)}×）`);
    check(`${sid} 终极 Lv1 输出 ≥ 四把满级总输出的 1.5 倍`, r1 >= 1.5, `${r1.toFixed(2)}×`);
    check(`${sid} 终极 Lv5 输出 ≥ 四把满级总输出的 1.5 倍`, r5 >= 1.5, `${r5.toFixed(2)}×`);
  }
}

// ================================================================ 6
section('6. 六个主动技彼此不可互换，且没有一个是纯范围伤害');
{
  const REQUIRED = {
    terrain: ['radius', 'duration', 'push'],
    dash: ['distance', 'iframes', 'knockback'],
    control: ['radius', 'duration', 'bossSlowMul'],
    aim: ['chargeTime', 'moveMul', 'fireRadius'],
    execute: ['perStack', 'stun'],
    defense: ['duration', 'shield'],
  };
  for (const s of ACTIVE_SKILLS) {
    const need = REQUIRED[s.type] || [];
    const missing = need.filter((k) => s[k] === undefined);
    check(`${s.cn}（${s.type}）带有该类型的机制参数`, missing.length === 0, missing.join(','));
  }
  // "纯范围伤害"的形状 = 只有 radius + damage。任何一个技能都不许退化成那样。
  const pureAoe = ACTIVE_SKILLS.filter((s) => {
    const keys = Object.keys(s).filter((k) => !['id', 'series', 'cn', 'type', 'cd', 'effect'].includes(k));
    return keys.length <= 2 && keys.includes('radius') && keys.includes('damage');
  });
  check('没有任何一个主动技是"只有范围+伤害"的纯 AOE', pureAoe.length === 0, pureAoe.map((s) => s.cn).join(','));
  // 伤害只是副产品：技能 CD 明显长于武器，靠"操作收益"而不是刷伤害。
  // ⚠️ 平衡修订后 CD 由"角色"决定，规格表里山/荒同为 14 秒（地形 / 控场都是中强度），
  //    所以这里**不再要求两两不同**——精确值由 test/balance-rework.mjs 对着规格表断言。
  check('六个主动技都有冷却', ACTIVE_SKILLS.every((s) => s.cd > 0), ACTIVE_SKILLS.map((s) => s.cd).join(','));
}

// ================================================================ 7
section('7. 天问「拉弓巨箭」输入状态机');
{
  const mk = () => {
    const w = new World({ seed: 7, characterId: 'tianpo' });
    w.paused = false;
    w.activeSkillUnlocked = 'skill_tian';
    w.activeSkillCd = 0;
    w.player.x = 500;
    w.player.y = 400;
    w.player.facing = 0;
    return w;
  };
  const press = (w, x, y) => {
    w.input.skillRequested = true;
    w.input.skillDown = true;
    w.input.skillStartX = x;
    w.input.skillStartY = y;
    w.input.skillCurX = x;
    w.input.skillCurY = y;
  };
  const dragTo = (w, x, y) => {
    w.input.skillCurX = x;
    w.input.skillCurY = y;
  };
  const release = (w) => {
    w.input.skillDown = false;
    w.input.skillReleased = true;
  };
  const bowBeams = (w) => w.beams.active.filter((b) => b.bow);

  // (a) 按下 → 蓄力
  const a = mk();
  press(a, 800, 400);
  a.step();
  check('按下立即进入蓄力（不立刻施放）', a.bow.phase === 'charge' && a.activeSkillCd === 0, `${a.bow.phase} cd=${a.activeSkillCd}`);
  check('蓄力期间移速倍率 ×0.7', Math.abs((a._bowMoveMul || 1) - 0.7) < 1e-6, String(a._bowMoveMul));

  // (b) 反向拖拽 = 拉弦，箭向反方向飞
  const b = mk();
  press(b, 800, 400);
  b.step();
  for (let i = 0; i < 80; i++) b.step(); // 满蓄
  check('满蓄 c 到达 1', b.bow.c >= 1, String(b.bow.c.toFixed(2)));
  dragTo(b, 640, 400); // 手指往左拖 160px
  b.step();
  check('拖动后进入瞄准态', b.bow.phase === 'aim', b.bow.phase);
  release(b);
  b.step();
  const bm = bowBeams(b);
  check('松手射出巨箭', bm.length >= 1, String(bm.length));
  if (bm.length) {
    // 手指往左拖 → 方向 = normalize(p0 - p1) = 向右（+x）
    check('箭的方向 = 拖动方向的反方向', Math.abs(bm[0].angle) < 0.05, bm[0].angle.toFixed(3));
    check('满蓄的箭更宽且带满蓄标记', bm[0].fullCharge === true && bm[0].width > 34, `w=${bm[0].width}`);
    check('箭贯穿全场', bm[0].pierce >= 99 && bm[0].length >= 1500, `len=${bm[0].length}`);
  }
  check('发射后进入冷却', b.activeSkillCd > 0, String(b.activeSkillCd));
  check('发射后留下"日火"灼烧区域', b.zones.active.some((z) => z.kind === 'sunfire'), '');

  // (c) 未满蓄也发射
  const c = mk();
  press(c, 800, 400);
  c.step();
  for (let i = 0; i < 5; i++) c.step(); // 只蓄一点点
  release(c);
  c.step();
  const cm = bowBeams(c);
  check('未满蓄松手也发射', cm.length >= 1 && cm[0].fullCharge === false, String(cm.length));
  check('未满蓄的箭比满蓄的窄', cm.length >= 1 && cm[0].width < 96, cm.length ? String(cm[0].width) : '');

  // (d) 拖回取消：不进冷却
  const d = mk();
  press(d, 800, 400);
  d.step();
  for (let i = 0; i < 40; i++) d.step();
  dragTo(d, 600, 400); // 先拉出去
  d.step();
  dragTo(d, 800, 400); // 再拖回按下点
  d.step();
  release(d);
  d.step();
  check('拖回按下点松手 = 取消，不进冷却', d.activeSkillCd === 0, String(d.activeSkillCd));
  check('取消后回到待机', d.bow.phase === 'idle', d.bow.phase);
  check('取消不产生箭矢', bowBeams(d).length === 0, String(bowBeams(d).length));

  // (e) 蓄力期间实际移速 = 基准 ×0.7
  const mkMove = () => {
    const w = new World({ seed: 9, characterId: 'tianpo' });
    w.paused = false;
    w.slots.weapons = [];
    w.recompute();
    w.enemies.clear();
    w.player.x = 600;
    w.player.y = 400;
    return w;
  };
  const plain = mkMove();
  plain.input.mx = 1;
  const x0 = plain.player.x;
  for (let i = 0; i < 40; i++) plain.step();
  const plainDx = plain.player.x - x0;

  const charging = mkMove();
  charging.activeSkillUnlocked = 'skill_tian';
  charging.activeSkillCd = 0;
  press(charging, 800, 400);
  charging.step();
  charging.input.mx = 1;
  const x1 = charging.player.x;
  for (let i = 0; i < 40; i++) charging.step();
  const chargeDx = charging.player.x - x1;
  const ratio = chargeDx / Math.max(0.001, plainDx);
  check('蓄力期间实际移速 = 基准 ×0.7', Math.abs(ratio - 0.7) < 0.03, `${ratio.toFixed(3)}（基准 ${plainDx.toFixed(1)} → 拉弓 ${chargeDx.toFixed(1)}）`);

  // (f) 满蓄有"不看 UI 也能察觉"的反馈：准星/箭光变金 + 提示
  check('满蓄时有可见提示（hint 文本）', /满蓄/.test(b.hintText || ''), b.hintText || '(无)');
}

// ================================================================ 8
section('8. HUD：1 格终极 + 3 格纯金色锁定（不画被合掉武器的微缩图标）');
{
  const canvas = { width: 1280, height: 640, style: {}, getContext: () => makeStubCtx(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 640 }) };
  const renderer = new Renderer(canvas, {});

  // 合体前：4 把武器 → 4 个图标
  const before = fusedWorld('shan');
  before.fusedWeapon = null;
  before.slots.weapons = WEAPONS.filter((x) => x.series === 'shan' && !x.locked).slice(0, 4)
    .map((x) => ({ id: x.id, level: 5, cd: 0, superId: null }));
  before.slots.passives = [];
  const r0 = recCtx();
  renderer.drawSlotPanel(r0.ctx, before, 0, 0);
  check('合体前 4 把武器画 4 个图标', r0.images() === 4, String(r0.images()));

  // 合体后：1 格终极 + 3 格金色锁定（锁定格不许有微缩图标）
  const w = fusedWorld('shan', { level: 1 });
  w.slots.passives = [];
  const r1 = recCtx();
  renderer.drawSlotPanel(r1.ctx, w, 0, 0);
  check('合体后只画 1 个武器图标（另外 3 格是纯金锁定格，无微缩图标）', r1.images() === 1, String(r1.images()));
  check('合体后槽位面板标出 Lv1', r1.texts.includes('Lv1'), r1.texts.join('/'));

  // Lv3 / Lv5 质变必须可见
  const r3 = recCtx();
  w.slots.weapons[0].level = 3;
  renderer.drawSlotPanel(r3.ctx, w, 0, 0);
  check('Lv3 质变在 HUD 上可见', r3.texts.includes('变Ⅰ'), r3.texts.join('/'));
  const r5 = recCtx();
  w.slots.weapons[0].level = 5;
  renderer.drawSlotPanel(r5.ctx, w, 0, 0);
  check('Lv5 质变在 HUD 上可见', r5.texts.includes('变Ⅱ'), r5.texts.join('/'));

  // 合体前后都不能抛异常（渲染层铁律）
  let threw = null;
  try {
    const world = fusedWorld('hai', { level: 5 });
    staticTargets(world, 8, 120);
    runSteps(world, 120);
    const rr = new Renderer(canvas, {});
    rr.render(world, { showHud: true, joystick: { dx: 0, dy: 0, active: false, origin: null } });
  } catch (e) {
    threw = e;
  }
  check('合体后的完整渲染不抛异常（含新机制绘制）', !threw, threw && threw.message);
}

// ================================================================ 9
section('9. 术语：血统 / 合体 / 主动技三分，废弃"融合"');
{
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files.push(p);
    }
  })(join(root, 'src'));

  /** 去掉行注释与块注释，只留"用户可见/会进包"的代码文本 */
  const visibleText = (src) => {
    const out = [];
    let inBlock = false;
    for (const line of src.split('\n')) {
      let i = 0;
      let res = '';
      while (i < line.length) {
        if (inBlock) {
          const end = line.indexOf('*/', i);
          if (end < 0) { i = line.length; break; }
          inBlock = false;
          i = end + 2;
          continue;
        }
        const b = line.indexOf('/*', i);
        const l = line.indexOf('//', i);
        if (l >= 0 && (b < 0 || l < b)) { res += line.slice(i, l); i = line.length; break; }
        if (b >= 0) { res += line.slice(i, b); inBlock = true; i = b + 2; continue; }
        res += line.slice(i);
        break;
      }
      out.push(res);
    }
    return out.join('\n');
  };

  const lines = [];
  for (const f of files) {
    const rel = f.replace(root + '\\', '');
    visibleText(readFileSync(f, 'utf8')).split('\n').forEach((line) => {
      if (line.trim()) lines.push({ rel, line });
    });
  }
  const flagged = (re, ctx) => lines.filter((l) => re.test(l.line) && (!ctx || ctx.test(l.line)))
    .map((l) => `${l.rel}: ${l.line.trim().slice(0, 70)}`);

  const fused = flagged(/融合/);
  check('用户可见文案里没有废弃词「融合」', fused.length === 0, fused.join(' | '));
  const four = flagged(/四合一/);
  check('用户可见文案里没有旧词「四合一」', four.length === 0, four.join(' | '));
  // 「合成」在音频语境里是正当用词（WebAudio 合成），只禁用把它用在合体/配方语境
  const synth = flagged(/合成/, /终极|合体|配方|血统|武器/);
  check('用户可见文案里没有把"合体"称作「合成」', synth.length === 0, synth.join(' | '));

  // 三个术语必须真的被使用，且指的不是同一件事
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  check('"血统"（单武器满级 + 被动 → 超武）在用', all.includes('血统'));
  check('"合体"（4 满级 + 4 被动 + 技能 → 终极武器）在用', all.includes('合体'));
  check('"主动技"（操作）在用', all.includes('主动技'));
  const supers = ACTIVE_SKILLS.filter((s) => /（|）/.test(s.cn));
  check('主动技名称不再沿用旧的范围伤害命名（山崩/潮涌/天罚/日蚀/巫毒/镇岳）',
    !ACTIVE_SKILLS.some((s) => ['山崩', '潮涌', '天罚', '日蚀', '巫毒', '镇岳'].includes(s.cn)) && supers.length === 0,
    ACTIVE_SKILLS.map((s) => s.cn).join(','));
}

console.log(`\n================ 批 1 改判验收 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
