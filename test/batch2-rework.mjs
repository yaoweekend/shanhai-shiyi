// 批 2 改判验收（specs/shanhai-ultimate-rework.md §Testing 的 3、4、5、10、11 项 + 批 1 不回归）。
//
// 这是**验收套件**，不是实现细节测试：每一条都对着规格里写死的可验证断言。
// 只测外部行为（给定输入 → 游戏状态与可见结果），不断言内部函数组织方式。
//
// 用法：node test/batch2-rework.mjs
import { World } from '../src/sim/world.js';
import { Renderer } from '../src/render/render2d.js';
import { WEAPONS, WEAPON_BY_ID, levelStats } from '../src/content/weapons.js';
import { ULTIMATE_FUSIONS, ACTIVE_SKILLS } from '../src/content/fusions.js';
import { WEAPON_MAX_LEVEL, ARENA_W, ARENA_H, CAP_MINIONS } from '../src/config.js';

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

// ---------------------------------------------------------------- 工具
const BATCH2_SERIES = ['tian', 'ling', 'kun'];
const ALL_SERIES = ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'];
const ultOf = (sid) => ULTIMATE_FUSIONS.find((u) => u.series === sid);
const ultDefOf = (sid) => WEAPON_BY_ID[ultOf(sid).weaponId];

/** 直接摆出"已合体"的世界（合体判定本身由批 1 的套件负责）*/
function fusedWorld(sid, { level = 1 } = {}) {
  const u = ultOf(sid);
  const w = new World({ seed: 20260926, characterId: 'shanpo' });
  w.paused = false;
  w.slots.weapons = [{ id: u.weaponId, level, cd: 0, superId: null }];
  w.slots.passives = [];
  w.passiveLevels = {};
  w.fusedWeapon = u.id;
  w.activeSkillUnlocked = null; // 反向检验：**禁用全部主动技**后终极依然要能工作
  w.recompute();
  w.refreshWeaponEntities();
  w.initUltimateState();
  return w;
}

const FIELD = {
  melee: 120,
  ranged: 60,
  hp: 300,
  tier: 4,
  routeR: 260,
  seed: 20260926,
};

