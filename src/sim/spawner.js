// 刷怪调度（规格 §7 一局节奏）。
// 刷怪位置：环形生成，且大部分刷新在玩家移动方向的前方。

import { ARENA_W, ARENA_H, RUN_T, TIER_PERIOD, CAP_ENEMIES } from '../config.js';
import { ENEMIES, AFFIXES, BOSS, enemyStatsFor, tierOf, tierBonusOf } from '../content/enemies.js';
import { TAU } from '../core/math.js';

// 各档位的"目标同屏数量"与"每秒生成数"。
// 关键认识：密度不能只按"目标同屏数"定，还要看**玩家每秒能杀多少**。
// 实测：玩家击杀速度可达 20/s，若生成速率低于它，场上永远是空的（"太强"的根源）。
// 但生成速率也不能一味拉高：超过玩家击杀速度之后，多出来的怪不是"更热闹"，
// 而是变成一圈永不消散的接触伤害源 —— 实测 6–8 分钟（tier3–4）死亡率陡增。
// 所以 5 档之后只缓涨，把"墙"挡在 tier5。
// 2026-09 重标：升级曲线放缓后玩家前期成型更快（3 分钟 6000 击杀），
// 原表低中档会被清空（同屏只剩 9 只），因此前 5 档的生成速率整体上调约 1.4 倍。
const TIER_TABLE = [
  { alive: 32, rate: 7.2 },
  { alive: 62, rate: 14.5 },
  { alive: 96, rate: 23.0 },
  { alive: 120, rate: 26.0 },
  { alive: 155, rate: 30.0 },
  { alive: 180, rate: 33.0 },
  { alive: 205, rate: 36.0 },
  { alive: 230, rate: 38.0 },
  { alive: 250, rate: 40.0 },
];

export function tierParams(tier) {
  return TIER_TABLE[Math.min(TIER_TABLE.length - 1, tier)];
}

/** 远程敌人（毕方）的同屏硬上限。见 updateSpawner 里的说明：限制数量比调权重可控。 */
export const RANGED_ALIVE_CAP = 12;

export function createSpawner() {
  return {
    acc: 0,
    eliteIdx: 0,
    bossSpawned: false,
    warnFired: false,
    waveIndex: 0,
    lastTier: 0,
    spawnedTotal: 0,
  };
}

/** 波次序号 = 每 30 秒一个波次（用于"波次开始时"钩子）*/
export function waveIndexOf(elapsedMs) {
  return Math.floor(elapsedMs / 30000);
}

/**
 * 调参面板：取（必要时初始化）某种敌人的运行时调参项。
 * from 为 null = 用内容表的默认出现时间（规格 §3C：每种敌人的 from 可调）。
 */
function tuneFor(world, id) {
  const tune = world.tune;
  if (!tune || !tune.enemies) return null;
  let e = tune.enemies[id];
  if (!e) {
    e = { on: true, count: 1, weight: 1, from: null };
    tune.enemies[id] = e;
  }
  return e;
}

function pickKind(rng, world, elapsedMs, allowRanged) {
  const tune = world.tune;
  const pool = [];
  for (const e of Object.values(ENEMIES)) {
    const t = tune ? tuneFor(world, e.id) : null;
    if (t && t.on === false) continue;
    const from = t && t.from !== null && t.from !== undefined ? t.from : e.from;
    if (from > elapsedMs) continue;
    if (!allowRanged && e.ai === 'ranged') continue;
    const weight = t ? e.weight * t.weight : e.weight;
    if (!(weight > 0)) continue;
    pool.push({ id: e.id, weight });
  }
  if (pool.length === 0) return ENEMIES.shanxiao.id;
  let total = 0;
  for (const e of pool) total += e.weight;
  let r = rng.next() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) return e.id;
  }
  return pool[0].id;
}

/** 环形生成位置；forwardBias 让大部分刷新落在玩家移动方向的前方 */
export function spawnPosition(rng, px, py, moveAngle, forwardBias = 0.62) {
  const ring = 420 + rng.next() * 180;
  let a;
  if (moveAngle === null || moveAngle === undefined) {
    a = rng.next() * TAU;
  } else if (rng.next() < forwardBias) {
    a = moveAngle + (rng.next() - 0.5) * (TAU * 0.55);
  } else {
    a = rng.next() * TAU;
  }
  let x = px + Math.cos(a) * ring;
  let y = py + Math.sin(a) * ring;
  // 夹到竞技场内；贴边时向中心推
  if (x < 24) x = 24 + rng.next() * 90;
  if (x > ARENA_W - 24) x = ARENA_W - 24 - rng.next() * 90;
  if (y < 24) y = 24 + rng.next() * 90;
  if (y > ARENA_H - 24) y = ARENA_H - 24 - rng.next() * 90;
  return { x, y };
}

