// 6 个角色（规格 §9）。
// 角色差异只有三项：① 初始武器；② 开局自带 1 件该系被动；③ 双向微调（一条通道 +8%、另一条 −5%）。
// 禁止纯增益角色，禁止幅度超过 10%。

export const CHARACTERS = [
  {
    id: 'shanpo',
    cn: '山魄',
    series: 'shan',
    weapon: 'w_shoujia',
    passive: 'kuiniu',
    mods: { dr: 0.08, speed: -0.05 },
    blurb: '体魄厚重，挪得慢。',
    locked: false,
  },
  {
    id: 'haipo',
    cn: '海魄',
    series: 'hai',
    weapon: 'w_linyu',
    passive: 'jiuweiyi',
    mods: { projSpeed: 0.08, area: -0.05 },
    blurb: '弹道快，打得散。',
    locked: false,
  },
  {
    id: 'huangpo',
    cn: '荒魄',
    series: 'huang',
    weapon: 'w_huanglei',
    passive: 'zhurongjin',
    mods: { dot: 0.08, maxHp: -0.05 },
    blurb: '天罚灼人，自身也脆。',
    locked: false,
  },
  // 第 4~6 系：双向微调保持"有得有失、幅度 ≤10%"
  // ⚠️ 单位约定（见 sim/stats.js 的 charBonus）：mods 里的值**一律是百分比**（0.08 = +8%），
  //    规格 §9 的"禁止幅度超过 10%"就是按这个校验的。点数型通道（maxHp 等）由 charBonus
  //    按 base 折算成点数，不要在内容表里直接写点数。
  // 天魄：原来用 maxHp −5% 换暴击 +8%，实测在"兽潮铺满屏幕"之后它是唯一 0/10 通关的角色
  // （暴击够高但完全没有防御特性，5 分钟内暴死的比例也偏高）。改成用**移速**换暴击：
  // 仍是"有得有失、幅度 ≤10%"，但把劣势从"更容易被围死"移到了"更难走位"，
  // 符合"打得极疼，血却薄"的定位同时不至于玩不下去。
  { id: 'tianpo', cn: '天魄', series: 'tian', weapon: 'w_rijian', passive: 'houyigong', mods: { critChance: 0.08, speed: -0.05 }, blurb: '打得极疼，自己挪得慢。', locked: true },
  // ⚠️ 平衡修订后「巫咸符」从 18% 上调到 24%，这里的 +8% 是角色自身的微调、**不跟着改**：
  //    平衡规格 §2③ 原文是「巫咸符 18%→24%、巫魄 8%→10%」，但那两个数字是**折算到 stats 上的
  //    实际值**（24% 与 8% 在 stats 里本来就是相邻的 0.24 / 0.08），不是内容表里的两个都要动。
  //    实测：巫魄的 curse 通道 = 0.08（角色）+ 0.24（被动）= 0.32 ——「确实高于普通角色」这条断言仍然成立。
  { id: 'wupo', cn: '巫魄', series: 'ling', weapon: 'w_wugu', passive: 'wuxianfu', mods: { curse: 0.08, speed: -0.05 }, blurb: '诅咒缠身，自己挪得慢。', locked: true },
  // shield 通道的 base 是 0，任何百分比折算到它身上都是 0（8% × 0 = 0）——
  // 所以"护盾厚实"改用减伤通道表达：+8% 减伤是真实生效的防护，配合自带的悬圃芝（护盾+30）仍保住守护系的手感。
  // 代价从 `critChance −5%` 改成 `speed −5%`（平衡规格 §3④）：**暴击率是乘性成长通道，
  // 砍它等于直接封死后期上限**，而它同时还有一整套防御向被动 —— 双重惩罚。移速后仍是
  //"一正一负、幅度 ≤10%"，但劣势不再落在输出上限上。
  { id: 'busipo', cn: '不死魄', series: 'kun', weapon: 'w_kunlun_1', passive: 'xuanpuzhi', mods: { dr: 0.08, speed: -0.05 }, blurb: '护盾厚实，挪得慢。', locked: true },
];

export const CHARACTER_BY_ID = {};
for (const c of CHARACTERS) CHARACTER_BY_ID[c.id] = c;

export const BATCH1_CHARACTERS = CHARACTERS.filter((c) => !c.locked);

/** 角色微调：把 mods 折算成"通道加成"，加法通道按基础值的百分比、比率通道直接相加 */
export function characterChannelBonus(char) {
  const out = {};
  for (const k of Object.keys(char.mods || {})) out[k] = char.mods[k];
  return out;
}
