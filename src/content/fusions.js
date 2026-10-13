// 9 条血统配方（规格 §5）：某把武器满级 + 某件指定被动 → 该武器的超武形态，一局内永久。
// 明牌：配方在试炼/图鉴面板中可见（§8 图鉴、US 11）。

export const FUSIONS = [
  // ---- 山经 ----
  { id: 'f1', series: 'shan', weapon: 'w_shoujia', passive: 'dangkangya', cn: '狂兽环', effect: '刃环数量翻倍并附带击退', mods: { countMul: 2, knockback: 140 } },
  { id: 'f2', series: 'shan', weapon: 'w_guhai', passive: 'shanyueji', cn: '骸山回旋', effect: '体积变大、无限穿透', mods: { sizeMul: 1.6, pierce: 99, damage: 0.35 } },
  { id: 'f3', series: 'shan', weapon: 'w_lizhao', passive: 'kuiniu', cn: '逐日爪', effect: '横扫范围随移速放大', mods: { radiusFromSpeed: 0.6, damage: 0.3 } },
  // ---- 海经 ----
  { id: 'f4', series: 'hai', weapon: 'w_linyu', passive: 'jiuweiyi', cn: '万鳞潮', effect: '扇形弹道数翻倍', mods: { countMul: 2, damage: 0.25 } },
  { id: 'f5', series: 'hai', weapon: 'w_jiaozhu', passive: 'kunpengyi', cn: '沧溟珠', effect: '穿透并命中分裂', mods: { pierce: 3, split: 2, damage: 0.2 } },
  { id: 'f6', series: 'hai', weapon: 'w_jingxi', passive: 'shenglouzhu', cn: '归墟息', effect: '光束变宽、持续时间延长', mods: { widthMul: 1.7, durationMul: 1.6, damage: 0.3 } },
  // ---- 大荒经 ----
  { id: 'f7', series: 'huang', weapon: 'w_huanglei', passive: 'zhulongtong', cn: '烛龙睁眼', effect: '落雷范围扩大并连锁', mods: { radiusMul: 1.6, chain: 2, damage: 0.3 } },
  { id: 'f8', series: 'huang', weapon: 'w_zhangqi', passive: 'zhurongjin', cn: '赤地瘴', effect: '区域燃烧并扩散', mods: { radiusMul: 1.4, spread: 1, damage: 0.35, dot: 8 } },
  { id: 'f9', series: 'huang', weapon: 'w_zhaoyin', passive: 'bashetun', cn: '相柳', effect: '召唤物变为多头形态', mods: { heads: 3, damage: 0.4, hpMul: 1.5 } },
  // ---- 天问 · 神祇 ----
  { id: 'f10', series: 'tian', weapon: 'w_rijian', passive: 'houyigong', cn: '扶桑箭', effect: '暴击时溅射成一片日火', mods: { splash: 90, critBonus: 0.15, damage: 0.25 } },
  { id: 'f11', series: 'tian', weapon: 'w_jiguang', passive: 'jingweiwei', cn: '星陨', effect: '碎片命中后再次分裂', mods: { split: 3, countMul: 2, damage: 0.2 } },
  { id: 'f12', series: 'tian', weapon: 'w_riyue', passive: 'nvwashi', cn: '烛照', effect: '领域随暴击扩大并附带灼烧', mods: { radiusMul: 1.5, dot: 12, damage: 0.3 } },
  // ---- 灵山 · 巫祝 ----
  { id: 'f13', series: 'ling', weapon: 'w_wugu', passive: 'wuxianfu', cn: '万蛊噬心', effect: '标记扩散到周围敌人', mods: { markSpread: 1, curseBonus: 0.15, damage: 0.25 } },
  { id: 'f14', series: 'ling', weapon: 'w_shigu', passive: 'gumumin', cn: '蛊母', effect: '啃噬伤害转为你的生命', mods: { lifesteal: 0.04, dot: 18, damage: 0.2 } },
  { id: 'f15', series: 'ling', weapon: 'w_shiwu', passive: 'shiwufan', cn: '十巫巡山', effect: '召影数量翻倍且更强', mods: { countMul: 2, damage: 0.45, hpMul: 1.6 } },
  // ---- 昆仑 · 不死 ----
  { id: 'f16', series: 'kun', weapon: 'w_kunlun_1', passive: 'xuanpuzhi', cn: '悬圃玉璧', effect: '玉片命中回复护盾', mods: { shieldOnHit: 1, pierce: 2, damage: 0.2 } },
  { id: 'f17', series: 'kun', weapon: 'w_kunlun_2', passive: 'busiyao', cn: '甘露垂野', effect: '甘露范围扩大并持续治疗', mods: { radiusMul: 1.6, regenBonus: 2, damage: 0.3 } },
  { id: 'f18', series: 'kun', weapon: 'w_kunlun_3', passive: 'kunlunyu', cn: '开天一剑', effect: '横扫范围大增并附带强击退', mods: { radiusMul: 1.5, knockback: 400, damage: 0.4 } },
  // 每系第 4 把武器也要有配方（否则它没有"攒到满级"的理由）
  { id: 'f19', series: 'tian', weapon: 'w_tianji', passive: 'kuafuzhong', cn: '射日', effect: '蓄力时间缩短、贯穿更宽', mods: { chargeMul: 0.6, widthMul: 1.6, damage: 0.45 } },
  { id: 'f20', series: 'ling', weapon: 'w_lingwu', passive: 'lingshanwu', cn: '瘴天', effect: '毒雾扩散并持续标记', mods: { radiusMul: 1.5, spread: 1, mark: 2, damage: 0.35 } },
  { id: 'f21', series: 'kun', weapon: 'w_kunlun_4', passive: 'luwushou', cn: '不动明王', effect: '守御领域常驻且随复活层数扩大', mods: { radiusMul: 1.6, reviveBonus: 1, damage: 0.3 } },
  // 开局三系的第 4 把武器同样配一条血统
  { id: 'f22', series: 'shan', weapon: 'w_shanbeng', passive: 'shanyueji', cn: '不周倾', effect: '冲击场随最大生命扩大并强击退', mods: { radiusMul: 1.5, knockback: 300, damage: 0.35 } },
  { id: 'f23', series: 'hai', weapon: 'w_haimao', passive: 'kunpengyi', cn: '归墟刺', effect: '水茅无限穿透且更宽', mods: { pierce: 99, arcMul: 1.6, damage: 0.4 } },
  { id: 'f24', series: 'huang', weapon: 'w_dahuangfeng', passive: 'qiongqixiu', cn: '风伯怒', effect: '风暴更大、牵引更强', mods: { radiusMul: 1.5, pullMul: 1.8, damage: 0.35 } },
];

