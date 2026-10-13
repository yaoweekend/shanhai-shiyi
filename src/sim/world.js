// 世界：一局的完整可序列化状态 + 固定步长推进。
// 分层铁律（规格 §0）：本文件及 src/sim 下所有文件**不得引用任何渲染 API**。
// 存档契约（规格 §10）：只存 seed/时间/玩家/槽位/试炼快照/Boss 状态；
// 敌人、子弹、掉落物、伤害数字不进存档，续局时按波次冷启动恢复。

import {
  TICK_MS, ARENA_W, ARENA_H, PLAYER_BASE, SLOT_WEAPONS, SLOT_PASSIVES,
  RUN_T, WEAPON_MAX_LEVEL, CARD_COUNT, CAP_ENEMIES, CAP_PLAYER_BULLETS, CAP_ENEMY_BULLETS,
  CAP_DAMAGE_NUMBERS, CAP_DROPS, CAP_PARTICLES, CAP_MINIONS, HASH_CELL, TIER_PERIOD,
  PASSIVE_MAX_LEVEL,
} from '../config.js';
import { createRng } from '../core/rng.js';
import { Pool } from '../core/pool.js';
import { SpatialHash } from '../core/spatial.js';
import { TAU, clamp, dist2, angleTo, turnToward } from '../core/math.js';
import { HOOKS, fireHook } from '../core/hooks.js';
import { computeStats, passiveLevelOf, dealDamage, hurtPlayer, hurtByContact, healPlayer, killEnemy, pushDamageNumber, spawnParticles, spawnDrop, explode } from './stats.js';
import { buildEffects } from './effects.js';
import {
  makeEnemy, makeBullet, makeZone, makeDrop, makeDamageNumber, makeParticle, makeMinion, makeOrbitBlade, makeBeam, makeRing,
} from './entities.js';
import { createSpawner, updateSpawner, describeSpawn, tierParams, waveIndexOf } from './spawner.js';
import { bladePositions, bladeHitsPoint, meleeRadiusOf } from '../render/orbit-view.js';
import { WEAPON_BY_ID, levelStats, BATCH1_WEAPONS } from '../content/weapons.js';
import { PASSIVE_BY_ID, BATCH1_PASSIVES } from '../content/passives.js';
import { FUSION_BY_ID, fusionOf, FUSIONS, ULTIMATE_FUSIONS, ultimateFusionFor, ultimateFusionOfWeapon, activeSkillFor, ACTIVE_SKILL_BY_ID } from '../content/fusions.js';
import { CHARACTER_BY_ID } from '../content/characters.js';
import { BOSS, ENEMIES, tierOf } from '../content/enemies.js';
import { EFFECT_KINDS } from '../core/hooks.js';

/**
 * "本系加权"的强度（用户需求：自己选的系，在升级时更容易刷到同系武器/被动，但别太多）。
 *
 * 用**加权抽取**实现：同系选项权重 = SERIES_CARD_WEIGHT，其他系 = 1。
 * 取值 1.8 的效果（可用 test/card-bias.mjs 复算）：
 *   · 池子里同系占少数时，同系卡出现在三选一里的概率从 ~30% 提到 ~44%；
 *   · 但**不会排挤其他系** —— 非同系选项依然按原概率出现在卡里，只是相对少一点。
 * 没有做成"同系保底一张"（那会变成硬性配平，等于替玩家做决定），也没有做成"只出同系"
 * （那就没有取舍了）。
 */
const SERIES_CARD_WEIGHT = 1.8;

// 蛊毒标记寿命（毫秒）。平衡规格 §2④：4 → 7 秒（蛊爆 CD 5 秒，要够"叠 3 层再连爆 3 次"）。
// ⚠️ 它与"死亡时爆毒"共用 enemy.markUntil：延长只是把时间戳推远，清理逻辑（onMarkedDeath
// 里置 markUntil = 0 的那一处）不受影响。
const MARK_LIFE_MS = 7000;

// 主动技有效冷却的硬下限（秒）。平衡规格 §5：**下限 3 秒是硬要求** ——
// 蛊爆基础 5 秒吃满技艺冷却后会变成"站着刷技能"，这条焊死它。
const SKILL_CD_MIN = 3;

// 玉璧环碾压（接触伤害）的节流与"首击预付款"。
// 环是常驻的，所以每个敌人要有自己的节流字段（敌人对象池复用，字段必须每次显式赋值，
// 不能靠"未定义就是冷却好了"——重置后的敌人会立刻挨一次白嫖伤害）。
const BULWARK_HIT_TICK = 0.3;
const BULWARK_FIRST_HIT = 0.6;

/** 每局可用的"刷新三选一"次数（用户需求：增加一次道具刷新机会）。 */
const CARD_REFRESH_PER_RUN = 1;

// 全部升满之后的"数值类兜底卡"。
// 没有这一类时，满配后 rollCards 只能发 {type:'none'}，升级被静默吞掉，
// 玩家在 6–10 分钟这段完全没有成长反馈。
const STAT_CARDS = [
  { id: 'dmg', cn: '伤害', channel: 'damage', value: 0.06 },
  { id: 'hp', cn: '生命上限', channel: 'maxHp', value: 14 },
  { id: 'spd', cn: '移速', channel: 'speed', value: 0.05 },
  { id: 'crit', cn: '暴击率', channel: 'critChance', value: 0.03 },
  { id: 'area', cn: '范围', channel: 'area', value: 0.05 },
  { id: 'rate', cn: '射速', channel: 'fireRate', value: 0.05 },
  { id: 'dr', cn: '减伤', channel: 'dr', value: 0.02 },
  { id: 'regen', cn: '每秒回血', channel: 'regen', value: 0.6 },
];

/** 一张卡的身份：类型 + 目标 id。用来保证同一轮里不出现两张相同的卡。 */
function cardKey(c) {
  return `${c.type}:${c.weaponId || c.passiveId || c.statId || ''}`;
}

/**
 * 从升级池里抽选项：**每张权重相同 + 不放回**，最多 CARD_COUNT 张。
 *
 *  · 仍然是"全随机"：不做"升级 / 新武器 / 新被动 各保一张"的分类配平
 *    （那是上一版被玩家否掉的写法）；
 *  · 不放回：同一轮三选一里不会出现两个相同的选项 —— 重复卡等于这一轮实际只有两个选择；
 *  · 池子去重后不足 3 个时才用重复卡凑满（规格 §6：每次升级都是 3 张，不可刷新不可跳过）。
 *
 *  第 3 个参数 `weightOf` 用于"本系加权"（见 rollCards 里的 SERIES_CARD_WEIGHT）。
 *  用**加权抽取**而不是"先抽完再按权重重排"——后者会破坏均匀性，前者每个选项被选中的
 *  概率与它的权重严格成正比，加权强度可以直接算出来。
 */
