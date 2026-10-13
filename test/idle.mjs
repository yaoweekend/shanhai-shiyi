// 站桩（不操作但正常选卡）统一测试：口径只在这里定义一次，其他测试都引用它。
// 为什么需要它：如果"站桩也能赢"，说明走位没有意义，游戏的核心循环是坏的。
import { World } from '../src/sim/world.js';
import { TICK_MS } from '../src/config.js';
import { autoTakeCards } from './policy.mjs';

/**
 * 跑一局"完全不操作"的对局（只把升级卡选掉）。
 * ⚠️ 必须选卡：待选卡会让世界进入 paused，step() 空转、时间不前进，
 * 无敌帧就永不过期——那样测的是"暂停状态下的无敌"，不是"站桩不死"。
 */
export function runIdle(charId, { seed = 777, maxSeconds = 300 } = {}) {
  const world = new World({ seed, characterId: charId });
  world.paused = false;
  const maxTicks = Math.round((maxSeconds * 1000) / TICK_MS);
  for (let i = 0; i < maxTicks && world.running; i++) {
    world.input.mx = 0;
    world.input.my = 0;
    world.input.dashRequested = false;
    world.step();
    if (world.awaitingChoice) autoTakeCards(world);
  }
  const died = !world.running && world.outcome === 'dead';
  return {
    charId,
    died,
    outcome: world.outcome,
    seconds: world.elapsedMs / 1000,
    hp: world.player.hp,
    maxHp: world.player.maxHp,
    kills: world.runStats.kills,
    level: world.player.level,
    weapons: world.slots.weapons.map((w) => w.id),
    passives: world.slots.passives.slice(),
  };
}

if (process.argv[1] && process.argv[1].endsWith('idle.mjs')) {
  const chars = process.argv.slice(2);
  const list = chars.length ? chars : ['shanpo', 'haipo', 'huangpo', 'tianpo', 'wupo', 'busipo'];
  console.log('站桩测试（不操作，只选卡），每个角色 300 秒：');
  for (const ch of list) {
    const r = runIdle(ch, { seed: 777, maxSeconds: 300 });
    console.log(
      `  ${ch.padEnd(8)} ${r.died ? '死亡' : '存活'} @ ${r.seconds.toFixed(0)}s  血量 ${r.hp.toFixed(0)}/${r.maxHp.toFixed(0)}  击杀 ${r.kills}  等级 ${r.level}`,
    );
  }
}
