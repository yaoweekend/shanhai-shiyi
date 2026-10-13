// 槽位定义（规格 §12）。游戏逻辑只引用槽位 id，永远不引用文件名。
// 批 1 槽位清单：玩家角色 ×3、普通敌人 ×5、Boss ×1、竞技场地面与障碍 ×1 套、
// 武器投射物 ×9、道具图标 ×12、UI、特效。
//
// 正式美术到位后：往 assets/manifest.js 里填这些槽位的 file/宽高/锚点/许可/来源 URL/下载日期，
// 不改一行游戏逻辑。

export const CATEGORIES = {
  character: '玩家角色',
  enemy: '普通敌人',
  boss: 'Boss',
  arena: '竞技场',
  projectile: '武器投射物',
  item: '道具图标',
  ui: 'UI',
  fx: '特效',
};

// 每个槽位：{ id, category, cn, series, w, h, anchor, frames, file?, license?, source?, downloadedAt?, generator }
// generator 是占位生成器的 id（见 generator.js）；file 为空时自动回退到占位图。

// 已交付的 9 张精灵是**本项目自己画出来的**（tools/sprites/ 下的程序化 Canvas 绘制），
// 不是第三方素材，所以统一登记为 CC0-1.0 并注明来源是自绘。
// license/source/downloadedAt 三个字段是规格 §12 要求的：每次用 file 替换占位图都必须能答出
// "这张图哪来的、谁授权、什么时候拿的" —— 自绘素材同样要如实登记，不能留空。
const SELF_DRAWN = {
  license: 'CC0-1.0',
  source: '本项目自绘（tools/sprites/sheet.html 程序化 Canvas 绘制，非第三方素材）',
  downloadedAt: '2026-09-26',
};

