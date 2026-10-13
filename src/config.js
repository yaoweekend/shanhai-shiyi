// 全局配置与硬上限。所有数值集中在数据表，这里只放"系统级常量"。
// 规格 §11 性能与渲染、§0 产品形态。

export const VERSION = '0.2.4';
export const SAVE_KEY = 'shanhai-save-v1';

// 固定步长模拟（规格 §11：60 Hz，渲染与模拟解耦）
export const TICK_MS = 1000 / 60;
export const TICK_S = TICK_MS / 1000;

// 逻辑分辨率与竞技场（规格 §0：固定逻辑分辨率 + 等比缩放留黑边）
export const LOGIC_W = 960;
export const LOGIC_H = 540;
export const ARENA_W = 2400;
export const ARENA_H = 1350;

// 硬上限：超限时"不再生成"而不是掉帧（规格 §11）
export const CAP_ENEMIES = 300;
export const CAP_PLAYER_BULLETS = 800;
export const CAP_ENEMY_BULLETS = 800; // 与玩家弹幕共用 800 的预算口径
export const CAP_DAMAGE_NUMBERS = 40;
export const CAP_DROPS = 700;
export const CAP_PARTICLES = 300;
export const CAP_MINIONS = 40;

// 空间哈希格子（broad-phase）
export const HASH_CELL = 64;

// 一局节奏（规格 §7）
export const RUN_T = {
  // 空窗期。规格原文写 0:00–0:30，但闪避不再是无敌之后，30 秒的空窗不足以让
  // 一级武器建立优势：实测三系在 140–230s 的爬升段早死（荒魄 4/8）。
  // 放到 45 秒后早死降到 0–2/8，三系都能稳定活到 Boss。
  graceEnd: 45,
  eliteTimes: [120, 240, 360, 480],
  rangedFrom: 300,
  warnAt: 570,
  bossAt: 600,
  // Boss 战窗口：600s 登场，到 750s（12:30）仍未击杀则本局收束。
  // 规格原文写的是 10:00–12:00，但 Boss 血量按"打满要一分半"标定后，
  // 120 秒窗口对近战系太紧，放宽 30 秒。累计时长仍在规格的 8~12 分钟区间内。
  bossDeadline: 750,
};

// 难度档：每 2 分钟一档阶梯式跃升（不是连续爬坡）
export const TIER_PERIOD = 120;

// 玩家基础值（角色微调在此之上，规格 §9）
export const PLAYER_BASE = {
  // 血量按"怪多而软"的新密度重新标定：同屏几十只怪会持续磨血，
  // 所以玩家的血池必须比"低密度时代"更大，否则活不到 Boss。
  maxHp: 170,
  speed: 190,
  radius: 14,
  pickup: 70,
  dashCd: 2.6,
  dashDist: 230,
  dashIframes: 0.28,
  // 闪避冷却下限。原来 0.35s 远低于 dashIframes(0.28s) —— 等于无限无敌，
  // 实测"一路按着闪避就能穿过整场弹幕"，这是闪避超标的根因。
  // 标定（8 种子 × 三系）：0.35 → 3/5/3 通关但闪避等于无限无敌；
  // 1.4 → 2/4/0（荒魄直接玩不下去）；1.0 与基础 2.6 配套 → 4/2/4，且三系都没有
  // "某系早死 4/8" 的塌陷。闪避占用率约 28%，仍需卡时机，不能按着不放。
  dashCdMin: 1.0,
  hurtIframes: 0.7,  xpBase: 14,
  xpGrow: 1.30,
  // 升级所需经验同时吃"当前等级"：越到后面越贵。
  // 标定过程（多组种子实测，不是拍脑袋）：
  //   · XP 收入随兽潮密度**指数上升**（前 2 分钟约 900，最后 2 分钟约 24000），
  //     所以"起点"和"每级增长"两个参数都极其敏感。
  //   · 起点 6 / 1.404 每级：6 分钟就满配，后 4 分钟没有任何成长（用户原话）。
  //   · 起点 6 / 1.612 每级：反向过头，一局只拿到 17 张卡，永远满不了，胜率塌到 1/8。
  //   · 起点 6 / 1.430 每级：前期反而升太快 —— 3 分钟 6334 击杀，怪还没刷出来就被清光，
  //     同屏只剩 9 只（"太强"的根因从"数值高"变成"成型太早"）。
  //   · 起点 14 / 1.430 每级：3 分钟 12–13 张、6 分钟 15–17 张（旧曲线此时已满配），
  //     同屏密度回到 19–32 只，且三系都能活到 Boss。
  xpLevelScale: 1.10,
  // 每升一级增加的血上限（局内成长，用于抵消后期兽潮）
  hpPerLevel: 7,
  // 被动也能升级：每级在上一次基础上 +60%（而不是线性 ×N，避免 split/revive 这类
  // 通道被叠到离谱）。Lv2 = 1.6 倍。
  passiveLevelStep: 0.6,
};

/** 被动最高等级（拿到即 1 级，升级卡 +1 级）。
 *  取 2 而不是 3：一局要发的卡 = 4 武器×(5−1) + 5 被动×(上限−1)。
 *  上限 3 时是 26 张，配合放缓后的升级曲线要打满整局才够，实测胜率掉到 1/8；
 *  上限 2 时是 21 张，7–8 分钟刚好成型，剩下时间走"数值类兜底卡"。 */
export const PASSIVE_MAX_LEVEL = 2;

// 槽位。原规格写"武器 3 + 被动 4，不得上调"；用户明确要求每系加到 4 把武器、
// 并且"集齐三个武器 + 三个相应被动"能合成终极武器，因此槽位随之扩容。
export const SLOT_WEAPONS = 4;
export const SLOT_PASSIVES = 5;

// 武器等级上限（规格 §5：Lv1~Lv5，满级才有资格触发配方）
export const WEAPON_MAX_LEVEL = 5;

// 升级卡：最多 3 张，不可刷新不可跳过（规格 §6）。
// 一轮里不允许出现两个相同的选项（不放回抽样）；去重后的合法选项不足 3 个时
// 就有几张发几张 —— 少发一张好过拿重复卡凑数。
export const CARD_COUNT = 3;

// 伤害数字节流（同帧同类伤害合并的时间窗）
export const DMG_NUMBER_MERGE_MS = 120;

// 画质档
export const QUALITY = { HIGH: 'high', LOW: 'low' };
