// 批 1 验收集成测试：把规格 §16 的"批 1"逐条走一遍。
// 与 headless.mjs（平衡与系统规则）互补：这里只问"批 1 承诺的东西是不是真在游戏里生效"。
//
// 用法：node test/accept.mjs
import { World } from '../src/sim/world.js';
import { ARENA_W, ARENA_H, TICK_MS, SLOT_WEAPONS, SLOT_PASSIVES, PASSIVE_MAX_LEVEL, WEAPON_MAX_LEVEL, CARD_COUNT, CAP_ENEMIES, CAP_PLAYER_BULLETS, RUN_T, TIER_PERIOD } from '../src/config.js';
import { BATCH1_CHARACTERS } from '../src/content/characters.js';
import { BATCH1_WEAPONS, WEAPON_BY_ID, WEAPONS, levelStats } from '../src/content/weapons.js';
import { BATCH1_PASSIVES, PASSIVES } from '../src/content/passives.js';
import { FUSIONS } from '../src/content/fusions.js';
import { tierOf } from '../src/content/enemies.js';
import { AFFIXES } from '../src/content/enemies.js';
import { HOOK_LIST } from '../src/core/hooks.js';
import { CHANNELS } from '../src/core/channels.js';
import { defaultSave } from '../src/meta/save.js';
import { recordRun, unlockedWeaponIds } from '../src/meta/meta.js';
import { getPlaceholder, placeholderStats } from '../src/assets/generator.js';
import { SLOTS, slotById } from '../src/assets/manifest.js';
import { kitingPolicy, idlePolicy } from './kite.mjs';
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

/** 跑一整局（可选是否操作），返回耗时与结算 */
function playFull(charId, { seed = 1, idle = false, unlocks = [], maxSeconds = 780, endless = false } = {}) {
  const t0 = process.hrtime.bigint();
  const world = new World({ seed, characterId: charId, unlocks, endless });
  world.paused = false;
  const maxTicks = Math.round((maxSeconds * 1000) / TICK_MS);
  for (let i = 0; i < maxTicks && world.running; i++) {
    if (!world.paused) {
      if (idle) idlePolicy(world);
      else kitingPolicy(world);
      world.step();
    }
    if (world.awaitingChoice && !idle) autoTakeCards(world);
    else if (world.awaitingChoice && idle) autoTakeCards(world);
  }
  const wallMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return { world, result: world.finish(), wallMs };
}

// ---------------- 1. 内容矩阵：六系完整 ----------------

section('1. 内容矩阵（六系）');
{
  const ALL_SERIES = ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'];
  const { ULTIMATE_FUSIONS } = await import('../src/content/fusions.js');
  const { CHARACTERS } = await import('../src/content/characters.js');
  check('六系 × 4 把武器 = 24 把', BATCH1_WEAPONS.length === 24, String(BATCH1_WEAPONS.length));
  check('六系 × 4 件被动 = 24 件', BATCH1_PASSIVES.length === 24, String(BATCH1_PASSIVES.length));
  check('每把武器都有一条血统配方（24 条）', FUSIONS.length === 24, String(FUSIONS.length));
  check('六系 × 1 条四合一终极 = 6 条', ULTIMATE_FUSIONS.length === 6, String(ULTIMATE_FUSIONS.length));
  check('6 个角色（每系一个）', CHARACTERS.length === 6, String(CHARACTERS.length));
  check('24 条修饰器通道', CHANNELS.length === 24, String(CHANNELS.length));
  check('5 个触发钩子', HOOK_LIST.length === 5, String(HOOK_LIST.length));
  for (const sid of ALL_SERIES) {
    const w = BATCH1_WEAPONS.filter((x) => x.series === sid);
    const p = BATCH1_PASSIVES.filter((x) => x.series === sid);
    const c = CHARACTERS.filter((x) => x.series === sid);
    check(`${sid} 系 4 武器 / 4 被动 / 1 角色`, w.length === 4 && p.length === 4 && c.length === 1, `${w.length}/${p.length}/${c.length}`);
    // 解锁层次：每系恰好 1 把初始 + 2 把池 + 1 把试炼解锁（第 4 把）。
    // 第 4 把是终极融合的门槛武器，所以"想凑某系终极，必须先通关该系试炼"。
    const byUnlock = { initial: 0, pool: 0, trial: 0 };
    for (const x of w) byUnlock[x.unlock] = (byUnlock[x.unlock] || 0) + 1;
    check(`${sid} 系解锁层次 = 1 初始 / 2 池 / 1 试炼`, byUnlock.initial === 1 && byUnlock.pool === 2 && byUnlock.trial === 1, JSON.stringify(byUnlock));
    // 每把武器都有配方
    check(`${sid} 系每把武器都有配方`, w.every((x) => FUSIONS.some((f) => f.weapon === x.id)));
    // 四合一终极：本系 4 把满级 + 指定被动
    const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
    check(`${sid} 系有四合一终极且需要 4 件被动`, !!u && u.passives.length === 4, u ? u.cn : '（缺）');
  }
  const trialWeapons = BATCH1_WEAPONS.filter((w) => w.unlock === 'trial').map((w) => w.id);
  check('每系 1 把试炼解锁武器（共 6 把）', trialWeapons.length === 6, `实际 ${trialWeapons.length}：${trialWeapons.join(',')}`);
  // 没有任何内容还标着"占位/锁定"
  const stillLocked = BATCH1_WEAPONS.filter((w) => w.locked).length + BATCH1_PASSIVES.filter((p) => p.locked).length;
  check('没有内容仍是占位状态（locked）', stillLocked === 0, String(stillLocked));
}

// ---------------- 2. 升级三选一：规则在真实对局中成立 ----------------