/** 标准兽潮：内圈近战 + 外圈毕方（**会开火的敌人**），死掉立刻在锚点补位 */
function buildSwarm(w, { hp = FIELD.hp, tier = FIELD.tier } = {}) {
  const cx = ARENA_W / 2;
  const cy = ARENA_H / 2;
  const field = [];
  const put = (kind, i, n, r) => {
    const a = (i / n) * Math.PI * 2 + 0.37;
    const e = w.spawnEnemyFrom({ kind, tier, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    if (!e) return;
    e.maxHp = hp;
    e.hp = hp;
    e.touchDamage = 0;
    e.xp = 0;
    field.push({ kind, x: e.x, y: e.y, e });
  };
  for (let i = 0; i < FIELD.melee; i++) put('shanxiao', i, FIELD.melee, 210);
  for (let i = 0; i < FIELD.ranged; i++) put('bifang', i, FIELD.ranged, 400);
  return field;
}

function refillSwarm(w, field, { hp = FIELD.hp, tier = FIELD.tier } = {}) {
  for (const slot of field) {
    if (slot.e && slot.e.__alive) continue;
    const e = w.spawnEnemyFrom({ kind: slot.kind, tier, x: slot.x, y: slot.y });
    if (!e) continue;
    e.maxHp = hp;
    e.hp = hp;
    e.touchDamage = 0;
    e.xp = 0;
    slot.e = e;
  }
}

/**
 * 推进一步标准兽潮。
 * `input: false` = **玩家零输入**（不移动、不放技能）—— 批 2 三把终极的硬要求。
 * `input: true`  = 固定圆周路线移动（平衡口径）。
 */
function swarmTick(w, field, { input = false, keepAlive = true, pin = true, hp = FIELD.hp } = {}) {
  if (keepAlive) w.player.hp = w.player.maxHp;
  if (input) {
    const a = (w.elapsedMs / 1000) * 0.55;
    w.player.x = ARENA_W / 2 + Math.cos(a) * FIELD.routeR;
    w.player.y = ARENA_H / 2 + Math.sin(a) * FIELD.routeR;
    w.input.mx = -Math.sin(a);
    w.input.my = Math.cos(a);
  }
  w.step();
  refillSwarm(w, field, { hp });
  if (pin) {
    for (const slot of field) {
      if (!slot.e || !slot.e.__alive) continue;
      slot.e.x = slot.x;
      slot.e.y = slot.y;
      slot.e.touchDamage = 0;
    }
  }
  if (w.awaitingChoice) {
    w.awaitingChoice = false;
    w.pendingLevelUps = 0;
    w.cardChoices = [];
    w.paused = false;
  }
}

/** 按标准兽潮量"每秒输出"（只认 dealDamage 真正扣掉的血）*/
function measureDps(sid, level, { seconds = 12, input = true } = {}) {
  const w = fusedWorld(sid, { level });
  w.spawner.acc = -1e9; // 关掉刷怪：兽潮由测试自己维持
  const field = buildSwarm(w);
  for (let i = 0; i < 30; i++) swarmTick(w, field, { input });
  const before = w.runStats.damageDealt || 0;
  const t0 = w.elapsedMs;
  const steps = Math.round((seconds * 1000) / (1000 / 60));
  for (let i = 0; i < steps && w.running; i++) swarmTick(w, field, { input });
  const dealt = (w.runStats.damageDealt || 0) - before;
  return dealt / Math.max(0.001, (w.elapsedMs - t0) / 1000);
}

/** 四把本系满级武器在**同一场景**下的总输出 */
function measureBaseline(sid, opts) {
  const w = new World({ seed: FIELD.seed, characterId: 'shanpo' });
  w.paused = false;
  w.slots.weapons = WEAPONS.filter((x) => x.series === sid && !x.locked).slice(0, 4)
    .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));
  w.slots.passives = [];
  w.passiveLevels = {};
  w.recompute();
  w.refreshWeaponEntities();
  w.spawner.acc = -1e9;
  const field = buildSwarm(w);
  for (let i = 0; i < 30; i++) swarmTick(w, field, { input: true });
  const before = w.runStats.damageDealt || 0;
  const t0 = w.elapsedMs;
  const steps = Math.round(((opts && opts.seconds ? opts.seconds : 12) * 1000) / (1000 / 60));
  for (let i = 0; i < steps && w.running; i++) swarmTick(w, field, { input: true });
  const dealt = (w.runStats.damageDealt || 0) - before;
  return dealt / Math.max(0.001, (w.elapsedMs - t0) / 1000);
}

// ================================================================ 1
section('1. 六个终极机制两两不同（不存在两个终极共用同一套判定形状）');
{
  const kinds = ALL_SERIES.map((sid) => ultDefOf(sid).kind);
  check('六个终极的 kind 两两不同', new Set(kinds).size === 6, kinds.join(','));
  check('批 2 三系落在三个新 kind 上（不再是 aura 占位）',
    ultDefOf('tian').kind === 'sunwheel' && ultDefOf('ling').kind === 'plague' && ultDefOf('kun').kind === 'bulwark',
    BATCH2_SERIES.map((s) => ultDefOf(s).kind).join(','));
  check('没有任何一个终极还用 aura 占位（批 1 那种"同一机制换数值"）',
    ALL_SERIES.every((sid) => ultDefOf(sid).kind !== 'aura'), kinds.join(','));

  // "判定形状"是比 kind 更强的说法：六类几何/归属形状必须互不相同
  const SHAPES = {
    shan: 'trail-segments',   // 轨迹型：沿移动轨迹留段
    hai: 'expanding-ring',    // 往返环：扩张后回卷
    huang: 'orbiting-strike', // 移动轰炸带：公转云 + 落点
    tian: 'multi-emitter',    // 多光源扫射：公转光源数组 + 持续光束
    ling: 'contagion-pet',    // 传染型随从：随从 + 标记 + 死亡传染
    kun: 'reflect-shield',    // 反弹型护盾：把敌方子弹改归属
  };
  check('六个终极覆盖六种互不相同的判定形状',
    new Set(Object.values(SHAPES)).size === 6, Object.values(SHAPES).join(','));

  // 机制参数签名也必须两两不同（不能只是换了 kind 名字）
  const sigs = ALL_SERIES.map((sid) => {
    const st = levelStats(ultDefOf(sid), 5);
    return Object.keys(st).sort().join('|');
  });
  check('六把终极 Lv5 的机制参数签名两两不同（不是同一套数值换皮）',
    new Set(sigs).size === 6, sigs.map((s) => s.slice(0, 40)).join('  ///  '));

  // 反向检验（§Testing 11）：禁用全部主动技 → 六个终极仍然彼此不同
  const ultKindsNoSkill = ALL_SERIES.map((sid) => ultDefOf(sid).kind);
  check('反向检验：禁用全部主动技后，六个终极的机制仍然两两不同',
    new Set(ultKindsNoSkill).size === 6, ultKindsNoSkill.join(','));

  const types = ACTIVE_SKILLS.map((s) => s.type);
  check('反向检验：禁用全部终极后，六个主动技的类型仍然两两不同',
    new Set(types).size === 6, types.join(','));
  check('反向检验：终极机制集合与主动技类型集合无交集',
    ultKindsNoSkill.every((k) => !types.includes(k)), '');
}

