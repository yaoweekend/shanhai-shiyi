// 武器的视觉配置：形状 + 颜色。
// 为什么要独立出来：24 把武器如果共用少数几个占位生成器，画出来会互相撞脸
// （实测"利爪横扫"和"海茅穿刺"完全一样）。把"长什么样"变成数据，
// 既能让每把武器一眼可辨，也让正式美术替换时有一份明确的对照表。
//
// shape 会被 render2d.js 用来画：投射物的轮廓、横扫的刀光、领域的光环、蓄力的光束。

export const WEAPON_VISUAL = {
  // ---- 山经 · 兽（暖红/土黄，近身）----
  w_shoujia: { shape: 'ring-blade', color: '#e8e2d0', accent: '#c9553d' },
  w_guhai: { shape: 'bone', color: '#ded6c2', accent: '#8a7f6a' },
  w_lizhao: { shape: 'claw', color: '#f0b357', accent: '#c9553d' },
  w_shanbeng: { shape: 'quake', color: '#c9553d', accent: '#f0b357' },

  // ---- 海经 · 水（蓝/青，弹道）----
  w_linyu: { shape: 'scale', color: '#7fd6ee', accent: '#2f7fb8' },
  w_jiaozhu: { shape: 'pearl', color: '#d9f6ff', accent: '#2f7fb8' },
  w_jingxi: { shape: 'whale-beam', color: '#8fd8ff', accent: '#2f7fb8' },
  w_haimao: { shape: 'spear', color: '#bfe9ff', accent: '#2f7fb8' },

  // ---- 大荒经 · 荒（紫/橙，范围天罚）----
  w_huanglei: { shape: 'bolt', color: '#c39bf0', accent: '#ffe08a' },
  w_zhangqi: { shape: 'miasma', color: '#9be08a', accent: '#6f5aa8' },
  w_zhaoyin: { shape: 'beast', color: '#c39bf0', accent: '#6f5aa8' },
  w_dahuangfeng: { shape: 'swirl', color: '#b9a6e8', accent: '#9be08a' },

  // ---- 天问 · 神祇（金/白，爆发）----
  w_rijian: { shape: 'sun-arrow', color: '#ffe08a', accent: '#d9a02b' },
  w_jiguang: { shape: 'comet', color: '#d9f6ff', accent: '#d9a02b' },
  w_riyue: { shape: 'halo', color: '#ffe08a', accent: '#fff6d6' },
  w_tianji: { shape: 'sun-lance', color: '#fff0b0', accent: '#d9a02b' },

  // ---- 灵山 · 巫祝（青绿/暗紫，诅咒）----
  w_wugu: { shape: 'rune', color: '#8ff0dd', accent: '#2f9e8f' },
  w_shigu: { shape: 'swarm', color: '#a8e6b0', accent: '#2f9e8f' },
  w_shiwu: { shape: 'wraith', color: '#8ff0dd', accent: '#4a3a6a' },
  w_lingwu: { shape: 'hex-mist', color: '#7fd6a8', accent: '#4a3a6a' },

  // ---- 昆仑 · 不死（玉白/银蓝，守护）----
  w_kunlun_1: { shape: 'jade-disc', color: '#dfe6f2', accent: '#8a93a8' },
  w_kunlun_2: { shape: 'dew', color: '#bfe9ff', accent: '#dfe6f2' },
  w_kunlun_3: { shape: 'kunwu-blade', color: '#f2f6ff', accent: '#8a93a8' },
  w_kunlun_4: { shape: 'aegis', color: '#dfe6f2', accent: '#6fd39a' },

  // ---- 四合一终极武器（各系专属形状，不与其他武器撞脸）----
  w_ult_shan: { shape: 'ult-mountain', color: '#c9553d', accent: '#f0b357' },
  w_ult_hai: { shape: 'ult-tide', color: '#2f7fb8', accent: '#7fd6ee' },
  w_ult_huang: { shape: 'ult-inferno', color: '#6f5aa8', accent: '#c39bf0' },
  w_ult_tian: { shape: 'ult-sun', color: '#d9a02b', accent: '#ffe08a' },
  w_ult_ling: { shape: 'ult-wraith', color: '#2f9e8f', accent: '#8ff0dd' },
  w_ult_kun: { shape: 'ult-jade', color: '#8a93a8', accent: '#dfe6f2' },
};

export function visualOf(weaponId) {
  return WEAPON_VISUAL[weaponId] || { shape: 'dot', color: '#ffffff', accent: '#cccccc' };
}

/** 自检用：所有武器都必须有视觉配置 */
export function missingVisuals(weapons) {
  return weapons.filter((w) => !WEAPON_VISUAL[w.id]).map((w) => w.id);
}

/** 自检用：找出视觉完全相同的武器对（形状 + 颜色都一样才算撞脸） */
export function duplicateVisuals(weapons) {
  const seen = new Map();
  const dups = [];
  for (const w of weapons) {
    const v = WEAPON_VISUAL[w.id];
    if (!v) continue;
    const key = v.shape + '|' + v.color;
    if (seen.has(key)) dups.push([seen.get(key), w.id]);
    else seen.set(key, w.id);
  }
  return dups;
}
