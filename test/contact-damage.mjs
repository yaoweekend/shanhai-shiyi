// 触碰伤害回归测试。
// 背景：曾经因为 player.radius 缺失（undefined），所有"圆 vs 圆"判定算成 NaN，
// 导致**普通敌人碰到玩家完全不掉血，而且不报任何错**。这个测试守住这条链路。
//
// 用法：node test/contact-damage.mjs
import { World } from '../src/sim/world.js';
import { ENEMY_LIST } from '../src/content/enemies.js';
import { TICK_MS, PLAYER_BASE } from '../src/config.js';
import { autoTakeCards } from './policy.mjs';

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

section('1. 玩家碰撞体积必须是有限正数');
{
  const w = new World({ seed: 1, characterId: 'shanpo' });
  check('player.radius 存在且有限', Number.isFinite(w.player.radius) && w.player.radius > 0, String(w.player.radius));
  check('player.radius 等于 PLAYER_BASE.radius', w.player.radius === PLAYER_BASE.radius, `${w.player.radius} vs ${PLAYER_BASE.radius}`);
  // 故意破坏后再 recompute，必须自愈（否则读档/改配置后可能又变 NaN）
  w.player.radius = undefined;
  w.recompute();
  check('radius 被破坏后 recompute 会自愈', Number.isFinite(w.player.radius), String(w.player.radius));
}

section('2. 每种怪贴脸都必须造成伤害');
{
  const rows = [];
  for (const def of ENEMY_LIST) {
    const w = new World({ seed: 1, characterId: 'shanpo' });
    w.paused = false;
    w.enemies.clear();
    const e = w.spawnEnemyFrom({ kind: def.id, tier: 0, x: w.player.x + 16, y: w.player.y });
    const hp0 = w.player.hp;
    let framesInCircle = 0;
    let firstHitFrame = null;
    for (let i = 0; i < 180; i++) {
      const before = w.player.hp;
      w.input.mx = 0;
      w.input.my = 0;
      w.step();
      if (!e.__alive) break;
      const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
      if (d <= e.radius + w.player.radius) framesInCircle++;
      if (firstHitFrame === null && w.player.hp < before) firstHitFrame = i;
    }
    rows.push({ cn: def.cn, kind: def.id, lost: hp0 - w.player.hp, framesInCircle, firstHitFrame, alive: e.__alive });
  }
  console.log('种类          贴脸3秒掉血   进碰撞圈帧   首次掉血帧   存活');
  for (const r of rows) {
    console.log(
      `  ${r.cn.padEnd(4)}(${r.kind.padEnd(10)}) ${r.lost.toFixed(0).padStart(9)}  ${String(r.framesInCircle).padStart(10)}  ${String(r.firstHitFrame === null ? '从未' : r.firstHitFrame).padStart(10)}   ${r.alive ? '是' : '已消失'}`,
    );
  }
  check('每种怪贴脸都造成伤害', rows.every((r) => r.lost > 0), rows.filter((r) => r.lost <= 0).map((r) => r.cn).join(','));
  check('每种怪都真的进入过碰撞圈', rows.every((r) => r.framesInCircle > 0), rows.filter((r) => r.framesInCircle === 0).map((r) => r.cn).join(','));
  check(
    '首次掉血发生在 1 秒内',
    rows.every((r) => r.firstHitFrame !== null && r.firstHitFrame < 60),
    JSON.stringify(rows.filter((r) => r.firstHitFrame === null || r.firstHitFrame >= 60)),
  );
}

section('3. 近战轮空：多只怪同时贴脸不能叠加融化');
{
  const w = new World({ seed: 2, characterId: 'huangpo' });
  w.paused = false;
  w.enemies.clear();
  for (let i = 0; i < 30; i++) {
    w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + (i % 6) * 3, y: w.player.y + Math.floor(i / 6) * 3 });
  }
  const hp0 = w.player.hp;
  let hits = 0;
  let last = hp0;
  for (let i = 0; i < 60; i++) {
    w.step();
    if (w.player.hp < last - 0.001) hits++;
    last = w.player.hp;
  }
  const lost = hp0 - w.player.hp;
  console.log(`  30 只怪堆在身上 1 秒：掉血 ${hits} 次、共 ${lost.toFixed(0)} 点（血量上限 ${w.player.maxHp}）`);
  check('1 秒内接触伤害次数被轮空限制（≤3 次）', hits <= 3, `${hits} 次`);
  check('被围住会明显掉血（不是无效伤害）', lost > 0, `${lost.toFixed(1)}`);
  check('被围住 1 秒不至于直接秒杀', w.player.hp > 0, `血量 ${w.player.hp.toFixed(0)}`);
}