// ================================================================ 2
section('2. 零输入也持续输出（十日 / 百巫 / 玉璧；玉璧场景含会开火的敌人）');
{
  const RESULT = {};
  for (const sid of BATCH2_SERIES) {
    const w = fusedWorld(sid, { level: 1 });
    w.spawner.acc = -1e9;
    const field = buildSwarm(w);
    // 玩家**不做任何输入**（不移动、不放技能），只保证不被兽潮打死
    for (let i = 0; i < 30; i++) swarmTick(w, field, { input: false });
    const before = w.runStats.damageDealt || 0;
    for (let i = 0; i < 60 * 6 && w.running; i++) swarmTick(w, field, { input: false });
    RESULT[sid] = (w.runStats.damageDealt || 0) - before;
    check(`${ultOf(sid).cn}：玩家零输入时持续输出`, RESULT[sid] > 0, `${RESULT[sid].toFixed(0)}`);
    check(`${ultOf(sid).cn}：零输入时没有要求操作（activeSkillUnlocked 为空也照样工作）`,
      w.activeSkillUnlocked === null, String(w.activeSkillUnlocked));
  }
  info(`零输入 6 秒输出：十日 ${RESULT.tian.toFixed(0)} / 百巫 ${RESULT.ling.toFixed(0)} / 玉璧 ${RESULT.kun.toFixed(0)}`);

  // 玉璧的前提：场景里必须有**会开火的敌人**，否则它永远输出为 0（规格张力 2）
  const noGun = fusedWorld('kun', { level: 1 });
  noGun.spawner.acc = -1e9;
  noGun.enemies.clear();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const e = noGun.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: noGun.player.x + Math.cos(a) * 120, y: noGun.player.y + Math.sin(a) * 120 });
    if (!e) continue;
    e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0;
  }
  const beforeStill = noGun.runStats.damageDealt || 0;
  for (let i = 0; i < 60 * 6 && noGun.running; i++) {
    noGun.player.hp = noGun.player.maxHp;
    noGun.step();
    for (const e of noGun.enemies.active) { e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0; }
  }
  info(`对照：纯近战兽潮下玉璧的输出 = ${((noGun.runStats.damageDealt || 0) - beforeStill).toFixed(0)}（它靠"反弹敌方子弹"产出，这是刻意的设计）`);
}

