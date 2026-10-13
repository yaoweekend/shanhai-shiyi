// 纯数学工具。无副作用、无 DOM。

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

// 环形距离（竞技场边界环绕？—— 本作不环绕，用矩形夹取）
export function clampToArena(x, y, r, w, h) {
  return { x: clamp(x, r, w - r), y: clamp(y, r, h - r) };
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

// 圆 vs 圆
export function circleHit(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return dist2(ax, ay, bx, by) <= r * r;
}

// 圆 vs 轴对齐矩形
export function circleRectHit(cx, cy, cr, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  return dist2(cx, cy, nx, ny) <= cr * cr;
}

// 角度最短差
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// 朝目标转向（追踪用），rate 为 弧度/秒
export function turnToward(cur, target, rate, dt) {
  const d = angleDiff(cur, target);
  const step = rate * dt;
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

export function approach(cur, target, maxDelta) {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}

// 把角度夹到 [-PI, PI)
export function wrapAngle(a) {
  a %= TAU;
  if (a >= Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}
