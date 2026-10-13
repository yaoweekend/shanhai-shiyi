// 内容数据 —— 神系（规格 §4）
// 逻辑只引用 id；名称与图标属于资源清单（§12）。

export const SERIES = {
  shan: { id: 'shan', cn: '山经', title: '山经 · 兽', position: '体魄 · 近身', color: '#c9553d', accent: '#f0b357', role: '近身换血' },
  hai: { id: 'hai', cn: '海经', title: '海经 · 水', position: '弹道 · 操控', color: '#2f7fb8', accent: '#7fd6ee', role: '弹幕操控' },
  huang: { id: 'huang', cn: '大荒经', title: '大荒经 · 荒', position: '范围 · 天罚 · 召唤', color: '#6f5aa8', accent: '#c39bf0', role: '范围天罚' },
  tian: { id: 'tian', cn: '天问', title: '天问 · 神祇', position: '爆发 · 暴击', color: '#d9a02b', accent: '#ffe08a', role: '暴击爆发', locked: true },
  ling: { id: 'ling', cn: '灵山', title: '灵山 · 巫祝', position: '诅咒 · 减益 · 召唤', color: '#2f9e8f', accent: '#8ff0dd', role: '诅咒减益', locked: true },
  kun: { id: 'kun', cn: '昆仑', title: '昆仑 · 不死', position: '守护 · 回复', color: '#8a93a8', accent: '#dfe6f2', role: '守护回复', locked: true },
};

// 批 1 开局的三个系（规格 §4：批 1 交付前三系）
export const BATCH1_SERIES = ['shan', 'hai', 'huang'];

export function seriesOf(id) {
  return SERIES[id] || SERIES.shan;
}