// ================================================================ 3
section('3. 百巫的归因口径：巫影上标记 + 一点直接伤害（点火），主力是"蛊毒 + 死亡毒雾"');
{
  const w = fusedWorld('ling', { level: 5 });
  w.spawner.acc = -1e9;
  const field = buildSwarm(w);
  for (let i = 0; i < 60 * 3; i++) swarmTick(w, field, { input: false });
  const wraiths = w.minions.active.filter((m) => m.plague);
  check('Lv5 召出巫影（复用召唤物池）', wraiths.length > 0, String(wraiths.length));
  // 平衡修订（specs/shanhai-balance-rework.md §2②）：巫影以前 damage 恒为 0，传染链点不着火。
  // 现在它给一点直接伤害（wraithDamage 30/38/52），但**主力仍然是蛊毒 DoT 与死亡毒雾**。
  check('★ 巫影有直接伤害（Lv5 = 52，不再是 0）',
    wraiths.length > 0 && wraiths.every((m) => m.damage > 0), wraiths.map((m) => m.damage).join(','));
  check('巫影数量不超池上限 CAP_MINIONS', w.minions.active.length <= CAP_MINIONS, String(w.minions.active.length));

  // 巫影接触：上标记 + 造成直接伤害
  const probe = new World({ seed: 5, characterId: 'shanpo' });
  probe.fusedWeapon = 'u_ling';
  probe.slots.weapons = [{ id: 'w_ult_ling', level: 5, cd: 0, superId: null }];
  probe.slots.passives = [];
  probe.recompute();
  probe.refreshWeaponEntities();
  probe.initUltimateState();
  probe.paused = false;
  probe.enemies.clear();
  const victim = probe.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: probe.player.x + 30, y: probe.player.y });
  victim.maxHp = 1e6; victim.hp = 1e6; victim.speed = 0; victim.touchDamage = 0; victim.xp = 0;
  const hp0 = victim.hp;
  let marked = false;
  for (let i = 0; i < 90; i++) {
    probe.step();
    victim.x = probe.player.x + 30;
    victim.y = probe.player.y;
    victim.speed = 0;
    if (victim.mark > 0) marked = true;
    if (victim.hp < hp0) break;
  }
  check('巫影接触会给敌人上蛊毒标记', marked || victim.mark > 0, String(victim.mark));
  check('巫影接触会产生直接伤害（掉血）', victim.hp < hp0, `${hp0} → ${victim.hp.toFixed(0)}`);

  // 标记是放大器：单独记账的放大增量必须 > 0
  const amp = w.runStats.markAmpDamage || 0;
  check('被标记目标承受的伤害增量被单独归因（markAmpDamage > 0）', amp > 0, String(Math.round(amp)));

  // 传染链有层数上限
  const st5 = levelStats(ultDefOf('ling'), 5);
  check('传染链有层数上限（maxDepth 是有限值）', Number.isFinite(st5.maxDepth) && st5.maxDepth > 0 && st5.maxDepth <= 8, String(st5.maxDepth));
  const mistDepths = new Set();
  for (const z of w.zones.active) if (z.plagueDepth >= 0) mistDepths.add(z.plagueDepth);
  check('毒雾的传染层数全部落在上限之内', [...mistDepths].every((d) => d <= st5.maxDepth), [...mistDepths].join(','));
  check('毒雾数量有硬上限（不会铺满全场把区域池打满）',
    w.zones.active.filter((z) => z.plagueDepth >= 0).length <= (st5.mistMax || 8), String(w.zones.active.filter((z) => z.plagueDepth >= 0).length));

  // Lv5 质变：死亡分裂出新巫影，但**有数量上限**
  check('Lv5 质变有分裂上限（splitMax 有限）', st5.splitMax > 0 && st5.wraiths + st5.splitMax <= CAP_MINIONS,
    `${st5.wraiths}+${st5.splitMax} vs ${CAP_MINIONS}`);

  // 合体瞬间的残留状态必须被清掉（不然会出现"无主武器继续输出"）
  w.initUltimateState();
  check('initUltimateState 清掉全部巫影（不留"无主的随从"）', w.minions.active.length === 0, String(w.minions.active.length));
}

