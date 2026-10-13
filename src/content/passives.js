// 12 件被动（规格 §4）—— 批 1 只做前三系。
// 铁律（§2）：道具只修改 24 条通道之一/之二，被动无等级、拿到即满（§5）。

export const PASSIVES = [
  // ---- 山经 · 兽 ----
  {
    id: 'xuangui',
    cn: '玄龟甲',
    series: 'shan',
    channel: 'dr',
    value: 0.18,
    icon: 'shield',
    desc: '减伤 +18%',
  },
  {
    id: 'kuiniu',
    cn: '夔牛蹄',
    series: 'shan',
    channel: 'speed',
    value: 0.1,
    icon: 'boot',
    desc: '移速 +10%',
  },
  {
    id: 'shanyueji',
    cn: '山岳脊',
    series: 'shan',
    channel: 'maxHp',
    value: 45,
    icon: 'mountain',
    desc: '最大生命 +45（按差值同步补血）',
  },
  {
    id: 'dangkangya',
    cn: '当康牙',
    series: 'shan',
    channel: 'knockback',
    value: 200,
    icon: 'tusk',
    desc: '击退 +200（命中时的推力）',
  },
  // ---- 海经 · 水 ----
  {
    id: 'jiuweiyi',
    cn: '九尾尾',
    series: 'hai',
    channel: 'projCount',
    value: 1,
    icon: 'tail',
    desc: '弹道数 +1',
  },
  {
    id: 'kunpengyi',
    cn: '鲲鹏翼',
    series: 'hai',
    channel: 'pierce',
    value: 1,
    icon: 'wing',
    desc: '穿透 +1',
  },
  {
    id: 'shenglouzhu',
    cn: '蜃楼珠',
    series: 'hai',
    channel: 'projSpeed',
    value: 0.2,
    icon: 'pearl',
    desc: '弹速 +20%',
  },
  {
    id: 'jiaorenyan',
    cn: '鲛人泪',
    series: 'hai',
    channel: 'pickup',
    value: 45,
    icon: 'tear',
    desc: '拾取半径 +45',
  },
  // ---- 大荒经 · 荒 ----
  {
    id: 'zhulongtong',
    cn: '烛龙瞳',
    series: 'huang',
    channel: 'area',
    value: 0.2,
    icon: 'eye',
    desc: '范围 +20%',
  },
  {
    id: 'zhurongjin',
    cn: '祝融烬',
    series: 'huang',
    channel: 'dot',
    value: 6,
    icon: 'flame',
    desc: '持续伤害 +6/秒',
  },
  {
    id: 'qiongqixiu',
    cn: '穷奇嗅',
    series: 'huang',
    channel: 'homing',
    value: 6,
    icon: 'nose',
    desc: '追踪强度 +6',
  },
  {
    id: 'bashetun',
    cn: '巴蛇吞',
    series: 'huang',
    channel: 'damage',
    value: 0.12,
    icon: 'snake',
    desc: '伤害 +12%',
  },
  // ---- 天问 · 神祇（第 4 系）----
  { id: 'houyigong', cn: '后羿弓', series: 'tian', channel: 'critChance', value: 0.1, icon: 'bow', desc: '暴击率 +10%' },
  { id: 'kuafuzhong', cn: '夸父踵', series: 'tian', channel: 'fireRate', value: 0.14, icon: 'foot', desc: '射速 +14%' },
  { id: 'nvwashi', cn: '女娲石', series: 'tian', channel: 'critMult', value: 0.45, icon: 'stone', desc: '暴击倍率 +45%' },
  { id: 'jingweiwei', cn: '精卫喙', series: 'tian', channel: 'split', value: 1, icon: 'beak', desc: '命中分裂 +1' },
  // ---- 灵山 · 巫祝（第 5 系）----
  { id: 'wuxianfu', cn: '巫咸符', series: 'ling', channel: 'curse', value: 0.24, icon: 'talisman', desc: '诅咒 +24%（只对已标记目标生效）' },
  { id: 'gumumin', cn: '蛊母皿', series: 'ling', channel: 'lifesteal', value: 0.035, icon: 'vessel', desc: '吸血 +3.5%' },
  { id: 'lingshanwu', cn: '灵山雾', series: 'ling', channel: 'dashCd', value: -0.35, icon: 'mist', desc: '技艺冷却 −0.35 秒（闪避与主动技共用）' },
  { id: 'shiwufan', cn: '十巫幡', series: 'ling', channel: 'summonPower', value: 0.3, icon: 'banner', desc: '召唤强度 +30%' },
  // ---- 昆仑 · 不死（第 6 系）----
  { id: 'busiyao', cn: '不死药', series: 'kun', channel: 'regen', value: 1.4, icon: 'pill', desc: '每秒回血 +1.4' },
  { id: 'xuanpuzhi', cn: '悬圃芝', series: 'kun', channel: 'shield', value: 30, icon: 'fungus', desc: '护盾 +30（可再生）' },
  { id: 'kunlunyu', cn: '昆仑玉膏', series: 'kun', channel: 'killHeal', value: 2, icon: 'jade', desc: '击杀回血 +2' },
  { id: 'luwushou', cn: '陆吾守', series: 'kun', channel: 'revive', value: 1, icon: 'gate', desc: '复活 +1 层' },
];

export const PASSIVE_BY_ID = {};
for (const p of PASSIVES) PASSIVE_BY_ID[p.id] = p;

export const BATCH1_PASSIVES = PASSIVES.filter((p) => !p.locked);

export function passiveSeriesIds(seriesId) {
  return BATCH1_PASSIVES.filter((p) => p.series === seriesId).map((p) => p.id);
}