function sampleCards(rng, pool, weightOf = null) {
  const seen = new Set();
  const uniq = [];
  for (const c of pool) {
    const k = cardKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  const count = Math.min(CARD_COUNT, uniq.length);
  const picked = [];
  const rest = uniq.slice();
  const w = (c) => (weightOf ? Math.max(0.0001, weightOf(c)) : 1);
  while (picked.length < count && rest.length > 0) {
    let total = 0;
    for (const c of rest) total += w(c);
    let r = rng.next() * total;
    let idx = rest.length - 1;
    for (let i = 0; i < rest.length; i++) {
      r -= w(rest[i]);
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picked.push(rest.splice(idx, 1)[0]);
  }
  // 只有"去重后选项不足 3 个"时才用重复卡凑满。
  // 规格 §6 要求**每次升级都是 3 张卡**（不可刷新、不可跳过）——只发 2 张等于把
  // 三选一降级成二选一，那是玩家明确否掉过的形态。实测只有 2.4% 的升级会走到这一步。
  let i = 0;
  while (picked.length < CARD_COUNT && uniq.length > 0) picked.push(uniq[i++ % uniq.length]);
  return picked;
}

function emptyPlayer() {
  return {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    vx: 0,
    vy: 0,
    hp: PLAYER_BASE.maxHp,
    maxHp: PLAYER_BASE.maxHp,
    shield: 0,
    // 碰撞半径：必须显式存在。它不在 24 条修饰器通道里（stats 只装通道），
    // 曾经漏掉这个字段导致所有"敌人碰到玩家"的判定算成 NaN 而永久失效。
    radius: PLAYER_BASE.radius,
    level: 1,
    xp: 0,
    xpNext: PLAYER_BASE.xpBase,
    reviveLayers: 0,
    dashCd: 0,
    dashUntil: 0,
    iframeUntil: 0,
    hitFlash: 0,
    facing: 0,
    moving: false,
    buffs: [],
  };
}

export class World {
  /**
   * @param {{ seed: number|string, characterId: string, unlocks?: string[], trials?: object, endless?: boolean }} opts
   */
  constructor(opts = {}) {
    const char = CHARACTER_BY_ID[opts.characterId] || CHARACTER_BY_ID.shanpo;
    this.characterId = char.id;
    this.series = char.series;
    this.unlocks = opts.unlocks ? opts.unlocks.slice() : [];
    // 开发/测试开关：开局就把本系 4 把武器拉满 + 四合一指定被动，直接进入"血统超武 + 四合一终极 + 主动技能"状态。
    // 只由 URL 参数 ?dev=ultimate 触发（见 main.js），正式玩法不带这个参数，行为完全不变。
    this.devUltimate = !!opts.devUltimate;
    // 每局可用的"刷新三选一"次数（用掉即减）。存档里会带上，防止退出重进刷回来。
    this.refreshesLeft = opts.refreshesLeft === undefined ? CARD_REFRESH_PER_RUN : opts.refreshesLeft;
    // 已解锁的神系：只有这些系的武器才有资格进卡池。
    // 每系都有 1 把 unlock:'initial' 的武器，但"initial"是"该系开局自带"，
    // 不是"全局免费"——天问的日珥箭在没解锁天问系之前不该出现在卡池里。
    this.unlockedSeries = opts.unlockedSeries ? opts.unlockedSeries.slice() : ['shan', 'hai', 'huang'];
    this.trials = opts.trials || {};
    this.endless = !!opts.endless;
    this.seed = typeof opts.seed === 'number' ? opts.seed : 1;
    this.rng = createRng(this.seed);
    this.fusionById = FUSION_BY_ID;
    this.errors = [];
    // 合体状态（一局一次）
    this.fusedWeapon = null;      // 已合体的终极武器 id（ULTIMATE_FUSIONS 里的 id），null = 未合体
    this.activeSkillUnlocked = null; // 已解锁的主动技 id（ACTIVE_SKILLS 里的 id）
    this.activeSkillUnlockedSeries = null; // 上面那个技能属于哪个系（解锁即持久化，见 checkActiveSkillUnlock）
    this.activeSkillCd = 0;       // 主动技剩余冷却（秒）

    // —— 合体终极武器（批 1：裂地 / 潮汐 / 天罚轮转；批 2：十日 / 百巫 / 玉璧）的机制状态 ——
    // 这六种机制**不是**"按冷却开火"的武器，而是每 tick 推进的世界状态，所以单独存。
    this.ultRift = { x: 0, y: 0, primed: false, moved: 0 };
    this.ultTide = { timer: 0 };
    this.ultStorm = { timer: 0, clouds: [] };
    // 十日凌空：公转的太阳轮 + 齐射计时（太阳位置每帧由 spin 现算，不存实体）
    this.ultSun = { spin: 0, volleyTimer: 0, flash: 0 };
    // 百巫夜行：巫影本体复用 minions 池（带 plague 标记），这里只存"当前有几只"的记账
    this.ultPlague = { wraiths: 0 };
    // 昆仑永镇：玉璧环（层数 / 自转角 / 反弹参数；updateEnemyBullets 要读它）
    this.ultBulwark = { active: false, angle: 0, angle2: 0, radius: 0, band: 0, innerCd: 0, reflectMul: 0, reflectPierce: 0, homing: 0, golden: false, rings: 1 };

    // —— 主动技状态（批 1：六个操作型技能）——
    // 立岩（地形）：一个持续的推力场 zone
    this.skillWall = null;
    // 化潮（位移）：位移期间的冲刺状态
    this.skillDash = { until: 0, angle: 0, hit: null };
    // 锁天（控场）/ 蛊爆（处决）：一次性，无需残留状态
    // 不死药（防御）：锁定最低血线的时间窗
    this.undyingUntil = 0;
    // 拉弓巨箭（瞄准）：完整的输入状态机（规格 §6）
    this.bow = { phase: 'idle', t: 0, c: 0, startX: 0, startY: 0, curX: 0, curY: 0, pulled: false };

    // 时间
    this.tick = 0;
    this.frame = 0;
    this.elapsedMs = 0;
    this.paused = true;
    this.running = true;
    this.outcome = null; // 'win' | 'dead'
    this.frameMs = TICK_MS;

    // 输入（由渲染/UI 层写入；模拟层只读）
    this.input = { mx: 0, my: 0, active: false, dashRequested: false, skillRequested: false };
    this.moveAngle = 0;

    // 调参面板（开发/测试用，规格 specs/shanhai-dev-tune.md）：
    // 全是"运行时本局"的量，不进存档；没有面板时这些字段保持中性值，
    // 所以正式包的行为与不带面板时**逐值一致**（测试有一条"不改参数则结果一致"守着）。
    this.tune = {
      enemies: {},        // id → { on, count, weight, from }
      spawn: 1,           // 生成速率倍率
      elite: 1,           // 精英频率倍率
      enemyHp: 1,         // 怪生命倍率
      enemySpd: 1,        // 怪速度倍率
      tier: -1,           // ≥0 = 手调难度档；-1 = 按时间自动
    };
    this.invincible = false;   // 面板的"无敌"
    this.damageMul = 1;        // 面板的伤害倍率
    this.speedMul = 1;         // 面板的移速倍率
    this.xpMul = 1;            // 面板的经验倍率（作用于掉落物的 XP 值）
    this.dropMul = 1;          // 面板的掉落倍率（作用于生成掉落时的数量）

    // 玩家
    this.player = emptyPlayer();

    // 槽位（规格 §6：武器 3 + 被动 4）
    this.slots = {
      weapons: [{ id: char.weapon, level: 1, cd: 0, superId: null }],
      passives: [char.passive],
    };
    // 被动等级表（id → 等级）。slots.passives 仍是 id 字符串数组，
    // 所以 effects / fusions / UI 里所有 includes(pid) 都不用改。
    this.passiveLevels = {};
    for (const pid of this.slots.passives) this.passiveLevels[pid] = 1;
    // 数值类兜底卡累加出来的通道加成
    this.bonusSums = {};

    // 池
    this.enemies = new Pool(makeEnemy, resetEnemy, CAP_ENEMIES);
    this.bullets = new Pool(makeBullet, resetBullet, CAP_PLAYER_BULLETS + CAP_ENEMY_BULLETS);
    this.playerBullets = [];
    this.enemyBullets = [];
    this.zones = new Pool(makeZone, resetZone, 120);
    this.drops = new Pool(makeDrop, resetDrop, CAP_DROPS);
    this.damageNumbers = new Pool(makeDamageNumber, resetDamageNumber, CAP_DAMAGE_NUMBERS);
    this.particles = new Pool(makeParticle, resetParticle, CAP_PARTICLES);
    this.minions = new Pool(makeMinion, resetMinion, CAP_MINIONS);
    this.orbitBlades = new Pool(makeOrbitBlade, resetOrbit, 16);
    this.beams = new Pool(makeBeam, resetBeam, 24);
    this.rings = new Pool(makeRing, resetRing, 40);

    this.enemyHash = new SpatialHash(HASH_CELL);
    this.queryBuf = [];

    // 钩子效果（由 slots 派生，不入存档）
    this.effects = buildEffects(this.slots, this.fusionById);

    // 统计与流程
    this.spawner = createSpawner();
    this.runStats = { kills: 0, killsTotal: 0, level: 1, timeMs: 0, weapons: 0, passives: 0, maxTier: 0, damageDealt: 0 };
    this.trialsThisRun = { seriesOnly: {}, won: false, characters: [] };
    this.bossState = { entered: false, phase: 0, heads: 9, spawned: false, hpPct: 1 };
    this.bossActive = false;
    this.bossDefeated = false;
    // 无尽：已通关周数（0 = 第一周）。难度与存档都依赖它。
    this.endlessCycle = 0;
    // 无尽：已完成周的累计时长，用于把刷怪日程重放（见 spawner.updateSpawner）。
    this.endlessOffsetMs = 0;
    this.bossWarning = false;
    this.pendingWaveStart = -1;
    this.pendingKillRecycle = [];
    this.xpCollected = 0;
    this.pendingLevelUps = 0;
    this.awaitingChoice = false;
    this.cardChoices = [];
    this.hintText = '';
    this.hintUntil = 0;
    this.shake = 0;
    this.particlesOn = true;
    this.showDamageNumbers = true;
    this.quality = 'high';
    this.camera = { x: this.player.x, y: this.player.y };
    this.applyCharacterMods();
    this.recompute();
    this.player.hp = this.player.maxHp;
    this.refreshWeaponEntities();
    this.loadoutPassiveIds = this.slots.passives.slice();
    for (const p of this.loadoutPassiveIds) this.onPassiveAcquired(p, true);

    // 测试开关：开局直接给"本系 4 把武器满级 + 四合一所需的被动"，并触发四合一 + 主动技能。
    // 必须放在构造函数**最末尾**：它会调 refreshWeaponEntities()/checkFusions()，
    // 而那些依赖上面刚建好的对象池（orbits/minions/beams 等）。
    if (this.devUltimate) this.applyDevUltimateLoadout();
  }

  // ---------------- 派生量 ----------------

  recompute() {
    const { sums, stats } = computeStats(this);
    this.sums = sums;
    this.stats = stats;
    const p = this.player;
    // 碰撞半径必须始终是有限数：= undefined 会让所有"圆 vs 圆"判定变成 NaN 而不报错
    if (!Number.isFinite(p.radius) || p.radius <= 0) p.radius = PLAYER_BASE.radius;
    const prevMax = p.maxHp;
    // 局内等级成长：升级顺带涨一点血上限。
    // 这是"局内成长"不是"局外数值成长"（规格 §8 的铁律只约束解锁），
    // 作用是让后期的同屏兽潮不至于把贴脸流派直接压死。
    p.maxHp = Math.round(stats.maxHp + (p.level - 1) * PLAYER_BASE.hpPerLevel);
    // 最大生命变化时按差值同步补血（规格 §2 通道说明）
    if (p.maxHp !== prevMax) p.hp = clamp(p.hp + (p.maxHp - prevMax), 1, p.maxHp);
    p.shieldMax = Math.round(stats.shield);
    // 复活层：以通道计数为准（超武/被动可叠加）
    const target = Math.max(p.reviveLayers, stats.revive);
    p.reviveLayers = target;
    p.buffs = p.buffs.filter((b) => b.until > this.elapsedMs);
  }

  applyCharacterMods() {
    // 角色初始武器与被动已在构造函数写入 slots；此处只做通道微调（在 computeStats 内读取）
  }

  // ---------------- 主循环 ----------------

  step() {
    if (!this.running) return;
    const dt = TICK_MS / 1000;
    // 有人（调参面板 / 回放工具 / 存档）直接改了 elapsedMs 时，把 tick 对齐过去。
    // 否则下面的 `elapsedMs = tick × TICK_MS` 会把它**顶回去** ——
    // 面板的"跳到第 9 分钟"就会在下一帧悄悄退回原处，而场上留下的却是跳转后补的怪。
    if (this.tick * TICK_MS !== this.elapsedMs) {
      const jumped = this.elapsedMs;
      this.tick = Math.round(jumped / TICK_MS);
      this.elapsedMs = this.tick * TICK_MS;
      // 时间跳转的配套语义（规格 §4）：**不追溯补发刷怪额度**。
      // 不这么做的话，跳到第 9 分钟会在下一帧一次性倒出一大坨生成额度。
      if (this.spawner) {
        this.spawner.acc = 0;
        this.spawner.waveIndex = Math.floor(jumped / 30000);
      }
    }
    const t0 = this.elapsedMs;
    this.tick++;
    this.frame++;
    this.elapsedMs = this.tick * TICK_MS;

    // 0) 恢复待处理状态
    this.applyKillRecycle();

    // 0.5) 主动技输入状态机（点按类立即生效；拉弓类只推进蓄力/瞄准/取消）
    this.updateSkillState(dt);

    // 1) 玩家
    this.updatePlayer(dt);

    // 2) 刷怪
    const reqs = updateSpawner(this, dt);
    for (const r of reqs) this.spawnEnemyFrom(r);

    // 3) 波次开始时钩子
    if (this.pendingWaveStart >= 0) {
      this.pendingWaveStart = -1;
      this.fireHook(HOOKS.ON_WAVE, { x: this.player.x, y: this.player.y });
    }

    // 4) 每 N 秒钩子（用整秒节拍驱动，避免浮点累积误差）
    const prevSec = Math.floor(t0 / 1000);
    const nowSec = Math.floor(this.elapsedMs / 1000);
    if (nowSec > prevSec) this.fireHook(HOOKS.ON_TIMER, { x: this.player.x, y: this.player.y });

    // 5) 敌人
    this.rebuildEnemyHash();
    this.updateEnemies(dt);

    // 6) 武器开火
    this.updateWeaponEntities(dt);
    this.updateWeapons(dt);
    // 6.5) 合体终极武器的机制（裂地 / 潮汐 / 天罚轮转）+ 拉弓发射
    //      放在敌人哈希重建之后：这三套机制都要按位置查敌人。
    this.updateUltimates(dt);

    // 7) 子弹
    this.updatePlayerBullets(dt);
    this.updateEnemyBullets(dt);

    // 8) 区域与光束
    this.updateZones(dt);
    this.updateBeams(dt);
    this.updateRings(dt);

    // 9) 掉落与拾取
    this.updateDrops(dt);

    // 10) 表现层计时
    this.updateCosmetics(dt);

    // 11) 状态机收尾
    this.runStats.timeMs = this.elapsedMs;
    this.runStats.level = this.player.level;
    this.runStats.weapons = this.fusedWeapon ? 4 : this.slots.weapons.length;
    this.runStats.passives = this.slots.passives.length;
    const tier = tierOf(this.elapsedMs, TIER_PERIOD * 1000);
    if (tier > this.runStats.maxTier) this.runStats.maxTier = tier;
    if (!this.endless && this.elapsedMs >= RUN_T.bossDeadline * 1000) {
      // 规格 §7：Boss 阶段 10:00 起；12:00 仍未击杀 → 本局按失败收束（避免无限拖时间）
      this.outcome = 'dead';
      this.running = false;
    }
    this.recompute();
  }

  /** 快进 n 步（无头测试用） */
  fastForward(steps) {
    for (let i = 0; i < steps && this.running; i++) this.step();
    return this;
  }

  // ---------------- 玩家 ----------------

  updatePlayer(dt) {
    const p = this.player;
    const stats = this.stats;
    const inp = this.input;
    let mx = inp.mx;
    let my = inp.my;
    const len = Math.hypot(mx, my);
    const active = len > 0.06;
    p.moving = active;
    if (active) {
      mx /= len;
      my /= len;
      this.moveAngle = Math.atan2(my, mx);
      p.facing = this.moveAngle;
    } else {
      mx = 0;
      my = 0;
    }

    // 闪避
    if (p.dashCd > 0) p.dashCd -= dt;
    // 主动技能冷却
    if (this.activeSkillCd > 0) this.activeSkillCd -= dt;
    if (inp.skillRequested) {
      inp.skillRequested = false;
      this.triggerActiveSkill();
    }
    if (inp.dashRequested) {
      inp.dashRequested = false;
      if (p.dashCd <= 0) {
        // stats.dashCd 已经是绝对秒数并夹过下限（见 stats.js 的折叠），这里不再二次夹取
        p.dashCd = stats.dashCd;
        p.dashUntil = this.elapsedMs + 180;
        p.iframeUntil = Math.max(p.iframeUntil, this.elapsedMs + PLAYER_BASE.dashIframes * 1000);
        this.shake = Math.max(this.shake, 3);
        spawnParticles(this, p.x, p.y, 6, '#bfe9ff');
      }
    }
    const dashing = this.elapsedMs < p.dashUntil;
    // 拉弓蓄力期间移速 ×0.7（规格 §6：这是刻意留的代价，在兽潮里拉弓要有风险）
    const bowing = this.bow.phase === 'charge' || this.bow.phase === 'aim';
    const bowMul = bowing ? (this._bowMoveMul || 1) : 1;
    // 化潮（位移型主动技）：位移期间由技能覆盖移动，方向在施放瞬间定死
    const skillDash = this.elapsedMs < this.skillDash.until;
    if (skillDash) {
      mx = Math.cos(this.skillDash.angle);
      my = Math.sin(this.skillDash.angle);
    }
    let speed = stats.speed * (dashing ? 3.2 : 1) * bowMul;
    if (skillDash) speed = this._skillDashSpeed || speed;
    // 调参面板的移速倍率（默认 1；作用于普通移动与闪避位移，不作用于技能自己定的速度）
    if (this.speedMul && this.speedMul !== 1) speed *= this.speedMul;
    if (dashing && !active && !skillDash) {
      // 站桩时闪避朝当前朝向冲
      mx = Math.cos(p.facing);
      my = Math.sin(p.facing);
    }
    p.vx = mx * speed;
    p.vy = my * speed;
    p.x = clamp(p.x + p.vx * dt, 16, ARENA_W - 16);
    p.y = clamp(p.y + p.vy * dt, 16, ARENA_H - 16);

    // 回血 / 护盾再生
    if (stats.regen > 0) healPlayer(this, stats.regen * dt, true);
    if (stats.shield > 0 && p.shield < stats.shield) {
      p.shield = Math.min(stats.shield, p.shield + stats.shield * 0.22 * dt);
    }
    // 相机（渲染层读；模拟层只写）
    const cam = this.camera;
    cam.x += (p.x - cam.x) * Math.min(1, dt * 8);
    cam.y += (p.y - cam.y) * Math.min(1, dt * 8);
    cam.x = clamp(cam.x, 0, ARENA_W);
    cam.y = clamp(cam.y, 0, ARENA_H);
  }

  // ---------------- 敌人 ----------------

  spawnEnemyFrom(req) {
    const desc = describeSpawn(req);
    const e = this.enemies.spawn();
    if (!e) return null;
    e.id = this.nextId();
    e.kind = desc.kind;
    e.isBoss = !!desc.isBoss;
    e.elite = !!req.elite;
    e.affix = req.affix || null;
    e.x = req.x;
    e.y = req.y;
    e.vx = 0;
    e.vy = 0;
    e.hp = desc.hp;
    e.maxHp = desc.maxHp !== undefined ? desc.maxHp : desc.hp;
    e.radius = desc.radius;
    e.speed = desc.speed;
    e.touchDamage = desc.touchDamage;
    e.xp = desc.xp;
    e.ai = desc.ai;
    e.tier = req.tier || 0;
    // 调参面板：怪生命/速度倍率（只作用于"新生成的怪"，所以放在实例化这一处，
    // 而不是每帧去乘 —— 每帧乘会指数级放大）
    if (this.tune && (this.tune.enemyHp !== 1 || this.tune.enemySpd !== 1)) {
      const hpMul = this.tune.enemyHp || 1;
      const spdMul = this.tune.enemySpd || 1;
      e.hp *= hpMul;
      e.maxHp *= hpMul;
      e.speed *= spdMul;
    }
    e.summonEvery = desc.summonEvery || 0;
    e.enrageMul = desc.enrageMul || 1;
    e.scale = desc.scale || 1;
    e.shape = desc.shape || 'ape';
    // 确定性个体差异（禁止在模拟层读 Math.random）
    e.approachBias = this.rng.next();
    e.color = desc.color || null;
    e.boomRadius = desc.boomRadius || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].boomRadius : 0) || 0;
    e.boomDamage = desc.boomDamage || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].boomDamage : 0) || 0;
    e.fireEvery = desc.fireEvery || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].fireEvery : 0) || 0;
    e.projSpeed = desc.projSpeed || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].projSpeed : 0) || 0;
    e.projDamage = desc.projDamage || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].projDamage : 0) || 0;
    e.chargeEvery = desc.chargeEvery || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].chargeEvery : 0) || 0;
    e.chargeSpeed = desc.chargeSpeed || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].chargeSpeed : 0) || 0;
    e.knockback = desc.knockback || (ENEMIES[desc.kind] ? ENEMIES[desc.kind].knockback : 0) || 0;
    if (e.isBoss) {
      this.bossState.spawned = true;
      this.bossState.entered = true;
      this.bossState.phase = 0;
      this.bossState.heads = BOSS.phases[0].heads;
      this.hint('相柳 · 九首齐鸣');
    }
    return e;
  }

  rebuildEnemyHash() {
    this.enemyHash.rebuild(this.enemies.active);
  }

  updateEnemies(dt) {
    const list = this.enemies.active;
    const p = this.player;
    const now = this.elapsedMs;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // 状态计时
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.wobble += dt;
      // 持续伤害（燃烧 / 毒）
      if (e.burnUntil > now && e.burnDps > 0) {
        e.dotTick += dt;
        if (e.dotTick >= 0.25) {
          e.dotTick -= 0.25;
          dealDamage(this, e, e.burnDps * 0.25, { source: 'dot', rollCrit: false, viaHook: true });
          if (!e.__alive) continue;
        }
      }
      // 蛊毒发作（百巫夜行）：标记本身就是毒，是它**主要**的掉血来源
      // （巫影还有一点直接伤害负责"点火"，见 updateMinions 的 m.damage）。
      if (e.plagueUntil > now && e.plagueDps > 0) {
        e.plagueTick += dt;
        if (e.plagueTick >= 0.25) {
          e.plagueTick -= 0.25;
          // 蛊毒 dps 随标记层数放大（平衡规格 §2①）：base × (1 + 0.6 × (层数−1))，
          // 3 层 = 2.2 倍。按**当前层数**重算（不取历史最大值）：引爆扣层后毒就变弱。
          const markStacks = e.mark > 0 && now < e.markUntil ? Math.min(3, e.mark) : 1;
          const plagueDps = e.plagueDps * (1 + 0.6 * (markStacks - 1));
          dealDamage(this, e, plagueDps * 0.25, { source: 'dot', rollCrit: false, viaHook: true });
          if (!e.__alive) continue;
        }
      }
      const slow = e.slowUntil > now ? e.slowMul : 1;
      if (e.stunUntil > now) {
        continue;
      }
      const spd = e.speed * slow;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.facing = Math.atan2(dy, dx);
      let targetAngle = e.facing;

      switch (e.ai) {
        case 'chase': {
          // 个体差异：一部分绕圈收口（制造混合距离的压力），一部分直冲贴脸
          if (d < 280) {
            const bias = e.approachBias || 0;
            if (bias < 0.55) {
              const tangent = e.facing + (e.id % 2 ? Math.PI / 2 : -Math.PI / 2);
              const mix = 0.45 + bias * 0.5; // 越靠前的越倾向于绕
              targetAngle = Math.atan2(
                Math.sin(e.facing) * (1 - mix) + Math.sin(tangent) * mix,
                Math.cos(e.facing) * (1 - mix) + Math.cos(tangent) * mix,
              );
            }
          }
          break;
        }
        case 'weave': {
          targetAngle = e.facing + Math.sin(now / 260 + e.id) * 0.55;
          break;
        }
        case 'ranged': {
          // 保持距离并射直线弹
          const want = 260;
          if (d < want - 30) targetAngle = e.facing + Math.PI;
          else if (d < want + 30) targetAngle = e.facing + Math.PI / 2 * (e.id % 2 ? 1 : -1);
          e.fireCd -= dt;
          if (e.fireCd <= 0 && d < 520) {
            e.fireCd = e.fireEvery || 2.4;
            this.spawnEnemyBullet(e, e.facing, e.projSpeed || 190, e.projDamage || 8);
          }
          break;
        }
        case 'suicide': {
          targetAngle = e.facing;
          // 两段式：先点燃引信（0.45 秒，可躲），再爆
          if (e.fuseUntil > now) {
            if (d < e.radius + p.radius + 10) {
          hurtByContact(this, e, { iframeMs: 900 });
              spawnParticles(this, e.x, e.y, 12, '#ff9a5a');
              this.enemies.release(e);
              continue;
            }
          } else if (e.fuseUntil > 0) {
            // 引信到期：爆
            explode(this, e.x, e.y, e.boomRadius || 62, e.boomDamage || 20);
            this.enemies.release(e);
            continue;
          } else if (d < 90) {
            e.fuseUntil = now + 450;
            e.hitFlash = 0.2;
          }
          break;
        }
        case 'charger': {
          e.chargeCd = (e.chargeCd || 0) - dt;
          if (e.chargeState === 1) {
            // 冲锋中
            if (now > e.chargeUntil) e.chargeState = 0;
            else targetAngle = e.chargeAngle;
          } else if (e.chargeState === 2) {
            // 蓄力（预警 0.35 秒）：站着不动，让玩家有时间躲
            targetAngle = e.facing;
            e.chargeAngle = e.facing;
            if (now >= e.chargeWindupUntil) {
              e.chargeState = 1;
              e.chargeUntil = now + 520;
            }
          } else if (e.chargeCd <= 0 && d < 420) {
            e.chargeState = 2;
            e.chargeAngle = e.facing;
            e.chargeWindupUntil = now + 350;
            e.chargeCd = e.chargeEvery || 3.2;
            targetAngle = e.facing;
          }
          if (e.chargeState === 1) {
            const kx = Math.cos(e.chargeAngle) * (e.chargeSpeed || 430);
            const ky = Math.sin(e.chargeAngle) * (e.chargeSpeed || 430);
            e.x += kx * dt;
            e.y += ky * dt;
            // 冲锋撞到玩家
            if (dist2(e.x, e.y, p.x, p.y) <= (e.radius + p.radius) * (e.radius + p.radius)) {
              hurtByContact(this, e);
              const k = e.knockback || 260;
              p.x += Math.cos(e.chargeAngle) * k * dt * 4;
              p.y += Math.sin(e.chargeAngle) * k * dt * 4;
              e.chargeState = 0;
            }
            if (e.x < 16 || e.x > ARENA_W - 16 || e.y < 16 || e.y > ARENA_H - 16) e.chargeState = 0;
            e.x = clamp(e.x, 16, ARENA_W - 16);
            e.y = clamp(e.y, 16, ARENA_H - 16);
            continue;
          }
          break;
        }
        case 'boss': {
          this.updateBoss(e, dt, d);
          break;
        }
        default:
          break;
      }

      // 词缀：狂暴（低血加速）
      const enrage = e.affix === 'rage' && e.hp < e.maxHp * 0.5 ? e.enrageMul || 1.35 : 1;
      const vx = Math.cos(targetAngle) * spd * enrage;
      const vy = Math.sin(targetAngle) * spd * enrage;
      // 敌人间简单分离（避免完全重叠成一条线）
      e.x += vx * dt;
      e.y += vy * dt;
      e.x = clamp(e.x, 12, ARENA_W - 12);
      e.y = clamp(e.y, 12, ARENA_H - 12);

      // 词缀：召唤
      if (e.summonEvery > 0) {
        e.summonCd -= dt;
        if (e.summonCd <= 0) {
          e.summonCd = e.summonEvery;
          const req = { kind: 'shanxiao', tier: e.tier, x: e.x + (this.rng.next() - 0.5) * 40, y: e.y + (this.rng.next() - 0.5) * 40 };
          this.spawnEnemyFrom(req);
        }
      }

      // 接触伤害（走统一的"近战轮空"入口，避免同屏兽潮叠加融化玩家）
      const rr = e.radius + p.radius;
      const d2 = dist2(e.x, e.y, p.x, p.y);
      if (d2 <= rr * rr) {
        // 敌人不许"穿进"玩家身体里。没有这一步时，相柳（半径 58）会直接压在
        // 玩家身上（实测最小距离 27px），半径 98 的环绕刃整圈落在它体内，
        // 近战武器对 Boss 的伤害趋近于零 —— 这是"山魄永远打不死相柳"的根因。
        // 按 0.9 倍半径推开：保留"被贴住"的压迫感，但把身体挡在外面。
        const sep = rr * 0.9;
        const d = Math.sqrt(d2);
        if (d < sep) {
          const nx = d > 0.001 ? (e.x - p.x) / d : Math.cos(e.angle || 0);
          const ny = d > 0.001 ? (e.y - p.y) / d : Math.sin(e.angle || 0);
          const push = sep - d;
          e.x += nx * push;
          e.y += ny * push;
          e.x = clamp(e.x, 12, ARENA_W - 12);
          e.y = clamp(e.y, 12, ARENA_H - 12);
        }
        hurtByContact(this, e);
      }
    }
  }

  updateBoss(boss, dt, distToPlayer) {
    const phases = BOSS.phases;
    const pct = boss.hp / boss.maxHp;
    // 阶段判定：取第一个"当前血量还没到它的门槛"的阶段（phases[0].at = 1，永远成立）。
    // 从高到低遍历会把结果覆盖回第 0 阶段 —— 那是个曾经真实存在的 bug。
    let phase = 0;
    for (let i = 0; i < phases.length; i++) {
      if (pct > phases[i].at) break;
      phase = i;
    }
    if (phase !== this.bossState.phase) {
      this.bossState.phase = phase;
      this.bossState.heads = phases[phase].heads;
      this.hint(`相柳 · ${phases[phase].name}`);
      this.shake = Math.max(this.shake, 9);
    }
    this.bossState.hpPct = pct;
    const cfg = phases[phase];
    const p = this.player;
    // 行为：中距离绕圈 + 周期性环形弹幕
    const want = 300;
    const dx = p.x - boss.x;
    const dy = p.y - boss.y;
    const ang = Math.atan2(dy, dx);
    const tangent = ang + (boss.id % 2 ? Math.PI / 2 : -Math.PI / 2);
    const radialSign = distToPlayer < want ? -1 : 1;
    const sp = boss.speed;
    boss.x += (Math.cos(ang) * radialSign * 0.6 + Math.cos(tangent) * 0.8) * sp * dt;
    boss.y += (Math.sin(ang) * radialSign * 0.6 + Math.sin(tangent) * 0.8) * sp * dt;
    boss.x = clamp(boss.x, 60, ARENA_W - 60);
    boss.y = clamp(boss.y, 60, ARENA_H - 60);

    boss.fireCd = (boss.fireCd || 0) - dt;
    if (boss.fireCd <= 0) {
      boss.fireCd = cfg.fireEvery;
      const offset = this.rng.next() * TAU;
      const n = cfg.bullets;
      for (let i = 0; i < n; i++) {
        const a = offset + (i / n) * TAU;
        this.spawnEnemyBullet(boss, a, cfg.bulletSpeed, cfg.bulletDamage, 'bossOrb');
      }
      // 每 3 个弹幕轮次加一次瞄准扇形
      boss.volley = (boss.volley || 0) + 1;
      if (boss.volley % 3 === 0) {
        for (let i = -2; i <= 2; i++) {
          this.spawnEnemyBullet(boss, ang + i * 0.16, cfg.bulletSpeed * 1.25, cfg.bulletDamage, 'bossArrow');
        }
      }
    }
    // 冲锋撞击
    boss.chargeCd = (boss.chargeCd || 0) - dt;
    if (boss.chargeCd <= 0 && distToPlayer < 420) {
      boss.chargeCd = cfg.chargeEvery;
      const kx = Math.cos(ang);
      const ky = Math.sin(ang);
      let traveled = 0;
      const step = 14;
      while (traveled < 240) {
        traveled += step;
        const tx = boss.x + kx * traveled;
        const ty = boss.y + ky * traveled;
        if (tx < 40 || tx > ARENA_W - 40 || ty < 40 || ty > ARENA_H - 40) break;
        if (dist2(tx, ty, p.x, p.y) <= (boss.radius + p.radius) * (boss.radius + p.radius)) {
          hurtByContact(this, boss, { iframeMs: 900 });
          break;
        }
      }
    }
  }

  spawnEnemyBullet(from, angle, speed, damage, pattern = 'dot') {
    if (this.enemyBullets.length >= CAP_ENEMY_BULLETS) return null;
    const b = this.bullets.spawn();
    if (!b) return null;
    b.id = this.nextId();
    b.owner = 'enemy';
    b.weaponId = 'enemy';
    b.x = from.x;
    b.y = from.y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.speed = speed;
    b.radius = pattern === 'bossOrb' ? 8 : 5;
    b.damage = damage;
    b.pierce = 0;
    b.hits = 0;
    b.life = 0;
    b.maxLife = 9;
    b.homing = 0;
    b.split = 0;
    b.splitDepth = 0;
    b.dot = 0;
    b.knockback = 0;
    b.crit = false;
    b.shape = pattern;
    b.color = pattern === 'bossOrb' ? '#ffd27f' : '#ff8a8a';
    b.boomerang = false;
    b.hitIds = null;
    this.enemyBullets.push(b);
    return b;
  }

  // ---------------- 武器 ----------------

  refreshWeaponEntities() {
    // 环绕刃
    const orbitWeapons = this.slots.weapons.filter((w) => WEAPON_BY_ID[w.id] && WEAPON_BY_ID[w.id].kind === 'orbit');
    const wantBlades = orbitWeapons.reduce((n, w) => n + this.weaponCount(w), 0);
    const cur = this.orbitBlades.active.length;
    if (wantBlades <= 0) {
      this.orbitBlades.clear();
    } else {
      while (this.orbitBlades.active.length < wantBlades) {
        if (!this.orbitBlades.spawn()) break;
      }
      while (this.orbitBlades.active.length > wantBlades) this.orbitBlades.releaseAt(this.orbitBlades.active.length - 1);
      let i = 0;
      for (const w of orbitWeapons) {
        const n = this.weaponCount(w);
        const st = levelStats(WEAPON_BY_ID[w.id], w.level);
        const sup = w.superId ? FUSION_BY_ID[w.superId] : null;
        for (let k = 0; k < n; k++) {
          const blade = this.orbitBlades.active[i++];
          if (!blade) break;
          blade.id = blade.id || this.nextId();
          blade.ownerWeapon = w.id;
          blade.count = n;
          blade.radius = (st.radius || 70) * this.stats.area;
          blade.damage = this.weaponDamage(w, st.damage);
          blade.width = 9;
          blade.height = (st.size || 30) * (sup && sup.mods.sizeMul ? 1 : 1);
          // 每片刃自己的击退：武器基础 + 角色被动 + 超武附加
          blade.knockback = (st.knockback || 0) + (sup && sup.mods.knockback ? sup.mods.knockback : 0);
          blade.color = sup ? '#ffd27f' : '#e8e2d0';
        }
      }
    }
    // 召唤物数量对齐
    const summonWeapons = this.slots.weapons.filter((w) => WEAPON_BY_ID[w.id] && WEAPON_BY_ID[w.id].kind === 'summon');
    const wantMinions = summonWeapons.reduce((n, w) => n + (w.superId ? (FUSION_BY_ID[w.superId].mods.heads || 1) : this.weaponCount(w)), 0);
    // 百巫的巫影也住在 minions 池里，但数量由 updatePlague 按等级管理（还包含 Lv5 的分裂），
    // 这里如果按"召唤武器数 = 0"去裁剪，会把它们全部抹掉 —— 所以这时不动这个池。
    if (!this.plagueActive()) {
      while (this.minions.active.length > wantMinions) this.minions.releaseAt(this.minions.active.length - 1);
    }
  }

  /** 当前合体的终极是不是「百巫夜行」（巫影住在 minions 池里）*/
  plagueActive() {
    if (!this.fusedWeapon) return false;
    const u = ULTIMATE_FUSIONS.find((x) => x.id === this.fusedWeapon);
    if (!u) return false;
    const def = WEAPON_BY_ID[u.weaponId];
    return !!def && def.kind === 'plague';
  }

  weaponCount(slot) {
    const def = WEAPON_BY_ID[slot.id];
    if (!def) return 0;
    const st = levelStats(def, slot.level);
    // 基础弹道数（武器等级表） + 超武倍率 + **弹道数通道**
    // ⚠️ 曾经这里漏了 this.stats.projCount，导致「九尾尾」这类被动
    // 对任何武器都不生效（通道装了等于没装）。
    let n = (st.count || 1) + Math.round(this.stats.projCount || 0);
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    if (sup && sup.mods && sup.mods.countMul) n = Math.round(n * sup.mods.countMul);
    return Math.max(1, n);
  }

  weaponDamage(slot, baseDamage) {
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    let dmg = baseDamage * (1 + this.stats.damage);
    if (sup && sup.mods) {
      if (sup.mods.damage) dmg *= 1 + sup.mods.damage;
      if (sup.mods.sizeMul) dmg *= sup.mods.sizeMul;
      if (sup.mods.durationMul) dmg *= Math.sqrt(sup.mods.durationMul);
    }
    // 调参面板的伤害倍率（默认 1 = 不参与，正式包行为不变）
    if (this.damageMul && this.damageMul !== 1) dmg *= this.damageMul;
    return dmg;
  }

  weaponAreaMul() {
    return this.stats.area;
  }

  updateWeaponEntities(dt) {
    // 环绕刃：角函数驱动，不创建投射物实体（规格 §4 武器 ①）。
    // 所有刃共用同一个角度 + 渲染/判定时按索引均匀分布 —— 绝不能逐片 `b.angle += x`
    // （那样每片都会在上一片的基础上再加一次，N 片刃会全部叠在同一个角度上）。
    const blades = this.orbitBlades.active;
    if (blades.length > 0) {
      const speed = 2.1 + this.stats.fireRate * 0.25;
      const spin = blades[0].angle + speed * dt;
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        b.angle = spin;
        if (b.hitCd > 0) b.hitCd -= dt;
      }
      this.orbitDamage(dt);
    }
    // 召唤物
    const mins = this.minions.active;
    for (let i = 0; i < mins.length; i++) {
      const m = mins[i];
      if (m.hitFlash > 0) m.hitFlash -= dt;
      m.life -= dt;
      if (m.life <= 0) continue;
      const target = this.enemyHash.nearest(m.x, m.y, 900, (e) => e.__alive);
      if (target) {
        const a = angleTo(m.x, m.y, target.x, target.y);
        m.facing = a;
        const sp = m.speed;
        if (dist2(m.x, m.y, target.x, target.y) > (m.radius + target.radius) * (m.radius + target.radius)) {
          m.x += Math.cos(a) * sp * dt;
          m.y += Math.sin(a) * sp * dt;
        }
        m.attackCd -= dt;
        if (m.attackCd <= 0 && dist2(m.x, m.y, target.x, target.y) <= Math.pow(m.radius + target.radius + 10, 2)) {
          m.attackCd = 0.6;
          if (m.plague) {
            // 百巫的巫影：接触时上蛊毒标记（层数 0 = 巫影直接上的）+ **一点直接伤害**。
            // 平衡规格 §2②：巫影以前 damage 恒为 0，导致传染链点不着火（等不到第一滴血）。
            // 直接伤害只是"点火"，主力仍是蛊毒 DoT 与死亡毒雾。
            this.applyMark(target, m.markStacks || 1, 0, m.plagueDps || 0);
            if (m.damage > 0) dealDamage(this, target, m.damage, { source: 'minion' });
            spawnParticles(this, target.x, target.y, 3, '#8ff0dd');
          } else {
            dealDamage(this, target, m.damage, { source: 'minion' });
            spawnParticles(this, target.x, target.y, 3, '#c39bf0');
          }
        }
      }
    }
  }

  orbitDamage(dt) {
    const blades = this.orbitBlades.active;
    if (blades.length === 0) return;
    const p = this.player;
    // 命中位置必须与渲染位置用同一套算法（render/orbit-view.js），
    // 否则会出现"看着刃扫过去了却没伤害"或反过来。
    const positions = bladePositions(p, blades);
    for (let i = 0; i < positions.length; i++) {
      const blade = blades[i];
      if (blade.hitCd > 0) continue;
      const pos = positions[i];
      const reach = pos.height * 0.5 + 4;
      // 不能复用 this.queryBuf：下面的伤害/击杀会再次查询并覆写它
      const cand = this.enemyHash.query(pos.x, pos.y, reach + 12, []);
      for (let k = 0; k < cand.length; k++) {
        const e = cand[k];
        if (!e.__alive) continue;
        if (!bladeHitsPoint(pos, e.x, e.y, meleeRadiusOf(e))) continue;
        // 0.14s：贴身怪"蹭一次就走"的间隔。原来 0.26s 时，刃扫过半径 58 的相柳
        // 只能结算 1 次，单体 DPS 被压到 ~60，山魄因此永远打不完 Boss（实测 150s 只掉 13%）。
        blade.hitCd = 0.14;
        dealDamage(this, e, blade.damage, { source: 'orbit' });
        this.knockbackEnemy(e, pos.angle, (blade.knockback || 0) + this.stats.knockback * 0.35);
        this.emitHit(e, { x: pos.x, y: pos.y, angle: pos.angle, weaponId: blade.ownerWeapon });
        break;
      }
    }
  }

  updateWeapons(dt) {
    for (const slot of this.slots.weapons) {
      const def = WEAPON_BY_ID[slot.id];
      if (!def) continue;
      const st = levelStats(def, slot.level);
      if (def.kind === 'orbit') continue; // 环绕由 updateWeaponEntities 处理
      if (this.isUltimateKind(def.kind)) continue; // 合体终极由 updateUltimates 推进
      slot.cd -= dt;
      if (slot.cd > 0) continue;
      const rate = Math.max(0.2, this.stats.fireRate);
      slot.cd = Math.max(0.08, (st.cd || 1) / rate);
      this.fireWeapon(slot, def, st);
    }
  }

  fireWeapon(slot, def, st) {
    const p = this.player;
    switch (def.kind) {
      case 'projectile':
        this.fireProjectileWeapon(slot, def, st);
        break;
      case 'boomerang':
        this.fireBoomerang(slot, def, st);
        break;
      case 'sweep':
        this.fireSweep(slot, def, st);
        break;
      case 'beam':
        this.fireBeam(slot, def, st);
        break;
      case 'strike':
        this.fireStrike(slot, def, st);
        break;
      case 'zone':
        this.fireZone(slot, def, st);
        break;
      case 'summon':
        this.fireSummon(slot, def, st);
        break;
      case 'aura':
        this.fireAura(slot, def, st);
        break;
      case 'charge':
        this.fireCharge(slot, def, st);
        break;
      default:
        break;
    }
  }

  /** 命中时钩子：让每把武器立即开火一次（不消耗常规冷却，但受极短节流保护） */
  refireOnce() {
    const now = this.elapsedMs;
    if (!this._refireAt) this._refireAt = [];
    for (let i = 0; i < this.slots.weapons.length; i++) {
      if (now < (this._refireAt[i] || 0)) continue;
      this._refireAt[i] = now + 320;
      const slot = this.slots.weapons[i];
      const def = WEAPON_BY_ID[slot.id];
      if (!def || def.kind === 'orbit') continue;
      if (this.isUltimateKind(def.kind)) continue; // 合体终极不吃"命中回响"
      this.fireWeapon(slot, def, levelStats(def, slot.level));
    }
  }

  aimAngle() {    // 自动开火：优先瞄最近的敌人，没有敌人时朝移动方向
    const p = this.player;
    const t = this.enemyHash.nearest(p.x, p.y, 700, (e) => e.__alive);
    if (t) return angleTo(p.x, p.y, t.x, t.y);
    return this.moveAngle;
  }

  fireProjectileWeapon(slot, def, st) {
    const p = this.player;
    const count = this.weaponCount(slot);
    const base = st.count || 1;
    const extra = count - base; // 弹道数通道/被动带来的额外弹道
    // 追踪通道让"瞄准方向本身就偏一点"：即使是不追踪的武器，
    // 高的追踪强度也会让它更贴脸打——这是"通道全局生效"的一部分。
    const home = (def.homing || 0) + this.stats.homing;
    const aim = this.aimAngle() + (home > 0 ? Math.min(0.45, home * 0.02) : 0);
    const spread = ((st.spread || 0) * Math.PI) / 180;
    const total = base + extra;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    for (let i = 0; i < total; i++) {
      const t = total === 1 ? 0 : i / (total - 1) - 0.5;
      const a = def.pattern === 'aimed' ? aim : aim + t * spread * 2;
      this.spawnPlayerBullet({
        x: p.x + Math.cos(a) * 14,
        y: p.y + Math.sin(a) * 14,
        angle: a,
        speed: (st.speed || 400) * this.stats.projSpeed,
        damage: this.weaponDamage(slot, st.damage),
        radius: (st.size || 7) * this.stats.area,
        // 穿透现在是全局通道：所有投射物都吃
        pierce: this.stats.pierce + ((sup && sup.mods && sup.mods.pierce) || 0),
        homing: home,
        splash: (sup && sup.mods && sup.mods.splash) || st.splash || 0,
        weaponId: slot.id,
        shape: def.pattern === 'aimed' ? 'orb' : 'scale',
        color: sup ? '#ffe6a3' : (this.series === 'hai' ? '#7fd6ee' : '#d8c8a0'),
        split: (sup && sup.mods && sup.mods.split) || 0,
        dot: this.stats.dot,
        mark: st.mark || 0,
      });
    }
  }

  fireBoomerang(slot, def, st) {
    const p = this.player;
    const count = this.weaponCount(slot);
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const sizeMul = sup && sup.mods.sizeMul ? sup.mods.sizeMul : 1;
    for (let i = 0; i < count; i++) {
      // 回旋镖也吃弹速通道（飞行速度）；攻击距离吃范围通道
      const a = this.aimAngle() + (i - (count - 1) / 2) * 0.32;
      const b = this.spawnPlayerBullet({
        x: p.x,
        y: p.y,
        angle: a,
        speed: (st.speed || 400) * this.stats.projSpeed,
        damage: this.weaponDamage(slot, st.damage),
        radius: (st.size || 12) * sizeMul * Math.sqrt(this.stats.area),
        pierce: sup && sup.mods.pierce ? sup.mods.pierce : this.stats.pierce + 99,
        homing: this.stats.homing * 0.5,
        weaponId: slot.id,
        shape: 'boomerang',
        color: sup ? '#e0d3ff' : '#e8e2d0',
        dot: this.stats.dot,
      });
      if (b) {
        b.boomerang = true;
        b.originX = p.x;
        b.originY = p.y;
        b.range = (st.range || 240) * this.stats.area;
        b.returnSpeed = (st.speed || 400) * 1.15 * this.stats.projSpeed;
        b.spin = 0;
        b.boomPhase = 0;
        b.maxLife = 6;
      }
    }
  }

  fireSweep(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    // 横扫属于"范围型"：半径吃范围通道；追踪通道让扇形自动修正朝向
    const homeFix = this.stats.homing > 0 ? Math.min(0.4, this.stats.homing * 0.02) : 0;
    let radius = (st.radius || 100) * this.stats.area;
    if (sup && sup.mods.radiusFromSpeed) {
      radius *= 1 + (this.stats.speed / PLAYER_BASE.speed - 1) * sup.mods.radiusFromSpeed;
    }
    const arc = ((st.arc || 110) * Math.PI) / 180 * (sup && sup.mods.arcMul ? sup.mods.arcMul : 1);
    const aim = this.aimAngle() + homeFix;
    const times = this.weaponCount(slot);
    for (let n = 0; n < times; n++) {
      const a = aim + (n === 0 ? 0 : Math.PI); // 第 2 次横扫反向补一刀
      const cand = this.enemyHash.query(p.x, p.y, radius + 30, this.queryBuf);
      for (let i = 0; i < cand.length; i++) {
        const e = cand[i];
        if (!e.__alive) continue;
        const ea = angleTo(p.x, p.y, e.x, e.y);
        let diff = Math.abs(((ea - a + Math.PI * 3) % TAU) - Math.PI);
        if (diff > arc / 2) continue;
        const rr = e.radius + radius;
        if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
        dealDamage(this, e, this.weaponDamage(slot, st.damage), { source: 'sweep' });
        this.knockbackEnemy(e, ea, (st.knockback || 0) + this.stats.knockback);
        if (this.stats.dot > 0) {
          e.burnDps = Math.max(e.burnDps, Math.min(26, this.stats.dot));
          e.burnUntil = this.elapsedMs + 2000;
        }
        this.emitHit(e, { x: e.x, y: e.y, angle: ea, weaponId: slot.id });
      }
      // 视觉：一次扇形扫击
      const fx = this.beams.spawn();
      if (fx) {
        fx.id = this.nextId();
        fx.ownerWeapon = slot.id;
        fx.x = p.x;
        fx.y = p.y;
        fx.angle = a;
        fx.length = radius;
        fx.width = arc * radius * 0.5;
        fx.damage = 0;
        fx.dps = 0;
        fx.life = 0.16;
        fx.maxLife = 0.16;
        fx.color = sup ? '#ffd27f' : '#f0b357';
        fx.sweepArc = arc;
      }
    }
    this.shake = Math.max(this.shake, 2);
  }

  fireBeam(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const width = (st.width || 24) * (sup && sup.mods.widthMul ? sup.mods.widthMul : 1) * this.stats.area;
    // 持续时间吃射速通道（射速对所有武器生效），但封顶防止无限场
    const duration = (st.duration || 0.3) * (sup && sup.mods.durationMul ? sup.mods.durationMul : 1) * Math.min(1.8, this.stats.fireRate);
    const length = (st.length || 560) * this.stats.area;
    const aim = this.aimAngle() + (this.stats.homing > 0 ? Math.min(0.4, this.stats.homing * 0.02) : 0);
    const bm = this.beams.spawn();
    if (!bm) return;
    bm.id = this.nextId();
    bm.ownerWeapon = slot.id;
    bm.x = p.x;
    bm.y = p.y;
    bm.angle = aim;
    bm.length = length;
    bm.width = width;
    bm.damage = 0;
    bm.dps = this.weaponDamage(slot, st.damage) * 6 + this.stats.dot * 3; // 光束按 DPS 结算
    bm.life = duration;
    bm.maxLife = duration;
    bm.pierce = 99;
    bm.color = sup ? '#bfe9ff' : '#8fd8ff';
    bm.beamTick = 0;
    this.shake = Math.max(this.shake, 3);
  }

  fireStrike(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const count = this.weaponCount(slot);
    const radius = (st.radius || 46) * this.stats.area * (sup && sup.mods.radiusMul ? sup.mods.radiusMul : 1);
    const chain = sup && sup.mods.chain ? sup.mods.chain : 0;
    // 落雷也吃追踪通道：追踪越强，索敌距离越远（更容易落到"该落的地方"）
    const seekRange = 620 + this.stats.homing * 25;
    for (let i = 0; i < count; i++) {
      let tx;
      let ty;
      if (i === 0) {
        const t = this.enemyHash.nearest(p.x, p.y, seekRange, (e) => e.__alive && e.kind !== 'bifang');
        const target = t || this.enemyHash.nearest(p.x, p.y, seekRange, (e) => e.__alive);
        if (target) {
          tx = target.x;
          ty = target.y;
        } else {
          const a = this.aimAngle();
          tx = p.x + Math.cos(a) * 260;
          ty = p.y + Math.sin(a) * 260;
        }
      } else {
        const others = this.enemyHash.query(p.x, p.y, seekRange, this.queryBuf).filter((e) => e.__alive);
        if (others.length === 0) continue;
        const pick = others[Math.floor(this.rng.next() * others.length)];
        tx = pick.x + (this.rng.next() - 0.5) * 60;
        ty = pick.y + (this.rng.next() - 0.5) * 60;
      }
      const z = this.zones.spawn();
      if (!z) return;
      z.id = this.nextId();
      z.kind = 'warning';
      z.owner = 'player';
      z.x = clamp(tx, 10, ARENA_W - 10);
      z.y = clamp(ty, 10, ARENA_H - 10);
      z.radius = radius;
      z.damage = 0;
      z.dps = 0;
      z.strikeDamage = this.weaponDamage(slot, st.damage);
      z.delay = st.delay || 0.45;
      z.warnTotal = z.delay; // 渲染预警进度用（不能从 maxLife 反推，会算出负数半径）
      z.life = 0.5 + (st.delay || 0.45);
      z.maxLife = z.life;
      z.color = sup ? '#ffe08a' : '#c39bf0';
      z.chain = chain;
      z.weaponId = slot.id;
      z.mark = st.mark || 0;
      z.strikeRadius = radius;
    }
  }

  fireZone(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const count = this.weaponCount(slot);
    const radius = (st.radius || 60) * this.stats.area * (sup && sup.mods.radiusMul ? sup.mods.radiusMul : 1);
    // 毒雾也吃追踪通道：追踪越强，越会主动往敌人脚下丢
    const seek = 520 + this.stats.homing * 20;
    for (let i = 0; i < count; i++) {
      let tx = p.x + (this.rng.next() - 0.5) * 220;
      let ty = p.y + (this.rng.next() - 0.5) * 220;
      const t = this.enemyHash.nearest(p.x, p.y, seek, (e) => e.__alive);
      if (t && i === 0) {
        tx = t.x;
        ty = t.y;
      }
      const z = this.zones.spawn();
      if (!z) return;
      z.id = this.nextId();
      z.kind = 'poison';
      z.owner = 'player';
      z.x = clamp(tx, 20, ARENA_W - 20);
      z.y = clamp(ty, 20, ARENA_H - 20);
      z.radius = radius;
      // 毒雾：伤害吃"武器伤害 + 持续伤害通道"，并且持续伤害通道让区域 tick 更快
      // （火Rate 通道对所有武器生效 → 毒雾的跳伤频率也吃射速）
      z.dps = (this.weaponDamage(slot, st.damage) + this.stats.dot) * Math.min(2, this.stats.fireRate);
      z.damage = 0;
      z.life = (st.duration || 3.5) * Math.min(1.6, this.stats.fireRate);
      z.maxLife = z.life;
      z.delay = 0;
      z.tick = 0;
      z.spread = !!(sup && sup.mods.spread);
      // 牵引（风暴类）：每 tick 把范围内的敌人往中心拉
      z.pull = (st.pull || 0) * (sup && sup.mods.pullMul ? sup.mods.pullMul : 1);
      z.color = sup ? '#ff8a5a' : '#9be08a';
      z.weaponId = slot.id;
    }
  }

  /**
   * 领域（aura）：以玩家为中心常驻的持续伤害圈。
   * 用 kind:'aura' 的 zone 实现（followPlayer = true），
   * 每次"开火"只负责按 tick 间隔结算伤害，不产生投射物实体。
   */
  fireAura(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const radius = (st.radius || 90) * this.stats.area * (sup && sup.mods.radiusMul ? sup.mods.radiusMul : 1);
    const dps = this.weaponDamage(slot, st.dps || 10);
    const mark = st.mark || 0;
    const cand = this.enemyHash.query(p.x, p.y, radius, []);
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (!e.__alive) continue;
      const rr = e.radius + radius;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
      dealDamage(this, e, dps, { source: 'aura' });
      if (!e.__alive) continue;
      if (this.stats.dot > 0) {
        e.burnDps = Math.max(e.burnDps, this.stats.dot * 0.5);
        e.burnUntil = this.elapsedMs + 1500;
      }
      if (mark > 0) this.applyMark(e, mark);
      this.emitHit(e, { x: e.x, y: e.y, angle: 0, weaponId: slot.id });
    }
  }

  /**
   * 蓄力穿透（charge）：新机制原型。
   * 武器按 cd 蓄力，蓄满后射出一道贯穿全场的光束（伤害吃蓄力时长）。
   */
  fireCharge(slot, def, st) {
    const p = this.player;
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const width = (st.width || 30) * this.stats.area * (sup && sup.mods.widthMul ? sup.mods.widthMul : 1);
    const length = (st.length || 1200) * this.stats.area;
    // 蓄力完成度：charge 越长，这一击越重（用"蓄力比"体现，不引入新通道）
    const chargeRatio = 1 + (st.charge || 1) * 0.25 * (sup && sup.mods.chargeMul ? sup.mods.chargeMul : 1);
    const aim = this.aimAngle();
    const bm = this.beams.spawn();
    if (bm) {
      bm.id = this.nextId();
      bm.ownerWeapon = slot.id;
      bm.x = p.x;
      bm.y = p.y;
      bm.angle = aim;
      bm.length = length;
      bm.width = width;
      bm.damage = 0;
      bm.dps = this.weaponDamage(slot, st.damage) * chargeRatio * 1.6;
      bm.life = 0.5;
      bm.maxLife = 0.5;
      bm.pierce = 99;
      bm.charge = true;
      bm.color = sup ? '#fff0b0' : '#ffd27f';
      bm.beamTick = 0;
    }
    // 蓄力重击带一次屏震与视觉冲击
    this.shake = Math.max(this.shake, 7);
    spawnParticles(this, p.x, p.y, 10, '#ffe08a');
  }

  /**
   * 诅咒 / 蛊毒标记：被标记的敌人受到额外伤害（每层 +12%，最多 3 层）。
   * `depth` 是**百巫传染链的层数**（可选）：巫影直接上的是 0，每经一次爆毒 +1，
   * 超过终极武器自己的上限就断链（防止无限递归）。
   */
  applyMark(enemy, stacks, depth, dps) {
    enemy.mark = Math.max(enemy.mark || 0, stacks);
    enemy.markUntil = this.elapsedMs + MARK_LIFE_MS;
    if (depth !== undefined) {
      const d = depth | 0;
      if (enemy.plagueDepth === undefined || enemy.plagueDepth < 0 || d < enemy.plagueDepth) {
        enemy.plagueDepth = d;
      }
      // 蛊毒发作：上了标记就持续掉血（后续刷新只延长，不叠加，避免多层指数化）
      if (dps > 0) {
        enemy.plagueDps = Math.max(enemy.plagueDps || 0, dps);
        // 与 markUntil 同寿命：否则会出现"标记还在、毒却先停了"的错位
        enemy.plagueUntil = Math.max(enemy.plagueUntil || 0, enemy.markUntil);
      }
    }
  }

  fireSummon(slot, def, st) {
    const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
    const count = this.weaponCount(slot);
    const heads = sup && sup.mods.heads ? sup.mods.heads : 1;
    const p = this.player;
    const total = Math.min(count, CAP_MINIONS - this.minions.active.length);
    for (let i = 0; i < total; i++) {
      const m = this.minions.spawn();
      if (!m) return;
      m.id = this.nextId();
      const a = this.weaponIdAngle(slot.id) + (i / Math.max(1, total)) * TAU;
      m.x = p.x + Math.cos(a) * 40;
      m.y = p.y + Math.sin(a) * 40;
      m.vx = 0;
      m.vy = 0;
      // 召唤物吃召唤强度；体型吃范围通道、移速吃移速通道（通道全局生效的一部分）
      m.maxHp = (st.hp || 40) * this.stats.summonPower * (sup && sup.mods.hpMul ? sup.mods.hpMul : 1);
      m.hp = m.maxHp;
      m.damage = this.weaponDamage(slot, st.damage) * this.stats.summonPower * heads;
      m.radius = 12 * Math.min(1.8, Math.sqrt(this.stats.area));
      m.speed = (st.speed || 170) * Math.min(1.6, this.stats.speed / PLAYER_BASE.speed);
      m.life = st.life || 10;
      m.maxLife = m.life;
      m.targetId = 0;
      m.attackCd = 0;
      m.heads = heads;
      m.hitFlash = 0;
    }
  }

  weaponIdAngle(weaponId) {
    let i = 0;
    for (const w of this.slots.weapons) {
      if (w.id === weaponId) break;
      i++;
    }
    return (i / 3) * TAU;
  }

  spawnPlayerBullet(o) {
    if (this.playerBullets.length >= CAP_PLAYER_BULLETS) return null;
    const b = this.bullets.spawn();
    if (!b) return null;
    b.id = this.nextId();
    b.owner = 'player';
    b.weaponId = o.weaponId || null;
    b.x = o.x;
    b.y = o.y;
    const speed = o.speed || 400;
    b.vx = Math.cos(o.angle) * speed;
    b.vy = Math.sin(o.angle) * speed;
    b.speed = speed;
    b.radius = o.radius || 6;
    b.damage = o.damage || 1;
    b.pierce = o.pierce || 0;
    b.hits = 0;
    b.life = 0;
    b.maxLife = o.maxLife || 2.6;
    b.homing = o.homing || 0;
    b.split = o.split || 0;
    b.splitDepth = o.splitDepth || 0;
    b.dot = o.dot || 0;
    b.knockback = o.knockback || 0;
    b.crit = false;
    b.color = o.color || '#fff';
    b.shape = o.shape || 'dot';
    b.boomerang = false;
    b.splash = o.splash || 0;
    b.angle = o.angle;
    b.mark = o.mark || 0;
    b.hitIds = [];
    this.playerBullets.push(b);
    return b;
  }

  // ---------------- 子弹 ----------------

  updatePlayerBullets(dt) {
    const list = this.playerBullets;
    const arenaPad = 60;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (!b.__alive) {
        list.splice(i, 1);
        continue;
      }
      b.life += dt;
      // 追踪
      if (b.homing > 0) {
        const t = this.enemyHash.nearest(b.x, b.y, 420, (e) => e.__alive);
        if (t) {
          const want = angleTo(b.x, b.y, t.x, t.y);
          const cur = Math.atan2(b.vy, b.vx);
          const na = turnToward(cur, want, b.homing, dt);
          b.vx = Math.cos(na) * b.speed;
          b.vy = Math.sin(na) * b.speed;
        }
      }
      // 回旋镖：飞出到 range 后折返玩家
      if (b.boomerang) {
        b.spin += dt * 14;
        if (b.boomPhase === 0) {
          const traveled = Math.hypot(b.x - b.originX, b.y - b.originY);
          if (traveled >= (b.range || 240)) b.boomPhase = 1;
        } else {
          const p = this.player;
          const a = angleTo(b.x, b.y, p.x, p.y);
          b.vx = Math.cos(a) * b.returnSpeed;
          b.vy = Math.sin(a) * b.returnSpeed;
          if (dist2(b.x, b.y, p.x, p.y) < 26 * 26) {
            this.recycleBullet(b, i, list);
            continue;
          }
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // 生命与出界
      if (b.life >= b.maxLife || b.x < -arenaPad || b.x > ARENA_W + arenaPad || b.y < -arenaPad || b.y > ARENA_H + arenaPad) {
        this.recycleBullet(b, i, list);
        continue;
      }
      // 命中判定
      const cand = this.enemyHash.query(b.x, b.y, b.radius + 40, this.queryBuf);
      for (let k = 0; k < cand.length; k++) {
        const e = cand[k];
        if (!e.__alive) continue;
        if (b.hitIds && b.hitIds.indexOf(e.id) >= 0) continue;
        const rr = e.radius + b.radius;
        if (dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;
        const dealt = this.onBulletHit(b, e);
        if (dealt === null) {
          this.recycleBullet(b, i, list);
        }
        break;
      }
    }
  }

  /** 返回 null 表示子弹已耗尽（应回收） */
  onBulletHit(b, e) {
    if (b.hitIds) b.hitIds.push(e.id);
    const angle = Math.atan2(b.vy, b.vx);
    const dealt = dealDamage(this, e, b.damage, { source: b.weaponId === 'enemy' ? 'enemy' : 'bullet' });
    spawnParticles(this, b.x, b.y, 2, b.color);
    // 击退
    const kb = (b.knockback || 0) + this.stats.knockback;
    if (kb > 0 && e.__alive) this.knockbackEnemy(e, angle, kb);
    // 命中分裂（通道）
    const splits = (b.split || 0) + this.stats.split;
    if (splits > 0 && b.splitDepth < 1 && this.playerBullets.length < CAP_PLAYER_BULLETS) {
      for (let i = 0; i < splits; i++) {
        const a = angle + (i - (splits - 1) / 2) * 0.6 + Math.PI;
        this.spawnPlayerBullet({
          x: e.x,
          y: e.y,
          angle: a,
          speed: b.speed * 0.85,
          damage: b.damage * 0.55,
          radius: b.radius * 0.85,
          pierce: 0,
          homing: b.homing,
          splitDepth: b.splitDepth + 1,
          maxLife: 0.9,
          weaponId: b.weaponId,
          shape: 'shard',
          color: b.color,
        });
      }
    }
    // 溅射
    if (b.splash > 0) {
      const radius = b.splash * this.stats.area;
      this.aoeAt(b.x, b.y, radius, b.damage * 0.45, { source: 'splash', viaHook: true, hookId: HOOKS.ON_HIT, exclude: e.id });
    }
    // 命中时钩子
    this.emitHit(e, { x: b.x, y: b.y, angle, weaponId: b.weaponId });
    // 巫蛊标记：命中后给目标挂标记（灵山系）
    if (b.mark > 0 && e.__alive) this.applyMark(e, b.mark);
    // 穿透
    if (b.pierce > 0) {
      b.pierce -= 1;
      if (b.hits !== undefined) b.hits++;
      return dealt;
    }
    return null;
  }

  updateEnemyBullets(dt) {
    const list = this.enemyBullets;
    const p = this.player;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (!b.__alive) {
        list.splice(i, 1);
        continue;
      }
      b.life += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life >= b.maxLife || b.x < -40 || b.x > ARENA_W + 40 || b.y < -40 || b.y > ARENA_H + 40) {
        this.recycleBullet(b, i, list);
        continue;
      }
      // 昆仑终极「玉璧」：环带上的敌方子弹被**反弹成己方子弹**（换归属 + 换数组）
      if (this.bulwarkTryReflect(b)) {
        list.splice(i, 1);
        this.playerBullets.push(b);
        continue;
      }
      const rr = p.radius + b.radius;
      if (dist2(b.x, b.y, p.x, p.y) <= rr * rr) {
        hurtPlayer(this, b.damage);
        spawnParticles(this, b.x, b.y, 4, b.color);
        this.recycleBullet(b, i, list);
      }
    }
  }

  recycleBullet(b, i, list) {
    this.bullets.release(b);
    list.splice(i, 1);
  }

  // ---------------- 区域 / 光束 ----------------

  updateZones(dt) {
    const zones = this.zones.active;
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      z.life -= dt;
      if (z.delay > 0) {
        z.delay -= dt;
        if (z.delay <= 0) {
          // 落雷：一次性范围伤害
          if (z.strikeDamage > 0) {
            this.aoeAt(z.x, z.y, z.radius, z.strikeDamage, { source: 'strike', viaHook: true, hookId: HOOKS.ON_HIT });
            spawnParticles(this, z.x, z.y, 14, z.color);
            this.shake = Math.max(this.shake, 4);
            // 天罚轮转：雷击之后在落点留下**焦痕**（独立区域，与雷击伤害分开计算）
            if (z.scorch > 0) {
              const sz = this.zones.spawn();
              if (sz) {
                sz.id = this.nextId();
                sz.kind = 'scorch';
                sz.owner = 'player';
                sz.x = z.x;
                sz.y = z.y;
                sz.radius = z.scorchRadius;
                sz.dps = z.scorch;
                sz.damage = 0;
                sz.life = z.scorchLife;
                sz.maxLife = sz.life;
                sz.delay = 0;
                sz.tick = 0;
                sz.color = '#ff8a5a';
                sz.weaponId = z.weaponId;
              }
            }
            // 连锁（超武）
            if (z.chain > 0) {
              const cand = this.enemyHash.query(z.x, z.y, z.radius + 150, this.queryBuf).filter((e) => e.__alive);
              for (let c = 0; c < Math.min(z.chain, cand.length); c++) {
                const t = cand[c];
                const z2 = this.zones.spawn();
                if (!z2) break;
                z2.id = this.nextId();
                z2.kind = 'warning';
                z2.owner = 'player';
                z2.x = t.x;
                z2.y = t.y;
                z2.radius = z.radius * 0.7;
                z2.delay = 0.22;
                z2.warnTotal = 0.22;
                z2.life = 0.4;
                z2.maxLife = 0.4;
                z2.strikeDamage = z.strikeDamage * 0.6;
                z2.chain = 0;
                z2.color = z.color;
                z2.weaponId = z.weaponId;
              }
            }
          }
          if (z.knockback) {
            const cand = this.enemyHash.query(z.x, z.y, z.radius, this.queryBuf);
            for (const e of cand) {
              if (!e.__alive) continue;
              const a = angleTo(z.x, z.y, e.x, e.y);
              this.knockbackEnemy(e, a, z.knockback);
            }
          }
          if (z.dps <= 0 && !z.knockback) {
            this.zones.release(z);
            continue;
          }
        }
      } else if (z.dps > 0) {
        z.tick += dt;
        if (z.tick >= 0.4) {
          z.tick -= 0.4;
          const cand = this.enemyHash.query(z.x, z.y, z.radius, this.queryBuf);
          for (const e of cand) {
            if (!e.__alive) continue;
            const rr = e.radius + z.radius * 0.5;
            if (dist2(z.x, z.y, e.x, e.y) > rr * rr) continue;
            dealDamage(this, e, z.dps * 0.4, { source: 'dot', rollCrit: false, viaHook: true });
            // 立岩 / 裂地：圈（段）内敌人被**持续推向外侧**
            if (z.knockback) this.knockbackEnemy(e, angleTo(z.x, z.y, e.x, e.y), z.knockback * 0.4);
            if (!e.__alive) continue;
            // 毒雾只传染"标记"（放大器）与传染链层数，蛊毒 DoT 不再由它持续补
            if (z.mark > 0) this.applyMark(e, z.mark, z.plagueDepth >= 0 ? z.plagueDepth : undefined);
            // 牵引：把范围内的敌人往中心拉（风暴类区域）
            if (z.pull > 0) {
              const pa = angleTo(e.x, e.y, z.x, z.y);
              const pd = Math.hypot(e.x - z.x, e.y - z.y) || 1;
              if (pd > 6) {
                const step = Math.min(pd * 0.5, z.pull * 0.4);
                e.x += Math.cos(pa) * step;
                e.y += Math.sin(pa) * step;
              }
            }
            if (z.kind === 'poison') {
              // 延烧有上限：否则"自动烧全场 → 清怪回血"会形成站桩闭环
              e.burnDps = Math.max(e.burnDps, Math.min(26, this.stats.dot * 0.5));
              e.burnUntil = this.elapsedMs + 1500;
            }
          }
        }
      } else if (z.knockback) {
        z.tick += dt;
        if (z.tick >= 0.2) {
          z.tick = 0;
          const cand = this.enemyHash.query(z.x, z.y, z.radius, this.queryBuf);
          for (const e of cand) {
            if (!e.__alive) continue;
            const a = angleTo(z.x, z.y, e.x, e.y);
            this.knockbackEnemy(e, a, z.knockback);
          }
        }
      }
      if (z.life <= 0) {
        // 裂地：地裂到期**塌陷**（范围爆发）；Lv3 质变「牵引塌陷」把敌人拉进坑
        if (z.collapse > 0) {
          this.aoeAt(z.x, z.y, z.collapseRadius, z.collapse, { source: 'rift' });
          if (z.pull > 0) {
            const cand = this.enemyHash.query(z.x, z.y, z.collapseRadius + 80, this.queryBuf);
            for (const e of cand) {
              if (!e.__alive || e.isBoss) continue;
              const pa = angleTo(e.x, e.y, z.x, z.y);
              const pd = Math.hypot(e.x - z.x, e.y - z.y) || 1;
              const step = Math.min(pd, z.pull * 0.06);
              e.x += Math.cos(pa) * step;
              e.y += Math.sin(pa) * step;
            }
          }
          spawnParticles(this, z.x, z.y, 10, z.color);
        }
        this.zones.release(z);
      }
    }
  }

  updateBeams(dt) {
    const beams = this.beams.active;
    for (let i = beams.length - 1; i >= 0; i--) {
      const bm = beams[i];
      bm.life -= dt;
      if (bm.dps > 0) {
        bm.beamTick = (bm.beamTick || 0) + dt;
        if (bm.beamTick >= 0.1) {
          const step = bm.beamTick;
          bm.beamTick = 0;
          // 沿光束采样，命中直线上的敌人
          const steps = Math.ceil(bm.length / 40);
          const hitSet = [];
          for (let s = 1; s <= steps; s++) {
            const px = bm.x + Math.cos(bm.angle) * (s * 40);
            const py = bm.y + Math.sin(bm.angle) * (s * 40);
            const cand = this.enemyHash.query(px, py, bm.width * 0.5 + 24, this.queryBuf);
            for (const e of cand) {
              if (!e.__alive) continue;
              if (hitSet.indexOf(e.id) >= 0) continue;
              const rr = e.radius + bm.width * 0.5;
              if (dist2(px, py, e.x, e.y) > rr * rr) continue;
              hitSet.push(e.id);
              dealDamage(this, e, bm.dps * step, { source: 'beam', rollCrit: false, viaHook: true, hookId: HOOKS.ON_HIT });
            }
          }
        }
      }
      if (bm.life <= 0) this.beams.release(bm);
    }
  }

  // ---------------- 合体终极武器的机制（批 1 + 批 2） ----------------
  // 六种机制**两两不同**的判定形状（规格 §Testing 3）：
  //   rift     轨迹型   —— 沿移动轨迹留段，到期塌陷
  //   tide     往返环   —— 扩张后回卷收缩
  //   storm    移动轰炸带 —— 公转雷云 + 落点焦痕
  //   sunwheel 多光源扫射 —— 公转太阳数组 + 每轮持续光束 + 周期性齐射
  //   plague   传染型随从 —— 巫影（点火伤害）+ 蛊毒标记 + 死亡毒雾传染
  //   bulwark  反弹型护盾 —— 玉璧环反弹敌方子弹 + 持续回盾
  /**
   * 这六种终极**不是**"按冷却开火"的武器，而是每 tick 推进的世界状态，
   * 所以不进 updateWeapons 的开火循环（见 isUltimateKind）。
   */
  isUltimateKind(kind) {
    return kind === 'rift' || kind === 'tide' || kind === 'storm'
      || kind === 'sunwheel' || kind === 'plague' || kind === 'bulwark';
  }

  /** 当前合体出来的终极（未合体 = null） */
  ultimateDef() {
    if (!this.fusedWeapon) return null;
    const u = ULTIMATE_FUSIONS.find((x) => x.id === this.fusedWeapon);
    if (!u) return null;
    const def = WEAPON_BY_ID[u.weaponId];
    if (!def) return null;
    const slot = this.slots.weapons.find((w) => w.id === u.weaponId) || null;
    return { u, def, slot };
  }

  /** 合体瞬间初始化机制状态（避免继承上一把武器的残留） */
  initUltimateState() {
    this.ultRift = { x: 0, y: 0, primed: false, moved: 0 };
    this.ultTide = { timer: 0.25 };
    this.ultStorm = { timer: 0, clouds: [] };
    this.ultSun = { spin: 0, volleyTimer: 0.5, flash: 0 };
    this.ultPlague = { wraiths: 0 };
    this.ultBulwark = { active: false, angle: 0, angle2: 0, radius: 0, band: 0, innerCd: 0, reflectMul: 0, reflectPierce: 0, homing: 0, golden: false, rings: 1 };
    this.rings.clear();
    // 合体会把 4 把武器塌缩成 1 把：环绕刃与召唤物必须在同一帧清掉，
    // 否则它们会「无主地」继续输出（曾经表现为"零输入也掉血"）。
    this.orbitBlades.clear();
    this.minions.clear();
    this.bowReset();
  }

  updateUltimates(dt) {
    // 主动技的残留效果（位移伤害等）先推进
    this.updateSkillEffects(dt);
    // 拉弓发射（需要敌人哈希，所以放在这一步）
    if (this._bowShot) {
      const shot = this._bowShot;
      this._bowShot = null;
      this.fireBowArrow(shot.c, shot.angle);
    }
    const cur = this.ultimateDef();
    if (!cur || !cur.slot) {
      // 没合体（或合体的不是终极）时，把只在这几种机制里才有意义的开关关掉，
      // 否则残留状态会继续生效（例如玉璧环在合体被清掉后还在反弹子弹）。
      if (this.ultBulwark) this.ultBulwark.active = false;
      return;
    }
    const st = levelStats(cur.def, cur.slot.level);
    switch (cur.def.kind) {
      case 'rift':
        this.updateRift(dt, cur.slot, st);
        break;
      case 'tide':
        this.updateTide(dt, cur.slot, st);
        break;
      case 'storm':
        this.updateStorm(dt, cur.slot, st);
        break;
      case 'sunwheel':
        this.updateSunwheel(dt, cur.slot, st);
        break;
      case 'plague':
        this.updatePlague(dt, cur.slot, st);
        break;
      case 'bulwark':
        this.updateBulwark(dt, cur.slot, st);
        break;
      default:
        if (this.ultBulwark) this.ultBulwark.active = false;
        break;
    }
  }

  /**
   * 山经 · 不周崩 · 裂地。
   * 玩家**移动轨迹**上按固定间距留下地裂段；段内敌人被撕裂并被推离；
   * 地裂到期**塌陷**造成范围爆发。
   * **站着不动就没有输出** —— 这是刻意的：山经的身份是贴脸冲阵。
   */
  updateRift(dt, slot, st) {
    const p = this.player;
    const rt = this.ultRift;
    if (!rt.primed) {
      rt.x = p.x;
      rt.y = p.y;
      rt.primed = true;
      return;
    }
    const dx = p.x - rt.x;
    const dy = p.y - rt.y;
    const step = Math.hypot(dx, dy);
    const spacing = st.spacing || 46;
    if (step < spacing) return;
    const dirX = dx / step;
    const dirY = dy / step;
    const n = st.parallel || 1;
    for (let i = 0; i < n; i++) {
      // Lv5 质变「双裂缝并行」：第二条沿行进方向的垂线偏移
      const off = n > 1 ? (i === 0 ? -1 : 1) * (st.width || 30) * this.stats.area : 0;
      this.spawnRiftSegment(p.x - dirY * off, p.y + dirX * off, slot, st);
    }
    rt.x = p.x;
    rt.y = p.y;
    rt.moved += step;
  }

  spawnRiftSegment(x, y, slot, st) {
    const z = this.zones.spawn();
    if (!z) return;
    z.id = this.nextId();
    z.kind = 'rift';
    z.owner = 'player';
    z.x = clamp(x, 12, ARENA_W - 12);
    z.y = clamp(y, 12, ARENA_H - 12);
    z.radius = (st.width || 30) * this.stats.area;
    z.dps = this.weaponDamage(slot, st.dps || 20);
    z.damage = 0;
    z.life = st.life || 2.2;
    z.maxLife = z.life;
    z.delay = 0;
    z.tick = 0;
    // 推力方向 = 离开裂心
    z.knockback = (st.push || 240) + this.stats.knockback * 0.4;
    // 到期塌陷：范围爆发（Lv3 质变「牵引塌陷」把敌人拉进坑）
    z.collapse = this.weaponDamage(slot, st.collapse || 60);
    z.collapseRadius = (st.collapseRadius || 90) * this.stats.area;
    z.pull = st.pull || 0;
    z.color = '#f0b357';
    z.weaponId = slot.id;
  }

  /**
   * 海经 · 归墟潮 · 潮汐。
   * 周期性推出**水环**：扩张到最大半径后**回卷收缩**；被扫过的敌人被沿环法向推动。
   * 回卷阶段推力方向相反；Lv5 质变「回卷带拉拽」把敌人拖向中心。
   */
  updateTide(dt, slot, st) {
    const p = this.player;
    const ut = this.ultTide;
    ut.timer -= dt;
    if (ut.timer > 0) return;
    ut.timer = st.period || 1.6;
    const n = st.rings || 1;
    for (let i = 0; i < n; i++) {
      const rg = this.rings.spawn();
      if (!rg) break;
      rg.id = this.nextId();
      rg.weaponId = slot.id;
      rg.x = p.x;
      rg.y = p.y;
      // Lv3 质变「第二道外环」：内外交错（第二道从半程开始）
      rg.r = i === 0 ? 0 : (st.maxRadius || 220) * 0.45;
      rg.maxR = (st.maxRadius || 220) * this.stats.area;
      rg.band = (st.band || 28) * Math.sqrt(this.stats.area);
      rg.speed = (st.speed || 300) * Math.sqrt(this.stats.area);
      rg.phase = 'out';
      rg.damage = this.weaponDamage(slot, st.damage || 55);
      rg.pull = st.retractPull || 0;
      rg.color = '#7fd6ee';
      rg.hitOut = [];
      rg.hitIn = [];
    }
  }

  updateRings(dt) {
    const rings = this.rings.active;
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      const prev = rg.r;
      if (rg.phase === 'out') {
        rg.r += rg.speed * dt;
        if (rg.r >= rg.maxR) {
          rg.r = rg.maxR;
          rg.phase = 'in';
        }
      } else {
        rg.r -= rg.speed * dt;
        if (rg.r <= 0) {
          this.rings.release(rg);
          continue;
        }
      }
      // 环带这一帧扫过的敌人：只结算一次（每个阶段一张 id 表）
      const lo = Math.min(prev, rg.r) - rg.band;
      const hi = Math.max(prev, rg.r) + rg.band;
      const hitList = rg.phase === 'out' ? rg.hitOut : rg.hitIn;
      // ⚠️ 必须用新数组，不能复用 this.queryBuf：下面的伤害可能击杀敌人 → 触发钩子
      // → aoeAt 会再用 queryBuf 查询并把它覆写掉（既有代码里踩过同一个坑）。
      const cand = this.enemyHash.query(rg.x, rg.y, hi + 40, []);
      for (const e of cand) {
        if (!e.__alive) continue;
        const d = Math.hypot(e.x - rg.x, e.y - rg.y);
        if (d < lo || d > hi) continue;
        if (hitList.indexOf(e.id) >= 0) continue;
        hitList.push(e.id);
        const a = angleTo(rg.x, rg.y, e.x, e.y);
        dealDamage(this, e, rg.damage, { source: 'tide' });
        const power = rg.phase === 'out' ? 260 : 260 + rg.pull;
        this.knockbackEnemy(e, rg.phase === 'out' ? a : a + Math.PI, power);
        this.emitHit(e, { x: e.x, y: e.y, angle: a, weaponId: rg.weaponId });
      }
    }
  }

  /**
   * 大荒经 · 赤地千里 · 天罚轮转。
   * 一朵**绕玩家公转的雷云**，落雷始终落在云下（移动轰炸带），落点留下焦痕持续灼烧。
   * Lv5 质变「双雷云反向公转」。
   */
  updateStorm(dt, slot, st) {
    const p = this.player;
    const us = this.ultStorm;
    const want = st.clouds || 1;
    while (us.clouds.length < want) {
      const i = us.clouds.length;
      us.clouds.push({ angle: (i / Math.max(1, want)) * TAU, timer: 0.2, dir: i === 0 ? 1 : -1, x: p.x, y: p.y });
    }
    while (us.clouds.length > want) us.clouds.pop();
    for (const cl of us.clouds) {
      cl.angle += (st.spin || 1.9) * cl.dir * dt;
      cl.timer -= dt;
      cl.x = p.x + Math.cos(cl.angle) * (st.orbit || 150) * this.stats.area;
      cl.y = p.y + Math.sin(cl.angle) * (st.orbit || 150) * this.stats.area;
      if (cl.timer > 0) continue;
      cl.timer = st.strike || 0.6;
      const z = this.zones.spawn();
      if (!z) continue;
      z.id = this.nextId();
      z.kind = 'warning';
      z.owner = 'player';
      z.x = clamp(cl.x, 10, ARENA_W - 10);
      z.y = clamp(cl.y, 10, ARENA_H - 10);
      z.radius = (st.radius || 62) * this.stats.area;
      z.delay = 0.35;
      z.warnTotal = 0.35;
      z.life = 0.35 + 0.45;
      z.maxLife = z.life;
      z.strikeDamage = this.weaponDamage(slot, st.damage || 46);
      z.color = '#c39bf0';
      z.weaponId = slot.id;
      // 焦痕：独立区域，与雷击伤害分开计算
      z.scorch = this.weaponDamage(slot, st.scorch || 9);
      z.scorchRadius = (st.scorchRadius || 70) * this.stats.area;
      z.scorchLife = st.scorchLife || 3.2;
    }
  }

  /**
   * 天问 · 十日凌空 · 十日。
   * 身后 **10 轮小太阳**绕玩家公转，每轮**持续射出光束**扫射；周期性**十日齐射**。
   * 光束是**持续判定**（不是投射物），不占用对象池 —— 位置每帧由 `spin` 现算。
   *
   * 判定技巧：每道光束的原点就在「半径 orbit、角度 θi」那条半径上，方向也是 θi，
   * 所以点 P 到该射线的垂距 = |P|·|sin(φ − θi)|。于是"最近的那道光束"直接由角度差
   * 算出，整轮判定是 O(敌人数)，而不是 O(敌人数 × 太阳数)。
   */
  updateSunwheel(dt, slot, st) {
    const p = this.player;
    const s = this.ultSun;
    const suns = Math.max(1, Math.round(st.suns || 10));
    const orbit = (st.orbit || 128) * this.stats.area;
    s.spin += (st.spin || 1.1) * dt;
    const stepAngle = TAU / suns;
    if (s.flash > 0) {
      s.flash -= dt;
      if (s.flash <= 0) s.lines = null;
    }
    s.volleyTimer -= dt;
    if (s.volleyTimer <= 0) {
      s.volleyTimer = Math.max(0.6, st.volleyEvery || 4.2);
      s.flash = 0.32;
      this.sunVolley(slot, st, orbit, suns);
    }
    const dps = this.weaponDamage(slot, st.dps || 80);
    const tick = Math.max(0.04, st.tick || 0.1);
    const halfW = (st.width || 16) * 0.5 * Math.sqrt(this.stats.area);
    const len = (st.beamLen || 620) * this.stats.area;
    // 一次查询拿候选（用新数组：下面的伤害会击杀 → 钩子会再查并覆写 this.queryBuf）
    const cand = this.enemyHash.query(p.x, p.y, orbit + len + 40, []);
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (!e.__alive) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < orbit - e.radius || d > orbit + len) continue;
      const phi = Math.atan2(dy, dx);
      const nearest = Math.round((phi - s.spin) / stepAngle);
      const off = (phi - s.spin - nearest * stepAngle);
      // 垂距 = d·|sin(off)|；沿轴距离 = d·cos(off) − orbit
      if (d * Math.abs(Math.sin(off)) > halfW + e.radius) continue;
      const along = d * Math.cos(off) - orbit;
      if (along < -e.radius || along > len) continue;
      if (e.sunCd > 0) {
        e.sunCd -= dt;
        continue;
      }
      e.sunCd = tick;
      dealDamage(this, e, dps * tick, { source: 'sunwheel', rollCrit: false, viaHook: true, hookId: HOOKS.ON_HIT });
      this.emitHit(e, { x: e.x, y: e.y, angle: phi, weaponId: slot.id });
    }
  }

  /** 十日齐射：每轮太阳向最近的目标射出一道贯穿光柱（Lv5 质变可贯穿多个目标）*/
  sunVolley(slot, st, orbit, suns) {
    const p = this.player;
    const range = st.volleyRange || 660;
    const damage = this.weaponDamage(slot, st.volleyDamage || 800);
    const pierce = Math.max(1, Math.round(st.volleyPierce || 1));
    const stepAngle = TAU / suns;
    const lines = [];
    let hitAny = 0;
    for (let i = 0; i < suns; i++) {
      const a = this.ultSun.spin + i * stepAngle;
      const sx = p.x + Math.cos(a) * orbit;
      const sy = p.y + Math.sin(a) * orbit;
      const target = this.enemyHash.nearest(sx, sy, range, (e) => e.__alive);
      if (!target) continue;
      const ang = angleTo(sx, sy, target.x, target.y);
      const n = this.pierceLine(sx, sy, ang, range, pierce, damage, slot.id);
      if (n > 0) {
        hitAny += n;
        lines.push({ x0: sx, y0: sy, x1: sx + Math.cos(ang) * range, y1: sy + Math.sin(ang) * range });
      }
    }
    this.ultSun.lines = lines;
    if (hitAny > 0) this.shake = Math.max(this.shake, 3);
  }

  /** 沿一条射线结算至多 n 个目标（最近的优先；十日齐射用）。返回命中数。 */
  pierceLine(x, y, angle, len, n, damage, weaponId) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cand = this.enemyHash.query(x + cos * len * 0.5, y + sin * len * 0.5, len * 0.5 + 80, []);
    const hits = this._lineBuf || (this._lineBuf = []);
    hits.length = 0;
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (!e.__alive) continue;
      const along = (e.x - x) * cos + (e.y - y) * sin;
      if (along < -e.radius || along > len) continue;
      const perp = Math.abs((e.x - x) * -sin + (e.y - y) * cos);
      if (perp > e.radius + 16) continue;
      hits.push({ e, along });
    }
    hits.sort((a, b) => a.along - b.along);
    let count = 0;
    for (let i = 0; i < hits.length && count < n; i++) {
      const h = hits[i];
      if (!h.e.__alive) continue;
      dealDamage(this, h.e, damage, { source: 'sunwheel', viaHook: true, hookId: HOOKS.ON_HIT });
      this.emitHit(h.e, { x: h.e.x, y: h.e.y, angle, weaponId });
      count++;
    }
    return count;
  }

  /**
   * 灵山 · 百巫夜行 · 百巫。
   * 召若干**巫影**：接触敌人时上**蛊毒标记**并造成一点直接伤害（把传染链点着火）；
   * 被标记者**死亡时爆毒雾并传染**标记（毒雾本身是新的伤害来源，与巫影无关）。
   * Lv5 质变：被标记者死亡时分裂出新巫影（有数量上限）。
   */
  updatePlague(dt, slot, st) {
    const want = Math.max(0, Math.round(st.wraiths || 6));
    const act = this.minions.active;
    // 已有巫影按当前等级刷新参数（升级立刻生效）
    for (let i = 0; i < act.length; i++) {
      const m = act[i];
      if (!m.plague) continue;
      m.damage = this.weaponDamage(slot, st.wraithDamage || 0) * this.stats.summonPower;
      m.markStacks = st.markStacks || 1;
      m.plagueDps = this.weaponDamage(slot, st.plagueDps || 0);
      m.speed = (st.wraithSpeed || 150) * Math.min(1.6, this.stats.speed / PLAYER_BASE.speed);
      m.radius = 12 * Math.min(1.8, Math.sqrt(this.stats.area));
      m.life = 1e9;
      m.maxLife = 1e9;
    }
    let have = 0;
    for (let i = 0; i < act.length; i++) if (act[i].plague) have++;
    while (have < want) {
      if (!this.spawnWraith(st, slot, null, null)) break;
      have++;
    }
    if (this.ultPlague) this.ultPlague.wraiths = have;
  }

  /** 召一只巫影（hp/speed/damage 都吃通道；damage 走 wraithDamage = "点火"）*/
  spawnWraith(st, slot, x, y) {
    if (this.minions.active.length >= CAP_MINIONS) return null;
    const m = this.minions.spawn();
    if (!m) return null;
    const p = this.player;
    const a = (this.minions.active.length / 10) * TAU + this.ultSun.spin;
    m.id = this.nextId();
    m.x = x === null || x === undefined ? p.x + Math.cos(a) * 44 : x;
    m.y = y === null || y === undefined ? p.y + Math.sin(a) * 44 : y;
    m.vx = 0;
    m.vy = 0;
    m.maxHp = (st.wraithHp || 60) * this.stats.summonPower;
    m.hp = m.maxHp;
    m.damage = this.weaponDamage(slot, st.wraithDamage || 0) * this.stats.summonPower; // ★ 巫影的直接伤害（点火）
    m.radius = 12 * Math.min(1.8, Math.sqrt(this.stats.area));
    m.speed = (st.wraithSpeed || 150) * Math.min(1.6, this.stats.speed / PLAYER_BASE.speed);
    m.life = 1e9;
    m.maxLife = 1e9;
    m.targetId = 0;
    m.attackCd = 0;
    m.heads = 1;
    m.hitFlash = 0;
    m.plague = true;
    m.markStacks = st.markStacks || 1;
    m.plagueDps = this.weaponDamage(slot, st.plagueDps || 0);
    return m;
  }

  /**
   * 被蛊毒标记的敌人死亡时的爆毒与传染（由 stats.js 的 killEnemy 调用）。
   * **传染链必须有层数上限**（规格 §2 硬要求），层数记在 `enemy.plagueDepth` /
   * `zone.plagueDepth` 上：巫影直接上的是 0 层，每经一次爆毒 +1，超过上限就断链。
   */
  onMarkedDeath(enemy) {
    if (!enemy || enemy.plagueBurst) return; // 同一帧内多次击杀结算只爆一次
    const cur = this.ultimateDef();
    if (!cur || !cur.slot || cur.def.kind !== 'plague') return;
    const depth = enemy.plagueDepth === undefined ? -1 : enemy.plagueDepth;
    if (depth < 0) return; // 这层标记不是百巫上的（例如灵山普通武器），不进百巫的传染链
    enemy.plagueBurst = true;
    const st = levelStats(cur.def, cur.slot.level);
    const maxDepth = st.maxDepth || 3;
    if (depth >= maxDepth) return; // ★ 层数上限：断链
    const next = depth + 1;
    // 1) 死亡处爆毒雾：独立的持续伤害区域，同时把**标记**（放大器）传染给雾里的敌人。
    //    ⚠️ 毒雾只传染"标记"（+12% 受伤），**不再持续补蛊毒 DoT** —— 否则整片场地会
    //    被毒雾反复上毒，几秒内就把区域池打满（实测 119/120），输出也失控。
    //    **同时给毒雾数量设上限**（mistMax），保证它永远不会铺满全场。
    let mistCount = 0;
    for (const zz of this.zones.active) if (zz.plagueDepth >= 0) mistCount++;
    const mistMax = Math.max(1, Math.round(st.mistMax || 8));
    if (mistCount < mistMax) {
      const z = this.zones.spawn();
      if (z) {
        z.id = this.nextId();
        z.kind = 'poison';
        z.owner = 'player';
        z.x = enemy.x;
        z.y = enemy.y;
        z.radius = (st.mistRadius || 96) * this.stats.area;
        z.dps = this.weaponDamage(cur.slot, st.mistDps || 260);
        z.damage = 0;
        z.life = st.mistLife || 3.2;
        z.maxLife = z.life;
        z.delay = 0;
        z.tick = 0;
        z.knockback = 0;
        z.mark = st.markStacks || 1;
        z.plagueDepth = next;
        z.color = '#8ff0dd';
        z.weaponId = cur.slot.id;
        spawnParticles(this, enemy.x, enemy.y, 8, '#8ff0dd');
      }
    }
    // 2) 向四周**一次性**传染蛊毒（标记 + 蛊毒发作），同样 +1 层
    const spread = (st.spreadRadius || 140) * this.stats.area;
    const cand = this.enemyHash.query(enemy.x, enemy.y, spread, []);
    for (let i = 0; i < cand.length; i++) {
      const o = cand[i];
      if (!o.__alive || o === enemy) continue;
      this.applyMark(o, st.markStacks || 1, next, this.weaponDamage(cur.slot, st.plagueDps || 0));
    }
    // 3) Lv5 质变：分裂出新巫影（数量上限 = 基础巫影数 + splitMax，且不超 CAP_MINIONS）
    const splitMax = st.splitMax || 0;
    if (splitMax > 0) {
      let wraiths = 0;
      for (let i = 0; i < this.minions.active.length; i++) if (this.minions.active[i].plague) wraiths++;
      const cap = Math.min(CAP_MINIONS, (st.wraiths || 6) + splitMax);
      if (wraiths < cap) this.spawnWraith(st, cur.slot, enemy.x, enemy.y);
    }
  }

  /**
   * 昆仑 · 昆仑永镇 · 玉璧。
   * 身周**自转的玉璧环**把**敌方子弹反弹**为己方子弹，同时持续为玩家回盾。
   * 反弹本体在 updateEnemyBullets 里（那里才拿得到敌方子弹），这里只维护环参数与回盾。
   */
  updateBulwark(dt, slot, st) {
    const bw = this.ultBulwark;
    bw.active = true;
    bw.radius = (st.orbit || 96) * this.stats.area;
    bw.band = (st.band || 22) * Math.sqrt(this.stats.area);
    bw.rings = Math.max(1, Math.round(st.rings || 1));
    bw.reflectMul = st.reflectMul || 40;
    bw.reflectPierce = Math.max(0, Math.round(st.reflectPierce === undefined ? 0 : st.reflectPierce));
    bw.homing = st.homing || 0;
    bw.golden = !!st.golden;
    bw.angle += (st.spin || 1.6) * dt;
    // Lv3 质变：第二层反向自转
    bw.angle2 -= (st.spin || 1.6) * 1.35 * dt;
    // 持续回盾：上限走既有的 shield 通道（p.shieldMax 由 recompute 从通道算出）
    const regen = st.shieldRegen || 0;
    const p = this.player;
    if (regen > 0 && p.shieldMax > 0 && p.shield < p.shieldMax) {
      p.shield = Math.min(p.shieldMax, p.shield + regen * dt);
    }
    // 玉璧环的**接触伤害**（平衡规格 §3①）：Lv1 150 → Lv5 320 dps，tick 0.3 秒。
    // 在这之前它整张字段表里只有半径/转速/反弹倍率/护盾，**没有任何伤害值** ——
    // 于是纯近战兽潮下它的输出恰好是 0（只反弹敌方子弹），防御系因此塌成弱系。
    const dps = this.weaponDamage(slot, st.dps || 0);
    if (dps <= 0) return;
    const bandR = bw.radius + Math.max(4, bw.band * 0.5);
    const cand = this.enemyHash.query(p.x, p.y, bandR + 48, []); // 新数组：伤害会击杀 → 钩子会再查
    for (let i = 0; i < cand.length; i++) {
      const e = cand[i];
      if (!e.__alive) continue;
      if (e.bulwarkCd > 0) {
        e.bulwarkCd -= dt;
        continue;
      }
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const outerHit = Math.abs(d - bw.radius) <= bw.band * 0.5 + e.radius;
      const innerHit = bw.rings > 1 && Math.abs(d - bw.radius * 0.78) <= bw.band * 0.5 + e.radius;
      if (!outerHit && !innerHit) continue;
      e.bulwarkCd = BULWARK_HIT_TICK;
      dealDamage(this, e, dps * BULWARK_FIRST_HIT, { source: 'bulwark', rollCrit: false, viaHook: true, hookId: HOOKS.ON_HIT });
      this.emitHit(e, { x: e.x, y: e.y, angle: angleTo(p.x, p.y, e.x, e.y), weaponId: slot.id });
    }
    // 突破玉璧外缘的怪仍在防护区内受碾压；每次只处理最近的 24 个，
    // 避免高等级在人海中按全部敌人数无限放大输出。
    bw.innerCd -= dt;
    if (bw.innerCd <= 0) {
      bw.innerCd += BULWARK_HIT_TICK;
      const inner = cand.filter((e) => e.__alive && Math.hypot(e.x - p.x, e.y - p.y) < bw.radius - bw.band * 0.5 - e.radius);
      inner.sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
      for (let i = 0; i < Math.min(24, inner.length); i++) {
        const e = inner[i];
        if (!e.__alive) continue;
        dealDamage(this, e, dps * BULWARK_HIT_TICK, { source: 'bulwark', rollCrit: false, viaHook: true, hookId: HOOKS.ON_HIT });
        this.emitHit(e, { x: e.x, y: e.y, angle: angleTo(p.x, p.y, e.x, e.y), weaponId: slot.id });
      }
    }
  }

  /**
   * 玉璧环拦截：命中则把**敌方子弹改归属为玩家**（换算伤害倍率、清空命中记录）。
   * 返回 true 表示这颗子弹已经被反弹成己方子弹、必须从 enemyBullets 里摘掉。
   */
  bulwarkTryReflect(b) {
    const bw = this.ultBulwark;
    if (!bw || !bw.active) return false;
    // 反弹弹进的是己方弹幕，要守同一条 800 的口径（规格 §11 硬上限）
    if (this.playerBullets.length >= CAP_PLAYER_BULLETS) return false;
    const p = this.player;
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    const outerHit = Math.abs(d - bw.radius) <= bw.band * 0.5;
    const innerHit = bw.rings > 1 && Math.abs(d - bw.radius * 0.78) <= bw.band * 0.5;
    if (!outerHit && !innerHit) return false;
    const cur = this.ultimateDef();
    if (!cur || !cur.slot) return false;
    const a = angleTo(p.x, p.y, b.x, b.y); // 沿环法向反射出去（离开玩家）
    const speed = Math.max(420, b.speed * 1.6);
    b.owner = 'player';
    b.weaponId = cur.slot.id;
    b.damage = this.weaponDamage(cur.slot, b.damage * bw.reflectMul);
    // ★ 换归属时必须清空命中记录，否则反弹弹会"记得自己打过谁"
    b.hitIds = [];
    b.pierce = bw.reflectPierce || 0;
    b.hits = 0;
    b.life = 0;
    b.maxLife = 2.6;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    b.speed = speed;
    b.radius = Math.max(b.radius, 6);
    b.knockback = this.stats.knockback;
    b.crit = false;
    b.pattern = null;
    b.boomerang = false;
    b.split = 0;
    b.splash = 0;
    b.mark = 0;
    if (bw.homing > 0) {
      b.homing = bw.homing;
      b.color = '#ffd76a';
      b.shape = 'orb';
    } else {
      b.homing = 0;
      b.color = '#9ff0d8';
      b.shape = 'dot';
    }
    spawnParticles(this, b.x, b.y, 4, b.color);
    // 换数组：从敌方弹幕摘掉、挂进己方弹幕（同一个对象池，不能 release）
    return true;
  }

  // ---------------- 主动技（六个操作型技能） ----------------

  /**
   * 输入状态机入口（每 tick 一次）。
   *  · 点按类（地形/位移/控场/处决/防御）→ 按下即施放
   *  · 瞄准类（天问拉弓）→ 按下只进入蓄力，松手才发射（见 updateBow）
   */
  updateSkillState() {
    const inp = this.input;
    if (inp.skillRequested) {
      inp.skillRequested = false;
      const skill = this.activeSkillUnlocked ? ACTIVE_SKILL_BY_ID[this.activeSkillUnlocked] : null;
      if (skill && skill.type === 'aim') this.bowPress(skill);
      else this.triggerActiveSkill();
    }
    this.updateBow();
  }

  bowReset() {
    this.bow = { phase: 'idle', t: 0, c: 0, startX: 0, startY: 0, curX: 0, curY: 0, pulled: false };
    this._bowMoveMul = 1;
    if (this.input) this.input.skillReleased = false;
  }

  /** 按下主动技键：拉弓进入蓄力（此时**不进冷却**，冷却从发射起算） */
  bowPress(skill) {
    if (this.activeSkillCd > 0) return false;
    const b = this.bow;
    if (b.phase !== 'idle') return false;
    const inp = this.input;
    b.phase = 'charge';
    b.t = 0;
    b.c = 0;
    b.pulled = false;
    b.startX = inp.skillStartX !== undefined ? inp.skillStartX : 0;
    b.startY = inp.skillStartY !== undefined ? inp.skillStartY : 0;
    b.curX = b.startX;
    b.curY = b.startY;
    b.angle = this.player.facing;
    this._bowMoveMul = skill.moveMul || 0.7;
    this.hint('拉弓：按住蓄力，反向拖拽瞄准', 1400);
    return true;
  }

  updateBow() {
    const b = this.bow;
    if (b.phase === 'idle') return;
    const skill = this.activeSkillUnlocked ? ACTIVE_SKILL_BY_ID[this.activeSkillUnlocked] : null;
    if (!skill || skill.type !== 'aim') {
      this.bowReset();
      return;
    }
    const inp = this.input;
    const dt = TICK_MS / 1000;
    b.t += dt;
    b.c = Math.min(1, b.t / (skill.chargeTime || 1.2));
    if (inp.skillCurX !== undefined) b.curX = inp.skillCurX;
    if (inp.skillCurY !== undefined) b.curY = inp.skillCurY;
    const dx = b.startX - b.curX;
    const dy = b.startY - b.curY;
    const drag = Math.hypot(dx, dy);
    const minDrag = skill.minDrag || 26;
    if (drag > minDrag) {
      b.pulled = true;
      // 方向 = normalize(p0 − p1)：**反向拖拽 = 拉弦，箭向反方向飞**
      b.angle = Math.atan2(dy, dx);
      b.phase = 'aim';
    } else {
      // 拖动距离小于阈值时，方向取玩家当前朝向
      b.angle = this.player.facing;
      b.phase = 'charge';
    }
    if (!inp.skillReleased) return;
    inp.skillReleased = false;
    // 取消：手指**拖回按下点附近**再松手 = 取消，不进冷却
    const cancel = b.pulled && drag < (skill.cancelDrag || 26);
    if (cancel) {
      this.hint('拉弓取消（不进冷却）', 1400);
      this.bowReset();
      return;
    }
    // 发射：未满蓄也发射，伤害/宽度都随 c 缩放
    this._bowShot = { c: b.c, angle: b.angle };
    this.activeSkillCd = this.activeSkillCooldown(skill);
    this.bowReset();
  }

  /** 拉弓巨箭：贯穿全场 + 命中点留下「日火」区域 */
  fireBowArrow(c, angle) {
    const skill = ACTIVE_SKILL_BY_ID[this.activeSkillUnlocked];
    if (!skill) return;
    const p = this.player;
    const width = (skill.width || 34) + ((skill.widthMax || 96) - (skill.width || 34)) * c;
    const len = (skill.length || 1700) * this.stats.area;
    const dmg = skill.damage * (1 + this.stats.damage) * (0.35 + 0.65 * c);
    const bm = this.beams.spawn();
    if (bm) {
      bm.id = this.nextId();
      bm.ownerWeapon = skill.id;
      bm.x = p.x;
      bm.y = p.y;
      bm.angle = angle;
      bm.length = len;
      bm.width = width;
      bm.damage = 0;
      bm.dps = dmg / 0.3; // 光束按 DPS 结算：life 0.3 秒 → 每个敌人约吃满 dmg
      bm.life = 0.3;
      bm.maxLife = 0.3;
      bm.pierce = 99;
      bm.charge = true;
      bm.bow = true;
      bm.fullCharge = c >= 1;
      bm.color = c >= 1 ? '#fff0b0' : '#ffd27f';
      bm.beamTick = 0;
    }
    // 命中点：这条线上**最远**的敌人；没有敌人就落在箭头末端
    const hit = this.raycastFarthest(p.x, p.y, angle, len);
    const ex = clamp(p.x + Math.cos(angle) * Math.min(len, 900), 20, ARENA_W - 20);
    const ey = clamp(p.y + Math.sin(angle) * Math.min(len, 900), 20, ARENA_H - 20);
    this.spawnBowFire(hit ? hit.x : ex, hit ? hit.y : ey, skill, c);
    this.shake = Math.max(this.shake, 4 + 10 * c);
    spawnParticles(this, p.x, p.y, 10 + Math.round(16 * c), '#ffe08a');
    // 满蓄提示：箭光变亮 + 音效上扬（音效由 main.js 的遥测反推）——这里给一次可见提示
    if (c >= 1) this.hint('满蓄！', 900);
  }

  spawnBowFire(x, y, skill, c) {
    const z = this.zones.spawn();
    if (!z) return;
    z.id = this.nextId();
    z.kind = 'sunfire'; // 日火：与已有的"灼烧"表现区分开
    z.owner = 'player';
    z.x = clamp(x, 20, ARENA_W - 20);
    z.y = clamp(y, 20, ARENA_H - 20);
    z.radius = (skill.fireRadius || 104) * this.stats.area * (0.7 + 0.3 * c);
    z.dps = (skill.fireDps || 42) * (1 + this.stats.damage) * (0.6 + 0.4 * c);
    z.damage = 0;
    z.life = skill.fireLife || 3.2;
    z.maxLife = z.life;
    z.delay = 0;
    z.tick = 0;
    z.color = '#ffe08a';
    z.weaponId = skill.id;
  }

  /** 这条射线上最远的敌人（用于把日火放在"命中点"） */
  raycastFarthest(x, y, angle, len) {
    const steps = Math.ceil(len / 40);
    let far = null;
    for (let s = 1; s <= steps; s++) {
      const px = x + Math.cos(angle) * (s * 40);
      const py = y + Math.sin(angle) * (s * 40);
      if (px < 0 || px > ARENA_W || py < 0 || py > ARENA_H) break;
      const cand = this.enemyHash.query(px, py, 30, []);
      for (const e of cand) {
        if (!e.__alive) continue;
        const rr = e.radius + 12;
        if (dist2(px, py, e.x, e.y) > rr * rr) continue;
        far = e;
      }
    }
    return far;
  }

  /** 触发主动技。返回是否真的"生效"（没生效就不进冷却）。 */
  triggerActiveSkill() {
    const skill = this.activeSkillUnlocked ? ACTIVE_SKILL_BY_ID[this.activeSkillUnlocked] : null;
    if (!skill) return false;
    if (this.activeSkillCd > 0) return false;
    if (skill.type === 'aim') return this.bowPress(skill); // 拉弓由状态机接管
    let ok = false;
    switch (skill.type) {
      case 'terrain':
        ok = this.triggerSkillTerrain(skill);
        break;
      case 'dash':
        ok = this.triggerSkillDash(skill);
        break;
      case 'control':
        ok = this.triggerSkillControl(skill);
        break;
      case 'execute':
        ok = this.triggerSkillExecute(skill);
        break;
      case 'defense':
        ok = this.triggerSkillDefense(skill);
        break;
      default:
        break;
    }
    if (ok) this.activeSkillCd = this.activeSkillCooldown(skill);
    return ok;
  }

  /**
   * 主动技的**有效冷却**（秒）。平衡规格 §5：技艺冷却通道从"只作用于闪避"扩展为
   * "闪避 + 主动技共用"，且 **下限 3 秒是硬要求**（否则蛊爆 5 秒吃满缩减会变成站着刷技能）。
   *
   * `stats.dashCd` 是"减秒"的绝对量（基础 2.6 − 灵山雾 0.35 …），所以这里直接相减：
   * 同一条通道喂两个消费方（闪避看绝对秒数，主动技看减量），不需要第二套折算比例 ——
   * 否则灵山雾会因为"折算两次"变成双倍收益（-0.35 秒 = 闪避 −13%、主动技 −35%）。
   */
  activeSkillCooldown(skill) {
    const cut = Math.max(0, PLAYER_BASE.dashCd - (this.stats.dashCd || PLAYER_BASE.dashCd));
    return Math.max(SKILL_CD_MIN, (skill.cd || 0) - cut);
  }

  /** 山经 · 立岩（地形）：升起环形石壁，圈内敌人被持续推向外侧并受伤 */
  triggerSkillTerrain(skill) {
    const p = this.player;
    const z = this.zones.spawn();
    if (!z) return false;
    z.id = this.nextId();
    z.kind = 'stonewall';
    z.owner = 'player';
    z.x = p.x;
    z.y = p.y;
    z.radius = skill.radius * this.stats.area;
    z.dps = skill.damage * (1 + this.stats.damage); // dps 分支每 0.4s 结算 → 每秒约 dps
    z.damage = 0;
    z.life = skill.duration;
    z.maxLife = z.life;
    z.delay = 0;
    z.tick = 0;
    z.knockback = skill.push; // 每 tick 把圈内敌人推向外侧
    z.color = '#f0b357';
    z.weaponId = skill.id;
    this.skillWall = z;
    this.shake = Math.max(this.shake, 10);
    spawnParticles(this, p.x, p.y, 30, '#f0b357');
    this.hint(`立岩：石壁升起（${skill.duration}s）`);
    return true;
  }

  /** 海经 · 化潮（位移）：沿摇杆方向穿怪位移，路径敌人受伤并被推开，位移瞬间免疫 */
  triggerSkillDash(skill) {
    const p = this.player;
    const inp = this.input;
    const len = Math.hypot(inp.mx || 0, inp.my || 0);
    const angle = len > 0.06 ? Math.atan2(inp.my, inp.mx) : p.facing;
    const durMs = (skill.distance / skill.speed) * 1000;
    this.skillDash = { until: this.elapsedMs + durMs, angle, hit: [] };
    this._skillDashSpeed = skill.speed;
    p.iframeUntil = Math.max(p.iframeUntil, this.elapsedMs + skill.iframes * 1000);
    this.shake = Math.max(this.shake, 8);
    spawnParticles(this, p.x, p.y, 24, '#7fd6ee');
    this.hint('化潮：穿身而过');
    return true;
  }

  /** 化潮的路径伤害：位移期间把靠近的敌人推开并打伤（每个敌人只吃一次） */
  updateSkillEffects() {
    const dash = this.skillDash;
    if (!dash || this.elapsedMs >= dash.until) return;
    const skill = this.activeSkillUnlocked ? ACTIVE_SKILL_BY_ID[this.activeSkillUnlocked] : null;
    if (!skill || skill.type !== 'dash') return;
    const p = this.player;
    const r = skill.radius * this.stats.area;
    const cand = this.enemyHash.query(p.x, p.y, r + 30, []);
    for (const e of cand) {
      if (!e.__alive) continue;
      if (dash.hit.indexOf(e.id) >= 0) continue;
      const rr = e.radius + r;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
      dash.hit.push(e.id);
      dealDamage(this, e, skill.damage * (1 + this.stats.damage), { source: 'skill' });
      this.knockbackEnemy(e, this.skillDash.angle, skill.knockback + this.stats.knockback);
      spawnParticles(this, e.x, e.y, 6, '#bfe9ff');
    }
  }

  /** 大荒经 · 锁天（控场）：范围内敌人被钉住；精英同样生效，Boss 改为强减速 */
  triggerSkillControl(skill) {
    const p = this.player;
    const r = skill.radius * this.stats.area;
    const until = this.elapsedMs + skill.duration * 1000;
    const cand = this.enemyHash.query(p.x, p.y, r + 60, this.queryBuf);
    let n = 0;
    for (const e of cand) {
      if (!e.__alive) continue;
      const rr = e.radius + r;
      if (dist2(p.x, p.y, e.x, e.y) > rr * rr) continue;
      if (e.isBoss) {
        // Boss 不被完全定身，改为强减速
        e.slowUntil = until;
        e.slowMul = Math.min(e.slowMul || 1, skill.bossSlowMul);
      } else {
        e.stunUntil = Math.max(e.stunUntil, until);
        e.chargeState = 0;
        e.chargeWindupUntil = 0;
        e.fuseUntil = 0;
      }
      n++;
    }
    const z = this.zones.spawn();
    if (z) {
      z.id = this.nextId();
      z.kind = 'shock';
      z.owner = 'player';
      z.x = p.x;
      z.y = p.y;
      z.radius = r;
      z.dps = 0;
      z.life = 0.45;
      z.maxLife = 0.45;
      z.color = '#c39bf0';
    }
    this.shake = Math.max(this.shake, 8);
    this.hint(n > 0 ? `锁天：定住 ${n} 个` : '锁天：范围内没有敌人');
    return true;
  }

  /** 灵山 · 蛊爆（处决）：引爆全场所有蛊毒标记（**每次只扣 1 层**）；未标记者不受影响 */
  triggerSkillExecute(skill) {
    const list = this.enemies.active;
    let n = 0;
    let dmgTotal = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.__alive) continue;
      if (!(e.mark > 0 && this.elapsedMs < e.markUntil)) continue;
      const stacks = Math.min(3, e.mark);
      const dmg = (skill.damage + skill.perStack * stacks) * (1 + this.stats.damage);
      dmgTotal += dmg;
      // **每次只扣 1 层**（平衡规格 §2④）：伤害仍按消耗前的层数计算，但不清空。
      // 于是"叠 3 层 → 连爆 3 次"成立：48→96→144 递减，合计 288 > 旧版单次引爆的 225。
      e.mark = Math.max(0, stacks - 1);
      if (e.mark === 0) e.markUntil = 0;
      dealDamage(this, e, dmg, { source: 'skill', rollCrit: false });
      if (e.__alive) e.stunUntil = Math.max(e.stunUntil, this.elapsedMs + skill.stun * 1000);
      n++;
    }
    if (n === 0) {
      // 没有蛊毒标记 = 这次没有生效：不进冷却（与"取消不进冷却"同一条规则）
      this.hint('蛊爆：场上没有蛊毒标记', 1600);
      return false;
    }
    this.shake = Math.max(this.shake, 12);
    spawnParticles(this, this.player.x, this.player.y, 34, '#8ff0dd');
    this.hint(`蛊爆：引爆 ${n} 个标记（各扣 1 层）`);
    return true;
  }

  /** 昆仑 · 不死药（防御）：数秒内不会死亡（血锁最低值，伤害优先吃护盾），并立即回盾 */
  triggerSkillDefense(skill) {
    const p = this.player;
    this.undyingUntil = Math.max(this.undyingUntil, this.elapsedMs + skill.duration * 1000);
    p.shield = Math.max(p.shield || 0, skill.shield);
    healPlayer(this, skill.shield, true);
    spawnParticles(this, p.x, p.y, 34, '#dfe6f2');
    this.hint(`不死药：${skill.duration}s 内不会死亡`);
    return true;
  }

  // ---------------- 掉落 ----------------

  updateDrops(dt) {
    const p = this.player;
    const pickup = this.stats.pickup;
    const list = this.drops.active;
    // 磁吸范围**就是拾取半径**（不能放大）：
    // 放大到 2.5 倍之后，站桩玩家能把身边一大圈的掉落全吸过来，
    // 于是"不动"反而比走位升级更快 —— 验收第 1 条（不做任何操作会死）直接被破坏，
    // 实测站桩通关率升到 4/12。拾取半径保持原语义：只有你走到的地方才有收益。
    // 磁吸范围：平时**就是拾取半径**，但球多到快撑满池子时按拥挤度放宽到最多 2.2 倍。
    //
    // 两难与取舍（两条路都实测过）：
    //  · 固定放大到 2.5 倍：站桩玩家能把身边一大圈掉落全吸走，"不动"反而升级更快，
    //    验收第 1 条（不做任何操作会死）被破坏（实测站桩通关 4/12）；
    //  · 固定等于拾取半径又太紧：击杀速率 50+/s 时球会堆到池上限，实测**一半经验**
    //    （已收 21,973 vs 卡在场上的 697 个球里 23,764）永远收不到。
    // 所以改成自适应：球少时严格按拾取半径（只有你走到的地方有收益），
    // 只在场子挤到 55% 容量以上才逐步放宽 —— 那种拥挤只可能出现在"你真的一直在打"的时候，
    // 放宽是补偿遗漏，不是给站桩发福利。
    const fill = list.length / Math.max(1, this.drops.cap);
    const magnetR = pickup * (1 + 1.2 * Math.max(0, Math.min(1, (fill - 0.55) / 0.45)));
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.bob += dt * 4;
      // 经验球**不过期**。它只会在两种情况下消失：被捡走，或掉落池真的满了（那才合并）。
      //
      // 曾经给球加了 6 秒寿命、到期就地并入最近的球 —— 目的是防止球无限堆积，
      // 但副作用是"玩家还没走过去，球就没了"（用户反馈），而且会让经验在场上
      // 缓慢漂移，升级进度变得不可预期。现在改成"永久留在原地"：
      // 经验堆积在你打过怪的地方，走位回来就能全收，语义直观。
      // 无界增长由掉落池容量兜底（满了并入最近的球），不靠计时器。
      // 只有回血物会过期（经验球 life=0，表示不过期）。
      if (d.life > 0) {
        d.life -= dt * 1000;
        if (d.life <= 0) {
          this.drops.release(d);
          continue;
        }
      }
      const d2 = dist2(d.x, d.y, p.x, p.y);
      if (d.magnet || d2 <= magnetR * magnetR) {
        const a = angleTo(d.x, d.y, p.x, p.y);
        const pull = 320 + (pickup * 2);
        d.x += Math.cos(a) * pull * dt;
        d.y += Math.sin(a) * pull * dt;
      }
      if (d2 <= 22 * 22) {
        this.collectDrop(d);
        this.drops.release(d);
      }
    }
  }

  /**
   * 把经验并入"附近的球"；没有邻居就地留下，不丢经验。
   *
   * 只在掉落池满、必须腾位时调用（经验球已不再有"寿命到期"这条路径）。
   *
   * 选谁当接收方：**优先挑附近经验最多的那个**，而不是最近的。
   * 原因：池满之后每只新死的怪都要合并一次，若都往"最近"并，经验会摊成几百个
   * 中等球铺满全场，玩家永远收不完（实测收集率只有 1.71 XP/杀，应有约 3.5）。
   * 改成往"附近最肥的球"并，经验会**浓缩成少量高价值球**，走一趟就能全收，
   * 总经验一点不丢。搜索半径也限制住，避免把远处的球吸过来破坏"经验堆在击杀处"的语义。
   */
  mergeDropIntoNearest(d, selfIndex) {
    const list = this.drops.active;
    const R2 = 260 * 260; // 只在附近找接收方
    let best = null;
    let bestValue = -1;
    let bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      if (i === selfIndex) continue;
      const o = list[i];
      if (o.kind !== 'xp') continue;
      const dd = dist2(o.x, o.y, d.x, d.y);
      if (dd > R2) continue;
      // 先比经验值，值相同再比距离（更近的更优）
      if (o.value > bestValue || (o.value === bestValue && dd < bestD)) {
        best = o;
        bestValue = o.value;
        bestD = dd;
      }
    }
    if (!best) return;
    best.value += d.value;
  }

  collectDrop(d) {
    const p = this.player;
    if (d.kind === 'xp') {
      // 调参面板的经验倍率（默认 1）
      const gain = d.value * (this.xpMul || 1);
      p.xp += gain;
      this.xpCollected += gain;
      while (p.xp >= p.xpNext) {
        p.xp -= p.xpNext;
        p.level += 1;
        p.xpNext = Math.round(p.xpNext * PLAYER_BASE.xpGrow * PLAYER_BASE.xpLevelScale);
        this.pendingLevelUps += 1;
      }
      if (this.pendingLevelUps > 0 && !this.awaitingChoice) {
        this.awaitingChoice = true;
        this.cardChoices = this.rollCards();
        // 内容已经全满（全武器满级 + 槽位全满）：没有卡可选。
        // 绝不能弹出"暂停等选卡"——那是软锁。这里直接把待选次数清掉。
        if (this.cardChoices.length === 1 && this.cardChoices[0].type === 'none') {
          this.pendingLevelUps = 0;
          this.awaitingChoice = false;
          this.cardChoices = [];
          this.paused = false;
        } else {
          this.paused = true;
        }
      }
    } else if (d.kind === 'heal') {
      healPlayer(this, d.value);
    }
  }

  // ---------------- 钩子与效果 ----------------

  emitHit(enemy, meta) {
    this.fireHook(HOOKS.ON_HIT, {
      x: meta.x !== undefined ? meta.x : enemy.x,
      y: meta.y !== undefined ? meta.y : enemy.y,
      enemy,
      angle: meta.angle,
      weaponId: meta.weaponId,
    });
  }

  knockbackEnemy(e, angle, power) {
    if (!e.__alive || power <= 0 || e.isBoss) return;
    const mass = 1 + e.radius / 14;
    e.x += Math.cos(angle) * (power / mass) * 0.05;
    e.y += Math.sin(angle) * (power / mass) * 0.05;
    e.x = clamp(e.x, 12, ARENA_W - 12);
    e.y = clamp(e.y, 12, ARENA_H - 12);
  }

  aoeAt(x, y, radius, damage, o = {}) {
    const cand = this.enemyHash.query(x, y, radius, this.queryBuf);
    for (const e of cand) {
      if (!e.__alive) continue;
      if (o.exclude !== undefined && e.id === o.exclude) continue;
      const rr = e.radius + radius * 0.6;
      if (dist2(x, y, e.x, e.y) > rr * rr) continue;
      dealDamage(this, e, damage, { source: o.source || 'aoe', viaHook: !!o.viaHook, hookId: o.hookId });
      if (o.knockback) this.knockbackEnemy(e, angleTo(x, y, e.x, e.y), o.knockback);
    }
  }

  fireHook(hookId, payload) {
    return fireHook(this, hookId, payload);
  }

  /** 执行一条钩子效果（由 core/hooks.js 调用；效果只能是"已存在的通道效果"或"已有武器的一次开火"）*/
  applyEffect(eff, payload, chain) {
    switch (eff.kind) {
      case EFFECT_KINDS.SPLIT_SHOT: {
        if (eff.mode === 'burn') {
          const e = payload.enemy;
          if (e && e.__alive) {
            e.burnDps = Math.max(e.burnDps, payload.dot || this.stats.dot || 6);
            e.burnUntil = this.elapsedMs + 2500;
          }
        } else if (eff.mode === 'refire') {
          // 让已有武器立即开火一次（规格 §3 允许的唯一行为来源）
          this.refireOnce();
        } else if (eff.mode === 'homing') {
          this.addBuff('homing', eff.value, 1.2);
        }
        break;
      }
      case EFFECT_KINDS.KILL_BLAST: {
        this.aoeAt(payload.x, payload.y, eff.radius * this.stats.area, eff.value * (1 + this.stats.damage), {
          source: 'hookBlast',
          viaHook: true,
          hookId: HOOKS.ON_KILL,
          knockback: eff.knockback || 0,
        });
        spawnParticles(this, payload.x, payload.y, 6, '#ffcf7a');
        break;
      }
      case EFFECT_KINDS.HURT_PULSE: {
        this.addBuff(eff.channel, eff.value, eff.duration);
        break;
      }
      case EFFECT_KINDS.CURSE_CLOUD: {
        const z = this.zones.spawn();
        if (!z) break;
        z.id = this.nextId();
        z.kind = eff.dps > 0 ? 'poison' : 'shock';
        z.owner = 'player';
        z.x = payload.x;
        z.y = payload.y;
        z.radius = eff.radius * this.stats.area;
        z.dps = eff.dps;
        z.knockback = eff.knockback || 0;
        z.life = eff.life;
        z.maxLife = eff.life;
        z.delay = 0;
        z.tick = 0;
        z.spread = !!eff.spread;
        z.color = '#9be08a';
        if (eff.strike) z.strikeDamage = eff.strike;
        break;
      }
      case EFFECT_KINDS.WAVE_FREEZE: {
        const list = this.enemies.active;
        for (const e of list) {
          if (e.isBoss) continue;
          e.slowUntil = this.elapsedMs + eff.duration * 1000;
          e.slowMul = 1 - eff.value;
        }
        this.hint('雾锁：来敌迟缓');
        break;
      }
      default:
        break;
    }
  }

  addBuff(channel, value, duration) {
    const p = this.player;
    const existing = p.buffs.find((b) => b.channel === channel);
    const until = this.elapsedMs + duration * 1000;
    if (existing) {
      existing.value = Math.max(existing.value, value);
      existing.until = Math.max(existing.until, until);
    } else {
      p.buffs.push({ channel, value, until });
    }
    this.recompute();
  }

  applyKillRecycle() {
    if (this.pendingKillRecycle.length === 0) return;
    for (const e of this.pendingKillRecycle) {
      const i = this.enemies.active.indexOf(e);
      if (i >= 0) this.enemies.releaseAt(i);
    }
    this.pendingKillRecycle.length = 0;
  }

  // ---------------- 表现层计时 ----------------

  updateCosmetics(dt) {
    this.shake *= Math.pow(0.001, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.damageNumbers.sweep((d) => {
      d.life -= dt;
      d.y -= 26 * dt;
      return d.life <= 0;
    });
    this.particles.sweep((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      return p.life <= 0;
    });
    // 清理已死敌人（非击杀路径）
    this.enemies.sweep((e) => !e.__alive || e.hp <= 0);
  }

  hint(text, ms = 2200) {
    this.hintText = text;
    this.hintUntil = this.elapsedMs + ms;
  }

  // ---------------- 升级与配方 ----------------

  rollCards() {
    const out = [];
    const rng = this.rng;
    const weaponSlotsFull = this.fusedWeapon || this.slots.weapons.length >= SLOT_WEAPONS;
    const passiveSlotsFull = this.slots.passives.length >= SLOT_PASSIVES;
    const upgradeable = this.slots.weapons.filter((w) => w.level < WEAPON_MAX_LEVEL);
    // 试炼解锁的武器只有已在 unlocks 里才进池
    // 只有"已解锁"的武器才能进池，两道门都要过：
    //  ① 它所属的神系已解锁（未解锁天问系时，天问的 4 把武器一把都不能出现）
    //  ② 它是该系的初始武器（系解锁后才免费）或已在玩家的解锁列表里
    const newWeapons = BATCH1_WEAPONS.filter((w) => {
      if (this.slots.weapons.some((s) => s.id === w.id)) return false;
      if (!this.unlockedSeries.includes(w.series)) return false;
      return w.unlock === 'initial' || this.unlocks.includes(w.id);
    });
    const newPassives = BATCH1_PASSIVES.filter(
      // 被动同样要过"系已解锁"这道门。
      // 上一轮我只修了武器、漏了被动，结果干净存档下能抽到夸父踵(天问)/不死药(昆仑)。
      (p) => !this.slots.passives.includes(p.id) && this.unlockedSeries.includes(p.series),
    );
    // 被动升级卡：已持有且没满级的被动
    const passiveUp = this.slots.passives
      .filter((pid) => PASSIVE_BY_ID[pid] && passiveLevelOf(this, pid) < PASSIVE_MAX_LEVEL)
      .map((pid) => ({ type: 'passive-up', passiveId: pid, level: passiveLevelOf(this, pid) + 1 }));
    const want = (list) => list.map((w) => ({ type: 'weapon-up', weaponId: w.id, level: w.level + 1 }));
    const wantNew = (list) => list.map((w) => ({ type: 'weapon-new', weaponId: w.id }));
    const wantP = (list) => list.map((p) => ({ type: 'passive', passiveId: p.id }));

    const up = [...want(upgradeable), ...passiveUp];
    const nw = weaponSlotsFull ? [] : wantNew(newWeapons);
    const np = passiveSlotsFull ? [] : wantP(newPassives);

    // 全都升满了（或本来就没东西可给）：转成"数值类兜底卡"。
    // 没有这一步时，全满之后只会发一张 {type:'none'}，等于升级被吞掉。
    const allMaxed = up.length === 0 && nw.length === 0 && np.length === 0;
    if (allMaxed) {
      const pool = STAT_CARDS.map((c) => ({ type: 'stat', statId: c.id, channel: c.channel, value: c.value, cn: c.cn }));
      return sampleCards(rng, pool);
    }

    // 三张卡从**全部合法选项**里随机抽，不做任何分类配平。
    //
    // 之前这里是"升级 / 新武器 / 新被动 各先保一张"，结果玩家看到的卡型分布是被
    // 人为钉死的（每轮必定各有一张），池子越大越不像随机 —— 用户的反馈就是这个。
    // 现在只有一个池子，唯一的偏置是下面这条"本系加权"。
    const pool = [...up, ...nw, ...np];
    if (pool.length === 0) {
      out.push({ type: 'none' });
      return out;
    }
    return sampleCards(rng, pool, (c) => (this.cardSeries(c) === this.series ? SERIES_CARD_WEIGHT : 1));
  }

  /** 这张卡属于哪个神系（用于"本系加权"）。升级卡看它指向的道具所属系。 */
  cardSeries(card) {
    if (card.weaponId) {
      const w = WEAPON_BY_ID[card.weaponId];
      return w ? w.series : null;
    }
    if (card.passiveId) {
      const p = PASSIVE_BY_ID[card.passiveId];
      return p ? p.series : null;
    }
    return null; // 数值兜底卡没有系
  }

  /**
   * 刷新当前这一轮三选一（每局限 CARD_REFRESH_PER_RUN 次）。
   * 只重抽卡面，不改变待选次数、不消耗升级；用掉一次就少一次，且计数会进存档。
   * 返回新的卡面数组（失败时返回 null，调用方据此决定是否提示）。
   */
  refreshCards() {
    if (this.refreshesLeft <= 0) return null;
    if (!this.awaitingChoice) return null;
    this.refreshesLeft -= 1;
    this.cardChoices = this.rollCards();
    return this.cardChoices;
  }

  takeCard(card) {
    if (!card) return false;
    if (card.type === 'weapon-new') {
      if (this.fusedWeapon || this.slots.weapons.length >= SLOT_WEAPONS) return false;
      this.slots.weapons.push({ id: card.weaponId, level: 1, cd: 0, superId: null });
    } else if (card.type === 'weapon-up') {
      const w = this.slots.weapons.find((s) => s.id === card.weaponId);
      if (!w || w.level >= WEAPON_MAX_LEVEL) return false;
      w.level += 1;
    } else if (card.type === 'passive') {
      if (this.slots.passives.length >= SLOT_PASSIVES) return false;
      this.slots.passives.push(card.passiveId);
      this.passiveLevels[card.passiveId] = 1;
      this.onPassiveAcquired(card.passiveId);
    } else if (card.type === 'passive-up') {
      const lv = passiveLevelOf(this, card.passiveId);
      if (!this.slots.passives.includes(card.passiveId) || lv >= PASSIVE_MAX_LEVEL) return false;
      this.passiveLevels[card.passiveId] = lv + 1;
    } else if (card.type === 'stat') {
      // 数值类兜底卡：直接加通道（永久，本局有效）
      this.statCards = (this.statCards || 0) + 1;
      this.bonusSums[card.channel] = (this.bonusSums[card.channel] || 0) + card.value;
      this.recompute();
    } else if (card.type === 'none') {
      // 已无内容可给（全武器满级 + 槽位全满）：本次升级直接作废。
      // 绝不能卡在"暂停等选卡"——那是软锁。
      this.pendingLevelUps = 0;
      this.awaitingChoice = false;
      this.cardChoices = [];
      this.paused = false;
      return true;
    } else {
      return false;
    }
    this.refreshWeaponEntities();
    this.checkFusions();
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    this.awaitingChoice = this.pendingLevelUps > 0;
    if (this.awaitingChoice) {
      this.cardChoices = this.rollCards();
    } else {
      this.cardChoices = [];
      this.paused = false;
    }
    this.effects = buildEffects(this.slots, this.fusionById);
    this.recompute();
    return true;
  }

  onPassiveAcquired(pid, silent = false) {
    // 试炼判定所需的"本局只持有某系武器"快照在武器变更时重算
    this.trialsThisRun.seriesOnly = this.computeSeriesOnly();
    if (!silent) this.hint(`得 ${PASSIVE_BY_ID[pid] ? PASSIVE_BY_ID[pid].cn : pid}`, 1200);
  }

  computeSeriesOnly() {
    const out = {};
    const owned = this.slots.weapons.map((w) => WEAPON_BY_ID[w.id]).filter(Boolean);
    for (const sid of ['shan', 'hai', 'huang']) {
      out[sid] = owned.length > 0 && owned.every((w) => w.series === sid);
    }
    return out;
  }

  /** 血统配方：武器满级 + 对应被动 → 超武（必定触发且只触发一次）*/
  checkFusions() {
    for (const w of this.slots.weapons) {
      if (w.superId) continue;
      if (w.level < WEAPON_MAX_LEVEL) continue;
      for (const pid of this.slots.passives) {
        const f = fusionOf(w.id, pid);
        if (!f) continue;
        w.superId = f.id;
        this.hint(`血统觉醒：${f.cn}`);
        this.shake = Math.max(this.shake, 8);
        spawnParticles(this, this.player.x, this.player.y, 22, '#ffe08a');
        break;
      }
    }
    this.checkActiveSkillUnlock();
    this.checkUltimateFusion();
    // 四合一终极合成会改变武器槽与主动技能，必须立刻重算统计值与实体。
    this.recompute();
    this.effects = buildEffects(this.slots, this.fusionById);
    const prevCount = this.orbitBlades.active.length;
    this.refreshWeaponEntities();
    if (this.orbitBlades.active.length !== prevCount) this.updateWeaponEntities(0);
  }

  /**
   * 测试用：把槽位直接填成"本系 4 把武器满级 + 四合一所需的被动"，立即触发四合一
   * 与主动技能（?dev=ultimate）。
   *
   * 走的是**真实的 checkFusions() → checkUltimateFusion()**，不是直接写融合结果，
   * 这样测到的就是玩家走正常流程会得到的东西。
   */
  applyDevUltimateLoadout() {
    const seriesWeapons = BATCH1_WEAPONS.filter((w) => w.series === this.series && !w.locked).map((w) => w.id);
    const ult = ultimateFusionFor(this.series);
    if (seriesWeapons.length < 4) return;
    const take = seriesWeapons.slice(0, 4);
    this.slots.weapons = take.map((id) => ({ id, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }));

    // 被动 = 这 4 把武器各自的融合被动 ∪ 四合一要求的被动（去重；超出槽位上限就截断）
    const need = [];
    const push = (pid) => {
      if (pid && PASSIVE_BY_ID[pid] && !need.includes(pid)) need.push(pid);
    };
    for (const wid of take) {
      const f = FUSIONS.find((x) => x.weapon === wid);
      if (f) push(f.passive);
    }
    for (const pid of (ult && ult.passives) || []) push(pid);
    for (const pid of this.slots.passives) push(pid); // 角色自带那件
    this.slots.passives = need.slice(0, SLOT_PASSIVES);
    for (const pid of this.slots.passives) if (!this.passiveLevels[pid]) this.passiveLevels[pid] = 1;

    this.recompute();
    this.refreshWeaponEntities();
    this.checkFusions();
  }

  /**
   * 合体：本系 4 把武器全部满级 + 指定被动 + **该系主动技已解锁**
   * → 合体出一把全新机制的终极武器，永久占满全部 4 个武器槽。
   *
   * ⚠️ 「该系主动技已解锁」是**硬前置**（规格 §4）：缺这一条时**不得**合体。
   * 这条前置的作用是消灭"合体前必须先合体"的顺序依赖 —— 玩家必须先把技能解锁出来，
   * 而技能一旦解锁就持久化（见 checkActiveSkillUnlock），合体后依然可用。
   */
  checkUltimateFusion() {
    if (this.fusedWeapon) return; // 已合体过，一局一次
    for (const u of ULTIMATE_FUSIONS) {
      // 本系 4 把武器全部满级
      const maxed = this.slots.weapons.filter((w) => {
        const def = WEAPON_BY_ID[w.id];
        return def && def.series === u.series && w.level >= WEAPON_MAX_LEVEL;
      });
      if (maxed.length < 4) continue;
      const hasPassives = u.passives.every((id) => this.slots.passives.includes(id));
      if (!hasPassives) continue;
      // ★ 硬前置：该系主动技必须已解锁
      const needSkill = activeSkillFor(u.series);
      if (!needSkill || this.activeSkillUnlocked !== needSkill.id) continue;
      // 触发：合体
      this.fusedWeapon = u.id;
      this.activeSkillUnlockedSeries = u.series;
      // 终极武器从 Lv1 开始，可继续升到 Lv5（Lv3 / Lv5 是质变点）
      this.slots.weapons = [{ id: u.weaponId, level: 1, cd: 0, superId: null, fused: true }];
      this.initUltimateState();
      this.hint(`合体：${u.cn}`);
      this.shake = Math.max(this.shake, 16);
      spawnParticles(this, this.player.x, this.player.y, 50, '#fff0b0');
      break;
    }
  }

  /**
   * 三把同系超武 → 解锁该系主动技。
   *
   * **达成即持久化**：结果写进 `activeSkillUnlocked`（还会进存档），
   * 不是"每帧从武器槽里数超武数量"。原因：合体会把 4 把武器塌缩成 1 把，
   * 那种写法在合体后必然失效 —— 而主动技必须**跨合体保持可用**（规格 §4）。
   */
  checkActiveSkillUnlock() {
    if (this.activeSkillUnlocked) return this.activeSkillUnlocked;
    const superBySeries = {};
    for (const w of this.slots.weapons) {
      if (!w.superId) continue;
      const def = WEAPON_BY_ID[w.id];
      if (!def) continue;
      superBySeries[def.series] = (superBySeries[def.series] || 0) + 1;
    }
    for (const series of Object.keys(superBySeries)) {
      if (superBySeries[series] >= 3) {
        const skill = activeSkillFor(series);
        if (skill) {
          this.activeSkillUnlocked = skill.id;
          this.activeSkillUnlockedSeries = series;
          this.hint(`主动技解锁：${skill.cn}`);
          break;
        }
      }
    }
    return this.activeSkillUnlocked;
  }

  nextId() {
    this._idSeq = (this._idSeq || 0) + 1;
    return this._idSeq;
  }

  // ---------------- 结算与存档 ----------------

  finish() {
    this.runStats.timeMs = this.elapsedMs;
    this.runStats.kills = this.runStats.kills;
    this.trialsThisRun.won = this.outcome === 'win';
    this.trialsThisRun.characters = [this.characterId];
    this.trialsThisRun.seriesOnly = this.computeSeriesOnly();
    return {
      outcome: this.outcome,
      elapsedMs: this.elapsedMs,
      kills: this.runStats.kills,
      level: this.player.level,
      characterId: this.characterId,
      series: this.series,
      trialsThisRun: this.trialsThisRun,
      superCount: this.slots.weapons.filter((w) => w.superId).length,
      maxTier: this.runStats.maxTier,
    };
  }

  /** 规格 §10：可完整序列化，用于断点续局 */
  toSnapshot() {
    return {
      v: 1,
      seed: this.seed,
      rngState: this.rng.state,
      characterId: this.characterId,
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      endless: this.endless,
      endlessCycle: this.endlessCycle,
      refreshesLeft: this.refreshesLeft,
      fusedWeapon: this.fusedWeapon,
      activeSkillUnlocked: this.activeSkillUnlocked,
      activeSkillUnlockedSeries: this.activeSkillUnlockedSeries,
      activeSkillCd: this.activeSkillCd,
      undyingUntil: this.undyingUntil,
      endlessOffsetMs: this.endlessOffsetMs,
      unlocks: this.unlocks.slice(),
      player: {
        x: Math.round(this.player.x),
        y: Math.round(this.player.y),
        hp: Math.round(this.player.hp * 100) / 100,
        level: this.player.level,
        xp: this.player.xp,
        xpNext: this.player.xpNext,
        reviveLayers: this.player.reviveLayers,
      },
      slots: {
        weapons: this.slots.weapons.map((w) => ({ id: w.id, level: w.level, superId: w.superId })),
        passives: this.slots.passives.slice(),
      },
      passiveLevels: { ...this.passiveLevels },
      bonusSums: { ...this.bonusSums },
      trialsThisRun: this.trialsThisRun,
      bossState: this.bossState,
      runStats: this.runStats,
      spawner: { ...this.spawner },
      xpCollected: this.xpCollected,
    };
  }

  static fromSnapshot(snap, opts = {}) {
    const w = new World({
      seed: snap.seed,
      characterId: snap.characterId,
      unlocks: snap.unlocks,
      trials: opts.trials,
      endless: snap.endless,
    });
    w.rng.state = snap.rngState;
    w.tick = snap.tick;
    w.elapsedMs = snap.elapsedMs;
    w.slots.weapons = snap.slots.weapons.map((s) => ({ id: s.id, level: s.level, cd: 0.2, superId: s.superId || null }));
    w.slots.passives = snap.slots.passives.slice();
    w.effects = buildEffects(w.slots, w.fusionById);
    w.player.x = snap.player.x;
    w.player.y = snap.player.y;
    w.player.level = snap.player.level;
    w.player.xp = snap.player.xp;
    w.player.xpNext = snap.player.xpNext;
    w.player.reviveLayers = snap.player.reviveLayers;
    // 旧存档没有这两项：被动等级一律按 1 级补，兜底卡加成为空
    w.passiveLevels = { ...(snap.passiveLevels || {}) };
    for (const pid of w.slots.passives) if (!w.passiveLevels[pid]) w.passiveLevels[pid] = 1;
    w.bonusSums = { ...(snap.bonusSums || {}) };
    w.recompute();
    w.player.hp = Math.min(snap.player.hp, w.player.maxHp);
    w.trialsThisRun = snap.trialsThisRun || w.trialsThisRun;
    w.bossState = snap.bossState || w.bossState;
    w.runStats = snap.runStats || w.runStats;
    w.spawner = { ...createSpawner(), ...(snap.spawner || {}) };
    w.endlessCycle = snap.endlessCycle || 0;
    w.refreshesLeft = snap.refreshesLeft === undefined ? CARD_REFRESH_PER_RUN : snap.refreshesLeft;
    w.fusedWeapon = snap.fusedWeapon || null;
    w.activeSkillUnlocked = snap.activeSkillUnlocked || null;
    w.activeSkillUnlockedSeries = snap.activeSkillUnlockedSeries || null;
    w.activeSkillCd = snap.activeSkillCd || 0;
    w.undyingUntil = snap.undyingUntil || 0;
    // 机制状态不进存档（与敌人/子弹同一条规则）：续局时冷启动
    w.initUltimateState();
    w.endlessOffsetMs = snap.endlessOffsetMs || 0;
    w.xpCollected = snap.xpCollected || 0;
    w.camera.x = w.player.x;
    w.camera.y = w.player.y;
    w.refreshWeaponEntities();
    // 续局按波次冷启动恢复：不恢复敌人/子弹/掉落（规格 §10）
    return w;
  }
}