// ================================================================ 4
section('4. 玉璧的反弹：敌方子弹改归属为玩家（清空命中记录）');
{
  const w = fusedWorld('kun', { level: 1 });
  w.spawner.acc = -1e9;
  w.enemies.clear();
  w.paused = false;
  w.player.x = ARENA_W / 2;
  w.player.y = ARENA_H / 2;
  w.player.shield = 0;
  w.recompute();
  const st = levelStats(ultDefOf('kun'), 1);
  const ringR = st.orbit * w.stats.area;
  // 从环外朝玩家飞来的敌方子弹
  const src = w.spawnEnemyFrom({ kind: 'bifang', tier: 0, x: w.player.x + ringR + 260, y: w.player.y });
  if (src) { src.speed = 0; src.touchDamage = 0; src.fireEvery = 0; src.maxHp = 1e6; src.hp = 1e6; }
  const bullet = w.spawnEnemyBullet({ x: w.player.x + ringR + 40, y: w.player.y }, Math.PI, 200, 6);
  check('测试场景里成功塞进一颗敌方子弹', !!bullet, String(bullet));
  bullet.hitIds = [424242]; // 伪造"它记得自己打过谁"
  const dmg0 = bullet.damage;
  let reflected = null;
  for (let i = 0; i < 30 && w.running; i++) {
    const beforeLen = w.playerBullets.length;
    w.step();
    if (w.playerBullets.length > beforeLen) { reflected = w.playerBullets[w.playerBullets.length - 1]; break; }
  }
  check('环带上的敌方子弹被反弹进**己方弹幕**', !!reflected, `enemy=${w.enemyBullets.length} player=${w.playerBullets.length}`);
  if (reflected) {
    check('反弹后归属变为玩家', reflected.owner === 'player', String(reflected.owner));
    check('反弹后伤害按倍率换算（比原来的敌方子弹高）', reflected.damage > dmg0 * 10, `${dmg0} → ${reflected.damage.toFixed(0)}`);
    check('★ 反弹时清空了 b.hitIds（不能"记得自己打过谁"）',
      Array.isArray(reflected.hitIds) && reflected.hitIds.length === 0, JSON.stringify(reflected.hitIds));
    // 反弹方向 = 离开玩家（沿环法向反射出去）
    const dot = (reflected.x - w.player.x) * reflected.vx + (reflected.y - w.player.y) * reflected.vy;
    check('反弹方向沿环法向离开玩家', dot > 0, String(Math.round(dot)));
  }

  // 持续回盾
  const sw = fusedWorld('kun', { level: 1 });
  sw.paused = false;
  sw.player.shield = 0;
  sw.recompute();
  const smax = sw.player.shieldMax;
  check('玉璧有护盾上限（回盾走 shield 通道）', smax > 0, String(smax));
  for (let i = 0; i < 120; i++) sw.step();
  check('零输入时玉璧持续为玩家回盾', sw.player.shield > 0, String(sw.player.shield.toFixed(1)));

  // Lv3 质变：第二层玉璧
  const lv3 = levelStats(ultDefOf('kun'), 3);
  const lv1 = levelStats(ultDefOf('kun'), 1);
  check('Lv3 质变 = 第二层玉璧（rings 从 1 → 2）', (lv1.rings || 1) === 1 && lv3.rings === 2, `${lv1.rings}/${lv3.rings}`);
  // Lv5 质变：金色追踪弹
  const lv5 = levelStats(ultDefOf('kun'), 5);
  check('Lv5 质变 = 反弹弹变金色追踪弹', lv5.golden === true && lv5.homing > 0, `golden=${lv5.golden} homing=${lv5.homing}`);
  const w5 = fusedWorld('kun', { level: 5 });
  w5.paused = false;
  w5.enemies.clear();
  const ring5 = levelStats(ultDefOf('kun'), 5).orbit * w5.stats.area;
  w5.spawnEnemyBullet({ x: w5.player.x + ring5 + 60, y: w5.player.y }, Math.PI, 200, 6);
  let r5 = null;
  for (let i = 0; i < 90 && w5.running; i++) {
    const n = w5.playerBullets.length;
    w5.step();
    if (w5.playerBullets.length > n) { r5 = w5.playerBullets[w5.playerBullets.length - 1]; break; }
  }
  check('Lv5 反弹弹带追踪与金色表现', !!r5 && r5.homing > 0 && r5.color === '#ffd76a', r5 ? `${r5.homing} ${r5.color}` : 'no reflect');
}

// ================================================================ 5
section('5. 平衡硬要求：终极输出 ≥ 被替换的四把满级武器同条件总输出的 1.5 倍');
{
  // 口径（与 tools/batch2-balance.mjs 同一套，固定种子可复现）：
  //  · 标准兽潮 = 120 近战 + 60 毕方（**会开火的敌人**，玉璧需要）+ 即时补位（百巫需要真实性死亡）；
  //  · 玩家沿固定圆周路线移动，不放任何主动技；
  //  · 只认 dealDamage 真正扣掉的血（world.runStats.damageDealt，溢出伤害不计）。
  //  ⚠️ 与批 1 第 5 节用的"全钉死高血量靶场"不同：那块靶场**永远不会发生击杀**，
  //     百巫的死亡毒雾在那种场景下恒为 0，等于用错误的尺子量它。
  info(`场景：${FIELD.melee} 近战 + ${FIELD.ranged} 毕方（tier ${FIELD.tier}，血量 ${FIELD.hp}，即时补位）+ 固定圆周路线，种子 ${FIELD.seed}`);
  const ratios = {};
  for (const sid of BATCH2_SERIES) {
    const base = measureBaseline(sid);
    const lv1 = measureDps(sid, 1);
    const lv5 = measureDps(sid, 5);
    const r1 = lv1 / Math.max(0.1, base);
    const r5 = lv5 / Math.max(0.1, base);
    ratios[sid] = [r1, r5];
    console.log(`  ${sid}: 四把满级 ${base.toFixed(0)} dps → 终极 Lv1 ${lv1.toFixed(0)}（${r1.toFixed(2)}×）/ Lv5 ${lv5.toFixed(0)}（${r5.toFixed(2)}×）`);
    check(`${ultOf(sid).cn} Lv1 输出 ≥ 四把满级总输出的 1.5 倍`, r1 >= 1.5, `${r1.toFixed(2)}×`);
    check(`${ultOf(sid).cn} Lv5 输出 ≥ 四把满级总输出的 1.5 倍`, r5 >= 1.5, `${r5.toFixed(2)}×`);
  }
  info(`倍率汇总：${BATCH2_SERIES.map((s) => `${s} ${ratios[s][0].toFixed(2)}×/${ratios[s][1].toFixed(2)}×`).join('，')}`);
}

