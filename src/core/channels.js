// 24 条修饰器通道 —— 本作的核心契约（规格 §2）。
// 道具只修改这些通道；通道之外的任何行为都必须由钩子（hooks.js）表达。
//
// 叠加规则（op = 如何把多来源叠加成最终值）：
//   add      最终值 = Σ加成          （加法）
//   addBase  最终值 = 基础值 × (1+Σ加成)  （"加法（乘基础值）"）
//   mul      最终值 = Π(1+加成)      （乘法）
//   count    整数计数，Σ，默认 0
//   cap      最终值 = min(Σ, hardCap)（加法但有硬上限）

import { PLAYER_BASE } from '../config.js';

export const OPS = {
  ADD: 'add',
  ADD_BASE: 'addBase',
  MUL: 'mul',
  COUNT: 'count',
  CAP: 'cap',
};

// hardCap 只对 cap/比率类通道生效；上限必须严格小于给定值（规格 §2 硬规则）
export const CHANNELS = [
  { id: 'maxHp', cn: '最大生命', series: '山经', op: OPS.ADD, base: PLAYER_BASE.maxHp, min: 1 },
  { id: 'dr', cn: '减伤', series: '山经', op: OPS.CAP, base: 0, hardCap: 0.79 },
  { id: 'speed', cn: '移速', series: '山经', op: OPS.ADD_BASE, base: PLAYER_BASE.speed, min: 40 },
  { id: 'knockback', cn: '击退', series: '山经', op: OPS.ADD, base: 0 },
  { id: 'projCount', cn: '弹道数', series: '海经', op: OPS.ADD, base: 0, min: 0 },
  { id: 'projSpeed', cn: '弹速', series: '海经', op: OPS.MUL, base: 1, min: 0.2 },
  { id: 'pierce', cn: '穿透', series: '海经', op: OPS.ADD, base: 0, min: 0 },
  { id: 'pickup', cn: '拾取半径', series: '海经', op: OPS.ADD, base: PLAYER_BASE.pickup, min: 0 },
  { id: 'area', cn: '范围', series: '大荒经', op: OPS.MUL, base: 1, min: 0.2 },
  { id: 'dot', cn: '持续伤害', series: '大荒经', op: OPS.ADD, base: 0 },
  { id: 'homing', cn: '追踪强度', series: '大荒经', op: OPS.ADD, base: 0 },
  { id: 'damage', cn: '伤害', series: '大荒经', op: OPS.ADD, base: 0 },
  { id: 'critChance', cn: '暴击率', series: '天问', op: OPS.CAP, base: 0.05, hardCap: 0.99 },
  { id: 'critMult', cn: '暴击倍率', series: '天问', op: OPS.MUL, base: 2, min: 1 },
  { id: 'fireRate', cn: '射速', series: '天问', op: OPS.MUL, base: 1, min: 0.1 },
  { id: 'split', cn: '命中分裂', series: '天问', op: OPS.ADD, base: 0, min: 0 },
  { id: 'lifesteal', cn: '吸血', series: '灵山', op: OPS.ADD, base: 0, hardCap: 0.5 },
  { id: 'curse', cn: '诅咒', series: '灵山', op: OPS.ADD, base: 0, min: 0 },
  // 技艺冷却：闪避 + 主动技**共用**（规格 §5，id 不变以免存档与内容表迁移）。
  // 值是"秒"的增量（灵山雾 = −0.35 秒），消费方有两处：
  //   · 闪避：stats.dashCd = max(dashCdMin, PLAYER_BASE.dashCd + 增量)  ← 绝对秒数
  //   · 主动技：有效CD = max(SKILL_CD_MIN, 基础CD − 增量)               ← 绝对秒数
  // 两者都是"减秒"，所以同一条通道能同时吃下两种消费方；min: -0.6 是通道自身的夹取。
  { id: 'dashCd', cn: '技艺冷却', series: '灵山', op: OPS.ADD, base: 0, min: -0.6 },
  { id: 'summonPower', cn: '召唤强度', series: '灵山', op: OPS.MUL, base: 1, min: 0.1 },
  { id: 'regen', cn: '回血', series: '昆仑', op: OPS.ADD, base: 0 },
  { id: 'shield', cn: '护盾', series: '昆仑', op: OPS.ADD, base: 0, min: 0 },
  { id: 'revive', cn: '复活', series: '昆仑', op: OPS.COUNT, base: 0, min: 0 },
  { id: 'killHeal', cn: '击杀回血', series: '昆仑', op: OPS.ADD, base: 0 },
];

export const CHANNEL_BY_ID = {};
for (const c of CHANNELS) CHANNEL_BY_ID[c.id] = c;

export const CHANNEL_IDS = CHANNELS.map((c) => c.id);

export function channelCn(id) {
  const c = CHANNEL_BY_ID[id];
  return c ? c.cn : id;
}

// 每个通道的"每点强度"默认含义，供内容表（passives.js）引用，
// 值本身是数据，不是逻辑。
export function baseOf(id) {
  const c = CHANNEL_BY_ID[id];
  return c ? c.base : 0;
}

/**
 * 通道求值：把一组加成（{channelId: number} 累加后的原始和）折叠成最终值。
 * @param {Record<string, number>} sums 例如 { damage: 0.3, fireRate: 0.25, projCount: 1 }
 * @returns {Record<string, number>} 最终值
 */
export function evalChannels(sums) {
  const out = {};
  for (const c of CHANNELS) {
    const s = sums[c.id] || 0;
    let v;
    switch (c.op) {
      case OPS.MUL:
        v = c.base * (1 + s);
        break;
      case OPS.ADD_BASE:
        v = c.base * (1 + s);
        break;
      case OPS.CAP:
        v = Math.min(c.base + s, c.hardCap);
        break;
      case OPS.COUNT:
        v = Math.max(0, Math.round(c.base + s));
        break;
      case OPS.ADD:
      default:
        v = c.base + s;
        break;
    }
    if (c.min !== undefined && v < c.min) v = c.min;
    out[c.id] = v;
  }
  return out;
}

/** 单条通道的展示字符串，用于卡片与图鉴 */
export function formatChannelBonus(id, value) {
  const c = CHANNEL_BY_ID[id];
  if (!c) return `${id} +${value}`;
  const pct = c.op === OPS.MUL || c.op === OPS.ADD_BASE || c.op === OPS.CAP;
  if (pct) return `${c.cn} ${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
  return `${c.cn} ${value >= 0 ? '+' : ''}${Number.isInteger(value) ? value : value.toFixed(1)}`;
}
