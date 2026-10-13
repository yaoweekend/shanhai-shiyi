// 局外进度闭环测试（规格 Testing 6/7：试炼、解锁、存档版本迁移）。
//
// 方法：试炼/解锁/迁移的逻辑用**确定性合成结算**验证（不受肉鸽随机性干扰），
// 另加一条**真实对局**的集成验证（整局模拟 → 结算 → 试炼达成）。
//
// 用法：node test/meta.mjs
import { World } from '../src/sim/world.js';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save.js';
import { recordRun, trialProgress, unlockedWeaponIds, unlockedSeriesIds, contentSelfCheck, TRIALS } from '../src/meta/meta.js';
import { kitingPolicy } from './kite.mjs';
import { autoTakeCards } from './policy.mjs';
import { TICK_MS } from '../src/config.js';

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

/** 合成一局结算（确定性：用于验证判定规则本身） */
function synth(kills, { won = false, series = null, seriesOnly = null, char = 'shanpo', timeMs = 300000, seen = [] } = {}) {
  return {
    outcome: won ? 'win' : 'dead',
    kills,
    elapsedMs: timeMs,
    level: 10,
    characterId: char,
    series,
    superCount: 0,
    maxTier: 2,
    trialsThisRun: { won, seriesOnly: seriesOnly || { shan: false, hai: false, huang: false } },
    seen,
  };
}

section('1. 未达成不解锁');
{
  const save = defaultSave();
  check('初始只解锁开局三系', unlockedSeriesIds(save).join(',') === 'shan,hai,huang', unlockedSeriesIds(save).join(','));
  check('初始没有试炼解锁武器', unlockedWeaponIds(save).length === 0);
  const a = recordRun(save, { ...synth(120), trialsThisRun: { won: true, seriesOnly: { shan: true, hai: true, huang: true } } });
  // 1100 击杀以内的失败局不应达成除"累计击杀"以外的任何试炼
  check('失败一局不触发通关类试炼', !save.trials.shan.done && !save.trials.tian.done && !save.trials.kun.done, JSON.stringify(save.trials));
  check('失败一局也累计击杀', save.counters.killsTotal === 120);
  check('失败一局不增加通关次数', save.counters.winsTotal === 0);
  check('累计击杀未到 3000 不解锁灵山', save.trials.ling.done === false);
}

section('2. 六条试炼的判定规则');
{
  // 山经：只用山经武器通关
  {
    const save = defaultSave();
    recordRun(save, synth(100, { won: true, series: 'shan', seriesOnly: { shan: true } }));
    check('山经试炼：纯山经通关 → 达成', save.trials.shan.done === true);
    check('山经试炼：解锁利爪横扫', unlockedWeaponIds(save).includes('w_lizhao'));
  }
  {
    const save = defaultSave();
    recordRun(save, synth(100, { won: true, series: 'shan', seriesOnly: { shan: false } }));
    check('山经试炼：混系通关 → 不达成', save.trials.shan.done === false);
  }
  {
    const save = defaultSave();
    recordRun(save, synth(100, { won: false, series: 'shan', seriesOnly: { shan: true } }));
    check('山经试炼：纯山经但没通关 → 不达成', save.trials.shan.done === false);
  }
  // 天问：任意角色首次通关
  {
    const save = defaultSave();
    recordRun(save, synth(100, { won: true, series: 'hai' }));
    check('天问试炼：任意角色首次通关 → 达成', save.trials.tian.done === true);
    check('天问试炼：解锁天问系 + 天魄', unlockedSeriesIds(save).includes('tian') && save.unlocks.characters.includes('tianpo'));
  }
  // 灵山：累计击杀 3000（跨局）
  {
    const save = defaultSave();
    recordRun(save, synth(2999));
    check('灵山试炼：2999 击杀尚未达成', save.trials.ling.done === false, String(save.counters.killsTotal));
    recordRun(save, synth(1));
    check('灵山试炼：跨局累计到 3000 → 达成', save.trials.ling.done === true, String(save.counters.killsTotal));
    check('灵山试炼：解锁灵山系 + 巫魄', unlockedSeriesIds(save).includes('ling') && save.unlocks.characters.includes('wupo'));
  }
  // 昆仑：开局三系各通关一次
  {
    const save = defaultSave();
    recordRun(save, synth(50, { won: true, series: 'shan' }));
    recordRun(save, synth(50, { won: true, series: 'hai' }));
    check('昆仑试炼：只有两系通关时不达成', save.trials.kun.done === false);
    recordRun(save, synth(50, { won: true, series: 'huang' }));
    check('昆仑试炼：三系各通关一次 → 达成', save.trials.kun.done === true);
    check('昆仑试炼：解锁昆仑系 + 不死魄', unlockedSeriesIds(save).includes('kun') && save.unlocks.characters.includes('busipo'));
  }
  // 海经 / 大荒
  {
    const save = defaultSave();
    recordRun(save, synth(50, { won: true, series: 'hai', seriesOnly: { hai: true } }));
    check('海经试炼：解锁鲸息贯穿', unlockedWeaponIds(save).includes('w_jingxi'));
    recordRun(save, synth(50, { won: true, series: 'huang', seriesOnly: { huang: true } }));
    check('大荒试炼：解锁召引荒兽', unlockedWeaponIds(save).includes('w_zhaoyin'));
  }
}

