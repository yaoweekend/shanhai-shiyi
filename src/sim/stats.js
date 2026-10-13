// 通道求值与伤害结算（规格 §2 修饰器通道 / §3 触发钩子）。
// 这里是把"道具只改通道"落成代码的地方，也是"两件叠加会长出意外效果"的来源。

import { CHANNELS, CHANNEL_BY_ID, OPS } from '../core/channels.js';
import { PASSIVE_BY_ID } from '../content/passives.js';
import { CHARACTER_BY_ID } from '../content/characters.js';
import { fusionOf, ULTIMATE_FUSIONS } from '../content/fusions.js';
import { WEAPON_BY_ID, levelStats } from '../content/weapons.js';
import { RUN_T, PLAYER_BASE } from '../config.js';
import { HOOKS } from '../core/hooks.js';

/** 被动的当前等级（未记录 = 1 级）。 */
export function passiveLevelOf(world, pid) {
  return (world.passiveLevels && world.passiveLevels[pid]) || 1;
}

/** 角色微调折算成通道加成。
 *
 *  规格 §9：角色差异是「本系一条通道 +8%、另一条通道 −5%」，且**幅度不得超过 10%**。
 *  所以 `character.mods` 里的值**一律是百分比**（0.08 = +8%），`tools/check.mjs` 也是按
 *  `|value| <= 0.1` 校验的 —— 内容表里必须保持这个写法，不要图省事写成点数。
 *
 *  折算规则（按通道类型）：
 *   · 比率型（mul / addBase / cap）→ 直接作为该通道的增量（critChance +0.08 就是 +8%）
 *   · 点数型（add）→ 按其 base 的百分比折算成点数（maxHp −5% 且 base=170 → −8.5 点）
 *   · 特例 `dr`：它的 base 是 0（减伤从 0 起算），但"减伤 +8%"的语义是**减伤率 +8 个百分点**，
 *     所以按 1 折算，得到 0.08。若不特判，山魄的"减伤 +8%"会变成 0×0.08 = 0 而静默失效。
 *
 *  这个函数曾经统一写成 `sums[id] += c.base * v`：base 为 0 的通道（dr / dot / curse / shield）
 *  全部被吃掉，于是「山魄 减伤+8%」「荒魄 持续伤害+8%」「巫魄 诅咒+8%」这些角色特性
 *  一点都没生效 —— 不报错、不崩，只是这几个角色"没有特点"。
 */
function charBonus(charId, sums) {
  const ch = CHARACTER_BY_ID[charId];
  if (!ch) return;
  for (const id of Object.keys(ch.mods || {})) {
    const c = CHANNEL_BY_ID[id];
    if (!c) continue; // 通道表里没有的键忽略（防止笔误静默变成 NaN）
    const v = ch.mods[id];
    const ratioLike = c.op === OPS.MUL || c.op === OPS.ADD_BASE || c.op === OPS.CAP;
    if (ratioLike) sums[id] = (sums[id] || 0) + v;
    else if (id === 'dr') sums[id] = (sums[id] || 0) + v; // 减伤：按"百分点"直接加
    else sums[id] = (sums[id] || 0) + c.base * v;
  }
}

/**
 * 汇总当前位置上所有影响玩家的加成（不含临时 buff）。
 * @returns {{ sums: Record<string,number>, stats: Record<string,number> }}
 */
