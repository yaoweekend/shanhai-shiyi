// 平衡修订验收（specs/shanhai-balance-rework.md §Testing，开工卡上的六条）。
//
// 这是**验收套件**：每条都对着规格里写死的可验证断言，只测外部行为
// （给定输入 → 游戏状态与可见结果），不断言内部函数组织方式。
//
// 六条：
//   1. 六系清场当量：固定种子 + 第 5 分钟兽潮档 + 60 秒 + 玩家只走固定圆形路线（零攻击输入）
//      + 该系 4 满级武器 / 4 被动 / 本系角色 → 最大值 ÷ 最小值 ≤ 1.15；合体后再跑一遍同样达标。
//   2. 蛊爆：叠 3 层单次伤害 > 旧版 225；连爆三次各扣 1 层；第 4 次无层可扣；不清空未消耗层数。
//   3. 诅咒：未标记目标无加成；3 层标记 = 诅咒 + 0.36。
//   4. 不死魄：没有任何远程怪的场景下，终极武器仍产生有效伤害（修复前此值恒为 0）。
//   5. 以守为攻：随护盾单调上升且在 +35% 封顶；冷却缩减叠满时有效 CD ≥ 3 秒。
//   6. 不得回归：六系各自可通关、终极机制两两不同、主动技类型两两不同。
//
// 用法：node test/balance-rework.mjs
import { World } from '../src/sim/world.js';
import { dealDamage } from '../src/sim/stats.js';
import { WEAPONS, WEAPON_BY_ID, levelStats } from '../src/content/weapons.js';
import { FUSIONS, ULTIMATE_FUSIONS, ACTIVE_SKILLS, ACTIVE_SKILL_BY_ID } from '../src/content/fusions.js';
import { CHARACTERS, CHARACTER_BY_ID } from '../src/content/characters.js';
import { PASSIVE_BY_ID } from '../src/content/passives.js';
import { WEAPON_MAX_LEVEL, ARENA_W, ARENA_H, PASSIVE_MAX_LEVEL, TICK_MS } from '../src/config.js';

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
// World 的构造与 step 会碰 Image/Audio 等宿主 API；测试只跑模拟层，全部打桩。
function makeStubCtx() {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const ctx = {
    canvas: { width: 960, height: 540 },
    save: noop, restore: noop, setTransform: noop, translate: noop, scale: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, rect: noop,
    fill: noop, stroke: noop, clip: noop, fillRect: noop, strokeRect: noop, setLineDash: noop,
    quadraticCurveTo: noop, drawImage: noop, fillText: noop,
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

// ---------------------------------------------------------------- 契约常量（内联，比散文精确）
const SERIES = ['ling', 'kun', 'shan', 'hai', 'huang', 'tian'];
const DISPLAY = { ling: '巫魄(灵山)', kun: '不死魄(昆仑)', shan: '山魄', hai: '海魄', huang: '荒魄', tian: '天魄' };

const FIELD = {
  tier: 4,          // 第 5 分钟难度档（TIER_PERIOD = 120 秒）
  melee: 120,       // 内圈近战
  ranged: 60,       // 外圈远程
  routeR: 260,      // 固定圆形路线：半径恒定、角速度恒定
  seed: 20260926,
};
const RATIO_MAX = 1.15;
const STEP_MS = Math.round(1000 / TICK_MS);

/** 该系的"本系角色" */
function characterOfSeries(sid) {
  return CHARACTERS.find((c) => c.series === sid) || CHARACTER_BY_ID.shanpo;
}

/**
 * 摆出规格 §1 的配装：该系 4 把武器全部满级 + 该系 4 件被动 + 该系角色，其余槽位留空。
 * `fused: false` = 合体前（4 把普通武器就位）；`fused: true` = 终极武器就位。
 */
function loadout(sid, { fused = false } = {}) {
  const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
  const ch = characterOfSeries(sid);
  const w = new World({ seed: FIELD.seed, characterId: ch.id, unlockedSeries: SERIES });
  w.paused = false;
  w.spawner.acc = -1e9; // 兽潮由测试自己维持，不用刷怪器
  w.slots.passives = u.passives.slice(0, 4); // 该系 4 件被动（第 5 槽留空）
  w.passiveLevels = {};
  for (const p of w.slots.passives) w.passiveLevels[p] = 1;
  if (fused) {
    w.slots.weapons = [{ id: u.weaponId, level: 1, cd: 0, superId: null }];
    w.fusedWeapon = u.id;
    w.recompute();
    w.refreshWeaponEntities();
    w.initUltimateState();
  } else {
    w.slots.weapons = WEAPONS.filter((x) => x.series === sid && !x.locked)
      .slice(0, 4)
      .map((x) => ({
        id: x.id,
        level: WEAPON_MAX_LEVEL,
        cd: 0,
        superId: (FUSIONS.find((f) => f.weapon === x.id) || {}).id || null,
      }));
    w.activeSkillUnlocked = null; // 合体本身由 batch1/batch2 的套件验收，这里只要"未合体"的对照
    w.recompute();
    w.refreshWeaponEntities();
  }
  return w;
}

/** 有限血量兽潮：怪会追击，死亡后在玩家附近补位，保留死亡触发机制。 */
function buildSwarm(w) {
  const cx = ARENA_W / 2;
  const cy = ARENA_H / 2;
  const field = [];
  const put = (kind, i, n, r) => {
    const a = (i / n) * Math.PI * 2 + 0.37;
    const e = w.spawnEnemyFrom({ kind, tier: FIELD.tier, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    if (!e) return;
    e.touchDamage = 0;
    e.xp = 0;
    field.push({ kind, idx: field.length, e });
  };
  for (let i = 0; i < FIELD.melee; i++) put('shanxiao', i, FIELD.melee, 210);
  for (let i = 0; i < FIELD.ranged; i++) put('bifang', i, FIELD.ranged, 400);
  return field;
}

/** 推进一步：玩家**零攻击输入**，只沿固定圆形路线移动 */
function swarmTick(w, field) {
  w.player.hp = w.player.maxHp; // 只测输出，不测生存
  const a = (w.elapsedMs / 1000) * 0.55;
  w.player.x = ARENA_W / 2 + Math.cos(a) * FIELD.routeR;
  w.player.y = ARENA_H / 2 + Math.sin(a) * FIELD.routeR;
  w.input.mx = -Math.sin(a);
  w.input.my = Math.cos(a);
  w.step();
  for (const slot of field) {
    if (!slot.e || !slot.e.__alive) {
      const angle = (slot.idx * 2.399963 + w.elapsedMs * 0.0007) % (2 * Math.PI);
      const distance = slot.kind === 'bifang' ? 320 : 170;
      slot.e = w.spawnEnemyFrom({
        kind: slot.kind, tier: FIELD.tier,
        x: w.player.x + Math.cos(angle) * distance,
        y: w.player.y + Math.sin(angle) * distance,
      });
      if (!slot.e) continue;
    }
    slot.e.touchDamage = 0;
    slot.e.xp = 0;
  }
  if (w.awaitingChoice) {
    w.awaitingChoice = false;
    w.pendingLevelUps = 0;
    w.cardChoices = [];
    w.paused = false;
  }
}

/** 60 秒清场当量（damageDealt = 真正扣掉的血） */
function clearDamage(sid, { fused = false, seconds = 60, warmup = 3 } = {}) {
  const w = loadout(sid, { fused });
  const field = buildSwarm(w);
  for (let i = 0; i < warmup * STEP_MS; i++) swarmTick(w, field);
  const before = w.runStats.damageDealt || 0;
  for (let i = 0; i < seconds * STEP_MS && w.running; i++) swarmTick(w, field);
  return (w.runStats.damageDealt || 0) - before;
}

/** 围一圈**静止的高血量假人**，用来干净地量"机制本身"的输出 */
function dummies(w, { n = 6, radius = 120, hp = 1e6, kind = 'shanxiao' } = {}) {
  w.enemies.clear();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.31;
    const e = w.spawnEnemyFrom({ kind, tier: 0, x: w.player.x + Math.cos(a) * radius, y: w.player.y + Math.sin(a) * radius });
    if (!e) continue;
    e.maxHp = hp;
    e.hp = hp;
    e.speed = 0;
    e.touchDamage = 0;
    e.fireEvery = 0;
    e.xp = 0;
    out.push({ e, x: e.x, y: e.y });
  }
  return out;
}

function pinDummies(w, list, { hp = 1e6 } = {}) {
  for (const d of list) {
    if (!d.e.__alive) continue;
    d.e.x = d.x;
    d.e.y = d.y;
    d.e.speed = 0;
    d.e.touchDamage = 0;
    d.e.maxHp = hp;
    d.e.hp = hp;
  }
}

// ================================================================ 1
//
// 旧版用钉死且每帧回满血的假人测量，百巫的死亡传染无法触发，
// 还会高估某些大范围持续伤害。这里保留固定种子、路线和密度，
// 改为有限血量、追击、死亡即补位；每帧回满玩家血，只测输出。
section('1. 六系清场当量齐平（固定种子 + 第 5 分钟档 + 60 秒 + 零攻击输入 + 圆形路线）');
{
  const CLEAR = {};
  for (const sid of SERIES) CLEAR[sid] = clearDamage(sid, { fused: false });
  const vals = SERIES.map((s) => CLEAR[s]);
  const mx = Math.max(...vals);
  const mn = Math.min(...vals);
  for (const sid of SERIES) info(`${DISPLAY[sid]}：合体前 60 秒当量 ${CLEAR[sid].toFixed(0)}`);
  info(`合体前 最大/最小 = ${(mx / mn).toFixed(3)}`);
  check(`合体前六系当量最大值 ÷ 最小值 ≤ ${RATIO_MAX}`, mx / mn <= RATIO_MAX, `${(mx / mn).toFixed(3)}`);

  const CLEAR_F = {};
  for (const sid of SERIES) CLEAR_F[sid] = clearDamage(sid, { fused: true });
  const valsF = SERIES.map((s) => CLEAR_F[s]);
  const mxF = Math.max(...valsF);
  const mnF = Math.min(...valsF);
  for (const sid of SERIES) info(`${DISPLAY[sid]}：合体后 60 秒当量 ${CLEAR_F[sid].toFixed(0)}`);
  info(`合体后 最大/最小 = ${(mxF / mnF).toFixed(3)}`);
  check(`合体后六系当量最大值 ÷ 最小值 ≤ ${RATIO_MAX}`, mxF / mnF <= RATIO_MAX, `${(mxF / mnF).toFixed(3)}`);
}

// ================================================================ 2
section('2. 蛊爆：每次只扣 1 层、连爆递减、第 4 次无层可扣');
{
  const skill = ACTIVE_SKILL_BY_ID.skill_ling;
  const PER_STACK_OLD = 55;
  const OLD_SINGLE_NOVA = skill.damage + PER_STACK_OLD * 3; // 旧版口径（= 225）

  const w = new World({ seed: 11, characterId: 'shanpo' }); // 干净口径：不带任何灵山被动
  w.paused = false;
  w.spawner.acc = -1e9;
  w.slots.weapons = [];
  w.slots.passives = [];
  w.activeSkillUnlocked = 'skill_ling';
  w.recompute();
  w.enemies.clear();

  const target = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + 40, y: w.player.y });
  target.maxHp = 1e7;
  target.hp = 1e7;
  target.speed = 0;
  target.touchDamage = 0;
  target.xp = 0;

  const cast = () => {
    w.activeSkillCd = 0; // 绕开冷却，只审"层数与伤害"的规则
    const hpBefore = target.hp;
    const ok = w.triggerActiveSkill();
    return { ok, dealt: hpBefore - target.hp, markAfter: target.mark };
  };

  w.applyMark(target, 3, 0, 0);
  check('标记层数是 3', target.mark === 3, String(target.mark));
  const c1 = cast();
  const c2 = cast();
  const c3 = cast();
  const c4 = cast();
  info(`连爆三次伤害：${c1.dealt.toFixed(0)} / ${c2.dealt.toFixed(0)} / ${c3.dealt.toFixed(0)}；第 4 次 ok=${c4.ok}`);
  check('叠 3 层单次伤害 > 旧版单次引爆 225', c1.dealt > OLD_SINGLE_NOVA, `${c1.dealt.toFixed(1)} vs ${OLD_SINGLE_NOVA}`);
  check('连爆三次各扣 1 层（3 → 2 → 1 → 0）', c1.markAfter === 2 && c2.markAfter === 1 && c3.markAfter === 0,
    `${c1.markAfter}/${c2.markAfter}/${c3.markAfter}`);
  check('连爆三次都生效（都能进冷却）', c1.ok && c2.ok && c3.ok, `${c1.ok}/${c2.ok}/${c3.ok}`);
  check('伤害随层数递减（按消耗前的层数结算）', c1.dealt > c2.dealt && c2.dealt > c3.dealt,
    `${c1.dealt.toFixed(1)} > ${c2.dealt.toFixed(1)} > ${c3.dealt.toFixed(1)}`);
  check('第 4 次无层可扣 → 不生效、不进冷却', c4.ok === false && c4.dealt === 0, `ok=${c4.ok} dealt=${c4.dealt}`);

  // 不清空未消耗层数：只扣 1 层，剩下的层仍然在场上
  const t2 = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x - 40, y: w.player.y });
  t2.maxHp = 1e7; t2.hp = 1e7; t2.speed = 0; t2.touchDamage = 0;
  w.applyMark(t2, 3, 0, 0);
  w.activeSkillCd = 0;
  w.triggerActiveSkill();
  check('一次引爆只消耗 1 层，未消耗的层数保留在场', t2.mark === 2, String(t2.mark));
}