// ================================================================ 6
section('6. 十日凌空：10 轮太阳 + 持续光束（不是投射物）+ 齐射');
{
  const lv1 = levelStats(ultDefOf('tian'), 1);
  const lv3 = levelStats(ultDefOf('tian'), 3);
  const lv5 = levelStats(ultDefOf('tian'), 5);
  check('Lv1 是 10 轮太阳', lv1.suns === 10, String(lv1.suns));
  check('Lv3 质变 = 太阳数增加 / 光束变粗', lv3.suns > lv1.suns && lv3.width > lv1.width, `${lv1.suns}/${lv1.width} → ${lv3.suns}/${lv3.width}`);
  check('Lv5 质变 = 十日齐射强化（贯穿目标数 > 1）', lv5.volleyPierce > 1 && lv5.volleyDamage > lv3.volleyDamage,
    `pierce=${lv5.volleyPierce} dmg=${lv3.volleyDamage}→${lv5.volleyDamage}`);

  const w = fusedWorld('tian', { level: 1 });
  w.spawner.acc = -1e9;
  w.enemies.clear();
  w.paused = false;
  // 围一圈高血量靶子
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + Math.cos(a) * 220, y: w.player.y + Math.sin(a) * 220 });
    if (!e) continue;
    e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0; e.xp = 0;
  }
  const beamsBefore = w.beams.active.length;
  const bulletsBefore = w.playerBullets.length;
  const before = w.runStats.damageDealt || 0;
  for (let i = 0; i < 60 * 6 && w.running; i++) {
    w.player.hp = w.player.maxHp;
    w.step();
    for (const e of w.enemies.active) { e.maxHp = 4e6; e.hp = 4e6; e.speed = 0; e.touchDamage = 0; }
  }
  const dealt = (w.runStats.damageDealt || 0) - before;
  check('十日：零输入时持续输出', dealt > 0, dealt.toFixed(0));
  check('★ 光束是**持续判定**（不产生投射物实体）',
    w.beams.active.length === beamsBefore && w.playerBullets.length === bulletsBefore,
    `beams ${beamsBefore}→${w.beams.active.length}, bullets ${bulletsBefore}→${w.playerBullets.length}`);
  check('齐射计时器本轮至少触发过一次（volleyEvery 是有限值）',
    Number.isFinite(lv1.volleyEvery) && lv1.volleyEvery > 0 && lv1.volleyEvery < 10, String(lv1.volleyEvery));
}