// ---------------- 池 reset（必须写全字段） ----------------

function resetEnemy(e) {
  e.id = 0;
  e.kind = 'shanxiao';
  e.elite = false;
  e.affix = null;
  e.x = 0;
  e.y = 0;
  e.vx = 0;
  e.vy = 0;
  e.hp = 1;
  e.maxHp = 1;
  e.radius = 12;
  e.speed = 60;
  e.touchDamage = 8;
  e.tier = 0;
  e.ai = 'chase';
  e.slowUntil = 0;
  e.slowMul = 1;
  e.burnDps = 0;
  e.burnUntil = 0;
  e.curseUntil = 0;
  e.stunUntil = 0;
  e.dotTick = 0;
  // 巫蛊标记与百巫的传染链层数必须清干净：池对象会被复用，
  // 残留的 mark 会让"下一次死亡"误触发爆毒（markUntil 是旧时间戳，放大已经失效，
  // 但 killEnemy 只看 mark > 0 —— 这就是一个真实的漏字段）。
  e.mark = 0;
  e.markUntil = 0;
  e.plagueDepth = -1;
  e.plagueBurst = false;
  e.plagueDps = 0;
  e.plagueUntil = 0;
  e.plagueTick = 0;
  e.sunCd = 0;
  e.bulwarkCd = 0;
  e.fireCd = 0;
  e.chargeState = 0;
  e.chargeCd = 0;
  e.chargeWindupUntil = 0;
  e.fuseUntil = 0;
  e.summonCd = 0;
  e.enrageMul = 1;
  e.hitFlash = 0;
  e.facing = 0;
  e.xp = 1;
  e.isBoss = false;
  e.bossPhase = 0;
  e.volley = 0;
  e.boomRadius = 0;
  e.boomDamage = 0;
  e.fireEvery = 0;
  e.projSpeed = 0;
  e.projDamage = 0;
  e.chargeEvery = 0;
  e.chargeSpeed = 0;
  e.knockback = 0;
  e.summonEvery = 0;
  e.scale = 1;
  e.shape = 'ape';
  e.color = null;
  e.approachBias = 0;
  e.wobble = 0;
  e.lastHitBy = 0;
  e.lastHitFrame = -1;
  e.chargeUntil = 0;
  e.chargeAngle = 0;
  e.spin = 0;
}