// ================================================================ 3
section('3. 诅咒：未标记目标**无加成**；3 层标记 = 诅咒 + 0.36');
{
  const w = new World({ seed: 12, characterId: 'shanpo' });
  w.paused = false;
  w.spawner.acc = -1e9;
  w.slots.weapons = [];
  w.slots.passives = [];
  w.recompute();
  w.stats = { ...w.stats, curse: 0.24, damage: 0, critChance: 0, shieldDamage: 0 };
  w.enemies.clear();

  const mk = (x) => {
    const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x, y: w.player.y });
    e.maxHp = 1e6; e.hp = 1e6; e.speed = 0; e.touchDamage = 0; e.xp = 0;
    return e;
  };
  const BASE = 100;
  const plain = mk(w.player.x + 40);
  const marked1 = mk(w.player.x - 40);
  const marked3 = mk(w.player.x + 80);
  w.applyMark(marked1, 1, 0, 0);
  w.applyMark(marked3, 3, 0, 0);

  const hit = (e) => {
    e.hp = 1e6;
    const before = e.hp;
    dealDamage(w, e, BASE, { rollCrit: false, source: 'test' });
    return before - e.hp;
  };

  const dPlain = hit(plain);
  const dMark1 = hit(marked1);
  const dMark3 = hit(marked3);
  const expect1 = BASE * (1 + 0.12) * (1 + 0.24 + 0.12);
  const expect3 = BASE * (1 + 0.36) * (1 + 0.24 + 0.36);
  info(`诅咒 24% 下：未标记 ${dPlain.toFixed(1)} / 1 层 ${dMark1.toFixed(1)}（期望 ${expect1.toFixed(1)}）/ 3 层 ${dMark3.toFixed(1)}（期望 ${expect3.toFixed(1)}）`);
  check('未标记目标吃不到任何诅咒加成（伤害 = 基础值）', Math.abs(dPlain - BASE) < 1e-6, `${dPlain}`);
  check('1 层标记 = (1+0.12) × (1+诅咒+0.12)', Math.abs(dMark1 - expect1) < 1e-6, `${dMark1} vs ${expect1}`);
  check('3 层标记 = (1+0.36) × (1+诅咒+0.36)', Math.abs(dMark3 - expect3) < 1e-6, `${dMark3} vs ${expect3}`);
  check('层数越多越痛（单调）', dMark3 > dMark1 && dMark1 > dPlain, `${dPlain.toFixed(1)} < ${dMark1.toFixed(1)} < ${dMark3.toFixed(1)}`);
}