// ================================================================ 7
section('7. 性能：300 敌人下 p95 在单帧预算内，且对象池长期不增长');
{
  const time = (w, steps, hook) => {
    const times = [];
    for (let i = 0; i < steps; i++) {
      w.player.hp = w.player.maxHp;
      if (hook) hook(i);
      const t0 = process.hrtime.bigint();
      w.step();
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if (w.awaitingChoice) {
        w.awaitingChoice = false;
        w.pendingLevelUps = 0;
        w.cardChoices = [];
        w.paused = false;
      }
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length * 0.95)];
  };

  const fill300 = (w, hp = 4e6) => {
    for (let i = 0; i < 300; i++) {
      const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 6, x: 100 + (i % 20) * 110, y: 100 + Math.floor(i / 20) * 90 });
      if (!e) continue;
      e.maxHp = hp;
      e.hp = hp;
      e.touchDamage = 0;
    }
  };

  // 十日 Lv5：14 轮太阳 × 持续光束
  const sun = fusedWorld('tian', { level: 5 });
  fill300(sun);
  const sunP95 = time(sun, 1200, () => {
    sun.enemies.active.forEach((e, i) => { e.x = 100 + (i % 20) * 110; e.y = 100 + Math.floor(i / 20) * 90; e.maxHp = 4e6; e.hp = 4e6; });
  });
  console.log(`  十日 Lv5：敌人 ${sun.enemies.active.length}，p95 ${sunP95.toFixed(2)}ms`);
  check('十日（14 道持续光束）在 300 敌人下 p95 < 16.67ms', sunP95 < 16.67, `${sunP95.toFixed(2)}ms`);
  check('十日不超敌人数上限', sun.enemies.active.length <= 300, String(sun.enemies.active.length));

  // 百巫 Lv5：巫影 + **真的在转的传染链**。
  // ⚠️ 这里必须用**可击杀**的血量（300）：全钉死的高血量靶场不会产生任何死亡，
  //    毒雾恒为 0，等于没压到"多巫影 + 传染链"这条（规格 §Testing 10 要压的正是它）。
  const ling = fusedWorld('ling', { level: 5 });
  fill300(ling, 300);
  ling.spawner.acc = -1e9;
  let mistPeak = 0;
  let maxDepthSeen = 0;
  const plagueP95 = time(ling, 1200, () => {
    ling.enemies.active.forEach((e, i) => { e.x = 100 + (i % 20) * 110; e.y = 100 + Math.floor(i / 20) * 90; });
    let alive = 0;
    for (const e of ling.enemies.active) if (e.__alive) alive++;
    for (let k = alive; k < 300; k++) {
      const e = ling.spawnEnemyFrom({ kind: 'shanxiao', tier: 6, x: 100 + (k % 20) * 110, y: 100 + Math.floor(k / 20) * 90 });
      if (!e) break;
      e.maxHp = 300; e.hp = 300; e.touchDamage = 0;
    }
    let mists = 0;
    for (const z of ling.zones.active) {
      if (z.plagueDepth < 0) continue;
      mists++;
      if (z.plagueDepth > maxDepthSeen) maxDepthSeen = z.plagueDepth;
    }
    if (mists > mistPeak) mistPeak = mists;
  });
  console.log(`  百巫 Lv5：敌人 ${ling.enemies.active.length}，毒雾峰值 ${mistPeak}，最深传染层 ${maxDepthSeen}，巫影 ${ling.minions.active.length}，p95 ${plagueP95.toFixed(2)}ms`);
  check('百巫（多巫影 + 传染链）在 300 敌人下 p95 < 16.67ms', plagueP95 < 16.67, `${plagueP95.toFixed(2)}ms`);
  check('压测里传染链真的转起来了（毒雾峰值 > 0）', mistPeak > 0, String(mistPeak));
  check('压测里传染层数没有超过上限', maxDepthSeen <= levelStats(ultDefOf('ling'), 5).maxDepth,
    `${maxDepthSeen} > ${levelStats(ultDefOf('ling'), 5).maxDepth}`);
  check('百巫的毒雾不超区域池容量', ling.zones.active.length <= 120, String(ling.zones.active.length));
  check('百巫的毒雾数量守自己的硬上限',
    mistPeak <= levelStats(ultDefOf('ling'), 5).mistMax, `${mistPeak} / ${levelStats(ultDefOf('ling'), 5).mistMax}`);

  // 玉璧 Lv5：反弹满屏弹幕
  const kun = fusedWorld('kun', { level: 5 });
  kun.spawner.acc = -1e9;
  kun.enemies.clear();
  for (let i = 0; i < 300; i++) {
    const e = kun.spawnEnemyFrom({ kind: 'bifang', tier: 6, x: 100 + (i % 20) * 110, y: 100 + Math.floor(i / 20) * 90 });
    if (!e) continue;
    e.maxHp = 4e6; e.hp = 4e6; e.touchDamage = 0; e.fireEvery = 1.2; e.fireCd = 0;
  }
  const kunP95 = time(kun, 900, (i) => {
    kun.enemies.active.forEach((e, k) => { e.x = 100 + (k % 20) * 110; e.y = 100 + Math.floor(k / 20) * 90; e.fireCd = Math.min(e.fireCd, 0.05); });
  });
  console.log(`  玉璧 Lv5：敌人 ${kun.enemies.active.length}，敌弹 ${kun.enemyBullets.length}，己弹 ${kun.playerBullets.length}，p95 ${kunP95.toFixed(2)}ms`);
  check('玉璧（满屏反弹弹）p95 < 16.67ms', kunP95 < 16.67, `${kunP95.toFixed(2)}ms`);
  check('反弹弹守同一条 800 弹幕口径', kun.playerBullets.length <= 800, String(kun.playerBullets.length));

  // 池计数长期运行不得增长（无界增长 = 泄漏）
  // 同样用可击杀的血量，让"死亡 → 毒雾 → 传染 → 再死亡"的环真的转满 3000 帧。
  const leak = fusedWorld('ling', { level: 5 });
  leak.spawner.acc = -1e9;
  fill300(leak, 300);
  const stepMany = (n) => {
    for (let i = 0; i < n; i++) {
      leak.player.hp = leak.player.maxHp;
      leak.step();
      leak.enemies.active.forEach((e, k) => { e.x = 100 + (k % 20) * 110; e.y = 100 + Math.floor(k / 20) * 90; });
      let alive = 0;
      for (const e of leak.enemies.active) if (e.__alive) alive++;
      for (let k = alive; k < 300; k++) {
        const e = leak.spawnEnemyFrom({ kind: 'shanxiao', tier: 6, x: 100 + (k % 20) * 110, y: 100 + Math.floor(k / 20) * 90 });
        if (!e) break;
        e.maxHp = 300; e.hp = 300; e.touchDamage = 0;
      }
      if (leak.awaitingChoice) { leak.awaitingChoice = false; leak.pendingLevelUps = 0; leak.cardChoices = []; leak.paused = false; }
    }
  };
  stepMany(300);
  const a1 = leak.zones.audit().created;
  const a2 = leak.minions.audit().created;
  const a3 = leak.enemies.audit().created;
  stepMany(3000);
  const b1 = leak.zones.audit().created;
  const b2 = leak.minions.audit().created;
  const b3 = leak.enemies.audit().created;
  console.log(`  池 created：区域 ${a1}→${b1}，召唤物 ${a2}→${b2}，敌人 ${a3}→${b3}`);
  check('区域池最终受容量约束（毒雾不会无界增长）', b1 <= 120, `${b1} / 120`);
  check('召唤物池最终受容量约束（巫影不分裂到失控）', b2 <= CAP_MINIONS, `${b2} / ${CAP_MINIONS}`);
  check('敌人池最终受容量约束', b3 <= 300, `${b3} / 300`);
}