/**
 * 合体（终极武器）：本系 **4 把武器全部满级 + 指定被动 + 该系主动技已解锁**
 * → 合体出一把**全新机制的终极武器**，永久占满全部 4 个武器槽。
 *
 * 与旧的"3 把满级 + 3 被动 → 全局通道强化"不同：这次是**一把真正的新武器**，
 * 有自己的 kind、等级、机制与视觉（见 weapons.js 里的 w_ult_*），不再只是改 stats，
 * 也不再是"同一套判定形状换数值"。
 *
 * 注意术语：这里是「合体」，产物是「终极武器」；「血统」指的是单把武器满级 +
 * 指定被动 → 该武器变超武形态。**"融合"是废弃词**，不得再用。
 *
 * passives = 合体所需的指定被动（这些被动必须已持有）。
 */
export const ULTIMATE_FUSIONS = [
  { id: 'u_shan', series: 'shan', weaponId: 'w_ult_shan', cn: '不周崩', passives: ['xuangui', 'kuiniu', 'shanyueji', 'dangkangya'] },
  { id: 'u_hai', series: 'hai', weaponId: 'w_ult_hai', cn: '归墟潮', passives: ['jiuweiyi', 'kunpengyi', 'shenglouzhu', 'jiaorenyan'] },
  { id: 'u_huang', series: 'huang', weaponId: 'w_ult_huang', cn: '赤地千里', passives: ['zhulongtong', 'zhurongjin', 'qiongqixiu', 'bashetun'] },
  { id: 'u_tian', series: 'tian', weaponId: 'w_ult_tian', cn: '十日凌空', passives: ['houyigong', 'kuafuzhong', 'nvwashi', 'jingweiwei'] },
  { id: 'u_ling', series: 'ling', weaponId: 'w_ult_ling', cn: '百巫夜行', passives: ['wuxianfu', 'gumumin', 'lingshanwu', 'shiwufan'] },
  { id: 'u_kun', series: 'kun', weaponId: 'w_ult_kun', cn: '昆仑永镇', passives: ['xuanpuzhi', 'busiyao', 'kunlunyu', 'luwushou'] },
];

export const ULTIMATE_BY_ID = {};
for (const u of ULTIMATE_FUSIONS) ULTIMATE_BY_ID[u.id] = u;