function resetBullet(b) {
  b.id = 0;
  b.owner = 'player';
  b.weaponId = null;
  b.x = 0;
  b.y = 0;
  b.vx = 0;
  b.vy = 0;
  b.radius = 4;
  b.damage = 1;
  b.pierce = 0;
  b.hits = 0;
  b.life = 0;
  b.maxLife = 3;
  b.homing = 0;
  b.speed = 0;
  b.split = 0;
  b.splitDepth = 0;
  b.dot = 0;
  b.knockback = 0;
  b.crit = false;
  b.color = '#fff';
  b.shape = 'dot';
  b.boomerang = false;
  b.boomPhase = 0;
  b.originX = 0;
  b.originY = 0;
  b.returnSpeed = 0;
  b.spin = 0;
  b.range = 0;
  b.splash = 0;
  b.angle = 0;
  b.mark = 0;
  b.pattern = null;
  b.hitIds = null;
}

function resetZone(z) {
  z.id = 0;
  z.kind = 'poison';
  z.x = 0;
  z.y = 0;
  z.radius = 60;
  z.damage = 0;
  z.dps = 0;
  z.life = 0;
  z.maxLife = 4;
  z.tick = 0;
  z.owner = 'player';
  z.color = '#8f8';
  z.delay = 0;
  z.warnTotal = 0;
  z.strikeDamage = 0;
  z.slowMul = 1;
  z.followPlayer = false;
  z.knockback = 0;
  z.spread = false;
  z.chain = 0;
  z.weaponId = null;
  z.mark = 0;
  z.pull = 0;
  z.collapse = 0;
  z.collapseRadius = 0;
  z.scorch = 0;
  z.scorchRadius = 0;
  z.scorchLife = 0;
  z.plagueDepth = -1;
}