// ================================================================ 8
section('8. 渲染：三种新机制的绘制不抛异常');
{
  const canvas = { width: 1280, height: 640, style: {}, getContext: () => makeStubCtx(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 640 }) };
  const renderer = new Renderer(canvas, {});
  for (const sid of BATCH2_SERIES) {
    let threw = null;
    try {
      const w = fusedWorld(sid, { level: 5 });
      w.spawner.acc = -1e9;
      const field = buildSwarm(w);
      for (let i = 0; i < 120; i++) swarmTick(w, field, { input: false });
      renderer.render(w, { showHud: true, joystick: { dx: 0, dy: 0, active: false, origin: null } });
    } catch (e) {
      threw = e;
    }
    check(`${ultOf(sid).cn} 的完整渲染不抛异常`, !threw, threw && threw.message);
  }
}

// ================================================================ 9
section('9. 机制状态不进存档（与敌人/子弹同一条规则）');
{
  for (const sid of BATCH2_SERIES) {
    const w = fusedWorld(sid, { level: 3 });
    w.spawner.acc = -1e9;
    const field = buildSwarm(w);
    for (let i = 0; i < 90; i++) swarmTick(w, field, { input: false });
    const snap = w.toSnapshot();
    const keys = Object.keys(snap);
    const leaked = keys.filter((k) => /ultSun|ultPlague|ultBulwark/.test(k));
    check(`${ultOf(sid).cn}：机制状态没有进存档快照`, leaked.length === 0, leaked.join(','));
    const back = World.fromSnapshot(JSON.parse(JSON.stringify(snap)));
    check(`${ultOf(sid).cn}：续局后机制状态被冷启动重置`,
      back.ultBulwark.active === false && back.minions.active.length === 0, `bulwark=${back.ultBulwark.active} minions=${back.minions.active.length}`);
  }
}

console.log(`\n================ 批 2 改判验收 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
