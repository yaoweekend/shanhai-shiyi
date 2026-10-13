// 平衡扫种：跑 N 个种子，统计各角色的通关率与最大难度档。
// 用法：node test/sweep.mjs [每角色种子数]
import { World } from '../src/sim/world.js';
import { TICK_MS } from '../src/config.js';
import { BATCH1_CHARACTERS } from '../src/content/characters.js';
import { kitingPolicy } from './kite.mjs';
import { autoTakeCards } from './policy.mjs';

const N = Number(process.argv[2] || 8);
// 种子必须落在 RNG 的 32 位范围内：之前用 (20260926 + i*7919) % 2147483647 会越界，
// 越界后 createRng 的位运算会退化，导致"同一 seed 两种跑法结果不一致"。
const seeds = [20260926];
for (let i = 1; i < N; i++) seeds.push((20260926 + i * 7919) % 2147483);

const table = [];
for (const ch of BATCH1_CHARACTERS) {
  let wins = 0;
  let reached = 0;
  const times = [];
  for (const seed of seeds) {
    const w = new World({ seed, characterId: ch.id });
    w.paused = false;
    const maxTicks = Math.round((780 * 1000) / TICK_MS);
    for (let i = 0; i < maxTicks && w.running; i++) {
      if (!w.paused) {
        kitingPolicy(w);
        w.step();
      }
      if (w.awaitingChoice) autoTakeCards(w);
    }
    const r = w.finish();
    if (r.outcome === 'win') wins++;
    if (r.elapsedMs >= 600000) reached++;
    times.push(r.elapsedMs / 1000);
  }
  table.push({ cn: ch.cn, id: ch.id, wins, reached, N, times });
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `${ch.cn.padEnd(4)} 通关 ${wins}/${N}  活到 Boss ${reached}/${N}  平均时长 ${avg.toFixed(0)}s  明细 ${times.map((t) => t.toFixed(0)).join(',')}`,
  );
}
const allWin = table.every((t) => t.wins >= Math.ceil(t.N * 0.5));
console.log(allWin ? '\n✓ 三系通关率均 ≥ 50%' : '\n✗ 有系通关率不足 50%');