section('4. 站桩会被打死（真实对局里也生效）');
{
  // 口径统一在 test/idle.mjs 里定义：必须像真实玩家一样把升级卡选掉。
  // （待选卡会让世界进入 paused，step() 空转、elapsedMs 不再前进，
  //   无敌帧于是永不过期 —— 那样测出来的是"暂停状态下的无敌"。）
  const { runIdle } = await import('./idle.mjs');
  // 单局随机性很大，所以用"3 个种子 × 3 个主角"的采样来判趋势
  const rows = [];
  for (const seed of [777, 4242, 987654]) {
    for (const ch of ['shanpo', 'haipo', 'huangpo']) {
      rows.push({ seed, ...runIdle(ch, { seed, maxSeconds: 300 }) });
    }
  }
  const deaths = rows.filter((r) => r.died);
  console.log(`  站桩 300 秒：${deaths.length}/${rows.length} 局死亡`);
  for (const r of rows) {
    console.log(`    seed ${String(r.seed).padStart(6)} ${r.charId.padEnd(8)} ${r.died ? '死亡' : '存活'} @ ${r.seconds.toFixed(0)}s 血量 ${r.hp.toFixed(0)} 击杀 ${r.kills}`);
  }
  // 阈值说明：'auto索敌'类的武器（落雷/毒雾/投射物）天生适合站桩，
  // 想让它 0% 存活就只能在设计上砍掉"自动索敌"，那不是这一轮该做的事。
  // 所以这里守的是"站桩会明显吃亏"这个趋势（≥40% 的采样死亡），
  // 而不是"站桩必死"；更重要的判据在下一节（站桩不许普遍通关）。
  check('站桩会明显吃亏（≥40% 的采样死亡）', deaths.length >= Math.ceil(rows.length * 0.4), `${deaths.length}/${rows.length}`);
  check('至少有两系站桩会死', ['shanpo', 'haipo', 'huangpo'].filter((ch) => rows.some((r) => r.charId === ch && r.died)).length >= 2, '');
  check('最脆的一系站桩 1 分钟内就死', rows.some((r) => r.died && r.seconds < 60), '');
}

section('5. 站桩不许普遍通关（走位必须有意义）');
{
  const { runIdle } = await import('./idle.mjs');
  const chars = ['shanpo', 'haipo', 'huangpo', 'tianpo', 'wupo', 'busipo'];
  const rows = [];
  for (const seed of [777, 4242]) {
    for (const ch of chars) rows.push({ seed, ...runIdle(ch, { seed, maxSeconds: 800 }) });
  }
  const idleWins = rows.filter((r) => r.outcome === 'win');
  console.log(`  站桩通关：${idleWins.length}/${rows.length} 局（${idleWins.map((r) => r.charId).join('、') || '无'}）`);
  // 注意：这个阈值是"趋势"而不是精确值。单局随机性很大，而且远程/自动索敌类武器
  // 天生就适合站桩；设计上"走位有没有意义"主要靠接触压力来保证，不可能做到 0。
  check('站桩通关不超过一半采样', idleWins.length <= Math.floor(rows.length / 2), `${idleWins.length}/${rows.length}`);
  check('至少有一半角色站桩通不了关', new Set(rows.filter((r) => r.outcome !== 'win').map((r) => r.charId)).size >= 3, `${new Set(rows.filter((r) => r.outcome !== 'win').map((r) => r.charId)).size} 个`);
}

section('6. 经验球不会被时间抹掉（用户报：长时间不捡就消失）');
{
  // 曾经给经验球加过 6 秒寿命（到期并入最近的球），副作用是"玩家还没走过去就没了"。
  // 现在经验球永久留在被击杀的位置：只要没被捡走，它就一直在。
  const w = new World({ seed: 20260926, characterId: 'haipo' });
  w.paused = false;
  const { kitingPolicy: kite, idlePolicy } = await import('./kite.mjs');
  // 先打一会儿攒出一些球
  for (let i = 0; i < 60 * 20 && w.running; i++) {
    kite(w);
    w.step();
    if (w.awaitingChoice) autoTakeCards(w);
  }
  const beforeIds = new Set(w.drops.active.map((d) => d.id));
  const beforeCount = beforeIds.size;
  check('场上已经攒下了经验球', beforeCount > 0, String(beforeCount));
  // 站着不动 20 秒（拾取半径外的球不会被收走）
  const far = w.drops.active.filter((d) => Math.hypot(d.x - w.player.x, d.y - w.player.y) > w.stats.pickup + 40);
  const farIds = far.map((d) => d.id);
  for (let i = 0; i < 60 * 20 && w.running; i++) {
    idlePolicy(w);
    w.step();
    if (w.awaitingChoice) autoTakeCards(w);
  }
  const stillThere = farIds.filter((id) => w.drops.active.some((d) => d.id === id));
  check(
    '20 秒后远处的经验球仍在场上（不因超时消失）',
    farIds.length === 0 || stillThere.length / farIds.length >= 0.8,
    `原有 ${farIds.length} 个远处的球，20 秒后还剩 ${stillThere.length} 个`,
  );
}

console.log(`\n================ 触碰伤害回归 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
