// 触控布局常量：屏幕上的按钮 + 摇杆（规格 §6 / US 21 / US 22）。
// main.js 的命中判定与 render2d.js 的绘制**必须共用这一份数字**，
// 否则会出现"看得到按不到"或"按到了别的东西"。

import { LOGIC_W, LOGIC_H } from '../config.js';

export const TOUCH = {
  // 闪避按钮
  dash: { r: 38, hitR: 50, cx: LOGIC_W - 16 - 50, cy: LOGIC_H - 16 - 50 },
  // 主动技能按钮（三把同系超武解锁后出现）
  skill: { r: 33, hitR: 45, cx: LOGIC_W - 16 - 47, cy: LOGIC_H - 16 - 145 },
  // 摇杆：**浮动式**。joy.guideX/guideY 只是"手放在哪"的提示圈，
  // 真正的原点在手指按下的位置（见 main.js 的 input.joyOrigin）。
  joy: { r: 62, hitR: 70, guideX: 12 + 62, guideY: LOGIC_H - 12 - 62 },
};

/** 浮动摇杆的触发区：左半边、避开顶部的暂停键。 */
export const JOY_REGION = { maxX: LOGIC_W * 0.45, minY: 80 };

export function resolveJoyOrigin(x, y, safe = null) {
  const r = TOUCH.joy.r;
  const g = safeAwareZones(safe).joy;
  // 夹在屏幕内，保证整个摇杆圈可见
  const lo = (v, min, max) => Math.max(min, Math.min(max, v));
  return {
    x: lo(x, r + 8, LOGIC_W - r - 8),
    y: lo(y, r + 8, LOGIC_H - r - 8),
    guideX: g.guideX,
    guideY: g.guideY,
  };
}

/** 是否落在浮动摇杆触发区 */
export function inJoyRegion(x, y) {
  return x <= JOY_REGION.maxX && y >= JOY_REGION.minY;
}

/** 命中测试：返回命中的控件名，或 null。safe 为设备安全区 inset（逻辑像素）。 */
export function hitTestTouch(x, y, safe = null) {
  const z = safeAwareZones(safe);
  if ((x - z.dash.cx) ** 2 + (y - z.dash.cy) ** 2 <= z.dash.hitR ** 2) return 'dash';
  if (z.skill && (x - z.skill.cx) ** 2 + (y - z.skill.cy) ** 2 <= z.skill.hitR ** 2) return 'skill';
  return null;
}

/** 把基准位置按安全区（刘海/圆角）内缩，返回实际生效的控件位置 */
export function safeAwareZones(safe) {
  const shift = { left: 0, right: 0, bottom: 0, top: 0 };
  if (safe) {
    shift.left = Math.max(0, (safe.left || 0) - 12);
    shift.right = Math.max(0, (safe.right || 0) - 12);
    shift.bottom = Math.max(0, (safe.bottom || 0) - 12);
  }
  return {
    joy: { ...TOUCH.joy, guideX: TOUCH.joy.guideX + shift.left, guideY: TOUCH.joy.guideY - shift.bottom },
    dash: { ...TOUCH.dash, cx: TOUCH.dash.cx - shift.right, cy: TOUCH.dash.cy - shift.bottom },
    skill: { ...TOUCH.skill, cx: TOUCH.skill.cx - shift.right, cy: TOUCH.skill.cy - shift.bottom },
  };
}

/** 自检用：控件不得重叠，且都要在逻辑画布内（安全区之外还有余量） */
export function touchLayoutProblems() {
  const problems = [];
  const g = TOUCH.joy;
  // 浮动摇杆的圆心能到最右，所以按"最大半径位置"和最右的闪避键比距离
  const joyRight = { cx: Math.min(LOGIC_W - 16, g.guideX + 200), cy: g.guideY };
  const d = Math.hypot(joyRight.cx - TOUCH.dash.cx, joyRight.cy - TOUCH.dash.cy);
  if (d <= g.hitR + TOUCH.dash.hitR) {
    problems.push(`joy 与 dash 命中区重叠（${d.toFixed(1)} ≤ ${g.hitR + TOUCH.dash.hitR}）`);
  }
  if (g.guideX - g.hitR < 0 || g.guideX + g.hitR > LOGIC_W || g.guideY - g.hitR < 0 || g.guideY + g.hitR > LOGIC_H) {
    problems.push('joy 提示圈超出逻辑画布');
  }
  const dz = TOUCH.dash;
  if (dz.cx - dz.hitR < 0 || dz.cx + dz.hitR > LOGIC_W || dz.cy - dz.hitR < 0 || dz.cy + dz.hitR > LOGIC_H) {
    problems.push('dash 超出逻辑画布');
  }
  if (TOUCH.skill.cx - TOUCH.skill.hitR < 0 || TOUCH.skill.cx + TOUCH.skill.hitR > LOGIC_W || TOUCH.skill.cy - TOUCH.skill.hitR < 0 || TOUCH.skill.cy + TOUCH.skill.hitR > LOGIC_H) {
    problems.push('skill 超出逻辑画布');
  }
  if (Math.hypot(dz.cx - TOUCH.skill.cx, dz.cy - TOUCH.skill.cy) <= dz.hitR + TOUCH.skill.hitR) {
    problems.push('dash 与 skill 命中区重叠');
  }
  if (JOY_REGION.maxX <= 0 || JOY_REGION.maxX >= dz.cx - dz.hitR) {
    problems.push('joy 触发区与闪避键重叠');
  }
  return problems;
}