section('3. 重复达成不重复发奖 / 解锁不给数值加成');
{
  const save = defaultSave();
  recordRun(save, synth(50, { won: true, series: 'shan', seriesOnly: { shan: true } }));
  const before = unlockedWeaponIds(save).slice().sort().join(',');
  const again = recordRun(save, synth(50, { won: true, series: 'shan', seriesOnly: { shan: true } }));
  check('第二次达成不再发奖', unlockedWeaponIds(save).slice().sort().join(',') === before, before);
  check('第二次达成不产生新的试炼解锁', again.newTrials.length === 0);
  check('解锁表里只有内容 id，没有数值字段', save.unlocks.weapons.every((w) => typeof w === 'string'));
  const keys = Object.keys(save.unlocks);
  check('解锁表不含任何成长/货币字段', !keys.some((k) => /coin|gold|level|stat|upgrade|power/i.test(k)), keys.join(','));
}

section('4. 最高分记录');
{
  const save = defaultSave();
  const r1 = recordRun(save, synth(500, { won: false, timeMs: 200000 }));
  check('首局刷新最高分', r1.highScoreBeaten === true);
  check('最高分写入击杀', save.highScore.kills === 500, JSON.stringify(save.highScore));
  const r2 = recordRun(save, synth(100, { won: false, timeMs: 300000 }));
  check('低分局不刷新最高分', r2.highScoreBeaten === false);
  const r3 = recordRun(save, synth(5000, { won: true, timeMs: 610000 }));
  check('高分局刷新最高分并标记通关', r3.highScoreBeaten === true && save.highScore.won === true);
}

section('5. 存档版本迁移（丢弃未完成的一局，保留解锁）');
{
  const save = defaultSave();
  recordRun(save, synth(50, { won: true, series: 'shan', seriesOnly: { shan: true } }));
  save.unfinishedRun = { v: SAVE_VERSION, seed: 1, characterId: 'shanpo', tick: 100 };
  const raw = JSON.parse(JSON.stringify(save));
  raw.v = SAVE_VERSION - 1;
  const migrated = migrate(raw);
  check('迁移后版本号更新', migrated.v === SAVE_VERSION);
  check('迁移丢弃未完成的一局', migrated.unfinishedRun === null);
  check('迁移保留解锁进度（武器）', migrated.unlocks.weapons.includes('w_lizhao'));
  check('迁移保留解锁进度（系）', migrated.unlocks.series.includes('tian'));
  check('迁移保留试炼进度', migrated.trials.shan.done === true);
  check('迁移保留累计击杀', migrated.counters.killsTotal === save.counters.killsTotal);
  check('迁移记录来源版本', migrated.migratedFrom === SAVE_VERSION - 1);
  const same = JSON.parse(JSON.stringify(save));
  same.v = SAVE_VERSION;
  check('同版本时保留未完成的一局（断点续局）', migrate(same).unfinishedRun !== null);
  check('空/非法存档回退到默认值', migrate(null).v === SAVE_VERSION && migrate(undefined).unlocks.series.length === 3);
  check('缺字段的老存档补齐默认值', (() => {
    const m = migrate({ v: 1, trials: { shan: { done: true } } });
    return m.trials.shan.done === true && m.trials.hai.done === false && Array.isArray(m.unlocks.weapons) && m.settings.volume > 0;
  })());
}