function resetRing(rg) {
  rg.id = 0;
  rg.weaponId = null;
  rg.x = 0;
  rg.y = 0;
  rg.r = 0;
  rg.maxR = 200;
  rg.band = 28;
  rg.speed = 300;
  rg.phase = 'out';
  rg.damage = 0;
  rg.dps = 0;
  rg.pull = 0;
  rg.color = '#7fd6ee';
  rg.hitOut = null;
  rg.hitIn = null;
}

function resetDrop(d) {
  d.id = 0;
  d.kind = 'xp';
  d.x = 0;
  d.y = 0;
  d.vx = 0;
  d.vy = 0;
  d.value = 1;
  d.radius = 6;
  d.magnet = false;
  d.life = 0;
  d.bob = 0;
}

function resetDamageNumber(d) {
  d.id = 0;
  d.x = 0;
  d.y = 0;
  d.value = 0;
  d.life = 0;
  d.maxLife = 0.7;
  d.crit = false;
  d.kind = 'hit';
  d.merged = 1;
}

function resetParticle(p) {
  p.id = 0;
  p.x = 0;
  p.y = 0;
  p.vx = 0;
  p.vy = 0;
  p.life = 0;
  p.maxLife = 0.4;
  p.radius = 3;
  p.color = '#fff';
}

