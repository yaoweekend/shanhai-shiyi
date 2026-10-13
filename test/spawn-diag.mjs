// 刷怪管道诊断：分别统计"刷怪器请求数"和"实际生成数"，找出限流发生在哪一步。
import { World } from '../src/sim/world.js';
import { tierParams, updateSpawner } from '../src/sim/spawner.js';
import { tierOf } from '../src/content/enemies.js';
import { TIER_PERIOD, CAP_ENEMIES } from '../src/config.js';
import { kitingPolicy } from './kite.mjs';
import { autoTakeCards } from './policy.mjs';

const w = new World({ seed: 20260926, characterId: 'huangpo' });
w.paused = false;

let reqTotal = 0;
let spawned = 0;
let spawnFailed = 0;
const origSpawn = w.spawnEnemyFrom.bind(w);
w.spawnEnemyFrom = function (req) {
  reqTotal++;
  const r = origSpawn(req);
  if (r) spawned++;
  else spawnFailed++;
  return r;
};
// 同时记录刷怪器返回的请求数（在 step 内部调用 updateSpawner）
const origStep = w.step.bind(w);
let stepReqs = 0;
w.step = function () {
  const before = reqTotal;
  origStep();
  stepReqs += reqTotal - before;
};

let seg = 0;
let segReq = 0;
let segSpawn = 0;
let segKill = 0;
let lastKills = 0;
console.log('时间   档  目标速率  目标同屏  请求/秒  生成/秒  失败  击杀/秒  实际同屏  每杀死亡时间');
for (let i = 0; i < 60 * 600 && w.running; i++) {
  kitingPolicy(w);
  w.step();
  if (w.awaitingChoice) autoTakeCards(w);
  if (w.elapsedMs - seg >= 60000) {
    const tier = tierOf(w.elapsedMs, TIER_PERIOD * 1000);
    const p = tierParams(tier);
    const k = w.runStats.kills - lastKills;
    const alive = w.enemies.active.length;
    console.log(
      `${String(Math.round(w.elapsedMs / 1000)).padStart(4)}s  ${String(tier).padStart(2)}  ${String(p.rate).padStart(8)}  ${String(p.alive).padStart(8)}  ${(stepReqs / 60).toFixed(1).padStart(7)}  ${(spawned / 60).toFixed(1).padStart(7)}  ${String(spawnFailed).padStart(4)}  ${(k / 60).toFixed(1).padStart(7)}  ${String(alive).padStart(8)}  ${alive > 0 ? (alive / Math.max(0.1, k / 60)).toFixed(1) + 's' : '-'}`,
    );
    seg = w.elapsedMs;
    stepReqs = 0;
    spawned = 0;
    spawnFailed = 0;
    segReq = 0;
    segSpawn = 0;
    segKill = 0;
    lastKills = w.runStats.kills;
  }
}
console.log(`结局 ${w.outcome} @ ${(w.elapsedMs / 1000).toFixed(0)}s，同屏上限 CAP_ENEMIES=${CAP_ENEMIES}`);
