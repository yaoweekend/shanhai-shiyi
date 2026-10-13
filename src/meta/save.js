// 局外进度与存档（规格 §8 / §10）。
// 唯一的持久化载体：最高分 / 图鉴 / 试炼进度 / 解锁状态 / 设置 / 未完成的一局。
// 铁律（§8）：解锁只解锁内容，不提供任何数值加成。不做金币、商店、每日任务、数值成长。
//
// 存档带版本号与迁移逻辑：版本不匹配时**丢弃未完成的一局**，但保留解锁进度。

import { SAVE_KEY } from '../config.js';

export const SAVE_VERSION = 2;

function defaultSave() {
  return {
    v: SAVE_VERSION,
    createdAt: null,
    updatedAt: null,
    // 局外进度
    highScore: { kills: 0, timeMs: 0, level: 0, won: false, characterId: null },
    unlocks: {
      weapons: [], // 试炼解锁的武器 id
      series: ['shan', 'hai', 'huang'],
      characters: ['shanpo', 'haipo', 'huangpo'],
    },
    trials: {
      shan: { done: false, best: 0 },
      hai: { done: false, best: 0 },
      huang: { done: false, best: 0 },
      tian: { done: false, best: 0 },
      ling: { done: false, best: 0 },
      kun: { done: false, best: 0 },
    },
    counters: {
      killsTotal: 0,
      winsTotal: 0,
      winsBySeries: { shan: 0, hai: 0, huang: 0 },
    },
    codex: {}, // id -> true（记录"见过"而非"持有"）
    settings: {
      muted: false,
      volume: 0.7,
      quality: 'auto', // auto | high | low
      effects: true,
      shake: true,
      damageNumbers: true,
      devLabels: false,
    },
    unfinishedRun: null,
  };
}

let memFallback = null;

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (e) {
    /* 隐私模式等场景 */
  }
  return null;
}

export function loadSave() {
  const st = storage();
  if (!st) {
    if (!memFallback) memFallback = defaultSave();
    return memFallback;
  }
  let raw = null;
  try {
    raw = st.getItem(SAVE_KEY);
  } catch (e) {
    raw = null;
  }
  if (!raw) return defaultSave();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // 存档损坏：不静默清空，保留原始串到一个备份键
    try {
      st.setItem(SAVE_KEY + '-corrupt', raw);
      st.removeItem(SAVE_KEY);
    } catch (e2) {
      /* 忽略 */
    }
    return defaultSave();
  }
  return migrate(parsed);
}

export function migrate(parsed) {
  const base = defaultSave();
  if (!parsed || typeof parsed !== 'object') return base;
  const v = parsed.v || 0;
  const out = { ...base, ...parsed };
  // 深合并关键子树，避免老存档缺字段
  out.unlocks = { ...base.unlocks, ...(parsed.unlocks || {}) };
  out.trials = { ...base.trials, ...(parsed.trials || {}) };
  out.counters = { ...base.counters, ...(parsed.counters || {}) };
  out.counters.winsBySeries = { ...base.counters.winsBySeries, ...((parsed.counters && parsed.counters.winsBySeries) || {}) };
  out.settings = { ...base.settings, ...(parsed.settings || {}) };
  out.highScore = { ...base.highScore, ...(parsed.highScore || {}) };
  out.codex = parsed.codex && typeof parsed.codex === 'object' ? parsed.codex : {};
  if (v !== SAVE_VERSION) {
    // 版本不匹配：丢弃未完成的一局，保留解锁进度（规格 §10）
    out.unfinishedRun = null;
    out.v = SAVE_VERSION;
    out.migratedFrom = v;
  } else if (parsed.unfinishedRun) {
    out.unfinishedRun = parsed.unfinishedRun;
  }
  if (!out.createdAt) out.createdAt = Date.now();
  return out;
}

export function persist(save) {
  save.updatedAt = Date.now();
  save.v = SAVE_VERSION;
  const st = storage();
  if (!st) {
    memFallback = save;
    return false;
  }
  try {
    st.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSave() {
  const st = storage();
  if (st) {
    try {
      st.removeItem(SAVE_KEY);
    } catch (e) {
      /* 忽略 */
    }
  }
  memFallback = null;
}

/** 导出存档为 JSON 字符串（玩家自证/换机用） */
export function exportSave(save) {
  return JSON.stringify(save, null, 2);
}

export function importSave(text) {
  try {
    return migrate(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

export { defaultSave };
