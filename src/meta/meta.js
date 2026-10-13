// 试炼与解锁（规格 §8）。
// 6 条试炼，全部是"一次性解锁任务"，唯一的局外进度载体。
//
// 试炼定义（condition 类型）：
//   seriesWin    只用某系武器通关一次
//   anyWin       任意角色首次通关
//   killTotal    累计击杀（跨局累计）
//   threeWins    开局三系各通关一次

import { WEAPON_BY_ID, BATCH1_WEAPONS } from '../content/weapons.js';
import { PASSIVE_BY_ID, BATCH1_PASSIVES } from '../content/passives.js';
import { FUSIONS } from '../content/fusions.js';
import { CHARACTERS, BATCH1_CHARACTERS } from '../content/characters.js';
import { SERIES } from '../content/series.js';
import { persist } from './save.js';

export const TRIALS = [
  {
    id: 'shan',
    cn: '山经',
    name: '兽径之试',
    condition: { type: 'seriesWin', series: 'shan' },
    reward: { kind: 'weapon', id: 'w_lizhao' },
    rewardText: '解锁「利爪横扫」',
    hint: '只用山经武器通关一次',
  },
  {
    id: 'hai',
    cn: '海经',
    name: '沧波之试',
    condition: { type: 'seriesWin', series: 'hai' },
    reward: { kind: 'weapon', id: 'w_jingxi' },
    rewardText: '解锁「鲸息贯穿」',
    hint: '只用海经武器通关一次',
  },
  {
    id: 'huang',
    cn: '大荒经',
    name: '荒野之试',
    condition: { type: 'seriesWin', series: 'huang' },
    reward: { kind: 'weapon', id: 'w_zhaoyin' },
    rewardText: '解锁「召引荒兽」',
    hint: '只用大荒经武器通关一次',
  },
  {
    id: 'tian',
    cn: '天问',
    name: '叩天之试',
    condition: { type: 'anyWin' },
    reward: { kind: 'series', id: 'tian', character: 'tianpo' },
    rewardText: '解锁天问系 + 天魄',
    hint: '任意角色首次通关',
  },
  {
    id: 'ling',
    cn: '灵山',
    name: '巫祝之试',
    condition: { type: 'killTotal', value: 3000 },
    reward: { kind: 'series', id: 'ling', character: 'wupo' },
    rewardText: '解锁灵山系 + 巫魄',
    hint: '累计击杀 3000（跨局累计）',
  },
  {
    id: 'kun',
    cn: '昆仑',
    name: '不死之试',
    condition: { type: 'threeWins', series: ['shan', 'hai', 'huang'] },
    reward: { kind: 'series', id: 'kun', character: 'busipo' },
    rewardText: '解锁昆仑系 + 不死魄',
    hint: '开局三系各通关一次',
  },
];

export const TRIAL_BY_ID = {};
for (const t of TRIALS) TRIAL_BY_ID[t.id] = t;

export function trialProgress(save, trial) {
  const c = trial.condition;
  switch (c.type) {
    case 'seriesWin':
      return { cur: save.trials[trial.id].done ? 1 : save.counters.winsBySeries[c.series] > 0 ? 1 : 0, goal: 1 };
    case 'anyWin':
      return { cur: save.trials[trial.id].done ? 1 : Math.min(1, save.counters.winsTotal), goal: 1 };
    case 'killTotal':
      return { cur: Math.min(c.value, save.counters.killsTotal), goal: c.value };
    case 'threeWins': {
      let n = 0;
      for (const s of c.series) if (save.counters.winsBySeries[s] > 0) n++;
      return { cur: n, goal: c.series.length };
    }
    default:
      return { cur: 0, goal: 1 };
  }
}

export function isTrialDone(save, trial) {
  return !!save.trials[trial.id].done;
}

export function evaluateTrials(save, runResult) {
  const newlyDone = [];
  for (const t of TRIALS) {
    if (save.trials[t.id].done) continue;
    if (!checkCondition(t.condition, save, runResult)) continue;
    save.trials[t.id].done = true;
    save.trials[t.id].doneAt = Date.now();
    applyReward(save, t.reward);
    newlyDone.push(t);
  }
  return newlyDone;
}

function checkCondition(c, save, run) {
  switch (c.type) {
    case 'seriesWin':
      return !!run.won && !!run.seriesOnly && run.seriesOnly[c.series] === true;
    case 'anyWin':
      return !!run.won;
    case 'killTotal':
      return save.counters.killsTotal >= c.value;
    case 'threeWins':
      return run.won && c.series.every((s) => save.counters.winsBySeries[s] > 0);
    default:
      return false;
  }
}