export function computeStats(world) {
  const sums = {};
  const add = (k, v) => {
    sums[k] = (sums[k] || 0) + v;
  };

  // ① 角色微调
  charBonus(world.characterId, sums);

  // ①.5 数值类兜底卡（全部升满之后才会出现），同样是通道加成
  if (world.bonusSums) {
    for (const k of Object.keys(world.bonusSums)) add(k, world.bonusSums[k]);
  }

  // ② 持有被动。被动现在可以升级：每级在上一次基础上 +60%
  //    （0.6 而不是 1.0，是为了不让 split / revive 这类"整数通道"被叠到离谱）。
  //    等级存在 world.passiveLevels，slots.passives 仍然是 id 字符串数组 ——
  //    这样 effects / fusions / UI 里所有 includes(pid) 的判断都不用改。
  for (const pid of world.slots.passives) {
    const p = PASSIVE_BY_ID[pid];
    if (!p) continue;
    const lv = Math.max(1, passiveLevelOf(world, pid));
    add(p.channel, p.value * (1 + (lv - 1) * (PLAYER_BASE.passiveLevelStep || 0.6)));
  }

  // ③ 超武：作用于该武器自身，不改全局通道（"超武效果"字段）
  //    其中一部分是全局通道（如狂兽环的击退、沧溟珠的分裂），在此折算。
  for (const w of world.slots.weapons) {
    if (!w.superId) continue;
    const f = world.fusionById[w.superId];
    if (!f || !f.mods) continue;
    const m = f.mods;
    if (m.knockback) add('knockback', m.knockback);
    if (m.split) add('split', m.split);
    if (m.dot) add('dot', m.dot);
    if (m.critBonus) add('critChance', m.critBonus);
    if (m.curseBonus) add('curse', m.curseBonus);
    if (m.lifesteal) add('lifesteal', m.lifesteal);
    if (m.regenBonus) add('regen', m.regenBonus);
    // damage 是"该武器"的乘区，在武器结算时用，不并入全局
  }

  // ③.5 已移除：旧的"本系 3 武器满级 + 3 被动 → 全局通道强化"终极系统
  // 被"四合一终极武器"取代（终极是一把真实武器，不是 stats 加成）。
  // 见 world.js 的 checkUltimateFusion 与 weapons.js 的 w_ult_*。

  // ③.6 合体终极武器对**全局通道**的贡献。
  //     目前只有昆仑的「玉璧」用得上：它的"持续回盾"给的是 **shield 通道的容量**
  //     （规格 §2：回盾走 shield 通道），所以它和昆仑系的护盾被动是**叠加**关系，
  //     而不是另开一套护盾系统 —— 没有这一条时 stats.shield 恒为 0，回盾无处可回。
  if (world.fusedWeapon) {
    const uf = ULTIMATE_FUSIONS.find((x) => x.id === world.fusedWeapon);
    const def = uf ? WEAPON_BY_ID[uf.weaponId] : null;
    const slot = uf ? (world.slots.weapons || []).find((w) => w.id === uf.weaponId) : null;
    if (def && slot) {
      const st = levelStats(def, slot.level);
      if (st.shieldCap) add('shield', st.shieldCap);
    }
  }

  // ④ 临时通道脉冲（钩子产生，例如受伤后短暂加速）
  if (world.player.buffs && world.player.buffs.length) {
    for (const b of world.player.buffs) {
      if (b.channel) add(b.channel, b.value);
    }
  }

  // ⑤ 折叠成最终值，再做硬上限与安全夹取
  const stats = {};
  for (const c of CHANNELS) {
    const s = sums[c.id] || 0;
    let v;
    switch (c.op) {
      case OPS.MUL:
      case OPS.ADD_BASE:
        v = c.base * (1 + s);
        break;
      case OPS.CAP:
        v = Math.min(c.base + s, c.hardCap);
        break;
      case OPS.COUNT:
        v = Math.max(0, Math.round(c.base + s));
        break;
      default:
        v = c.base + s;
    }
    if (!Number.isFinite(v)) v = c.base;
    if (c.min !== undefined && v < c.min) v = c.min;
    stats[c.id] = v;
  }
  // 硬规则：减伤与暴击率的硬上限（§2）永不被组合突破
  stats.dr = Math.min(stats.dr, CHANNEL_BY_ID.dr.hardCap - 0.001);
  stats.critChance = Math.min(stats.critChance, CHANNEL_BY_ID.critChance.hardCap - 0.001);
  stats.lifesteal = Math.min(stats.lifesteal, CHANNEL_BY_ID.lifesteal.hardCap);
  // dashCd 通道是"增量"（灵山雾 = −0.35 秒），但消费方要的是绝对秒数。
  // 之前这里直接 Math.max(0.35, stats.dashCd)：通道 base 是 0，于是闪避冷却恒等于
  // 下限 0.35 秒 —— 既等于无限无敌，也让"灵山雾"这件被动完全失效（真实老 bug）。
  stats.dashCd = Math.max(PLAYER_BASE.dashCdMin, PLAYER_BASE.dashCd + stats.dashCd);
  return { sums, stats };
}

/**
 * 对敌人造成伤害。返回实际造成的伤害（0 表示被无效化）。
 * @param {object} o { crit?: boolean, source?: string, viaHook?: boolean, hookId?: string, ignoreIframes?: boolean }
 */
