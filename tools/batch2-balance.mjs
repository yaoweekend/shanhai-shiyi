// 批 2 平衡标定探针：给「十日 / 百巫 / 玉璧」三把终极的 1.5× 硬要求标定与复核数值。
//
// 口径（与 test/batch2-rework.mjs 第 5 节同一套，固定种子可复现）：
//  · **标准兽潮 + 即时补位**：120 个近战怪 + 60 个毕方（会开火的远程怪）铺在固定环形锚点上；
//    血量取标准量级（tier 4 的杂兵 ≈ 300），死掉立刻在锚点补一个新的 —— 这样"每秒输出"量的是
//    真实的吞吐，不会被"供给卡死"，也不会像全钉死的靶场那样**永远没有击杀**。
//    （百巫的毒雾只在"被标记者死亡"时出现，全钉死的靶场会让它恒为 0；玉璧则需要会开火的敌人。）
//  · **固定路线**：玩家绕竞技场中心做圆周运动（半径 260），不做任何主动技操作。
//  · 只认 dealDamage 真正扣掉的血（world.runStats.damageDealt）。
//
// 用法：node tools/batch2-balance.mjs [计量秒数]
import { World } from '../src/sim/world.js';
import { BATCH1_WEAPONS } from '../src/content/weapons.js';
import { ULTIMATE_FUSIONS } from '../src/content/fusions.js';
import { WEAPON_MAX_LEVEL, ARENA_W, ARENA_H } from '../src/config.js';

const MEASURE = Number(process.argv[2]) || 20;
const SEED = 20260926;
const ROUTE_R = 260;
const MELEE = 120;
const RANGED = 60;
// 标准兽潮的血量量级：tier 4 的杂兵 ≈ 基础血 × 1.42^4
const HP = 300;
const TIER = 4;
const UNLOCKS = BATCH1_WEAPONS.filter((w) => w.unlock === 'trial').map((w) => w.id);

function fixedRoute(w) {
  const a = (w.elapsedMs / 1000) * 0.55;
  w.player.x = ARENA_W / 2 + Math.cos(a) * ROUTE_R;
  w.player.y = ARENA_H / 2 + Math.sin(a) * ROUTE_R;
  w.input.mx = -Math.sin(a);
  w.input.my = Math.cos(a);
}

/** 固定锚点：内圈近战 + 外圈毕方（会开火），死掉立刻补位 */
function buildField(w) {
  const cx = ARENA_W / 2;
  const cy = ARENA_H / 2;
  const out = [];
  const put = (kind, i, n, r) => {
    const a = (i / n) * Math.PI * 2 + 0.37;
    const e = w.spawnEnemyFrom({ kind, tier: TIER, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    if (!e) return;
    e.maxHp = HP;
    e.hp = HP;
    e.touchDamage = 0;
    e.xp = 0;
    out.push({ kind, x: e.x, y: e.y, e });
  };
  for (let i = 0; i < MELEE; i++) put('shanxiao', i, MELEE, 210);
  for (let i = 0; i < RANGED; i++) put('bifang', i, RANGED, 400);
  return out;
}

function refill(w, field) {
  for (const slot of field) {
    if (slot.e && slot.e.__alive) continue;
    const e = w.spawnEnemyFrom({ kind: slot.kind, tier: TIER, x: slot.x, y: slot.y });
    if (!e) continue;
    e.maxHp = HP;
    e.hp = HP;
    e.touchDamage = 0;
    e.xp = 0;
    slot.e = e;
  }
}

function tick(w, field) {
  w.player.hp = w.player.maxHp;
  fixedRoute(w);
  w.step();
  refill(w, field);
  for (const slot of field) {
    if (!slot.e || !slot.e.__alive) continue;
    slot.e.x = slot.x;
    slot.e.y = slot.y;
    slot.e.touchDamage = 0;
  }
  if (w.awaitingChoice) {
    w.awaitingChoice = false;
    w.pendingLevelUps = 0;
    w.cardChoices = [];
    w.paused = false;
  }
}

function run(loadout, { measure = MEASURE, seed = SEED } = {}) {
  const w = new World({ seed, characterId: 'shanpo', unlocks: UNLOCKS.slice() });
  w.paused = false;
  w.slots.weapons = loadout.map((l) => ({ id: l.id, level: l.level, cd: 0, superId: null }));
  const ultOnly = loadout.length === 1 ? ULTIMATE_FUSIONS.find((x) => x.weaponId === loadout[0].id) : null;
  if (ultOnly) {
    w.fusedWeapon = ultOnly.id;
    w.activeSkillUnlocked = null;
    w.initUltimateState();
  }
  w.slots.passives = [];
  w.passiveLevels = {};
  w.recompute();
  w.refreshWeaponEntities();
  w.spawner.acc = -1e9; // 关掉刷怪：兽潮由探针自己维持
  const field = buildField(w);
  for (let i = 0; i < 30; i++) tick(w, field);
  const before = w.runStats.damageDealt || 0;
  const t0 = w.elapsedMs;
  const steps = Math.round((measure * 1000) / (1000 / 60));
  for (let i = 0; i < steps && w.running; i++) tick(w, field);
  const dealt = (w.runStats.damageDealt || 0) - before;
  const dt = (w.elapsedMs - t0) / 1000;
  return { dps: dealt / Math.max(0.001, dt), t: w.elapsedMs / 1000 };
}

const four = (series) =>
  BATCH1_WEAPONS.filter((x) => x.series === series && !x.locked)
    .slice(0, 4)
    .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL }));

console.log(`标准兽潮 ${MELEE} 近战 + ${RANGED} 毕方（即时补位，tier ${TIER}，血量 ${HP}）+ 固定圆周路线，种子 ${SEED}，计量 ${MEASURE}s`);
console.log('系列     四把满级 DPS   终极Lv1 DPS   Lv5 DPS   Lv1倍率  Lv5倍率   终极');
for (const u of ULTIMATE_FUSIONS) {
  const a = run(four(u.series));
  const b1 = run([{ id: u.weaponId, level: 1 }]);
  const b5 = run([{ id: u.weaponId, level: 5 }]);
  console.log(
    `${u.series.padEnd(7)} ${a.dps.toFixed(0).padStart(13)} ${b1.dps.toFixed(0).padStart(13)} ${b5.dps.toFixed(0).padStart(9)} ` +
      `${(b1.dps / Math.max(0.1, a.dps)).toFixed(2).padStart(8)}x ${(b5.dps / Math.max(0.1, a.dps)).toFixed(2).padStart(8)}x   ${u.cn}`,
  );
}
