// 平衡标定探针：给"合体终极 ≥ 被替换的四把满级武器 ×1.5"这条硬要求标定与复核数值。
// （同一套口径已经固化进 test/batch1-rework.mjs 第 5 节，这里留一份可交互的调参入口。）
//
// 口径（最终会写进 test/batch1-rework.mjs，固定种子可复现）：
//  · **固定靶场**：80 个高血量靶子铺在玩家路线的两侧（半径 180~360），每帧钉回锚点；
//  · **固定路线**：玩家绕竞技场中心做圆周运动（半径 260）；
//  · **不吃供给上限**：靶子血量 1e6 且每帧抬满 —— 否则"总伤害"会被刷怪供给卡死
//    （实测 45 秒内任何满级组合都恰好 634，因为怪一出来就被清光）；
//  · **也不让它无限堆积**：靶子数量固定，不跟随玩家，避免"不死怪全糊在脸上"
//    导致 AOE 伤害失真（那样 Lv5 会虚高到 40 万，完全不可比）；
//  · 只认 dealDamage 真正扣掉的血（world.runStats.damageDealt）。
//
// 用法：node tools/dps-probe.mjs [计量秒数]
import { World } from '../src/sim/world.js';
import { BATCH1_WEAPONS } from '../src/content/weapons.js';
import { ULTIMATE_FUSIONS } from '../src/content/fusions.js';
import { WEAPON_MAX_LEVEL, ARENA_W, ARENA_H } from '../src/config.js';

const MEASURE = Number(process.argv[2]) || 25;
const SEED = 20260926;
const TARGETS = 160;
const ROUTE_R = 260;
const FIELD_R = 420;
const UNLOCKS = BATCH1_WEAPONS.filter((w) => w.unlock === 'trial').map((w) => w.id);

function fixedRoute(w) {
  const a = (w.elapsedMs / 1000) * 0.55;
  w.player.x = ARENA_W / 2 + Math.cos(a) * ROUTE_R;
  w.player.y = ARENA_H / 2 + Math.sin(a) * ROUTE_R;
  w.input.mx = -Math.sin(a);
  w.input.my = Math.cos(a);
}

/** 80 个高血量靶子，铺在玩家圆周路线的两侧（半径 180~360），每帧钉回锚点 */
function buildField(w) {
  const cx = ARENA_W / 2;
  const cy = ARENA_H / 2;
  const out = [];
  for (let i = 0; i < TARGETS; i++) {
    const a = i * 2.399963;
    const r = FIELD_R * Math.sqrt((i + 0.5) / TARGETS);
    const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    if (!e) continue;
    e.maxHp = 1e6;
    e.hp = 1e6;
    e.touchDamage = 0;
    e.xp = 0;
    e.ax = e.x;
    e.ay = e.y;
    out.push(e);
  }
  return out;
}

function tick(w, field) {
  w.player.hp = w.player.maxHp;
  w.player.shield = 0;
  fixedRoute(w);
  for (const e of field) {
    if (!e.__alive) continue;
    e.x = e.ax;
    e.y = e.ay;
    e.maxHp = 1e6;
    e.hp = 1e6;
    e.touchDamage = 0;
  }
  w.step();
  for (const e of field) {
    if (!e.__alive) continue;
    e.x = e.ax;
    e.y = e.ay;
    e.maxHp = 1e6;
    e.hp = 1e6;
    e.touchDamage = 0;
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
  w.slots.weapons = loadout.map((l) => ({ id: l.id, level: l.level, cd: 0, superId: l.superId || null }));
  // 终极武器要靠 fusedWeapon 认出来（正常玩法由 checkUltimateFusion 写；探针直接摆）
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
  w.spawner.acc = -1e9; // 关掉刷怪：靶场固定
  const field = buildField(w);

  for (let i = 0; i < 30; i++) tick(w, field); // 让武器相位稳定
  const before = w.runStats.damageDealt || 0;
  const t0 = w.elapsedMs;
  const steps = Math.round((measure * 1000) / (1000 / 60));
  for (let i = 0; i < steps && w.running; i++) tick(w, field);
  const dealt = (w.runStats.damageDealt || 0) - before;
  const dt = (w.elapsedMs - t0) / 1000;
  return { dps: dealt / Math.max(0.001, dt), t: w.elapsedMs / 1000, alive: w.enemies.active.length };
}

const four = (series) =>
  BATCH1_WEAPONS.filter((x) => x.series === series && !x.locked)
    .slice(0, 4)
    .map((x) => ({ id: x.id, level: WEAPON_MAX_LEVEL }));

if (process.argv.includes('--one')) {
  const [sid, wid, lv] = process.argv.slice(-3);
  const load = wid ? [{ id: wid, level: Number(lv) || 1 }] : four(sid);
  const r = run(load);
  console.log(`${wid || sid + '×4'} → ${r.dps.toFixed(0)} dps（靶 ${r.alive}，t=${r.t.toFixed(0)}s）`);
} else {
  console.log(`固定靶场 ${TARGETS} 靶 + 固定圆周路线（半径 ${ROUTE_R}），固定种子 ${SEED}，计量 ${MEASURE}s`);
  console.log('系列     四把满级 DPS   终极Lv1 DPS   Lv5 DPS   Lv1倍率  Lv5倍率   靶数');
  for (const u of ULTIMATE_FUSIONS) {
    const a = run(four(u.series));
    const b1 = run([{ id: u.weaponId, level: 1 }]);
    const b5 = run([{ id: u.weaponId, level: 5 }]);
    console.log(
      `${u.series.padEnd(7)} ${a.dps.toFixed(0).padStart(13)} ${b1.dps.toFixed(0).padStart(13)} ${b5.dps.toFixed(0).padStart(9)} ` +
        `${(b1.dps / Math.max(0.1, a.dps)).toFixed(2).padStart(8)}x ${(b5.dps / Math.max(0.1, a.dps)).toFixed(2).padStart(8)}x   ${b1.alive}  (${u.cn})`,
    );
  }
}
