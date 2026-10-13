// 平衡测试的"玩家策略"：一个会玩但很笨的玩家。
//
// 关键认识：走位不是"离敌人越远越好"，而是围绕**当前武器的有效交战距离**做取舍。
//   · 近战（环绕/横扫）必须真的贴进刃带，所以有一段"贴上去"的行为
//   · 远程/落雷只需拖成一条尾巴，所以保持距离
//   · 永远有 60px 内的强排斥，避免被叠成一堆啃死
//   · 同时咬你的敌人越多、血越低，就越往外撤（否则就是送头）
//
// 没有这些，测出来的只是"某个固定风筝脚本能不能通关"，而不是"这一系能不能通关"。

import { WEAPON_BY_ID, levelStats } from '../src/content/weapons.js';

/** 当前武器想在什么距离上交战 */
export function idealRange(world) {
  let want = 200;
  for (const s of world.slots.weapons) {
    const def = WEAPON_BY_ID[s.id];
    if (!def) continue;
    const st = levelStats(def, s.level);
    let r = 200;
    switch (def.kind) {
      case 'orbit':
        r = (st.radius || 70) * (world.stats.area || 1) + 8;
        break;
      case 'sweep':
        r = (st.radius || 100) * (world.stats.area || 1) * 0.6;
        break;
      case 'boomerang':
        r = (st.range || 240) * 0.5;
        break;
      case 'beam':
        r = 250;
        break;
      case 'strike':
        r = 230;
        break;
      case 'zone':
        r = 190;
        break;
      case 'summon':
        r = 220;
        break;
      case 'projectile':
        r = 230;
        break;
      default:
        r = 200;
    }
    want = Math.min(want, r);
  }
  return Math.max(56, want);
}

export function kitingPolicy(world) {
  const p = world.player;
  const list = world.enemies.active;
  const base = idealRange(world);
  const hpFrac = p.hp / Math.max(1, p.maxHp);

  // 找最近敌人
  let closest = null;
  let closestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < closestD) {
      closestD = d;
      closest = e;
    }
  }

  let mx = 0;
  let my = 0;
  // ① 近身强排斥（叠一起会被啃死）
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 34) {
      const w = ((34 - d) / 34) * 2.6;
      mx += (dx / d) * w;
      my += (dy / d) * w;
    }
  }
  // ② 低血恐慌：整体向外撤
  if (hpFrac < 0.55) {
    const urgency = (0.55 - hpFrac) / 0.55;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 260) continue;
      const w = ((260 - d) / 260) * urgency * 1.6;
      mx += (dx / d) * w;
      my += (dy / d) * w;
    }
  }

  // ③ 主行为：按交战距离三段式
  if (!closest) {
    const dr = world.drops.active[0];
    if (dr) {
      mx += dr.x - p.x;
      my += dr.y - p.y;
    } else {
      mx += Math.cos(world.elapsedMs / 1200) * 100;
      my += Math.sin(world.elapsedMs / 1200) * 100;
    }
  } else {
    const dx = p.x - closest.x;
    const dy = p.y - closest.y;
    const d = closestD || 1;
    const nx = dx / d;
    const ny = dy / d;
    const side = world._kiteSide || (world._kiteSide = 1);
    const tx = -ny * side;
    const ty = nx * side;
    const inner = base * 0.8;
    const outer = base * 1.3;
    if (d > outer) {
      // 贴上去
      mx += -nx * 1.5 + tx * 0.15;
      my += -ny * 1.5 + ty * 0.15;
    } else if (d < inner) {
      // 拉开 + 绕
      mx += nx * 1.1 + tx * 0.55;
      my += ny * 1.1 + ty * 0.55;
    } else {
      // 合适距离：以切向为主绕圈
      mx += tx * 1.0 + nx * 0.12;
      my += ty * 1.0 + ny * 0.12;
    }
  }

  // ④ 竞技场边界排斥 + 中心弱吸引（别贴墙角被围死）
  const edge = 130;
  if (p.x < edge) mx += (edge - p.x) / edge * 1.4;
  if (p.x > 2400 - edge) mx -= (p.x - (2400 - edge)) / edge * 1.4;
  if (p.y < edge) my += (edge - p.y) / edge * 1.4;
  if (p.y > 1350 - edge) my -= (p.y - (1350 - edge)) / edge * 1.4;
  mx += (1200 - p.x) / 9000;
  my += (675 - p.y) / 9000;

  const len = Math.hypot(mx, my);
  if (len < 1e-6) {
    world.input.mx = 1;
    world.input.my = 0;
  } else {
    world.input.mx = mx / len;
    world.input.my = my / len;
  }
  world.input.dashRequested = closestD < 44 && p.dashCd <= 0;
}

/** 挂机：完全不动 */
export function idlePolicy(world) {
  world.input.mx = 0;
  world.input.my = 0;
  world.input.dashRequested = false;
}
