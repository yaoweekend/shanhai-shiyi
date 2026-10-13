// 环绕刃（兽甲旋刃）的绘制与判定位置必须完全一致：
// 刃的角位置 = blade.angle + (索引 / 数量) * TAU
// 这个函数同时给渲染层和测试用，避免两处各写一遍导致"看到的和打到的"不一致。
import { TAU } from '../core/math.js';

export function bladePositions(player, blades) {
  const out = [];
  const n = blades.length;
  for (let i = 0; i < n; i++) {
    const b = blades[i];
    const a = b.angle + (i / n) * TAU;
    out.push({
      angle: a,
      radius: b.radius,
      x: player.x + Math.cos(a) * b.radius,
      y: player.y + Math.sin(a) * b.radius,
      height: b.height,
      width: b.width,
      color: b.color,
    });
  }
  return out;
}

/** 判定用的刃上一点是否覆盖某个圆 */
export function bladeHitsPoint(blade, px, py, pr) {
  const reach = blade.height * 0.5 + 4;
  const dx = px - blade.x;
  const dy = py - blade.y;
  const rr = pr + reach * 0.6;
  return dx * dx + dy * dy <= rr * rr;
}

/**
 * 近战判定的"有效半径"。
 * 巨物（相柳 radius 58、精英放大后 80+）的真实碰撞半径远大于它看起来的"实体核心"，
 * 若直接用碰撞半径判定，半径 98 的环绕刃在贴脸时整圈都落在它体内 —— 近战对它几乎零伤害。
 * 所以对超大赛体做一次收缩：0.55 倍，其余单位不变（不会改变兽潮手感）。
 */
export function meleeRadiusOf(enemy) {
  const r = enemy && enemy.radius ? enemy.radius : 14;
  return r > 40 ? r * 0.55 : r;
}