function applyReward(save, reward) {
  if (!reward) return;
  if (reward.kind === 'weapon') {
    if (!save.unlocks.weapons.includes(reward.id)) save.unlocks.weapons.push(reward.id);
  } else if (reward.kind === 'series') {
    if (!save.unlocks.series.includes(reward.id)) save.unlocks.series.push(reward.id);
    if (reward.character && !save.unlocks.characters.includes(reward.character)) save.unlocks.characters.push(reward.character);
    // 新系解锁时同时放行它的两把"池"武器（第 4 把仍需该系试炼）
    for (const wid of reward.weapons || []) {
      if (!save.unlocks.weapons.includes(wid)) save.unlocks.weapons.push(wid);
    }
  }
}

/**
 * 一局结算：更新最高分、累计计数、图鉴、试炼。
 * @returns {{newTrials: Array, highScoreBeaten: boolean}}
 */
export function recordRun(save, result) {
  const run = {
    won: result.outcome === 'win',
    seriesOnly: result.trialsThisRun ? result.trialsThisRun.seriesOnly : {},
    characterId: result.characterId,
    series: result.series,
  };
  save.counters.killsTotal += result.kills || 0;
  if (run.won) {
    save.counters.winsTotal += 1;
    if (run.series && save.counters.winsBySeries[run.series] !== undefined) {
      save.counters.winsBySeries[run.series] += 1;
    }
  }
  const beat =
    result.kills > save.highScore.kills ||
    (result.kills === save.highScore.kills && result.elapsedMs > save.highScore.timeMs) ||
    (run.won && !save.highScore.won);
  if (beat) {
    save.highScore = {
      kills: result.kills || 0,
      timeMs: result.elapsedMs || 0,
      level: result.level || 1,
      won: run.won || save.highScore.won,
      characterId: result.characterId,
    };
  }
  // 图鉴记录"见过"
  for (const rec of result.seen || []) save.codex[rec] = true;
  const newTrials = evaluateTrials(save, run);
  save.unfinishedRun = null;
  persist(save);
  return { newTrials, highScoreBeaten: beat };
}

/** 本局解锁后可用的武器 id 列表 */
export function unlockedWeaponIds(save) {
  return (save.unlocks.weapons || []).slice();
}

export function unlockedSeriesIds(save) {
  return (save.unlocks.series || []).slice();
}

export function unlockedCharacterIds(save) {
  return (save.unlocks.characters || []).slice();
}

/** 图鉴数据：按系分卷 */
export function codexBySeries(save) {
  const out = {};
  for (const sid of Object.keys(SERIES)) {
    out[sid] = {
      series: SERIES[sid],
      weapons: BATCH1_WEAPONS.filter((w) => w.series === sid).map((w) => ({ ...w, seen: !!save.codex[w.id] })),
      passives: BATCH1_PASSIVES.filter((p) => p.series === sid).map((p) => ({ ...p, seen: !!save.codex[p.id] })),
      fusions: FUSIONS.filter((f) => f.series === sid).map((f) => ({ ...f, seen: !!save.codex[f.id] })),
    };
  }
  return out;
}

/** 实现者/维护者用的自检：所有内容 id 是否都被图鉴与资源清单覆盖 */
export function contentSelfCheck() {
  const problems = [];
  for (const w of BATCH1_WEAPONS) {
    if (!FUSIONS.some((f) => f.weapon === w.id)) problems.push(`武器 ${w.id} 没有配方`);
  }
  for (const f of FUSIONS) {
    if (!WEAPON_BY_ID[f.weapon]) problems.push(`配方 ${f.id} 指向不存在的武器 ${f.weapon}`);
    if (!PASSIVE_BY_ID[f.passive]) problems.push(`配方 ${f.id} 指向不存在的被动 ${f.passive}`);
  }
  for (const c of CHARACTERS) {
    if (!WEAPON_BY_ID[c.weapon]) problems.push(`角色 ${c.id} 的初始武器不存在：${c.weapon}`);
    if (!PASSIVE_BY_ID[c.passive]) problems.push(`角色 ${c.id} 的初始被动不存在：${c.passive}`);
  }
  for (const t of TRIALS) {
    const ser = SERIES[t.id];
    if (!ser) problems.push(`试炼 ${t.id} 没有对应神系`);
  }
  return problems;
}