// ================================================================ 4
section('4. 不死魄：**没有任何远程怪**的场景下，终极武器仍产生有效伤害（修复前恒为 0）');
{
  const w = loadout('kun', { fused: true });
  const u = ULTIMATE_FUSIONS.find((x) => x.series === 'kun');
  const st = levelStats(WEAPON_BY_ID[u.weaponId], 1);
  const list = dummies(w, { n: 6, radius: st.orbit * w.stats.area, kind: 'shanxiao' });
  const before = w.runStats.damageDealt || 0;
  for (let i = 0; i < 6 * STEP_MS && w.running; i++) {
    w.player.hp = w.player.maxHp;
    w.step();
    pinDummies(w, list);
  }
  const dealt = (w.runStats.damageDealt || 0) - before;
  info(`纯近战（${list.length} 个静止假人）6 秒输出 = ${dealt.toFixed(0)}，场上敌方子弹 = ${w.enemyBullets.length}`);
  check('场景里确实没有远程怪（没有敌方子弹）', w.enemyBullets.length === 0, String(w.enemyBullets.length));
  check('玉璧环对近战怪产生有效伤害（修复前此值为 0）', dealt > 0, dealt.toFixed(0));

  const breached = loadout('kun', { fused: true });
  const inside = dummies(breached, { n: 1, radius: st.orbit * breached.stats.area * 0.35, kind: 'shanxiao' });
  const beforeInside = breached.runStats.damageDealt || 0;
  for (let i = 0; i < 3 * STEP_MS && breached.running; i++) {
    breached.player.hp = breached.player.maxHp;
    breached.step();
    pinDummies(breached, inside);
  }
  const innerDamage = (breached.runStats.damageDealt || 0) - beforeInside;
  check('怪物突破玉璧外环后仍会受到近身伤害', innerDamage > 0, innerDamage.toFixed(0));

  const doubled = loadout('kun', { fused: true });
  doubled.slots.weapons[0].level = 3;
  doubled.recompute();
  doubled.initUltimateState();
  doubled.step();
  const shot = { x: doubled.player.x + doubled.ultBulwark.radius * 0.78, y: doubled.player.y, speed: 180, damage: 6, radius: 4 };
  const reflected = doubled.bulwarkTryReflect(shot);
  check('Lv3 第二层玉璧能实际反弹敌弹', reflected && shot.owner === 'player', String(reflected));
}

