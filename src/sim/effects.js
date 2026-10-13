// 钩子效果表：把"被动/超武"里的表述落成一条条可执行的钩子效果。
// 铁律（§3）：钩子只挂"已存在的通道效果"或"已有武器的一次开火"，不引入新通道。
//
// 复用关系（规格 §3：通道相乘 = 数值意外，钩子相乘 = 行为意外）：
//   祝融烬（dot 通道） + 命中分裂类效果   → 焚身（命中时给目标挂燃烧）
//   玄龟甲（dr 通道）  + 受伤时效果       → 龟息（受伤后短暂加防）
//   穷奇嗅（homing 通道）+ 波次时效果     → 嗅踪（波次开始短暂强化追踪）

import { EFFECT_KINDS, HOOKS } from '../core/hooks.js';

/**
 * 由 slots（武器/被动/超武）派生本局生效的钩子效果清单。
 * 纯函数：只读 slots，不读世界状态。
 */
export function buildEffects(slots, fusionById) {
  const effects = [];
  const push = (e) =>
    effects.push({
      lastFrame: -1,
      readyAt: 0,
      // 默认字段，避免读档后 undefined
      cooldown: 0,
      value: 0,
      ...e,
    });

  const hasPassive = (id) => slots.passives.includes(id);
  const hasSuper = (id) => slots.weapons.some((w) => w.superId === id && w.superId);
  const superOf = (weaponId) => {
    const w = slots.weapons.find((x) => x.id === weaponId);
    return w && w.superId ? fusionById[w.superId] : null;
  };

  // ---------- 命中时 ----------
  if (hasPassive('zhurongjin')) {
    // 焚身：命中时给直接命中目标挂燃烧（持续伤害通道）
    push({ id: 'e_burn', hook: HOOKS.ON_HIT, kind: EFFECT_KINDS.SPLIT_SHOT, mode: 'burn', interval: 0.25, label: '焚身（命中挂燃烧）' });
  }
  if (hasPassive('jiuweiyi')) {
    // 鳞落：命中时按弹道数再次开火（已有武器的一次开火）
    push({ id: 'e_split', hook: HOOKS.ON_HIT, kind: EFFECT_KINDS.SPLIT_SHOT, mode: 'refire', interval: 0.5, label: '鳞落（命中回响一次）' });
  }
  if (hasPassive('qiongqixiu')) {
    push({ id: 'e_homingburst', hook: HOOKS.ON_HIT, kind: EFFECT_KINDS.SPLIT_SHOT, mode: 'homing', value: 1.2, interval: 1.0, label: '嗅血（命中短时强化追踪）' });
  }

  // ---------- 击杀时 ----------
  if (hasPassive('bashetun')) {
    push({ id: 'e_killblast', hook: HOOKS.ON_KILL, kind: EFFECT_KINDS.KILL_BLAST, radius: 50, value: 9, label: '吞噬（击杀小范围爆炸）' });
  }
  const xiangliu = superOf('w_zhaoyin');
  if (xiangliu) {
    push({ id: 'e_killblast_super', hook: HOOKS.ON_KILL, kind: EFFECT_KINDS.KILL_BLAST, radius: 64, value: 14, label: '相柳（击杀爆毒）' });
  }
  const kuangshou = superOf('w_shoujia');
  if (kuangshou) {
    push({ id: 'e_killpush', hook: HOOKS.ON_KILL, kind: EFFECT_KINDS.KILL_BLAST, radius: 74, value: 6, knockback: 260, label: '狂兽环（击杀震退）' });
  }

  // ---------- 受伤时 ----------
  if (hasPassive('xuangui')) {
    push({ id: 'e_turtle', hook: HOOKS.ON_HURT, kind: EFFECT_KINDS.HURT_PULSE, channel: 'dr', value: 0.2, duration: 3, cooldown: 4, label: '龟息（受伤后 3 秒减伤 +20%）' });
  }
  if (hasPassive('kuiniu')) {
    push({ id: 'e_burst', hook: HOOKS.ON_HURT, kind: EFFECT_KINDS.HURT_PULSE, channel: 'speed', value: 0.4, duration: 2, cooldown: 4, label: '牛奔（受伤后 2 秒移速 +40%）' });
  }

  // ---------- 每 N 秒 ----------
  if (hasPassive('zhangqi') || hasPassive('zhurongjin')) {
    push({ id: 'e_cloud', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.CURSE_CLOUD, cd: 5, radius: 70, dps: 6, life: 2.6, label: '毒瘴（每 5 秒落下瘴气）' });
  }
  if (hasPassive('shanyueji')) {
    push({ id: 'e_regen_wave', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.HURT_PULSE, channel: 'regen', value: 1.5, duration: 4, cd: 10, label: '山息（周期性回血）' });
  }
  if (hasPassive('dangkangya')) {
    push({ id: 'e_pushwave', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.CURSE_CLOUD, cd: 6, radius: 90, dps: 0, knockback: 340, life: 0.2, label: '震地（周期性推开来敌）' });
  }
  if (hasPassive('jiaorenyan')) {
    push({ id: 'e_magnet', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.HURT_PULSE, channel: 'pickup', value: 120, duration: 3, cd: 12, label: '泪引（周期性大范围吸附）' });
  }
  if (hasPassive('kunpengyi')) {
    push({ id: 'e_piercepulse', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.HURT_PULSE, channel: 'pierce', value: 2, duration: 3, cd: 12, label: '鹏击（周期性强化穿透）' });
  }
  if (hasPassive('shenglouzhu')) {
    push({ id: 'e_speedpulse', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.HURT_PULSE, channel: 'projSpeed', value: 0.35, duration: 3, cd: 12, label: '蜃影（周期性弹速强化）' });
  }
  const zhulong = superOf('w_huanglei');
  if (zhulong) {
    push({ id: 'e_superlightning', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.CURSE_CLOUD, cd: 3, radius: 110, dps: 16, life: 0.5, strike: 30, label: '烛龙睁眼（周期性天罚）' });
  }
  const guidi = superOf('w_zhangqi');
  if (guidi) {
    push({ id: 'e_spread', hook: HOOKS.ON_TIMER, kind: EFFECT_KINDS.CURSE_CLOUD, cd: 4, radius: 100, dps: 12, life: 3.4, spread: true, label: '赤地（瘴气扩散）' });
  }

  // ---------- 波次开始时 ----------
  if (hasPassive('ling_shanwu')) {
    push({ id: 'e_wavefog', hook: HOOKS.ON_WAVE, kind: EFFECT_KINDS.WAVE_FREEZE, value: 0.5, duration: 2.5, label: '雾锁（波次开始全场减速）' });
  }
  if (hasPassive('qiongqixiu')) {
    push({ id: 'e_wavehunt', hook: HOOKS.ON_WAVE, kind: EFFECT_KINDS.HURT_PULSE, channel: 'homing', value: 4, duration: 4, label: '嗅踪（波次开始强化追踪）' });
  }
  const wangui = superOf('w_jingxi');
  if (wangui) {
    push({ id: 'e_wavebeam', hook: HOOKS.ON_WAVE, kind: EFFECT_KINDS.KILL_BLAST, radius: 130, value: 40, label: '归墟（波次开始光爆）' });
  }

  return effects;
}