export function dealDamage(world, enemy, amount, o = {}) {
  if (!enemy || !enemy.__alive) return 0;
  let amt = amount;
  const stats = world.stats;
  // 暴击
  let crit = !!o.crit;
  if (o.rollCrit !== false && o.source !== 'dot') {
    if (world.rng.next() < stats.critChance) crit = true;
  }
  if (crit) amt *= stats.critMult;
  // 诅咒不再是无条件的全局易伤：它现在在下面"标记"块里，只对已标记者生效。
  // 巫蛊标记：每层 +12% 受伤，最多 3 层（灵山系武器的核心减益）。
  // 诅咒（stats.curse）**只对已标记的目标生效**，且每层再追加一层（平衡规格 §2③）：
  //   加成 = 诅咒 + 0.12 × 层数（层数最多 3 → 最多再 +0.36）
  // 之前诅咒是无条件的全局易伤 —— 那等于"不用叠标记也有收益"，把灵山的核心操作打没了。
  let markAmp = 0;
  if (enemy.mark > 0 && world.elapsedMs < enemy.markUntil) {
    const before = amt;
    const stacks = Math.min(3, enemy.mark);
    amt *= 1 + stacks * 0.12;
    if (stats.curse > 0) amt *= 1 + stats.curse + 0.12 * stacks;
    markAmp = amt - before;
  }
  // 以守为攻（昆仑 · 平衡规格 §3②）：每 10 点**当前护盾** → +3.5% 全局伤害，上限 +35%。
  // 放在乘区链的最后一环 = 真正"全局"（对所有来源生效，含玉璧环的接触伤害与反弹弹）。
  // 它由"持有护盾"自解释，所以除了 stats.shieldDamage（通道或将来接别的来源）之外，
  // 只要**玉璧环在场上**（合体完成）就生效 —— 对应"终极武器主动把护盾换算成伤害"的定位。
  const shieldScaling = (stats.shieldDamage || 0) > 0 || !!(world.ultBulwark && world.ultBulwark.active);
  if (shieldScaling) {
    const g = Math.min(0.35, (world.player.shield || 0) * 0.0035);
    if (g > 0) amt *= 1 + g;
  }
  // 持续伤害不吃暴击
  if (o.source === 'dot') crit = false;
  amt = Math.max(0, amt);
  // 标记的放大器增量单独记账（供「百巫」的归因口径使用：标记本身不产生伤害，
  // 它放大的是别的来源的伤害 —— 见 specs/shanhai-ultimate-rework.md 的规格张力 1）。
  if (markAmp > 0) {
    world.runStats.markAmpDamage = (world.runStats.markAmpDamage || 0) + Math.min(markAmp, Math.max(0, enemy.hp));
  }
  // 有效输出计量（只算真正扣掉的血，避免溢出伤害虚高）。
  // 合体（终极武器）的平衡硬要求是"每秒输出 ≥ 被替换的四把满级武器总输出的 1.5 倍"，
  // 这条口径就是为那句验收准备的（见 test/batch1-rework.mjs 的平衡用例）。
  const removed = Math.min(amt, Math.max(0, enemy.hp));
  world.runStats.damageDealt = (world.runStats.damageDealt || 0) + removed;
  enemy.hp -= amt;
  enemy.hitFlash = 0.12;
  // 吸血
  if (stats.lifesteal > 0 && amt > 0) {
    healPlayer(world, amt * stats.lifesteal, true);
  }
  if (world.showDamageNumbers !== false) pushDamageNumber(world, enemy.x, enemy.y, amt, crit);
  if (enemy.hp <= 0) killEnemy(world, enemy, o);
  return amt;
}

export function healPlayer(world, amount, silent = false) {
  const p = world.player;
  if (amount <= 0) return 0;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const gained = p.hp - before;
  if (gained > 0 && !silent) pushDamageNumber(world, p.x, p.y - 18, gained, false, 'heal');
  return gained;
}

