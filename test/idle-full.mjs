// 站桩能通关吗？这是"走位有没有意义"的终极判据。
import { runIdle } from './idle.mjs';

const chars = ['shanpo', 'haipo', 'huangpo', 'tianpo', 'wupo', 'busipo'];
console.log('站桩一整局（800 秒，正常选卡）——看谁能不操作通关：');
let idleWins = 0;
for (const ch of chars) {
  const r = runIdle(ch, { seed: 777, maxSeconds: 800 });
  if (r.outcome === 'win') idleWins++;
  console.log(
    `  ${ch.padEnd(8)} ${String(r.outcome || '超时').padEnd(6)} @ ${r.seconds.toFixed(0)}s  血量 ${r.hp.toFixed(0)}/${r.maxHp.toFixed(0)}  击杀 ${r.kills}  等级 ${r.level}`,
  );
}
console.log(`\n站桩通关的角色数：${idleWins}/${chars.length}`);
