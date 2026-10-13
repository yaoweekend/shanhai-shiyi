// 5 个触发钩子（规格 §3）。
// 钩子上只挂"已存在的通道效果"或"已有武器的一次开火"，不引入新通道。
// 递归防护：由钩子触发的伤害不再触发同类钩子（同一帧内同一钩子最多触发一次）。
//
// 实现取舍：钩子订阅**不是闭包**，而是从 world.effects 数组（由 slots 派生）读取的
// 纯数据描述。这样存档只需存 slots，读档后重建 effects 即可，且全程可序列化。

export const HOOKS = {
  ON_HIT: 'onHit',
  ON_KILL: 'onKill',
  ON_HURT: 'onHurt',
  ON_TIMER: 'onTimer',
  ON_WAVE: 'onWave',
};

export const HOOK_LIST = [
  { id: HOOKS.ON_HIT, cn: '命中时' },
  { id: HOOKS.ON_KILL, cn: '击杀时' },
  { id: HOOKS.ON_HURT, cn: '受伤时' },
  { id: HOOKS.ON_TIMER, cn: '每 N 秒' },
  { id: HOOKS.ON_WAVE, cn: '波次开始时' },
];

export const EFFECT_KINDS = {
  SPLIT_SHOT: 'splitShot', // 命中时：额外生成子弹（已有武器的一次开火）
  KILL_BLAST: 'killBlast', // 击杀时：范围伤害
  HURT_PULSE: 'hurtPulse', // 受伤时：短时通道加成
  CURSE_CLOUD: 'curseCloud', // 每 N 秒：在身边落下持续伤害区域
  WAVE_FREEZE: 'waveFreeze', // 波次开始时：全场减速
};

export const MAX_CHAIN = 3;

/**
 * 触发钩子。
 * @param {object} world
 * @param {string} hookId
 * @param {object} payload { x, y, enemy?, chain?, viaHook? }
 * @returns {number} 实际触发的效果数
 */
export function fireHook(world, hookId, payload) {
  const list = world.effects;
  if (!list || list.length === 0) return 0;
  const chain = (payload.chain | 0) + 1;
  if (chain > MAX_CHAIN) return 0;
  // 钩子产生的伤害不再触发同类钩子
  if (payload.viaHook && payload.hookId === hookId) return 0;
  const frame = world.frame;
  let fired = 0;
  for (const eff of list) {
    if (eff.hook !== hookId) continue;
    if (eff.lastFrame === frame) continue; // 同一帧内同一钩子对同一效果最多一次
    if (eff.cooldown > 0 && world.elapsedMs < eff.readyAt) continue;
    eff.lastFrame = frame;
    if (eff.cooldown > 0) eff.readyAt = world.elapsedMs + eff.cooldown;
    world.applyEffect(eff, payload, chain);
    fired++;
  }
  return fired;
}