export function killEnemy(world, enemy, o = {}) {
  if (!enemy.__alive) return;
  world.runStats.kills += 1;
  world.runStats.killsTotal += 1;
  // 击杀回血（昆仑通道，本轮无来源但逻辑就位）
  if (world.stats.killHeal > 0) healPlayer(world, world.stats.killHeal, true);
  // 掉落。调参面板的掉落倍率作用在"这颗球值多少经验"上（保持随机数与掉落个数不变，
  // 这样调它不会顺带改变别的随机结果）。
  const dropXp = enemy.xp * ((world.dropMul && world.dropMul !== 1) ? world.dropMul : 1);
  spawnDrop(world, enemy.x, enemy.y, dropXp, enemy.isBoss, { elite: enemy.elite });
  if (enemy.isBoss) {
    world.bossDefeated = true;
    world.bossActive = false;
    // 击杀相柳 = 通关，两种模式一致（规格 §7：无尽不是"另一种胜利"，是通关后继续）。
    world.outcome = 'win';
    if (world.endless) {
      // 无尽：结算不结束这一局，而是把刷怪日程倒回起点重放（时间轴循环），
      // 同时 +1 周 —— 周数通过 tierBonusOf 直接抬高敌人生命/速度/伤害。
      world.endlessCycle = (world.endlessCycle || 0) + 1;
      const sp = world.spawner;
      if (sp) {
        sp.bossSpawned = false;
        sp.warnFired = false;
        sp.eliteIdx = 0;
        sp.waveIndex = -1;
      }
      world.endlessOffsetMs = (world.endlessOffsetMs || 0) + RUN_T.bossAt * 1000;
      world.hint(`无尽 第 ${world.endlessCycle + 1} 周`, 3200);
    } else {
      world.running = false;
    }
  }
  // 击杀时钩子
  world.fireHook(HOOKS.ON_KILL, { x: enemy.x, y: enemy.y, enemy, viaHook: !!o.viaHook, hookId: o.hookId });
  // 灵山终极「百巫夜行」：被蛊毒标记的敌人死亡时爆毒雾并把标记传染（层数上限由 world 把关）。
  // 注意要放在待回收队列之前 —— 对象一进队列，下一帧 resetEnemy 就会把这些字段写回默认值。
  if (enemy.mark > 0 && world.onMarkedDeath) world.onMarkedDeath(enemy);
  if (enemy.kind === 'xinang' && enemy.ai === 'suicide') {
    explode(world, enemy.x, enemy.y, enemy.boomRadius || 62, enemy.boomDamage || 20);
  }
  world.pendingKillRecycle.push(enemy);
}

/** 自爆 / 死亡爆炸：对玩家造成伤害（敌人来源的爆炸只伤玩家） */
export function explode(world, x, y, radius, damage) {
  const p = world.player;
  const dx = p.x - x;
  const dy = p.y - y;
  if (dx * dx + dy * dy <= radius * radius) hurtPlayer(world, damage);
  spawnParticles(world, x, y, 8, '#ff9a5a');
}

export function hurtPlayer(world, damage, o = {}) {
  const p = world.player;
  const now = world.elapsedMs;
  if (!o.ignoreIframes && now < p.iframeUntil) return 0;
  // 调参面板的"无敌"：直接不吃伤害（默认 false，正式包行为不变）
  if (world.invincible) return 0;
  // 等级韧性：随等级缓慢下降的受创倍率（等级 20 时约 −28%）。
  // 硬上限仍是 §2 的减伤 <80%：韧性只做乘法，永远不会突破上限。
  const levelMitigation = Math.min(0.35, (p.level - 1) * 0.015);
  let amt = damage * (1 - world.stats.dr) * (1 - levelMitigation);
  amt = Math.max(1, amt);
  // 复活层（昆仑通道）
  if (p.shield > 0) {
    const absorbed = Math.min(p.shield, amt);
    p.shield -= absorbed;
    amt -= absorbed;
  }
  // 昆仑主动技「不死药」：数秒内不会死亡 —— 血量锁在最低值（1），
  // 受到的伤害优先消耗护盾（上面已经吃过了），所以只有护盾见底后才压到 1 点血。
  const undying = world.undyingUntil && now < world.undyingUntil;
  if (amt > 0) {
    if (undying) p.hp = Math.max(1, p.hp - amt);
    else p.hp -= amt;
  }
  // 近战轮空：一屏 300 只怪时，如果每只都能独立打你，
  // 玩家会在几秒内被"叠加的接触伤害"融化 —— 这不是难，是不讲道理。
  // 所以接触伤害有自己的轮空档（比子弹/爆炸的 0.7s 更短，手感更"连续挨打"）。
  p.iframeUntil = now + (o.iframeMs === undefined ? 700 : o.iframeMs);
  p.hitFlash = 0.25;
  world.shake = Math.max(world.shake, 5);
  pushDamageNumber(world, p.x, p.y - 22, damage, false, 'hurt');
  // 受伤时钩子
  world.fireHook(HOOKS.ON_HURT, { x: p.x, y: p.y });
  if (p.hp <= 0) {
    if (p.reviveLayers > 0) {
      p.reviveLayers -= 1;
      p.hp = p.maxHp * 0.5;
      p.iframeUntil = now + 1600;
      world.hint('复活！命不该绝', 2600);
    } else {
      p.hp = 0;
      world.outcome = 'dead';
      world.running = false;
    }
  }
  return amt;
}

/**
 * 敌人触碰玩家的统一入口。
 * 关键在于 iframeMs：接触伤害必须被节流，否则同屏兽潮会变成秒杀。
 */