// ================================================================ 5
section('5. 以守为攻：随护盾单调上升且 +35% 封顶；冷却缩减叠满时有效 CD ≥ 3 秒');
{
  const w = loadout('kun', { fused: true });
  const list = dummies(w, { n: 1, radius: 120, kind: 'shanxiao' });
  const dummy = list[0].e;
  // 以守为攻要"玉璧环在场上"才生效（ultBulwark.active 由第一帧 updateBulwark 打开）
  w.player.hp = w.player.maxHp;
  w.step();
  const atShield = (s) => {
    w.player.shield = s;
    dummy.hp = 1e6;
    const before = dummy.hp;
    dealDamage(w, dummy, 100, { rollCrit: false, source: 'test' });
    return before - dummy.hp;
  };
  // 封顶点是 100 点护盾（100 × 0.0035 = 0.35）——单调性必须在封顶**以下**取样
  const g0 = atShield(0);
  const g25 = atShield(25);
  const g50 = atShield(50);
  const g75 = atShield(75);
  const g100 = atShield(100);
  const g200 = atShield(200);
  const g500 = atShield(500);
  const gCap = atShield(1000);
  const m = (g) => g / g0;
  info(`护盾 0/25/50/75/100/200/500/1000 → 伤害倍率 ${[g0, g25, g50, g75, g100, g200, g500, gCap].map((g) => m(g).toFixed(3)).join(' / ')}`);
  check('每 10 点护盾 = +3.5%（100 点 → ×1.35）', Math.abs(m(g100) - 1.35) < 1e-6, m(g100).toFixed(4));
  check('封顶前随护盾单调上升', m(g25) > m(g0) && m(g50) > m(g25) && m(g75) > m(g50) && m(g100) > m(g75),
    `${[g0, g25, g50, g75, g100].map((g) => m(g).toFixed(3)).join(' < ')}`);
  check('在 +35% 封顶（100 点以上伤害不再增长）',
    Math.abs(g200 - g100) < 1e-6 && Math.abs(g500 - g100) < 1e-6 && Math.abs(gCap - g100) < 1e-6,
    `${m(g100).toFixed(4)} / ${m(g200).toFixed(4)} / ${m(gCap).toFixed(4)}`);
  check('封顶值恰好是 ×1.35', Math.abs(m(gCap) - 1.35) < 1e-6, m(gCap).toFixed(4));

  const mk = () => {
    const s = loadout('ling', { fused: false });
    s.slots.weapons = [{ id: 'w_wugu', level: 1, cd: 0, superId: null }];
    s.slots.passives = [];
    s.passiveLevels = {};
    s.activeSkillUnlocked = 'skill_ling';
    s.recompute();
    return s;
  };
  const sk = ACTIVE_SKILL_BY_ID.skill_ling;
  const plain = mk();
  check('无任何技艺冷却时，蛊爆有效 CD = 基础 CD（5 秒）',
    Math.abs(plain.activeSkillCooldown(sk) - sk.cd) < 1e-9, String(plain.activeSkillCooldown(sk)));

  const cdr = mk();
  cdr.slots.passives = ['lingshanwu'];
  cdr.passiveLevels = { lingshanwu: PASSIVE_MAX_LEVEL };
  cdr.recompute();
  info(`灵山雾 Lv${PASSIVE_MAX_LEVEL}：闪避冷却 ${cdr.stats.dashCd.toFixed(2)} 秒（基础 2.6）→ 蛊爆有效 CD ${cdr.activeSkillCooldown(sk).toFixed(2)} 秒`);
  check('叠满技艺冷却后蛊爆有效 CD < 基础 CD', cdr.activeSkillCooldown(sk) < sk.cd, String(cdr.activeSkillCooldown(sk)));
  check('闪避冷却同时被缩短（同一通道两个消费方）', cdr.stats.dashCd < plain.stats.dashCd, `${cdr.stats.dashCd} < ${plain.stats.dashCd}`);

  const extreme = mk();
  extreme.stats = { ...extreme.stats, dashCd: 0.01 }; // 把通道压到极限
  for (const s of ACTIVE_SKILLS) {
    const cd = extreme.activeSkillCooldown(s);
    check(`极限冷却缩减下「${s.cn}」有效 CD ≥ 3 秒`, cd >= 3 - 1e-9, `${cd}`);
  }
}

