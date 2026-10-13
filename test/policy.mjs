// 自动选取升级卡（会玩的玩家模拟）。
// 策略：优先补齐武器到 3 把（每把 Lv5 是触发血统配方的前提），
// 然后拿被动凑配方，最后升级武器。
// 用于无头平衡测试与"能不能通关"的验收。

import { WEAPON_BY_ID } from '../src/content/weapons.js';
import { PASSIVE_BY_ID } from '../src/content/passives.js';
import { fusionOf, FUSIONS } from '../src/content/fusions.js';
import { SLOT_WEAPONS, SLOT_PASSIVES, WEAPON_MAX_LEVEL } from '../src/config.js';

/** 得分越高越优先 */
function scoreCard(world, card) {
  if (!card) return -1;
  if (card.type === 'weapon-new') {
    // 补齐到 3 把武器
    return world.slots.weapons.length < SLOT_WEAPONS ? 90 : -1;
  }
  if (card.type === 'passive') {
    const p = PASSIVE_BY_ID[card.passiveId];
    let s = 70;
    // 已经满级武器 → 优先拿它的配方被动
    for (const w of world.slots.weapons) {
      if (w.level >= WEAPON_MAX_LEVEL && !w.superId) {
        const f = fusionOf(w.id, card.passiveId);
        if (f) return 200;
      }
      if (f_fusionExists(w.id, card.passiveId)) s = Math.max(s, 110);
    }
    // 通用强度偏好
    const weights = { damage: 18, dr: 16, maxHp: 14, fireRate: 16, critChance: 14, projCount: 15, dot: 12, area: 12, speed: 10, regen: 10, lifesteal: 12, homing: 8, pierce: 10, projSpeed: 8, knockback: 6, pickup: 6, critMult: 8, split: 12, curse: 8, dashCd: 6, summonPower: 8, shield: 10, revive: 12, killHeal: 8 };
    s += (weights[p.channel] || 4);
    return s;
  }
  if (card.type === 'weapon-up') {
    const w = world.slots.weapons.find((x) => x.id === card.weaponId);
    if (!w) return -1;
    // 未满级的武器：尽快顶到 5 级去触发配方
    let s = 60 + w.level * 6;
    if (w.level === WEAPON_MAX_LEVEL - 1) s += 40;
    if (w.superId) s -= 50; // 已经超武了就不再喂
    return s;
  }
  return -1;
}

function f_fusionExists(weaponId, passiveId) {
  return !!fusionOf(weaponId, passiveId);
}

export function autoTakeCards(world) {
  let guard = 0;
  while (world.awaitingChoice && guard++ < 100) {
    let best = null;
    let bestScore = -1;
    for (const c of world.cardChoices) {
      const s = scoreCard(world, c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (!best || bestScore < 0) {
      // 没有可选的（理论上不会发生）→ 强行取第一张
      best = world.cardChoices[0];
    }
    if (!best || !world.takeCard(best)) break;
  }
  return world.slots;
}