export function hurtByContact(world, enemy, o = {}) {
  const amount = (enemy && enemy.touchDamage ? enemy.touchDamage : 1) * (o.mul === undefined ? 1 : o.mul);
  // 接触伤害的轮空档。520ms 是实测调出来的：
  // 650ms 时成型角色只承受约 1.3 DPS 的接触伤害，6 个角色里 4 个站桩就能通关；
  // 450ms 又过硬（山魄通关率掉到 33%）。520ms 下站桩通关只剩守护系 1 个。
  return hurtPlayer(world, amount, { ...o, iframeMs: o.iframeMs === undefined ? 520 : o.iframeMs });
}

// ---- 表现层事件（渲染层只读；模拟层不引用任何渲染 API）----

export function pushDamageNumber(world, x, y, value, crit, kind = 'hit') {
  const list = world.damageNumbers.active;
  if (list.length >= world.damageNumbers.cap) {
    // 满了就合并到最近的一个，而不是丢弃信息
    const last = list[list.length - 1];
    if (last && Math.abs(last.x - x) < 24 && Math.abs(last.y - y) < 24) {
      last.value += value;
      last.merged += 1;
      last.life = last.maxLife;
      return;
    }
    return;
  }
  const d = world.damageNumbers.spawn();
  if (!d) return;
  d.id = world.nextId();
  d.x = x + (world.rng.next() - 0.5) * 10;
  d.y = y - 6;
  d.value = value;
  d.crit = !!crit;
  d.kind = kind;
  d.life = d.maxLife;
  d.merged = 1;
}

export function spawnParticles(world, x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const p = world.particles.spawn();
    if (!p) return;
    p.id = world.nextId();
    p.x = x;
    p.y = y;
    const a = world.rng.next() * Math.PI * 2;
    const s = 40 + world.rng.next() * 120;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = 0.35;
    p.maxLife = 0.35;
    p.radius = 2 + world.rng.next() * 2;
    p.color = color;
  }
}

export function spawnDrop(world, x, y, xp, isBoss, opts = {}) {
  if (isBoss) return;
  const full = world.drops.active.length >= world.drops.cap;
  if (full) {
    // 池满时把经验并入**离这次击杀最近**的经验球，而不是列表里的第一个。
    // （原来固定并入 active[0]：那是场上最老的球，通常远在玩家早先路过的地方，
    //   结果 400 个球的池子被一个死经验堆占住，玩家实际收集率掉到 8–12%，
    //   等级在 4–7 分钟整段卡死 —— 这是"后期打不动"的真正原因。）
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < world.drops.active.length; i++) {
      const d = world.drops.active[i];
      if (d.kind !== 'xp') continue;
      const dd = (d.x - x) * (d.x - x) + (d.y - y) * (d.y - y);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    if (best) {
      best.value += Math.max(1, Math.round(xp));
      return;
    }
    return;
  }
  const d = world.drops.spawn();
  if (!d) return;
  d.id = world.nextId();
  // 回血掉落率与同屏密度一起标定。
  // 实测教训（重要）：密度拉到 40+/s 之后，"击杀数 × 回血率"会变成一台永动机 ——
  // 6 个角色里有 4 个**站桩就能通关**（走位完全没意义）。
  // 所以回血必须与"击杀量"解耦：改成更低的掉率 + 同时存在的回血物有上限，
  // 让主动走位成为维持血线的主要手段。
  const activeHeals = (() => {
    let n = 0;
    for (let i = 0; i < world.drops.active.length; i++) if (world.drops.active[i].kind === 'heal') n++;
    return n;
  })();
  const healChance = opts.elite ? 0.4 : 0.008;
  if ((opts.forceHeal || world.rng.next() < healChance) && (opts.elite || activeHeals < 10)) {
    d.kind = 'heal';
    d.value = opts.elite ? 22 : 5;
    d.radius = 8;
  } else {
    d.kind = 'xp';
    d.value = Math.max(1, Math.round(xp));
    d.radius = 6;
  }
  d.x = x;
  d.y = y;
  d.vx = 0;
  d.vy = 0;
  d.magnet = false;
  // 经验球不设寿命（life 留 0，表示"不过期"）：它永久留在被击杀的位置，
  // 玩家走位回来就能收。无界增长交给掉落池容量兜底（满了并入最近的球）。
  // 回血物仍给 10 秒寿命 —— 它是"应急资源"，留在场上太久会让血线管理失去意义。
  d.life = d.kind === 'heal' ? 10000 : 0;
  d.bob = world.rng.next() * Math.PI * 2;
}