export const SLOTS = [
  // ---- 玩家角色（3）----
  { id: 'char_shanpo', category: 'character', cn: '山魄', series: 'shan', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_shanpo.png' },
  { id: 'char_haipo', category: 'character', cn: '海魄', series: 'hai', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_haipo.png' },
  { id: 'char_huangpo', category: 'character', cn: '荒魄', series: 'huang', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_huangpo.png' },

  // ---- 普通敌人（5）----
  { id: 'enemy_shanxiao', category: 'enemy', cn: '山魈', series: 'shan', w: 28, h: 28, anchor: [0.5, 0.5], frames: 1, generator: 'gen_enemy', ...SELF_DRAWN, file: 'assets/sprites/enemy_shanxiao.png' },
  { id: 'enemy_bifang', category: 'enemy', cn: '毕方', series: 'huang', w: 30, h: 30, anchor: [0.5, 0.5], frames: 1, generator: 'gen_enemy', ...SELF_DRAWN, file: 'assets/sprites/enemy_bifang.png' },
  { id: 'enemy_huashe', category: 'enemy', cn: '化蛇', series: 'hai', w: 28, h: 28, anchor: [0.5, 0.5], frames: 1, generator: 'gen_enemy', ...SELF_DRAWN, file: 'assets/sprites/enemy_huashe.png' },
  { id: 'enemy_xinang', category: 'enemy', cn: '傒囊', series: 'huang', w: 26, h: 26, anchor: [0.5, 0.5], frames: 1, generator: 'gen_enemy', ...SELF_DRAWN, file: 'assets/sprites/enemy_xinang.png' },
  { id: 'enemy_qiangliang', category: 'enemy', cn: '强良', series: 'shan', w: 36, h: 36, anchor: [0.5, 0.5], frames: 1, generator: 'gen_enemy', ...SELF_DRAWN, file: 'assets/sprites/enemy_qiangliang.png' },

  // ---- Boss（1）----
  { id: 'boss_xiangliu', category: 'boss', cn: '相柳', series: 'huang', w: 132, h: 132, anchor: [0.5, 0.5], frames: 1, generator: 'gen_boss', ...SELF_DRAWN, file: 'assets/sprites/boss_xiangliu.png' },

  // ---- 竞技场（地面 + 障碍，1 套）----
  { id: 'arena_floor', category: 'arena', cn: '竞技场地面', series: 'shan', w: 64, h: 64, anchor: [0, 0], frames: 1, generator: 'gen_floor' },
  { id: 'arena_obstacle', category: 'arena', cn: '障碍', series: 'shan', w: 48, h: 48, anchor: [0.5, 0.5], frames: 1, generator: 'gen_obstacle' },

  // ---- 武器投射物（9）----
  { id: 'proj_shoujia', category: 'projectile', cn: '兽甲旋刃', series: 'shan', w: 24, h: 12, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_orbit' },
  { id: 'proj_guhai', category: 'projectile', cn: '骨骸回旋', series: 'shan', w: 28, h: 28, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_boomerang' },
  { id: 'proj_lizhao', category: 'projectile', cn: '利爪横扫', series: 'shan', w: 96, h: 96, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_sweep' },
  { id: 'proj_linyu', category: 'projectile', cn: '鳞雨散射', series: 'hai', w: 14, h: 14, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_scale' },
  { id: 'proj_jiaozhu', category: 'projectile', cn: '鲛珠追踪', series: 'hai', w: 18, h: 18, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_orb' },
  { id: 'proj_jingxi', category: 'projectile', cn: '鲸息贯穿', series: 'hai', w: 64, h: 24, anchor: [0, 0.5], frames: 1, generator: 'gen_proj_beam' },
  { id: 'proj_huanglei', category: 'projectile', cn: '荒雷落顶', series: 'huang', w: 48, h: 48, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_strike' },
  { id: 'proj_zhangqi', category: 'projectile', cn: '瘴气毒雾', series: 'huang', w: 64, h: 64, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_zone' },
  { id: 'proj_zhaoyin', category: 'projectile', cn: '召引荒兽', series: 'huang', w: 28, h: 28, anchor: [0.5, 0.5], frames: 1, generator: 'gen_proj_summon' },

  // ---- 道具图标（12：9 武器图标 + 被动图标按类；这里登记 12 个批 1 图标）----
  { id: 'icon_w_shoujia', category: 'item', cn: '兽甲旋刃', series: 'shan', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_shoujia.png' },
  { id: 'icon_w_guhai', category: 'item', cn: '骨骸回旋', series: 'shan', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_guhai.png' },
  { id: 'icon_w_lizhao', category: 'item', cn: '利爪横扫', series: 'shan', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_lizhao.png' },
  { id: 'icon_w_linyu', category: 'item', cn: '鳞雨散射', series: 'hai', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_linyu.png' },
  { id: 'icon_w_jiaozhu', category: 'item', cn: '鲛珠追踪', series: 'hai', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_jiaozhu.png' },
  { id: 'icon_w_jingxi', category: 'item', cn: '鲸息贯穿', series: 'hai', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_jingxi.png' },
  { id: 'icon_w_huanglei', category: 'item', cn: '荒雷落顶', series: 'huang', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_huanglei.png' },
  { id: 'icon_w_zhangqi', category: 'item', cn: '瘴气毒雾', series: 'huang', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_zhangqi.png' },
  { id: 'icon_w_zhaoyin', category: 'item', cn: '召引荒兽', series: 'huang', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_weapon', ...SELF_DRAWN, file: 'assets/sprites/icon_w_zhaoyin.png' },
  { id: 'icon_passive', category: 'item', cn: '被动图标', series: 'shan', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_passive', ...SELF_DRAWN, file: 'assets/sprites/icon_passive.png' },
  { id: 'icon_super', category: 'item', cn: '超武图标', series: 'huang', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_super', ...SELF_DRAWN, file: 'assets/sprites/icon_super.png' },
  { id: 'icon_drop', category: 'item', cn: '掉落物', series: 'hai', w: 12, h: 12, anchor: [0.5, 0.5], frames: 1, generator: 'gen_icon_drop', ...SELF_DRAWN, file: 'assets/sprites/icon_drop.png' },

  // ---- UI（1 套）----
  { id: 'ui_panel', category: 'ui', cn: '面板底', series: 'shan', w: 64, h: 64, anchor: [0, 0], frames: 1, generator: 'gen_ui_panel' },
  { id: 'ui_joystick', category: 'ui', cn: '摇杆', series: 'hai', w: 128, h: 128, anchor: [0.5, 0.5], frames: 1, generator: 'gen_ui_joystick' },
  { id: 'ui_button_dash', category: 'ui', cn: '闪避键', series: 'hai', w: 96, h: 96, anchor: [0.5, 0.5], frames: 1, generator: 'gen_ui_button' },
  { id: 'ui_card', category: 'ui', cn: '升级卡', series: 'hai', w: 200, h: 280, anchor: [0, 0], frames: 1, generator: 'gen_ui_card' },

  // ---- 特效（命中 / 爆炸 / 升级 / 拾取）----
  { id: 'fx_hit', category: 'fx', cn: '命中', series: 'shan', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_fx_hit' },
  { id: 'fx_explode', category: 'fx', cn: '爆炸', series: 'huang', w: 96, h: 96, anchor: [0.5, 0.5], frames: 1, generator: 'gen_fx_explode' },
  { id: 'fx_levelup', category: 'fx', cn: '升级', series: 'hai', w: 128, h: 128, anchor: [0.5, 0.5], frames: 1, generator: 'gen_fx_levelup' },
  { id: 'fx_pickup', category: 'fx', cn: '拾取', series: 'shan', w: 24, h: 24, anchor: [0.5, 0.5], frames: 1, generator: 'gen_fx_pickup' },
];

export const SLOT_BY_ID = {};
for (const s of SLOTS) SLOT_BY_ID[s.id] = s;

// 批 2~4 的槽位：现在就把 id 定死并登记生成器，正式素材或内容到位时直接填数据即可。
// 它们不在批 1 的槽位统计里（placeholderStats 只统计 SLOTS），但**命名必须已经可解析**，
// 否则解锁后的人气角色/武器会永远停留在"每帧回退到占位图"的状态。
export const FUTURE_SLOTS = [
  { id: 'char_tianpo', category: 'character', cn: '天魄', series: 'tian', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_tianpo.png', batch: 2 },
  { id: 'char_wupo', category: 'character', cn: '巫魄', series: 'ling', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_wupo.png', batch: 3 },
  { id: 'char_busipo', category: 'character', cn: '不死魄', series: 'kun', w: 32, h: 32, anchor: [0.5, 0.5], frames: 1, generator: 'gen_character', ...SELF_DRAWN, file: 'assets/sprites/char_busipo.png', batch: 4 },
];
for (const s of FUTURE_SLOTS) SLOT_BY_ID[s.id] = s;

// ---------------------------------------------------------------------------
// 批 3 自绘道具图标的「已交付清单」——给**派生**出来的图标槽位补 file 用。
// ---------------------------------------------------------------------------
// 上面逐行登记的 12 个批 1 图标槽位直接写 file 就行；但下面从 WEAPONS / PASSIVES
// **派生**出来的 39 个图标槽位（15 把后续武器的 icon_w_* + 24 件被动的 icon_passive_*）
// 原来是代码生成的，不带 file —— 于是它们全部静默回退到 generator.js 里同一个四角星
// 占位图，这就是「24 把武器的图标长得一模一样、玩家分不出哪张卡是哪把武器」的根因。
//
// 所以这里登记本批已交付 PNG 的槽位 id，派生时按同一个命名规则补上 file：
//     assets/sprites/<槽位id>.png
// 只登记确实画好了的 id（不做「全部派生项一律带 file」）：将来新增武器/被动时，
// 没有真图的槽位仍然照旧回退到占位图，不会谎报一个有文件的路径。
const SELF_DRAWN_ICON_IDS = new Set([
  'icon_w_shanbeng', 'icon_w_haimao', 'icon_w_dahuangfeng',
  'icon_w_rijian', 'icon_w_jiguang', 'icon_w_riyue', 'icon_w_tianji',
  'icon_w_wugu', 'icon_w_shigu', 'icon_w_shiwu', 'icon_w_lingwu',
  'icon_w_kunlun_1', 'icon_w_kunlun_2', 'icon_w_kunlun_3', 'icon_w_kunlun_4',
  'icon_passive_xuangui', 'icon_passive_kuiniu', 'icon_passive_shanyueji', 'icon_passive_dangkangya',
  'icon_passive_jiuweiyi', 'icon_passive_kunpengyi', 'icon_passive_shenglouzhu', 'icon_passive_jiaorenyan',
  'icon_passive_zhulongtong', 'icon_passive_zhurongjin', 'icon_passive_qiongqixiu', 'icon_passive_bashetun',
  'icon_passive_houyigong', 'icon_passive_kuafuzhong', 'icon_passive_nvwashi', 'icon_passive_jingweiwei',
  'icon_passive_wuxianfu', 'icon_passive_gumumin',
  'icon_passive_lingshanwu', 'icon_passive_shiwufan', 'icon_passive_busiyao', 'icon_passive_xuanpuzhi',
  'icon_passive_kunlunyu', 'icon_passive_luwushou',
]);

/** 派生图标槽位的 file 字段：已交付自绘 PNG 的才带（路径规则 = assets/sprites/<槽位id>.png）。 */
function selfDrawnIcon(id) {
  return SELF_DRAWN_ICON_IDS.has(id) ? { ...SELF_DRAWN, file: `assets/sprites/${id}.png` } : {};
}

// ---------------------------------------------------------------------------
// 由内容数据自动派生槽位：每把武器都需要一个图标槽位与一个投射物槽位，
// 每件被动都需要一个图标槽位。手工登记太容易漏（加了武器忘了登记图标，
// 就会静默回退到一张错的占位图），所以这里从 weapons.js / passives.js 生成。
// 命名规则写死在一处：图标 = 'icon_' + 武器id，投射物 = 'proj_' + 武器id去掉 w_ 前缀。
// ---------------------------------------------------------------------------
import { WEAPONS } from '../content/weapons.js';
import { PASSIVES } from '../content/passives.js';

const derived = [];
for (const w of WEAPONS) {
  const iconId = 'icon_' + w.id;
  if (!SLOT_BY_ID[iconId]) {
    derived.push({
      id: iconId,
      category: 'item',
      cn: w.cn,
      series: w.series,
      w: 24,
      h: 24,
      anchor: [0.5, 0.5],
      frames: 1,
      generator: 'gen_icon_weapon',
      ...selfDrawnIcon(iconId),
      derived: true,
    });
  }
  const projId = 'proj_' + w.id.replace(/^w_/, '');
  if (!SLOT_BY_ID[projId]) {
    // 投射物槽位的形状按武器类型给不同生成器，保证"看得出这是什么弹道"
    const genByKind = {
      projectile: 'gen_proj_scale',
      orbit: 'gen_proj_orbit',
      boomerang: 'gen_proj_boomerang',
      sweep: 'gen_proj_sweep',
      beam: 'gen_proj_beam',
      charge: 'gen_proj_beam',
      strike: 'gen_proj_strike',
      zone: 'gen_proj_zone',
      summon: 'gen_proj_summon',
      aura: 'gen_proj_zone',
      // 批 1 / 批 2 合体终极的新机制（投射物槽位只是命名占位，实体由 updateUltimates 推进）
      rift: 'gen_proj_zone',
      tide: 'gen_proj_zone',
      storm: 'gen_proj_zone',
      sunwheel: 'gen_proj_beam',
      plague: 'gen_proj_summon',
      bulwark: 'gen_proj_orb',
    };
    const beamLike = w.kind === 'beam' || w.kind === 'charge' || w.kind === 'sunwheel';
    derived.push({
      id: projId,
      category: 'projectile',
      cn: w.cn,
      series: w.series,
      w: beamLike ? 64 : 28,
      h: 24,
      anchor: beamLike ? [0, 0.5] : [0.5, 0.5],
      frames: 1,
      generator: genByKind[w.kind] || 'gen_proj_scale',
      derived: true,
    });
  }
}
for (const p of PASSIVES) {
  const id = 'icon_passive_' + p.id;
  if (!SLOT_BY_ID[id]) {
    derived.push({
      id,
      category: 'item',
      cn: p.cn,
      series: p.series,
      w: 24,
      h: 24,
      anchor: [0.5, 0.5],
      frames: 1,
      generator: 'gen_icon_passive',
      ...selfDrawnIcon(id),
      derived: true,
    });
  }
}
for (const s of derived) {
  SLOT_BY_ID[s.id] = s;
  SLOTS.push(s);
}
export const DERIVED_SLOTS = derived;

/** 批 1 交付的槽位（用于统计"占位图/正式文件"的比例） */
export function batch1Slots() {
  return SLOTS;
}

export function slotById(id) {
  return SLOT_BY_ID[id] || null;
}

export function slotsMissingFile() {
  return SLOTS.filter((s) => !s.file);
}

export function slotForWeapon(weaponId) {
  // 武器 id 形如 w_shoujia；对应图标槽位 icon_shoujia、投射物槽位 proj_shoujia
  return {
    icon: 'icon_' + weaponId,
    projectile: 'proj_' + weaponId.replace(/^w_/, ''),
  };
}