/**
 * 每 tick 调用。返回本 tick 需要生成的敌人描述数组（由 world 负责实例化）。
 */
export function updateSpawner(world, dt) {
  const sp = world.spawner;
  const rng = world.rng;
  // elapsedMs 是"真实局时长"（单调递增，相机/存档/节拍都依赖它）。
  // 无尽续周时不能把它倒回去，所以刷怪日程单独减掉已完成的周时长，
  // 让 0:30 / 2:00 精英 / 10:00 Boss 这套日程能被重放。
  const t = world.elapsedMs - (world.endlessOffsetMs || 0);
  const out = [];
  const tune = world.tune || null;
  const autoTier = tierOf(t, TIER_PERIOD * 1000) + tierBonusOf(world.endlessCycle);
  // 手调难度档（面板）：≥0 时压过"每 2 分钟一档"
  const tier = tune && tune.tier >= 0 ? tune.tier : autoTier;
  const params = tierParams(tier);

  const newWave = waveIndexOf(t);
  if (newWave !== sp.waveIndex) {
    sp.waveIndex = newWave;
    world.pendingWaveStart = newWave;
  }
  sp.lastTier = tier;

  // 9:30 清场预警（由 world 处理表现层）
  if (t >= RUN_T.warnAt * 1000 && !sp.warnFired) {
    sp.warnFired = true;
    world.bossWarning = true;
  }

  // 10:00 Boss 登场
  if (t >= RUN_T.bossAt * 1000 && !sp.bossSpawned) {
    sp.bossSpawned = true;
    out.push({ kind: 'boss', boss: true, x: ARENA_W / 2, y: ARENA_H / 2 - 120, tier });
    world.bossActive = true;
  }

  // 精英登场：基准是 4 次（2:00 / 4:00 / 6:00 / 8:00，见 RUN_T.eliteTimes）。
  // 调参面板的「精英频率」按间隔反比生效：间隔 = 120 / 频率（0 = 完全关掉精英）。
  //
  // ⚠️ **默认路径必须逐值还原**：不开面板时走上面那条硬编码日程，随机数消耗与改动前
  //    完全一致（否则同一 seed 的整条兽潮都会跟着变 —— 通关率回归 41/0 → 39/2 就是栽在这）。
  //    只有 `?dev=tune` 把 elite 调离 1 时才走"按间隔补"的分支。
  const eliteMul = tune && Number.isFinite(tune.elite) ? tune.elite : 1;
  if (eliteMul === 1) {
    while (sp.eliteIdx < RUN_T.eliteTimes.length && t >= RUN_T.eliteTimes[sp.eliteIdx] * 1000) {
      const affix = AFFIXES[(sp.eliteIdx * 3 + 1) % AFFIXES.length];
      const kind = pickKind(rng, world, t, t >= RUN_T.rangedFrom * 1000);
      const pos = spawnPosition(rng, world.player.x, world.player.y, world.moveAngle);
      out.push({ kind, elite: true, affix: affix.id, tier, x: pos.x, y: pos.y });
      sp.eliteIdx++;
    }
  } else if (eliteMul > 0) {
    const eliteEvery = Math.max(15, (RUN_T.eliteTimes[1] || 120) / eliteMul);
    const wantIdx = Math.floor(t / 1000 / eliteEvery);
    while (sp.eliteIdx < wantIdx) {
      const idx = sp.eliteIdx;
      const affix = AFFIXES[(idx * 3 + 1) % AFFIXES.length];
      const kind = pickKind(rng, world, t, t >= RUN_T.rangedFrom * 1000);
      const pos = spawnPosition(rng, world.player.x, world.player.y, world.moveAngle);
      out.push({ kind, elite: true, affix: affix.id, tier, x: pos.x, y: pos.y });
      sp.eliteIdx++;
    }
  }

  // 空窗期：0:00–0:30 只有零星弱敌
  if (t < RUN_T.graceEnd * 1000) {
    sp.acc += dt * 0.75;
    while (sp.acc >= 1 && world.enemies.active.length + out.length < 18) {
      sp.acc -= 1;
      const pos = spawnPosition(rng, world.player.x, world.player.y, world.moveAngle, 0.4);
      out.push({ kind: 'shanxiao', tier: 0, weak: true, x: pos.x, y: pos.y });
    }
    return out;
  }

  // Boss 战期间降低普通怪密度（让 Boss 有存在感，也保护性能）
  const densityScale = world.bossActive ? 0.35 : 1;
  // 空窗期结束后的爬坡：消掉"45 秒突然涌出一堆"的悬崖。
  //
  // 关键教训（用户报过两次"50 秒怪突然变多"，第一次只改了"速率"没解决）：
  // 光让**生成速率**爬坡是不够的 —— **同屏上限本身也是跳变的**：
  // 空窗期的实际上限约 10 只，一到 graceEnd 就切成档位表的 32 只，
  // 容量一下放大 3 倍，怪物照样在几秒内灌满。实测修前：
  //   48s 13 只 → 52s 18 只 → 58s 25 只（两秒 +7 只）
  // 所以速率与上限**必须一起爬**，而且上限爬得更慢（容量一放开就立刻被填满）。
  const rampSince = Math.max(0, t - RUN_T.graceEnd * 1000);
  const rampFull = TIER_PERIOD * 2 * 1000; // 约 4 分钟爬满
  const ramp = Math.min(1, 0.4 + 0.6 * (rampSince / rampFull));
  const aliveCap = Math.max(12, Math.round(params.alive * Math.min(1, 0.42 + 0.58 * (rampSince / rampFull))));
  const alive = world.enemies.active.length;
  if (alive + out.length < Math.min(CAP_ENEMIES, aliveCap)) {
    // 调参面板：生成速率倍率
    const rateMul = tune && Number.isFinite(tune.spawn) ? tune.spawn : 1;
    sp.acc += dt * params.rate * densityScale * ramp * rateMul;
    // 远程敌人的同屏硬上限（用户报：后期发射弹幕的怪太多，难度过高）。
    // 毕方是唯一的远程单位，权重 22/90 ≈ 24%；后期生成 33/s 时每秒入场约 8 只、
    // 每只每 2.4 秒一发 —— 不需要很久弹幕就会糊满屏幕，而那既不公平也很伤性能
    // （玩家弹与敌方弹共用 800 的池子，敌人弹幕多了会挤掉玩家自己的弹）。
    // 限制同屏数量比调权重更可控：近战兽潮的密度完全不受影响。
    let rangedAlive = 0;
    for (const e of world.enemies.active) if (e.ai === 'ranged') rangedAlive++;
    let guard = 0;
    while (sp.acc >= 1 && guard++ < 12) {
      sp.acc -= 1;
      const allowRanged = t >= RUN_T.rangedFrom * 1000;
      let kind = pickKind(rng, world, t, allowRanged);
      if (allowRanged && rangedAlive >= RANGED_ALIVE_CAP) {
        // 到上限了就换一个近战单位，而不是干脆不生成（保持总密度不变）
        kind = pickKind(rng, world, t, false);
      }
      if (kind === 'bifang') rangedAlive++;
      // 调参面板：每种敌人的数量倍率（0 = 该种类不再生成）
      const cnt = tune ? tuneFor(world, kind).count : 1;
      if (!(cnt > 0)) continue;
      const copies = Math.max(1, Math.round(cnt));
      for (let c = 0; c < copies; c++) {
        // 先算位置再加进 out：`continue` 必须发生在 push **之前**，
        // 否则"数量倍率 0"会先入队再被跳过判定无效（实测漏掉过：倍率 0 照样生成）
        const pos = spawnPosition(rng, world.player.x, world.player.y, world.moveAngle);
        out.push({ kind, tier, x: pos.x, y: pos.y });
      }
    }
  } else {
    sp.acc = 0;
  }
  return out;
}

/** 由 world 调用的便捷包装：使用内容表算好数值 */
export function describeSpawn(req) {
  if (req.boss) {
    return {
      kind: BOSS.id,
      isBoss: true,
      hp: BOSS.hp,
      speed: BOSS.speed,
      radius: BOSS.radius,
      touchDamage: BOSS.touchDamage,
      xp: 0,
      ai: 'boss',
      shape: 'boss',
      scale: 1,
    };
  }
  const s = enemyStatsFor(req.kind, req.tier, { elite: req.elite, affix: req.affix, weak: req.weak });
  return { kind: req.kind, isBoss: false, ...s };
}