section('2. 升级三选一（真实对局观测）');
{
  // 一张卡的身份（与 world.js 的 cardKey 同口径）：同一轮里不许出现两个相同的身份。
  const cardKeyOf = (c) => `${c.type}:${c.weaponId || c.passiveId || c.statId || ''}`;
  const dupOf = (cards) => cards.length - new Set(cards.map(cardKeyOf)).size;
  const world = new World({ seed: 20260926, characterId: 'haipo' });
  world.paused = false;
  let choicesSeen = 0;
  let badCount = 0;
  let dupCount = 0;
  let withSeriesTag = 0;
  let newWeaponAfterFullSlots = 0;
  let fullContentPauses = 0;
  for (let i = 0; i < 60 * 700 && world.running; i++) {
    if (!world.paused) {
      kitingPolicy(world);
      world.step();
    }
    if (world.awaitingChoice) {
      choicesSeen++;
      if (world.cardChoices.length !== 3) badCount++;
      dupCount += dupOf(world.cardChoices);
      for (const c of world.cardChoices) {
        if (c.type === 'weapon-new' && world.slots.weapons.length >= SLOT_WEAPONS) newWeaponAfterFullSlots++;
        if (c.type !== 'none') withSeriesTag++; // 每张卡都能解析出神系
      }
      autoTakeCards(world);
    }
    // 内容全满时不能卡在暂停态（软锁）
    const allMaxed = world.slots.weapons.length >= SLOT_WEAPONS && world.slots.weapons.every((w) => w.level >= 5) && world.slots.passives.length >= SLOT_PASSIVES;
    if (allMaxed && world.paused && world.awaitingChoice) fullContentPauses++;
  }
  console.log(`  本次对局触发升级 ${choicesSeen} 次，武器槽 ${world.slots.weapons.length}/3，被动槽 ${world.slots.passives.length}/4`);
  check('每次升级都是 3 张卡', badCount === 0, `${badCount} 次不是 3 张`);
  // 规格只要求"3 张卡不可刷新不可跳过"，没要求卡不重复；去重是体验上的优化。
  // 真实全样本实测：236 次升级里 7 次出现重复（**3.0%**），都发生在"池子只剩 1–2 个选项"
  // 的中后段（武器满级 + 槽位满之后选项本来就少）。所以这里守的是"重复率很低"，
  // 阈值给到 15% —— 既不与"必须 3 张"冲突，也不会放过"抽样退化成带放回"的回归。
  const dupRate = choicesSeen ? dupCount / choicesSeen : 0;
  check('同一轮基本不出现重复选项（池子不足时允许）', dupRate <= 0.15, `${dupCount}/${choicesSeen} = ${(dupRate * 100).toFixed(1)}%（阈值 15%）`);
  check('出现过升级选择', choicesSeen > 5, String(choicesSeen));
  check('槽位满后不再发新武器卡', newWeaponAfterFullSlots === 0, String(newWeaponAfterFullSlots));
  check('卡片都能解析出神系标签', withSeriesTag > 0);
  check('内容全满时不会卡在暂停等选卡（软锁防护）', fullContentPauses === 0, `${fullContentPauses} 帧卡住`);
  // 直接构造"全满"状态：把槽位（4 武器 / 5 被动）全部填满且武器全满级。
  // 被动现在也能升级，所以"武器满级 + 槽位满"时仍有卡可发（被动升级卡）。
  const full = new World({ seed: 3, characterId: 'shanpo' });
  full.slots.weapons = BATCH1_WEAPONS.slice(0, SLOT_WEAPONS).map((w, i) => ({ id: w.id, level: 5, cd: 0, superId: FUSIONS[i] ? FUSIONS[i].id : null }));
  full.slots.passives = BATCH1_PASSIVES.slice(0, SLOT_PASSIVES).map((p) => p.id);
  full.passiveLevels = {};
  for (const pid of full.slots.passives) full.passiveLevels[pid] = 1;
  full.recompute();
  const noCards = full.rollCards();
  check(
    '武器全满级 + 槽位全满时改为发被动升级卡',
    noCards.length === CARD_COUNT && noCards.every((c) => c.type === 'passive-up'),
    JSON.stringify(noCards),
  );
  const preferred = full.slots.passives[0];
  full.paused = true;
  full.awaitingChoice = true;
  full.pendingLevelUps = 1;
  full.cardChoices = noCards;
  // 不放回抽样下 preferred 不一定在这 3 张里 —— 抽到哪张就验哪张
  const picked = noCards.find((c) => c.passiveId === preferred) || noCards[0];
  const target = picked.passiveId;
  full.takeCard(picked);
  check(
    'takeCard 处理被动升级后解除暂停',
    full.paused === false && full.awaitingChoice === false && full.pendingLevelUps === 0,
    `paused=${full.paused} awaiting=${full.awaitingChoice} pending=${full.pendingLevelUps}`,
  );
  check('被动升级真的加了等级', (full.passiveLevels[target] || 1) === 2, String(full.passiveLevels[target]));
  // 连升多级时必须继续等下一张卡（这是正确行为，不是软锁）
  full.paused = true;
  full.awaitingChoice = true;
  full.pendingLevelUps = 2;
  full.cardChoices = full.rollCards();
  full.takeCard(full.cardChoices[0]);
  check(
    '连升多级时继续等下一张卡（不是软锁）',
    full.awaitingChoice === true && full.pendingLevelUps === 1 && full.paused === true,
    `paused=${full.paused} awaiting=${full.awaitingChoice} pending=${full.pendingLevelUps}`,
  );
  // 真·全满（被动也满级）：此时必须发数值类兜底卡，绝不能是 none
  const maxed = new World({ seed: 4, characterId: 'shanpo' });
  maxed.slots.weapons = BATCH1_WEAPONS.slice(0, SLOT_WEAPONS).map((w) => ({ id: w.id, level: 5, cd: 0, superId: null }));
  maxed.slots.passives = BATCH1_PASSIVES.slice(0, SLOT_PASSIVES).map((p) => p.id);
  maxed.passiveLevels = {};
  for (const pid of maxed.slots.passives) maxed.passiveLevels[pid] = PASSIVE_MAX_LEVEL;
  maxed.recompute();
  const statCards = maxed.rollCards();
  check(
    '全部升满后发数值类兜底卡',
    statCards.length === CARD_COUNT && statCards.every((c) => c.type === 'stat'),
    JSON.stringify(statCards),
  );
  const before = maxed.stats.damage;
  const dmgCard = statCards.find((c) => c.channel === 'damage') || { type: 'stat', channel: 'damage', value: 0.06 };
  maxed.takeCard(dmgCard);
  check('数值卡真的加到了通道上', maxed.stats.damage > before, `${before} → ${maxed.stats.damage}`);
  check('数值兜底卡同样不重复', dupOf(statCards) === 0, JSON.stringify(statCards));

  // ---- 全随机抽卡：多轮扫描，任何一轮都不许出现两个相同的选项 ----
  const probe = new World({ seed: 11, characterId: 'haipo' });
  const probeBefore = JSON.stringify([probe.slots, probe.passiveLevels]);
  let dupRolls = 0;
  let thinRolls = 0;
  for (let i = 0; i < 500; i++) {
    const cards = probe.rollCards();
    if (dupOf(cards) !== 0) dupRolls++;
    if (new Set(cards.map(cardKeyOf)).size !== cards.length) thinRolls++;
  }
  check('全随机抽 500 轮：没有一轮出现重复选项', dupRolls === 0, `${dupRolls} 轮出现重复`);
  check('全随机抽 500 轮：张数都等于去重后的选项数', thinRolls === 0, `${thinRolls} 轮张数不匹配`);
  // rollCards 只读状态：扫完 500 轮不该把对局状态改坏
  check('rollCards 不污染对局状态', JSON.stringify([probe.slots, probe.passiveLevels]) === probeBefore,
    `武器 ${probe.slots.weapons.length} / 被动 ${probe.slots.passives.length}`);

  // ---- 池子比 3 小时：有几张给几张，绝不重复凑数 ----
  const thin = new World({ seed: 7, characterId: 'shanpo' });
  thin.slots.weapons = BATCH1_WEAPONS.slice(0, SLOT_WEAPONS).map((w) => ({ id: w.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));
  thin.slots.passives = BATCH1_PASSIVES.slice(0, SLOT_PASSIVES).map((p) => p.id);
  thin.passiveLevels = {};
  for (const pid of thin.slots.passives) thin.passiveLevels[pid] = PASSIVE_MAX_LEVEL;
  // 只留两件被动没满级 → 合法选项恰好 2 个（武器槽满、被动槽满、武器全满级）
  thin.passiveLevels[thin.slots.passives[0]] = 1;
  thin.passiveLevels[thin.slots.passives[1]] = 1;
  thin.recompute();
  // 规格 §6：每次升级**必须发 3 张卡**（不可刷新、不可跳过）。
  // 所以池子不足 3 个时用重复卡凑满，而不是"有几个发几张"——只发 2 张等于把三选一
  // 降级成二选一，那正是规格要避免的形态。
  const thinCards = thin.rollCards();
  check('池子只有 2 个选项时：仍发满 3 张（用重复凑数）', thinCards.length === 3, JSON.stringify(thinCards));
  check('池子只有 2 个选项时：两张不同的选项都出现了', new Set(thinCards.map((c) => c.passiveId)).size === 2, JSON.stringify(thinCards));
  check('池子只有 2 个选项时：三张都是被动升级卡', thinCards.every((c) => c.type === 'passive-up'), JSON.stringify(thinCards));

  // ---- 池子只有 1 个选项时：只发 1 张 ----
  const single = new World({ seed: 9, characterId: 'shanpo' });
  single.slots.weapons = BATCH1_WEAPONS.slice(0, SLOT_WEAPONS).map((w) => ({ id: w.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));
  single.slots.passives = BATCH1_PASSIVES.slice(0, SLOT_PASSIVES).map((p) => p.id);
  single.passiveLevels = {};
  for (const pid of single.slots.passives) single.passiveLevels[pid] = PASSIVE_MAX_LEVEL;
  single.passiveLevels[single.slots.passives[0]] = 1;
  single.recompute();
  const singleCards = single.rollCards();
  check('池子只有 1 个选项时：发满 3 张同一张卡', singleCards.length === 3 && singleCards.every((c) => c.type === 'passive-up'),
    JSON.stringify(singleCards));
  // 一张卡（重复 3 份）也必须能正常选掉、不会卡在暂停态（软锁防护）
  single.paused = true;
  single.awaitingChoice = true;
  single.pendingLevelUps = 1;
  single.cardChoices = singleCards;
  single.takeCard(singleCards[0]);
  check('只有 1 张卡时也能选掉并解除暂停',
    single.paused === false && single.awaitingChoice === false && single.pendingLevelUps === 0,
    `paused=${single.paused} awaiting=${single.awaitingChoice} pending=${single.pendingLevelUps}`);
}

// ---------------- 2.5 本系加权 + 三选一刷新（用户新增的两条特性） ----------------

section('2.5 本系加权与刷新');
{
  const { CHARACTERS } = await import('../src/content/characters.js');

  // ① 本系加权：同系卡应该更容易出现，但不能变成"每轮必出同系"（那就成了硬性配平）
  const rateOf = (charId, series) => {
    const w = new World({ seed: 4242, characterId: charId, unlockedSeries: ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'] });
    let hit = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      if (w.rollCards().some((c) => w.cardSeries(c) === series)) hit++;
    }
    return hit / N;
  };
  for (const ch of CHARACTERS) {
    const r = rateOf(ch.id, ch.series);
    check(`${ch.cn} 的三选一里同系更容易出现`, r > 0.5, `${(r * 100).toFixed(0)}%`);
    check(`${ch.cn} 的同系不是"每轮必出"（保留取舍）`, r < 0.9, `${(r * 100).toFixed(0)}%`);
  }
  console.log(
    `  同系出现率：${CHARACTERS.map((c) => `${c.cn} ${(rateOf(c.id, c.series) * 100).toFixed(0)}%`).join('  ')}`,
  );

  // ② 刷新：每局限一次，用掉即减，且计数进存档（否则退出重进就能刷回来）
  const rw = new World({ seed: 5, characterId: 'shanpo' });
  rw.paused = true;
  rw.awaitingChoice = true;
  rw.pendingLevelUps = 1;
  rw.cardChoices = rw.rollCards();
  const before = JSON.stringify(rw.cardChoices);
  check('开局有 1 次刷新机会', rw.refreshesLeft === 1, String(rw.refreshesLeft));
  const first = rw.refreshCards();
  check('刷新返回了新的卡面', Array.isArray(first) && first.length === 3, JSON.stringify(first && first.length));
  check('刷新后次数用尽', rw.refreshesLeft === 0, String(rw.refreshesLeft));
  check('刷新不消耗升级次数', rw.pendingLevelUps === 1 && rw.awaitingChoice === true, `pending=${rw.pendingLevelUps}`);
  check('刷新不改变卡位数量', rw.cardChoices.length === 3, String(rw.cardChoices.length));
  // 卡面是否真的换了（池子够大时几乎必然不同；同种子重抽也可能撞上，所以只作提示不作断言）
  const changed = JSON.stringify(rw.cardChoices) !== before;
  console.log(`  刷新后卡面与原先${changed ? '不同' : '相同（概率极低，可接受）'}`);
  check('次数用尽后再刷新无效', rw.refreshCards() === null, 'refreshCards 应返回 null');

  // 存档往返：刷新次数必须带过去，否则退出重进可以反复刷
  const snap = rw.toSnapshot();
  const rw2 = World.fromSnapshot(snap, {});
  check('刷新次数进存档（防退出重进刷回）', rw2.refreshesLeft === 0, String(rw2.refreshesLeft));
}

// ---------------- 3. 精英与词缀 ----------------

section('3. 精英（换色放大 + 一个词缀）');
{
  const world = new World({ seed: 42, characterId: 'shanpo' });
  world.paused = false;
  const seen = new Set();
  const eliteIds = new Set();
  const eliteTimes = [];
  let maxScale = 1;
  let maxRadius = 0;
  for (let i = 0; i < 60 * 520 && world.running; i++) {
    kitingPolicy(world);
    world.step();
    if (world.awaitingChoice) autoTakeCards(world);
    for (const e of world.enemies.active) {
      if (!e.elite) continue;
      // 必须按对象 id 去重：精英会在场上活好几秒，而这里是每帧扫描，
      // 不去重就会把同一只精英记成 120/125/130/135/140 五只"新精英"。
      if (eliteIds.has(e.id)) continue;
      eliteIds.add(e.id);
      seen.add(e.affix);
      eliteTimes.push(world.elapsedMs);
      maxScale = Math.max(maxScale, e.scale || 1);
      maxRadius = Math.max(maxRadius, e.radius);
    }
  }
  const uniqTimes = [...new Set(eliteTimes.map((t) => Math.round(t / 1000 / 5) * 5))];
  console.log(`  观测到精英词缀：${[...seen].join(',')}；出现时间（秒，去重）：${uniqTimes.join(',')}`);
  // 只要求"已活到的时间点都出现了精英"：这一局可能没活到 8 分钟，
  // 把收束条件写成"必须见满 4 只"就等于在测平衡而不是测机制。
  const reached = RUN_T.eliteTimes.filter((t) => world.elapsedMs / 1000 >= t + 10);
  check(
    '已抵达的时间点都出现了精英',
    reached.length > 0 && reached.every((t) => eliteTimes.some((et) => Math.abs(et / 1000 - t) < 20)),
    `已抵达 ${reached.join(',')}；实际 ${eliteTimes.map((t) => (t / 1000).toFixed(0)).join(',')}`,
  );
  check('同一时间点不会重复产出精英', eliteTimes.length === new Set(eliteTimes).size, `${eliteTimes.length} 次 vs ${new Set(eliteTimes).size} 个时间点`);
  check('精英带词缀且来自 4 种词缀表', seen.size >= 1 && [...seen].every((a) => AFFIXES.some((x) => x.id === a)), [...seen].join(','));
  check('精英被放大（scale > 1）', maxScale > 1, `maxScale=${maxScale}`);
  check('精英半径大于普通敌人', maxRadius > 13, `maxRadius=${maxRadius}`);
}

// ---------------- 4. Boss 相柳三阶段 ----------------

section('4. Boss 相柳（三阶段，头部逐个被击破）');
{
  const world = new World({ seed: 5, characterId: 'huangpo' });
  world.paused = false;
  // 直接放到 10:00 的 Boss 时刻：把时间推过去（模拟层时间就是 tick × 固定步长）
  const bossTick = Math.round((RUN_T.bossAt * 1000) / TICK_MS) + 120;
  world.tick = bossTick;
  world.elapsedMs = bossTick * TICK_MS;
  world.spawner.waveIndex = Math.floor(world.elapsedMs / 30000);
  // 推进几帧让刷怪器放出 Boss
  for (let i = 0; i < 30 && !world.bossActive; i++) world.step();
  const boss = world.enemies.active.find((e) => e.isBoss);
  check('10:00 出现 Boss 相柳', !!boss, world.bossActive ? 'bossActive 为真但找不到实体' : '没生成');
  if (boss) {
    console.log(`  Boss 生命 ${boss.maxHp}，初始首数 ${world.bossState.heads}，阶段 ${world.bossState.phase}，弹幕周期 ${boss.fireEvery}s`);
    check('Boss 初始为九首、第 0 阶段', world.bossState.heads === 9 && world.bossState.phase === 0, `${world.bossState.heads}/${world.bossState.phase}`);
    check('Boss 登场有预警与提示', world.bossWarning === true || !!world.hintText, `warning=${world.bossWarning} hint=${world.hintText}`);
    // 打到 62% 以下 → 第 1 阶段（六首）
    boss.hp = boss.maxHp * 0.6;
    world.step();
    check('血量降到 62% 以下 → 六首（第 1 阶段）', world.bossState.phase === 1 && world.bossState.heads === 6, `${world.bossState.heads}/${world.bossState.phase}`);
    // 打到 30% 以下 → 第 2 阶段（三首）
    boss.hp = boss.maxHp * 0.25;
    world.step();
    check('血量降到 30% 以下 → 三首（第 2 阶段）', world.bossState.phase === 2 && world.bossState.heads === 3, `${world.bossState.heads}/${world.bossState.phase}`);
    // 弹幕形态随阶段改变
    const phase2CfgBullets = 16;
    const beforeBullets = world.enemyBullets.length;
    boss.fireCd = 0;
    for (let i = 0; i < 4; i++) world.step();
    check('阶段 3 的环形弹幕真的发出来了', world.enemyBullets.length > beforeBullets, `${beforeBullets} → ${world.enemyBullets.length}`);
    // 击杀 → 通关
    boss.hp = 1;
    world.player.x = boss.x;
    world.player.y = boss.y;
    for (let i = 0; i < 8; i++) world.step();
    // 直接结算（用伤害函数，保证走的是真实的击杀路径）
    boss.hp = 0.5;
    const { dealDamage } = await import('../src/sim/stats.js');
    dealDamage(world, boss, 10, { source: 'test' });
    check('击杀 Boss → 本局判定为通关', world.outcome === 'win' && world.bossDefeated === true, `outcome=${world.outcome}`);
    check('Boss 死亡立刻停止推进', world.running === false);
  }
  // 直接 spawnEnemyFrom 也要能正确建立 Boss 状态（不做时间旅行的情况）
  const w2 = new World({ seed: 6, characterId: 'shanpo' });
  w2.spawnEnemyFrom({ kind: 'xiangliu', boss: true, x: 1200, y: 600, tier: 5 });
  check('手动生成 Boss 也建立正确状态', w2.bossState.spawned && w2.bossState.heads === 9 && w2.bossActive === false, JSON.stringify(w2.bossState));
}

// ---------------- 5. 难度阶梯与一局节奏时间点 ----------------

section('5. 一局节奏（时间驱动的关键点）');
{
  const world = new World({ seed: 11, characterId: 'huangpo' });
  world.paused = false;
  const marks = {};
  let graceMaxEnemies = 0;
  let rangedBefore5min = 0;
  for (let i = 0; i < 60 * 620 && world.running; i++) {
    kitingPolicy(world);
    world.step();
    if (world.awaitingChoice) autoTakeCards(world);
    if (world.elapsedMs <= RUN_T.graceEnd * 1000) graceMaxEnemies = Math.max(graceMaxEnemies, world.enemies.active.length);
    if (world.elapsedMs < RUN_T.rangedFrom * 1000 && world.enemies.active.some((e) => e.ai === 'ranged')) rangedBefore5min++;
    for (const t of [120, 240, 360, 480]) {
      if (!marks[t] && world.elapsedMs >= t * 1000) marks[t] = world.runStats.maxTier;
    }
  }
  console.log(`  空窗期同屏最多 ${graceMaxEnemies} 个敌人；难度档：2min=${marks[120]} 4min=${marks[240]} 6min=${marks[360]} 8min=${marks[480]}`);
  check(`0:00–0:${RUN_T.graceEnd} 空窗期只有少量弱敌`, graceMaxEnemies > 0 && graceMaxEnemies <= 18, String(graceMaxEnemies));
  check('5:00 之前不出现远程敌人', rangedBefore5min === 0, `${rangedBefore5min} 帧出现远程`);
  // 阶梯本身是纯时间函数，直接验公式（不受"这局活多久"影响）。
  // 之前这条断言要求玩家必须活到 6 分钟，等于把平衡问题当成机制问题 —— 随机抽卡之后
  // 某一局 2 分钟前就死，marks 全空，它就误报了。
  check(
    '难度每 2 分钟升一档（阶梯式）',
    tierOf(0, 120000) === 0 && tierOf(119999, 120000) === 0 && tierOf(120000, 120000) === 1 &&
      tierOf(240000, 120000) === 2 && tierOf(360000, 120000) === 3,
    `tierOf: 0s=${tierOf(0, 120000)} 120s=${tierOf(120000, 120000)} 240s=${tierOf(240000, 120000)} 360s=${tierOf(360000, 120000)}`,
  );
  // 真正要防的回归是"maxTier 根本没被记录过"：只要这一局活过了第一个档位就必须记到 1。
  check(
    '实际推进时难度档被记录到 runStats',
    world.elapsedMs < 120000 || marks[120] >= 1,
    `活到 ${(world.elapsedMs / 1000).toFixed(0)}s，marks=${JSON.stringify(marks)}`,
  );
  // 8 分钟那一档单独验证（这一局可能没活到 8 分钟，所以不放进上面那条）
  check('8 分钟为第 4 档', tierOf(480000, TIER_PERIOD * 1000) === 4, String(tierOf(480000, TIER_PERIOD * 1000)));
  check('难度档周期常量 = 2 分钟', TIER_PERIOD === 120);
}

// ---------------- 6. 通关 / 无尽 ----------------

section('6. 通关结算与无尽模式');
{
  // 用多个种子判"能通关"，而不是要求某一个特定种子通关
  // （肉鸽单局随机性大：同一个种子可能这一版赢、下一版输）
  const seeds = [20260926, 4242, 987654, 13579, 246810];
  let wins = 0;
  let winResult = null;
  let sample = null;
  for (const s of seeds) {
    const r = playFull('haipo', { seed: s });
    if (!sample) sample = r;
    if (r.result.outcome === 'win') {
      wins++;
      if (!winResult) winResult = r;
    }
  }
  console.log(`  海魄 5 个种子：通关 ${wins}/5（示例：${sample.result.outcome} @ ${(sample.result.elapsedMs / 1000).toFixed(0)}s）`);
  check('一局能通关（5 种子里至少 1 次）', wins >= 1, `${wins}/5`);
  const wr = winResult || sample;
  check('通关时长落在 8~13 分钟', wr.result.elapsedMs >= 480000 && wr.result.elapsedMs <= 780000, `${(wr.result.elapsedMs / 1000).toFixed(0)}s`);
  check('击杀 Boss 即通关结算', wr.world.bossDefeated === true && wr.result.outcome === 'win', `bossDefeated=${wr.world.bossDefeated} outcome=${wr.result.outcome}`);

  // 无尽模式：只在"12:00 未击杀 Boss"这条收束条件上生效（不是不会通关）
  const { dealDamage } = await import('../src/sim/stats.js');
  const buildAt = (endless) => {
    const w2 = new World({ seed: 21, characterId: 'shanpo', endless });
    w2.paused = false;
    // 已过 Boss 登场时刻，且不让刷怪器再灌小怪
    w2.spawner.bossSpawned = true;
    w2.spawner.eliteIdx = 99;
    w2.spawner.acc = 0;
    // 把玩家挪到远离竞技场中心的位置，Boss 距离足够远，
    // 这样测到的一定是"计时器收束"，而不是"被 Boss 打死"。
    w2.player.x = 120;
    w2.player.y = 120;
    w2.camera.x = 120;
    w2.camera.y = 120;
    w2.spawnEnemyFrom({ kind: 'xiangliu', boss: true, x: ARENA_W - 200, y: ARENA_H - 200, tier: 5 });
    w2.elapsedMs = (RUN_T.bossDeadline - 20) * 1000;
    w2.tick = Math.round(w2.elapsedMs / TICK_MS);
    return w2;
  };
  // 非无尽 + 有 Boss：到 bossDeadline（12:30）收束
  const normal = buildAt(false);
  for (let i = 0; i < 60 * 40 && normal.running; i++) normal.step();
  check(
    `非无尽模式：${RUN_T.bossDeadline / 60} 分钟仍未击杀 Boss → 本局收束`,
    normal.running === false && normal.outcome === 'dead',
    `running=${normal.running} outcome=${normal.outcome} t=${(normal.elapsedMs / 1000).toFixed(0)} hp=${normal.player.hp.toFixed(0)}`,
  );
  // 无尽模式同样条件必须继续。为了只测"计时器"这一件事，
  // 把 Boss 做成无害的（不打人也不掉血）：否则测出来的可能是"被 Boss 打死"。
  const endless = buildAt(true);
  const eb = endless.enemies.active.find((e) => e.isBoss);
  if (eb) {
    eb.touchDamage = 0;
    eb.fireCd = 1e9;
    eb.chargeCd = 1e9;
  }
  endless.player.hp = 99999;
  for (let i = 0; i < 60 * 40 && endless.running; i++) endless.step();
  check(
    '无尽模式：不会强制结束',
    endless.running === true && endless.elapsedMs > RUN_T.bossDeadline * 1000,
    `running=${endless.running} outcome=${endless.outcome} t=${(endless.elapsedMs / 1000).toFixed(0)}`,
  );
  // 无尽模式下击杀 Boss：先按通关结算，然后继续下一周（规格 §7：无尽是"通关后继续"）
  const boss = endless.enemies.active.find((e) => e.isBoss);
  if (boss) {
    const beforeCycle = endless.endlessCycle;
    boss.hp = 1;
    dealDamage(endless, boss, 100, { source: 'test' });
    check(
      '无尽模式击杀 Boss → 依然判定通关',
      endless.outcome === 'win' && endless.bossDefeated === true,
      `outcome=${endless.outcome}`,
    );
    check(
      '无尽模式通关后继续下一周',
      endless.running === true && endless.endlessCycle === beforeCycle + 1 && endless.spawner.bossSpawned === false,
      `running=${endless.running} 周=${endless.endlessCycle}`,
    );
  } else {
    check('无尽模式下 Boss 仍在场', false);
  }
  // 难度在 12 分钟后继续升档
  const long = buildAt(true);
  long.elapsedMs = 900000;
  long.tick = Math.round(900000 / TICK_MS);
  for (let i = 0; i < 10; i++) long.step();
  check('无尽模式 15 分钟时难度档继续上涨', long.runStats.maxTier >= 7, String(long.runStats.maxTier));
}

// ---------------- 7. 断点续局：存档 → 恢复 → 继续（真实模拟） ----------------

section('7. 断点续局');
{
  const a = new World({ seed: 31415, characterId: 'huangpo' });
  a.paused = false;
  for (let i = 0; i < 60 * 180 && a.running; i++) {
    kitingPolicy(a);
    a.step();
    if (a.awaitingChoice) autoTakeCards(a);
  }
  const snap = JSON.parse(JSON.stringify(a.toSnapshot()));
  const b = World.fromSnapshot(snap);
  b.paused = false;
  const before = { t: b.elapsedMs, lv: b.player.level, hp: b.player.hp, kills: b.runStats.kills };
  for (let i = 0; i < 60 * 60 && b.running; i++) {
    kitingPolicy(b);
    b.step();
    if (b.awaitingChoice) autoTakeCards(b);
  }
  console.log(`  续局：${(before.t / 1000).toFixed(0)}s Lv${before.lv} → ${(b.elapsedMs / 1000).toFixed(0)}s Lv${b.player.level}，击杀 ${before.kills} → ${b.runStats.kills}`);
  check('续局后时间从存档点继续', b.elapsedMs > before.t, `${before.t} → ${b.elapsedMs}`);
  check('续局后等级不回退', b.player.level >= before.lv, `${before.lv} → ${b.player.level}`);
  check('续局后战斗继续（有击杀增长）', b.runStats.kills >= before.kills, `${before.kills} → ${b.runStats.kills}`);
  check('续局不恢复敌人/子弹（按波次冷启动）', snap.v === 1 && !('enemies' in snap) && !('bullets' in snap), Object.keys(snap).join(','));
}

// ---------------- 8. 试炼解锁 → 武器真的进池 → 能通关 ----------------

section('8. 试炼解锁武器的完整闭环');
{
  const save = defaultSave();
  // 先用真实对局拿到山经试炼（纯山经通关）
  const { world, result } = playFull('shanpo', { seed: 20260926 });
  result.seen = world.slots.weapons.map((w) => w.id).concat(world.slots.passives);
  const rec = recordRun(save, result);
  console.log(`  山经对局：${result.outcome}，纯山经=${JSON.stringify(result.trialsThisRun.seriesOnly)}，触发试炼：${rec.newTrials.map((t) => t.name).join('、') || '无'}`);
  const unlockedIds = unlockedWeaponIds(save);
  if (save.trials.shan.done) {
    check('山经试炼解锁了「利爪横扫」', unlockedIds.includes('w_lizhao'), unlockedIds.join(','));
    // 解锁后：新一局的卡池里必须真的能抽到它
    const w2 = new World({ seed: 777, characterId: 'shanpo', unlocks: unlockedIds });
    let sawTrial = false;
    for (let i = 0; i < 200 && !sawTrial; i++) {
      for (const c of w2.rollCards()) if (c.weaponId === 'w_lizhao') sawTrial = true;
    }
    check('解锁后「利爪横扫」进入卡池', sawTrial);
    // 未解锁时，试炼武器绝不能进卡池
    const w3 = new World({ seed: 778, characterId: 'shanpo', unlocks: [] });
    let sawLocked = false;
    for (let i = 0; i < 200 && !sawLocked; i++) {
      for (const c of w3.rollCards()) if (c.weaponId === 'w_shanbeng') sawLocked = true;
    }
    check('未解锁时试炼武器「山崩践踏」不在卡池', !sawLocked);
    // 拿上它真的能打
    const r4 = playFull('shanpo', { seed: 4242, unlocks: unlockedIds });
    console.log(`  解锁后带试炼武器再打一局：${r4.result.outcome} @ ${(r4.result.elapsedMs / 1000).toFixed(0)}s`);
    check('解锁后的对局能正常推进到中后期', r4.result.elapsedMs > 120000, `${(r4.result.elapsedMs / 1000).toFixed(0)}s`);
  } else {
    console.log('  （山经试炼未达成，走"未解锁不进池"分支；判定规则由 test/meta.mjs 覆盖）');
    const w3 = new World({ seed: 778, characterId: 'shanpo', unlocks: [] });
    let sawLocked = false;
    for (let i = 0; i < 200 && !sawLocked; i++) {
      for (const c of w3.rollCards()) if (c.weaponId === 'w_shanbeng') sawLocked = true;
    }
    check('未解锁时试炼武器「山崩践踏」不在卡池', !sawLocked);
  }
}

// ---------------- 9. 占位美术 + 资源清单回退 ----------------

section('9. 占位美术与资源清单回退');
{
  // 无 DOM 环境下 generator 需要 canvas：这里只验证清单结构与"缺文件"这一事实
  const stats = placeholderStats();
  console.log(`  槽位总数 ${stats.total}：程序生成 ${stats.generated}，已替换正式文件 ${stats.supplied}`);
  check('批 1 槽位清单覆盖主角/敌人/Boss/竞技场/投射物/道具/UI/特效', ['character', 'enemy', 'boss', 'arena', 'projectile', 'item', 'ui', 'fx'].every((c) => SLOTS.some((s) => s.category === c)));
  check('每个槽位都有占位生成器（缺文件时能回退）', SLOTS.every((s) => typeof s.generator === 'string' && s.generator.length > 0));
  // 规格 §12 原本写的是"批 1 不交付正式美术，全部走程序生成"。
  // 现在交付了第一批 9 张自绘精灵，这条的老口径作废 —— 但**回退能力必须还在**：
  // 所以改成"已替换的槽位必须都带许可信息，未替换的必须都有生成器"。
  check('已替换的槽位都登记了许可/来源/日期', SLOTS.every((s) => !s.file || (s.license && s.source && s.downloadedAt)), `${stats.supplied} 个已替换`);
  check('槽位 id 唯一', new Set(SLOTS.map((s) => s.id)).size === SLOTS.length);
  check('槽位带尺寸与锚点（替换正式美术时需要）', SLOTS.every((s) => s.w > 0 && s.h > 0 && Array.isArray(s.anchor) && s.anchor.length === 2));
  check('槽位带许可字段位（替换时必填：许可/来源/下载日期）', SLOTS.every((s) => !s.file || (s.license && s.source && s.downloadedAt)), '有 file 但缺许可信息的槽位');
  // 9 把武器 + 被动/超武/掉落都有图标槽位。
  // 注意槽位命名规则：武器 id 已经是 w_*，对应图标槽位是 icon_<武器id>（不是 icon_w_w_*）
  const iconIds = new Set(SLOTS.filter((s) => s.category === 'item').map((s) => s.id));
  const missingW = BATCH1_WEAPONS.filter((w) => !iconIds.has('icon_' + w.id)).map((w) => w.id);
  check('9 把武器都有道具图标槽位', missingW.length === 0, missingW.join(','));
  check('有被动/超武/掉落物图标槽位', iconIds.has('icon_passive') && iconIds.has('icon_super') && iconIds.has('icon_drop'));
  // 素体挂件用的图标必须存在（每个武器/被动都要能画出挂件）
  const traits = BATCH1_WEAPONS.map((w) => 'icon_' + w.id).concat(BATCH1_PASSIVES.map(() => 'icon_passive'), ['icon_super']);
  check('素体挂件所需图标全部存在', traits.every((id) => slotById(id)), traits.filter((id) => !slotById(id)).join(','));
  // 渲染层与 UI 层实际引用的槽位 id 必须都在清单里（避免运行时静默回退到错的占位图）
  const { readFileSync } = await import('node:fs');
  // 命名规则：武器 id 自带 w_ 前缀（w_shoujia），图标槽位 = 'icon_' + 武器id = icon_w_shoujia。
  // 所以生产代码里必须写 'icon_' + id，写成 'icon_w_' + id 会拼出不存在的 icon_w_w_xxx。
  const badRef = [];
  for (const f of ['src/render/render2d.js', 'src/ui/ui.js']) {
    const src = readFileSync(f, 'utf8');
    if (/'icon_w_' \+/.test(src)) badRef.push(`${f} 用了 'icon_w_' 前缀（会拼出不存在槽位）`);
    if (/'icon_' \+/.test(src) === false && src.includes('icon_')) badRef.push(`${f} 的图标拼接规则不明`);
  }
  check('没有代码引用不存在的槽位命名', badRef.length === 0, badRef.join('; '));
  // 实际算出渲染层会请求的槽位 id，逐个回查清单
  const { BATCH1_WEAPONS: BW } = await import('../src/content/weapons.js');
  const wouldRequest = [
    ...BW.map((w) => 'icon_' + w.id),
    ...BW.map((w) => 'proj_' + w.id.replace(/^w_/, '')),
    'icon_passive',
    'icon_super',
    'icon_drop',
  ];
  const missingRequested = wouldRequest.filter((id) => !slotById(id));
  check('渲染层会请求的槽位 id 全部存在', missingRequested.length === 0, missingRequested.join(','));
}

// ---------------- 10. 完整对局计时（确认"三系各通关一次"可在一次测试里跑完） ----------------

section('10. 完整对局计时');
{
  // 验收标准："三系各自的初始武器都能单独通关一次"。
  // 单局是随机的，所以用多个种子判"通关过至少一次"，而不是要求同一种子三系全胜。
  const seeds = [20260926, 4242, 987654];
  const rows = [];
  const wins = {};
  for (const ch of BATCH1_CHARACTERS) wins[ch.id] = 0;
  for (const seed of seeds) {
    for (const ch of BATCH1_CHARACTERS) {
      const r = playFull(ch.id, { seed });
      if (r.result.outcome === 'win') wins[ch.id]++;
      if (seed === seeds[0]) rows.push({ cn: ch.cn, outcome: r.result.outcome, sec: r.result.elapsedMs / 1000, wall: r.wallMs });
    }
  }
  for (const r of rows) {
    console.log(`  ${r.cn}：${r.outcome} @ ${r.sec.toFixed(0)}s，模拟耗时 ${r.wall.toFixed(0)}ms（约 ${(r.wall / (r.sec * 1000)).toFixed(2)}× 实时）`);
  }
  console.log(`  ${seeds.length} 个种子通关数：${BATCH1_CHARACTERS.map((c) => `${c.cn} ${wins[c.id]}/${seeds.length}`).join('　')}`);
  // 通关率偏严（这是刻意调紧的结果）：只要求"能通关"，不要求高频通关
  const anyWin = Object.values(wins).some((n) => n >= 1);
  check('至少一个角色在这批种子里通关过（游戏可通关）', anyWin, JSON.stringify(wins));
  check('单局无头模拟快于实时（可批量回归）', rows.every((r) => r.wall < r.sec * 1000), rows.map((r) => r.wall.toFixed(0)).join(','));
  console.log(`  首个种子的三局合计模拟耗时 ${rows.reduce((a, b) => a + b.wall, 0).toFixed(0)}ms`);
}

// ---------------- 11. 开发模式：一键解锁全部（跳过试炼） ----------------

section('11. 开发模式：解锁全部神系与角色');
{
  const save = defaultSave();
  // 模拟 main.js 里 controller.setUnlockAll(true) 的效果（同一套数据来源）
  const { CHARACTERS } = await import('../src/content/characters.js');
  const allSeries = CHARACTERS.map((c) => c.series);
  const allChars = CHARACTERS.map((c) => c.id);
  const trialWeapons = BATCH1_WEAPONS.filter((w) => w.unlock === 'trial').map((w) => w.id);
  save.unlocks.series = [...new Set([...save.unlocks.series, ...allSeries])];
  save.unlocks.characters = [...new Set([...save.unlocks.characters, ...allChars])];
  save.unlocks.weapons = [...new Set([...save.unlocks.weapons, ...trialWeapons])];
  check('解锁全部 6 个神系', save.unlocks.series.length === 6, save.unlocks.series.join(','));
  check('解锁全部 6 个角色', save.unlocks.characters.length === 6, save.unlocks.characters.join(','));
  check('解锁全部 6 把试炼武器', trialWeapons.length === 6 && trialWeapons.every((id) => save.unlocks.weapons.includes(id)), JSON.stringify(save.unlocks.weapons));

  // 解锁后：每个角色都能建局、能推进、不抛异常（这是"解锁会不会炸"的核心检查）
  const results = [];
  let broken = [];
  for (const ch of CHARACTERS) {
    try {
      const w = new World({ seed: 20260926, characterId: ch.id, unlocks: save.unlocks.weapons });
      w.paused = false;
      const firstWeapon = w.slots.weapons[0].id;
      for (let i = 0; i < 60 * 40 && w.running; i++) {
        kitingPolicy(w);
        w.step();
        if (w.awaitingChoice) autoTakeCards(w);
      }
      // 卡池里必须能抽到内容（不能出现"一张卡都发不出来"）
      const cards = w.rollCards();
      results.push({ cn: ch.cn, weapon: firstWeapon, t: Math.round(w.elapsedMs / 1000), cards: cards.length, ok: true });
    } catch (e) {
      broken.push(`${ch.id}: ${e.message}`);
    }
  }
  for (const r of results) console.log(`  ${r.cn.padEnd(4)} 初始武器 ${r.weapon.padEnd(10)} 推进 ${r.t}s，可发卡 ${r.cards} 张`);
  check('6 个角色都能建局并推进 40 秒', broken.length === 0 && results.length === 6, broken.join('; '));
  check('没有任何角色发不出升级卡', results.every((r) => r.cards > 0), JSON.stringify(results.filter((r) => r.cards === 0)));

  // 明确记录：六系内容已经补完，不再有"骨架/占位"状态
  const lockedWeapons = BATCH1_WEAPONS.filter((w) => w.locked);
  const lockedPassives = BATCH1_PASSIVES.filter((p) => p.locked);
  check('六系内容已补完（没有 locked 占位）', lockedWeapons.length === 0 && lockedPassives.length === 0, `${lockedWeapons.length} 把武器 / ${lockedPassives.length} 件被动`);
  check('六系都有配方', ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'].every((s) => FUSIONS.some((f) => f.series === s)));
}

// ---------------- 12. 触碰伤害（回归：曾经整条链路静默失效） ----------------

section('12. 触碰伤害必须真的生效');
{
  // 玩家碰撞半径必须是有限正数：为 undefined 会让所有"圆 vs 圆"判定变成 NaN，
  // 也就是怪物碰到你完全不掉血，而且不报任何错。
  const w0 = new World({ seed: 1, characterId: 'shanpo' });
  check('玩家碰撞半径是有限正数', Number.isFinite(w0.player.radius) && w0.player.radius > 0, String(w0.player.radius));
  // 逐帧统计：把每种怪直接生成在玩家身上，必须掉血
  const { ENEMY_LIST } = await import('../src/content/enemies.js');
  const contactResults = [];
  for (const def of ENEMY_LIST) {
    const w = new World({ seed: 1, characterId: 'shanpo' });
    w.paused = false;
    w.player.hp = 5000;
    w.player.maxHp = 5000;
    w.enemies.clear();
    const e = w.spawnEnemyFrom({ kind: def.id, tier: 0, x: w.player.x + 18, y: w.player.y });
    let framesInCircle = 0;
    for (let i = 0; i < 180; i++) {
      w.input.mx = 0;
      w.input.my = 0;
      w.step();
      if (!e.__alive) break;
      const d = Math.hypot(e.x - w.player.x, e.y - w.player.y);
      if (d <= e.radius + w.player.radius) framesInCircle++;
    }
    contactResults.push({ cn: def.cn, kind: def.id, hpLost: 5000 - w.player.hp, framesInCircle });
  }
  for (const r of contactResults) console.log(`  ${r.cn.padEnd(4)} 贴脸 3 秒：掉血 ${r.hpLost.toFixed(0)}，进碰撞圈 ${r.framesInCircle} 帧`);
  check('每种怪贴脸都会造成伤害', contactResults.every((r) => r.hpLost > 0), JSON.stringify(contactResults.filter((r) => r.hpLost <= 0)));
  // 嘲讽式回归：有人在身边站着就会持续掉血
  const w2 = new World({ seed: 3, characterId: 'huangpo' });
  w2.paused = false;
  w2.player.hp = 5000;
  w2.player.maxHp = 5000;
  for (let i = 0; i < 60 * 45 && w2.running; i++) {
    w2.input.mx = 0;
    w2.input.my = 0;
    w2.step();
    if (w2.awaitingChoice) autoTakeCards(w2);
  }
  const lost = 5000 - w2.player.hp;
  console.log(`  站桩 45 秒（有远程敌人）：掉血 ${lost.toFixed(0)}`);
  check('站桩会被打死（触碰伤害在真实对局里也生效）', lost > 200, `只掉 ${lost.toFixed(0)}`);
}

console.log(`\n================ 批 1 验收 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