section('6. 试炼面板进度');
{
  const save = defaultSave();
  save.counters.killsTotal = 1500;
  save.counters.winsBySeries.shan = 1;
  const ling = TRIALS.find((t) => t.id === 'ling');
  const kun = TRIALS.find((t) => t.id === 'kun');
  const shan = TRIALS.find((t) => t.id === 'shan');
  const p1 = trialProgress(save, ling);
  const p2 = trialProgress(save, kun);
  const p3 = trialProgress(save, shan);
  check('累计击杀试炼进度 = 1500/3000', p1.cur === 1500 && p1.goal === 3000, JSON.stringify(p1));
  check('三系通关试炼进度 = 1/3', p2.cur === 1 && p2.goal === 3, JSON.stringify(p2));
  check('山经试炼进度 = 1/1', p3.cur === 1 && p3.goal === 1, JSON.stringify(p3));
  let legal = true;
  for (const t of TRIALS) {
    const p = trialProgress(save, t);
    if (!(p.goal > 0 && p.cur >= 0 && p.cur <= p.goal)) legal = false;
  }
  check('6 条试炼进度都合法', legal && TRIALS.length === 6);
}

section('7. 真实对局的集成验证（整局模拟 → 结算 → 试炼）');
{
  const save = defaultSave();
  const world = new World({ seed: 20260926, characterId: 'shanpo', unlocks: [] });
  world.paused = false;
  const maxTicks = Math.round((780 * 1000) / TICK_MS);
  for (let i = 0; i < maxTicks && world.running; i++) {
    if (!world.paused) {
      kitingPolicy(world);
      world.step();
    }
    if (world.awaitingChoice) autoTakeCards(world);
  }
  const result = world.finish();
  result.seen = world.slots.weapons.map((w) => w.id).concat(world.slots.passives);
  const rec = recordRun(save, result);
  console.log(`  真实对局：${result.outcome} @ ${(result.elapsedMs / 1000).toFixed(1)}s，击杀 ${result.kills}，等级 ${result.level}，超武 ${result.superCount}`);
  console.log(`  本局满足的"只用某系武器"：${JSON.stringify(result.trialsThisRun.seriesOnly)}`);
  console.log(`  触发试炼：${rec.newTrials.map((t) => t.name).join('、') || '（无）'}`);
  check('真实对局结算写入了最高分', save.highScore.kills >= result.kills);
  check('真实对局累计了击杀', save.counters.killsTotal === result.kills);
  check('真实对局的图鉴记录了"见过"', Object.keys(save.codex).length > 0, JSON.stringify(save.codex).slice(0, 120));
  check('真实对局清空了未完成的一局', save.unfinishedRun === null);
  if (result.outcome === 'win') {
    check('真实通关触发了天问试炼', save.trials.tian.done === true);
    if (result.trialsThisRun.seriesOnly.shan) check('真实纯山经通关触发了山经试炼', save.trials.shan.done === true);
  } else {
    console.log('  （这一局没通关，因此不验证通关类试炼——单局随机性不影响上面的确定性判定）');
  }
}

section('8. 内容自检');
{
  const problems = contentSelfCheck();
  check('内容表自检无问题（每把武器都有配方等）', problems.length === 0, problems.join('; '));
}

console.log(`\n================ 局外进度自检 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