/**
 * 主动技（三把同系超武解锁，手动触发）。
 *
 * **改判（批 1）**：主动技 = 玩家主动施加的**操作**，伤害只是副产品；
 * 不得设计成"更大的一次范围伤害"。六系的类型**两两不同**：
 *   地形 / 位移 / 控场 / 瞄准 / 处决 / 防御 各一个。
 *
 * 输入模型（规格 §5）：手势种类上限 4 种；**批 1 只有天问（拉弓）用非点按手势**，
 * 其余五系先点按（type 不是 'aim' 的都按点按处理，留出后续升级空间）。
 *
 * 冷却从**生效或取消**起算；取消不进冷却（见 world.triggerActiveSkill）。
 */
export const ACTIVE_SKILL_TYPES = {
  terrain: '地形',
  dash: '位移',
  control: '控场',
  aim: '瞄准',
  execute: '处决',
  defense: '防御',
};

export const ACTIVE_SKILLS = [
  {
    id: 'skill_shan',
    series: 'shan',
    cn: '立岩',
    type: 'terrain',
    cd: 14,
    duration: 4.5,
    tick: 0.35,
    radius: 152,
    damage: 26,
    push: 300,
    effect: '以你为中心升起环形石壁：圈内敌人被持续推向外侧并受伤，你在圈内相对安全',
  },
  {
    id: 'skill_hai',
    series: 'hai',
    cn: '化潮',
    type: 'dash',
    cd: 10,
    distance: 330,
    speed: 1500,
    radius: 76,
    damage: 70,
    knockback: 320,
    iframes: 0.5,
    effect: '沿摇杆方向穿怪位移，路径上的敌人受伤并被推开，位移瞬间免疫伤害',
  },
  {
    id: 'skill_huang',
    series: 'huang',
    cn: '锁天',
    type: 'control',
    cd: 14,
    radius: 265,
    duration: 3.2,
    bossSlowMul: 0.35,
    effect: '一片范围内的敌人被钉住数秒（精英同样生效；Boss 改为强减速）',
  },
  {
    id: 'skill_tian',
    series: 'tian',
    cn: '拉弓巨箭',
    type: 'aim',
    cd: 11,
    // —— 输入状态机参数（规格 §6 内联契约）——
    chargeTime: 1.2, // 满蓄 T
    minDrag: 26, // 拖动距离小于该阈值时方向取玩家朝向
    moveMul: 0.7, // 蓄力期间移速倍率
    cancelDrag: 26, // 拖回按下点该距离内再松手 = 取消
    // —— 箭体 ——
    damage: 150,
    width: 34,
    widthMax: 96,
    length: 1700,
    // 命中点留下的「日火」区域（与已有的灼烧表现区分开）
    fireRadius: 104,
    fireDps: 42,
    fireLife: 3.2,
    effect: '按住拉弓、反向拖拽瞄准、松手射出贯穿全场的巨箭；命中处留下日火区域',
  },
  {
    id: 'skill_ling',
    series: 'ling',
    cn: '蛊爆',
    type: 'execute',
    cd: 5,
    damage: 60,
    perStack: 48,
    stun: 1.2,
    effect: '引爆全场所有蛊毒标记：每个被标记者独立结算伤害并短暂眩晕（标记越多越强；未标记者不受影响；每次只消耗 1 层）',
  },
  {
    id: 'skill_kun',
    series: 'kun',
    cn: '不死药',
    type: 'defense',
    cd: 17,
    duration: 4.0,
    shield: 90,
    effect: '数秒内不会死亡（血量锁在最低值，伤害优先消耗护盾），并立即回复护盾',
  },
];

export const ACTIVE_SKILL_BY_ID = {};
for (const s of ACTIVE_SKILLS) ACTIVE_SKILL_BY_ID[s.id] = s;

/** 某系的四合一终极配置 */
export function ultimateFusionFor(seriesId) {
  return ULTIMATE_FUSIONS.find((u) => u.series === seriesId) || null;
}

/** 某系的主动技配置 */
export function activeSkillFor(seriesId) {
  return ACTIVE_SKILLS.find((s) => s.series === seriesId) || null;
}

/** 主动技类型的可读名（"地形 / 位移 / 控场 / 瞄准 / 处决 / 防御"） */
export function activeSkillTypeCn(type) {
  return ACTIVE_SKILL_TYPES[type] || type;
}

/** 某把终极武器（weapons.js 的 w_ult_*）对应的合体配置 */
export function ultimateFusionOfWeapon(weaponId) {
  return ULTIMATE_FUSIONS.find((u) => u.weaponId === weaponId) || null;
}

export const FUSION_BY_ID = {};
for (const f of FUSIONS) FUSION_BY_ID[f.id] = f;

export function fusionForWeapon(weaponId) {
  return FUSIONS.find((f) => f.weapon === weaponId) || null;
}

export function fusionOf(weaponId, passiveId) {
  return FUSIONS.find((f) => f.weapon === weaponId && f.passive === passiveId) || null;
}