function resetMinion(m) {
  m.id = 0;
  m.x = 0;
  m.y = 0;
  m.vx = 0;
  m.vy = 0;
  m.hp = 20;
  m.maxHp = 20;
  m.damage = 8;
  m.radius = 12;
  m.speed = 170;
  m.life = 0;
  m.maxLife = 99999;
  m.targetId = 0;
  m.attackCd = 0;
  m.heads = 1;
  m.hitFlash = 0;
  m.facing = 0;
  m.plague = false;
  m.markStacks = 1;
}

function resetOrbit(b) {
  b.id = 0;
  b.ownerWeapon = null;
  b.angle = 0;
  b.radius = 70;
  b.count = 1;
  b.damage = 1;
  b.width = 8;
  b.height = 26;
  b.knockback = 0;
  b.hitCd = 0;
  b.color = '#fff';
}

function resetBeam(b) {
  b.id = 0;
  b.ownerWeapon = null;
  b.x = 0;
  b.y = 0;
  b.angle = 0;
  b.length = 520;
  b.width = 22;
  b.damage = 1;
  b.dps = 0;
  b.life = 0.3;
  b.maxLife = 0.3;
  b.pierce = 99;
  b.color = '#fff';
  b.beamTick = 0;
  b.sweepArc = 0;
}
