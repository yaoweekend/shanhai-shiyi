// 诊断：伤害来源归因 + 每 10 秒状态。用于平衡调参。
import { World } from '../src/sim/world.js';
import { autoTakeCards } from './policy.mjs';
import { kitingPolicy } from './kite.mjs';
import * as stats from '../src/sim/stats.js';

const charId = process.argv[2] || 'shanpo';
const seed = Number(process.argv[3] || 20260926);
const w = new World({ seed, characterId: charId });
w.paused = false;

// 给 hurtPlayer 包一层，按"最近一次伤害来源"归因
const kindCount = {};
const origHurt = stats.hurtPlayer;
let currentSource = 'unknown';
w._hurtProbe = (src) => {
  currentSource = src;
};
// 直接改写 world 上的调用点不方便，这里用玩家的 hp 变化 + 敌人类型近似归因：
// 记录每次受伤时最近敌人的类型
const dmgByKind = {};
let lastHp = w.player.hp;
let dead = false;

for (let i = 0; i < 60 * 780 && w.running; i++) {
  if (!w.paused) {
    kitingPolicy(w);
    w.step();
  }
  if (w.awaitingChoice) autoTakeCards(w);
  if (w.player.hp < lastHp - 0.01) {
    // 归因：找最近的敌人
    let best = null;
    let bd = Infinity;
    for (const e of w.enemies.active) {
      const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    const key = bd < 90 && best ? best.kind + (best.elite ? '(精英)' : '') : '远程/子弹/自爆/未知';
    dmgByKind[key] = (dmgByKind[key] || 0) + (lastHp - w.player.hp);
  }
  lastHp = w.player.hp;
  if (i % 900 === 0) {
    const weapons = w.slots.weapons.map((x) => x.id + ':' + x.level).join(' ');
    console.log(`${(w.elapsedMs / 1000).toFixed(0).padStart(4)}s hp${w.player.hp.toFixed(0).padStart(4)} Lv${w.player.level} 敌${String(w.enemies.active.length).padStart(3)} 击杀${String(w.runStats.kills).padStart(5)} | ${weapons} | ${w.slots.passives.join(',')}`);
  }
}
console.log('\n结局', w.outcome, '@', (w.elapsedMs / 1000).toFixed(1), 's  等级', w.player.level);
console.log('伤害归因（近似）：');
const total = Object.values(dmgByKind).reduce((a, b) => a + b, 0) || 1;
for (const [k, v] of Object.entries(dmgByKind).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${v.toFixed(0).padStart(6)}  (${((v / total) * 100).toFixed(0)}%)`);
}
