// 5 种普通敌人（批 1）+ Boss 相柳（九首，三阶段）+ 精英词缀。
// 精英 = 普通敌人换色放大 + 一个词缀，不产出新美术（规格 §4）。

export const ENEMIES = {
  shanxiao: {
    id: 'shanxiao',
    cn: '山魈',
    ai: 'chase',
    hp: 32,
    speed: 112,
    radius: 13,
    // 接触伤害的基础值刻意压低：它是最持续的威胁来源（每 0.5 秒可触发一次），
    // 不像子弹/爆炸那样是偶发伤害。
    // 接触伤害要低：同屏几十只怪时，每 0.5 秒可触发一次，单只给太高会直接围死玩家
    touchDamage: 4,
    xp: 2,
    shape: 'ape',
    from: 0,
    weight: 34,
    blurb: '近战快速，成群扑上来。',
  },
  bifang: {
    id: 'bifang',
    cn: '毕方',
    ai: 'ranged',
    hp: 26,
    speed: 88,
    radius: 14,
    touchDamage: 4,
    xp: 2,
    shape: 'bird',
    from: 300, // 第 5 分钟起出现远程敌人
    weight: 22,
    fireEvery: 2.4,
    projSpeed: 168,
    projDamage: 6,
    blurb: '远程直线弹，逼你绕。',
    xp: 3,
  },
  huashe: {
    id: 'huashe',
    cn: '化蛇',
    ai: 'weave',
    hp: 18,
    speed: 126,
    radius: 12,
    touchDamage: 3,
    shape: 'snake',
    from: 60,
    weight: 26,
    blurb: '蛇形穿插，走位没有直线。',
    xp: 2,
  },
  xinang: {
    id: 'xinang',
    cn: '傒囊',
    ai: 'suicide',
    hp: 14,
    speed: 172,
    radius: 12,
    touchDamage: 3,
    shape: 'blob',
    from: 120,
    weight: 16,
    boomRadius: 62,
    boomDamage: 16,
    blurb: '自爆，靠太近很痛。',
    // 血量很低（一碰就死），但自爆伤害有威胁，所以经验略高于同血的杂兵
    xp: 2,
  },
  qiangliang: {
    id: 'qiangliang',
    cn: '强良',
    ai: 'charger',
    hp: 42,
    speed: 104,
    radius: 17,
    touchDamage: 6,
    shape: 'brute',
    from: 180,
    weight: 14,
    chargeEvery: 3.2,
    chargeSpeed: 430,
    knockback: 260,
    blurb: '冲锋并击退你。',
    xp: 5,
  },
};

export const ENEMY_LIST = Object.values(ENEMIES);

export const AFFIXES = [
  { id: 'swift', cn: '迅捷', speedMul: 1.5, hpMul: 0.9, scale: 1.05, color: '#7fe0ff' },
  { id: 'tough', cn: '坚韧', speedMul: 0.85, hpMul: 2.6, scale: 1.2, color: '#c9c9c9' },
  { id: 'summoner', cn: '召唤', speedMul: 1, hpMul: 1.4, scale: 1.15, color: '#c39bf0', summonEvery: 2.6 },
  { id: 'rage', cn: '狂暴', speedMul: 1.15, hpMul: 1.3, scale: 1.12, color: '#ff8a6a', enrageMul: 1.35 },
];

export const AFFIX_BY_ID = {};
for (const a of AFFIXES) AFFIX_BY_ID[a.id] = a;

// Boss：相柳（九首）。三阶段；头部逐个被击破后弹幕形态改变（规格 §4）。
export const BOSS = {
  id: 'xiangliu',
  cn: '相柳',
  // Boss 血量按"玩家满构筑 DPS"重新标定：之前的 5200 会被秒熔；
  // 38000 又太厚（近战系打不完）。26000 是实测下最接近"能打完但要打满"的值。
  hp: 26000,
  speed: 46,
  radius: 58,
  touchDamage: 22,
  xp: 0,
  phases: [
    { at: 1.0, heads: 9, name: '九首齐鸣', fireEvery: 1.25, bullets: 9, spread: Math.PI * 2, bulletSpeed: 150, bulletDamage: 10, chargeEvery: 6 },
    { at: 0.62, heads: 6, name: '六首垂涎', fireEvery: 1.0, bullets: 12, spread: Math.PI * 2, bulletSpeed: 175, bulletDamage: 11, chargeEvery: 5 },
    { at: 0.3, heads: 3, name: '三首狂噬', fireEvery: 0.8, bullets: 16, spread: Math.PI * 2, bulletSpeed: 205, bulletDamage: 12, chargeEvery: 4 },
  ],
};

/** 难度档：每 2 分钟一档阶梯式跃升（不是连续爬坡）。tier 0 是开局第一档。 */
export function tierOf(elapsedMs, tierPeriodMs) {
  return Math.floor(elapsedMs / tierPeriodMs);
}

/**
 * 无尽周数带来的额外难度档（批 1 无尽模式的唯一难度来源）。
 * 每通关一次相柳算一周，下一周整体再抬一档；不设上限，交由玩家自行决定在哪一周倒下。
 */
export function tierBonusOf(cycle) {
  return Math.max(0, Math.floor(cycle || 0));
}

/**
 * 阶梯化敌人数值。
 * 两个方向的取舍（实测得出）：
 *   · 生命成长必须够陡（1.42），否则每只怪只活 1 秒、场上永远是空的
 *   · 但**基础接触伤害要低**：怪一多，接触伤害会被高频触发，单只伤害高会直接围死玩家
 * 所以是"多而软"，不是"少而硬"。
 */
export function enemyStatsFor(kind, tier, opts = {}) {
  const def = ENEMIES[kind] || ENEMIES.shanxiao;
  const hpMul = Math.pow(1.42, tier);
  const speedMul = 1 + 0.055 * tier;
  // 触碰伤害成长：怪一多，接触伤害会被高频触发，所以成长不能太陡；
  // 但完全不平移又会让成型的角色无视兽潮。4%/档是实测的折中。
  const dmgMul = 1 + 0.04 * tier;
  const elite = !!opts.elite;
  const affix = opts.affix ? AFFIX_BY_ID[opts.affix] : null;
  const weak = opts.weak ? 0.6 : 1;
  let hp = def.hp * hpMul * weak;
  let speed = def.speed * speedMul;
  let touch = def.touchDamage * dmgMul * weak;
  let radius = def.radius;
  let scale = 1;
  let summonEvery = 0;
  let enrageMul = 1;
  if (elite) {
    hp *= 6;
    touch *= 1.15;
    radius *= 1.38;
    scale = 1.38;
  }
  if (affix) {
    hp *= affix.hpMul;
    speed *= affix.speedMul;
    scale *= affix.scale;
    summonEvery = affix.summonEvery || 0;
    enrageMul = affix.enrageMul || 1;
  }
  return {
    hp,
    maxHp: hp,
    speed,
    touchDamage: touch,
    radius,
    // 经验必须与"这只怪有多难打"成正比：经验同时吃"种类基准值"和"难度档"。
    // 不随档成长会导致后期打强的怪和弱的怪收益一样，等级曲线整段失准。
    xp: Math.max(1, Math.round(def.xp * (elite ? 6 : 1) * Math.pow(1.22, tier))),
    scale,
    summonEvery,
    enrageMul,
    ai: def.ai,
    shape: def.shape,
    color: affix ? affix.color : null,
  };
}