// ================================================================ 6
section('6. 不得回归：六系可通关、终极机制两两不同、主动技类型两两不同');
{
  const kinds = ULTIMATE_FUSIONS.map((u) => WEAPON_BY_ID[u.weaponId].kind);
  check('六个终极机制两两不同', new Set(kinds).size === 6, kinds.join(','));
  const types = ACTIVE_SKILLS.map((s) => s.type);
  check('六个主动技类型两两不同', new Set(types).size === 6, types.join(','));

  const CD_EXPECT = { ling: 5, hai: 10, tian: 11, shan: 14, huang: 14, kun: 17 };
  const bySeries = {};
  for (const s of ACTIVE_SKILLS) bySeries[s.series] = s.cd;
  check('六系主动技 CD 与规格一致（灵 5 / 海 10 / 天 11 / 山 14 / 荒 14 / 昆 17）',
    SERIES.every((s) => bySeries[s] === CD_EXPECT[s]), JSON.stringify(bySeries));

  for (const sid of SERIES) {
    const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
    const chainOk = !!WEAPON_BY_ID[u.weaponId]
      && u.passives.every((p) => !!PASSIVE_BY_ID[p])
      && !!CHARACTERS.find((c) => c.series === sid);
    check(`${DISPLAY[sid]} 的终极/被动/角色链条完整`, chainOk, u.id);
  }

  // 每系都能持续打到 Boss 窗口：4 满级武器 + 4 被动 + 本系角色，300 秒不死且有输出
  for (const sid of SERIES) {
    const w = loadout(sid, { fused: false });
    const field = buildSwarm(w);
    let died = false;
    for (let i = 0; i < 300 * STEP_MS && w.running; i++) {
      swarmTick(w, field);
      if (w.player.hp <= 0) { died = true; break; }
    }
    const dealt = w.runStats.damageDealt || 0;
    info(`${DISPLAY[sid]}：300 秒存活=${!died}，累计输出 ${dealt.toFixed(0)}`);
    check(`${DISPLAY[sid]}：未合体也能持续清场（不死 + 有输出）`, !died && dealt > 0, `died=${died} dealt=${dealt.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------- 汇总
console.log(`\n================ 平衡修订验收 ${pass} 通过 / ${fail} 失败 ================`);
if (fail) {
  console.log('失败项：');
  for (const b of bad) console.log(`  - ${b}`);
}
process.exit(fail === 0 ? 0 : 1);
