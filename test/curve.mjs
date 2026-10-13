// 难度曲线诊断：同时打印"玩家输出"和"敌人血量池"，看清强弱是否匹配。
// 用法：node test/curve.mjs [角色] [种子]
import { World } from '../src/sim/world.js';
import { tierOf } from '../src/content/enemies.js';
import { TIER_PERIOD, TICK_MS, SLOT_WEAPONS, SLOT_PASSIVES } from '../src/config.js';
import { kitingPolicy } from './kite.mjs';
import { autoTakeCards } from './policy.mjs';

const charId = process.argv[2] || 'shanpo';
const seed = Number(process.argv[3] || 20260926);

const w = new World({ seed, characterId: charId });
w.paused = false;

let dmgDealt = 0;
let pendingDealt = 0;
const rows = [];
let nextReport = 0;
let bossHpAtEntry = null;
let bossDeadAt = null;
let hpMin = Infinity;

for (let i = 0; i < 60 * 760 && w.running; i++) {
  // 统计"本帧造成的总伤害"：敌人掉血 + 本帧被击杀敌人剩余血量
  const hpBefore = new Map();
  for (const e of w.enemies.active) hpBefore.set(e.id, e.hp);
  let killCredit = 0;
  const before = w.player.hp;
  kitingPolicy(w);
  w.step();
  if (w.awaitingChoice) autoTakeCards(w);
  for (const e of w.enemies.active) {
    const h0 = hpBefore.get(e.id);
    if (h0 !== undefined && e.hp < h0) pendingDealt += h0 - e.hp;
  }
  // 被击杀的敌人：用"击杀数 × 当时的平均血量"近似（更精确的做法是拦截 killEnemy，
  // 但这里只关心量级，近似够了）
  void killCredit;

  if (w.player.hp < hpMin) hpMin = w.player.hp;
  const t = w.elapsedMs;
  if (t >= nextReport) {
    nextReport += 30000;
    const tier = tierOf(t, TIER_PERIOD * 1000);
    const aliveHp = w.enemies.active.reduce((a, e) => a + Math.max(0, e.hp), 0);
    const avgHp = w.enemies.active.length ? aliveHp / w.enemies.active.length : 0;
    rows.push({
      sec: Math.round(t / 1000),
      tier,
      lv: w.player.level,
      kills: w.runStats.kills,
      enemyCount: w.enemies.active.length,
      avgEnemyHp: avgHp,
      damageMul: w.stats.damage,
      fireRate: w.stats.fireRate,
      weapons: w.slots.weapons.filter((x) => x.level > 0).length,
      passives: w.slots.passives.length,
      hp: w.player.hp,
      maxHp: w.player.maxHp,
      dmg30: pendingDealt,
    });
    pendingDealt = 0;
  }
  if (w.bossActive && bossHpAtEntry === null) {
    const boss = w.enemies.active.find((e) => e.isBoss);
    if (boss) bossHpAtEntry = { t: w.elapsedMs, hp: boss.maxHp };
  }
  if (w.bossDefeated && bossDeadAt === null) bossDeadAt = w.elapsedMs;
}

console.log(`角色 ${charId} seed ${seed}：${w.outcome} @ ${(w.elapsedMs / 1000).toFixed(0)}s  等级 ${w.player.level}  击杀 ${w.runStats.kills}`);
console.log(`槽位上限：武器 ${SLOT_WEAPONS} / 被动 ${SLOT_PASSIVES}（实际带 ${w.slots.weapons.length} / ${w.slots.passives.length}）`);
console.log('');
console.log('  时间  档  等级   击杀  同屏  平均怪血   玩家DPS   血量        输出加成  射速');
for (const r of rows) {
  const dps = r.dmg30 / 30;
  console.log(
    `  ${String(r.sec).padStart(3)}s  ${String(r.tier).padStart(2)}  ${String(r.lv).padStart(4)}  ${String(r.kills).padStart(6)}  ${String(r.enemyCount).padStart(4)}  ${r.avgEnemyHp.toFixed(0).padStart(8)}  ${dps.toFixed(0).padStart(8)}   ${r.hp.toFixed(0).padStart(4)}/${String(Math.round(r.maxHp)).padStart(4)}  ${(r.damageMul * 100).toFixed(0).padStart(7)}%  ${r.fireRate.toFixed(2)}`,
  );
}
if (bossHpAtEntry) {
  const killTime = bossDeadAt ? ((bossDeadAt - bossHpAtEntry.t) / 1000).toFixed(1) : '未击杀';
  console.log(`\nBoss：血量 ${bossHpAtEntry.hp}，击杀耗时 ${killTime}s`);
}
console.log(`最低血量 ${hpMin.toFixed(0)}`);
console.log(`伤害输出比（玩家DPS / 平均怪血）：这是"能不能秒掉"的直接指标，<0.3 表示很吃力，>2 表示秒杀`);
