// 渲染层（规格 §11 性能与渲染 / §12 美术）。
// 铁律（§0）：渲染层只读模拟状态，绝不写回；模拟层也不引用这里的任何东西。
//
// 画布策略：固定逻辑分辨率 960×540 + 等比缩放留黑边（letterbox），不做自适应拉伸。
// 安全区：HUD 元素按 CSS 变量注入的安全区 inset 内缩，避开刘海与圆角。

import { LOGIC_W, LOGIC_H, ARENA_W, ARENA_H, SLOT_WEAPONS, SLOT_PASSIVES } from '../config.js';
import { getAsset, passiveIconSlot } from '../assets/generator.js';
import { SERIES } from '../content/series.js';
import { WEAPON_BY_ID, levelStats } from '../content/weapons.js';
import { PASSIVE_BY_ID } from '../content/passives.js';
import { FUSION_BY_ID, ACTIVE_SKILL_BY_ID } from '../content/fusions.js';
import { BOSS } from '../content/enemies.js';
import { QUALITY } from '../config.js';
import { TOUCH } from './touch-layout.js';
import { bladePositions } from './orbit-view.js';
import { drawWeaponShape } from './weapon-shapes.js';
import { visualOf } from '../content/weapon-visuals.js';

/** 把任意值夹到 [0,1]，NaN 视为 0 */
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 半径兜底：负数/NaN/Infinity 会让 ctx.arc 抛异常，直接夹到合法值 */
function safeR(r) {
  if (!Number.isFinite(r)) return 0;
  return r < 0 ? 0 : r;
}

/**
 * 半径非法的 canvas 调用会让整条渲染链抛异常，而它跑在主循环里 →
 * requestAnimationFrame 断掉 → 画面永久定格。所有 arc() 都走这里。
 * 注意：内部必须调用 ctx.arc（而不是 arc），否则会无限递归。
 */
function arc(ctx, x, y, r, a0, a1) {
  try {
    ctx.arc(x, y, safeR(r), a0 === undefined ? 0 : a0, a1 === undefined ? Math.PI * 2 : a1);
  } catch (e) {
    // 单个图形画不出来不该影响其他图形
  }
}

/** 半径非法的径向渐变同样会抛异常 */
function radial(ctx, x0, y0, r0, x1, y1, r1) {
  try {
    return ctx.createRadialGradient(x0, y0, safeR(r0), x1, y1, safeR(r1));
  } catch (e) {
    return null;
  }
}

/** #rrggbb → rgba(...)，用于渐变里的低透明度颜色 */
function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '');
  if (h.length !== 6) return `rgba(232,226,208,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts { quality, shake, damageNumbers, effects }
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.view = { scale: 1, ox: 0, oy: 0, dw: LOGIC_W, dh: LOGIC_H };
    this.quality = opts.quality || QUALITY.HIGH;
    this.shakeOn = opts.shake !== false;
    this.damageNumbersOn = opts.damageNumbers !== false;
    this.effectsOn = opts.effects !== false;
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.frameTimes = [];
    this.fps = 60;
    this.dpr = 1;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, (window.devicePixelRatio || 1));
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this.cssW = cssW;
    this.cssH = cssH;
    this.canvas.style.background = '#0b0a0e';
    this.updateView();
  }

  updateView() {
    // 等比缩放 + 居中留黑边
    const scale = Math.min(this.canvas.width / LOGIC_W, this.canvas.height / LOGIC_H);
    const dw = LOGIC_W * scale;
    const dh = LOGIC_H * scale;
    const ox = (this.canvas.width - dw) / 2;
    const oy = (this.canvas.height - dh) / 2;
    this.view = { scale, ox, oy, dw, dh };
  }

  /** 屏幕坐标（CSS px）→ 逻辑坐标；黑边内返回 null */
  toLogic(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const px = (clientX - r.left) * this.dpr - this.view.ox;
    const py = (clientY - r.top) * this.dpr - this.view.oy;
    const x = px / this.view.scale;
    const y = py / this.view.scale;
    if (x < 0 || y < 0 || x > LOGIC_W || y > LOGIC_H) return null;
    return { x, y };
  }

  updateFps(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    let sum = 0;
    for (const t of this.frameTimes) sum += t;
    this.fps = sum > 0 ? (this.frameTimes.length / sum) * 1000 : 60;
  }

  /**
   * 渲染一帧。
   * @param {object} world 模拟状态（只读）
   * @param {object} ui { joystick: {active,x,y,dx,dy}, showHud, message }
   */
  render(world, ui = {}) {
    const ctx = this.ctx;
    const v = this.view;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0a0e';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.translate(v.ox, v.oy);
    ctx.scale(v.scale, v.scale);
    // 逻辑坐标裁剪（黑边外的内容不画）
    ctx.beginPath();
    ctx.rect(0, 0, LOGIC_W, LOGIC_H);
    ctx.clip();

    // 没有世界（菜单/结算）时只画底色，别碰 world 的字段
    if (!world) {
      ctx.restore();
      return;
    }

    // 屏震（画质档可关）
    let sx = 0;
    let sy = 0;
    if (this.shakeOn && world.shake > 0.2) {
      const a = world.elapsedMs * 0.09;
      sx = Math.cos(a * 1.7) * world.shake;
      sy = Math.sin(a * 2.3) * world.shake;
    }

    const camX = world.camera.x;
    const camY = world.camera.y;
    ctx.save();
    ctx.translate(LOGIC_W / 2 - camX + sx, LOGIC_H / 2 - camY + sy);

    this.drawFloor(ctx, camX, camY);
    this.drawZones(ctx, world);
    this.drawRings(ctx, world);
    this.drawDrops(ctx, world);
    this.drawEnemies(ctx, world);
    this.drawMinions(ctx, world);
    this.drawPlayer(ctx, world);
    this.drawAuras(ctx, world);
    this.drawBulwark(ctx, world);
    this.drawStormClouds(ctx, world);
    this.drawSunwheel(ctx, world);
    this.drawOrbitBlades(ctx, world);
    this.drawBeams(ctx, world);
    this.drawBullets(ctx, world);
    this.drawBow(ctx, world);
    this.drawParticles(ctx, world);
    if (this.damageNumbersOn) this.drawDamageNumbers(ctx, world);
    ctx.restore();

    // 竞技场边界提示（避免"我怎么走进墙里了"）
    this.drawArenaEdge(ctx, world, camX, camY);

    if (ui.showHud !== false) this.drawHud(ctx, world, ui);
    ctx.restore();
  }

  drawFloor(ctx, camX, camY) {
    const { source } = getAsset('arena_floor');
    const tile = 64;
    const x0 = Math.max(0, Math.floor((camX - LOGIC_W / 2) / tile) * tile);
    const x1 = Math.min(ARENA_W, camX + LOGIC_W / 2 + tile);
    const y0 = Math.max(0, Math.floor((camY - LOGIC_H / 2) / tile) * tile);
    const y1 = Math.min(ARENA_H, camY + LOGIC_H / 2 + tile);
    // 背景（竞技场外）
    ctx.fillStyle = '#08070b';
    ctx.fillRect(camX - LOGIC_W, camY - LOGIC_H, LOGIC_W * 2, LOGIC_H * 2);
    ctx.fillStyle = '#141319';
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    if (source) {
      for (let x = x0; x < x1; x += tile) {
        for (let y = y0; y < y1; y += tile) {
          ctx.drawImage(source, x, y, tile, tile);
        }
      }
    }
    // 中心祭坛标记
    ctx.strokeStyle = 'rgba(240,179,87,0.10)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    arc(ctx, ARENA_W / 2, ARENA_H / 2, 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    arc(ctx, ARENA_W / 2, ARENA_H / 2, 60, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawArenaEdge(ctx, world, camX, camY) {
    ctx.save();
    ctx.translate(LOGIC_W / 2 - camX, LOGIC_H / 2 - camY);
    ctx.strokeStyle = 'rgba(240,179,87,0.45)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, ARENA_W - 4, ARENA_H - 4);
    ctx.restore();
  }

  drawZones(ctx, world) {
    for (const z of world.zones.active) {
      ctx.save();
      ctx.translate(z.x, z.y);
      // ---- 批 1 新增：立岩的石壁 / 裂地的地裂 / 天罚的焦痕 / 拉弓的日火 ----
      if (z.kind === 'stonewall') {
        const t = clamp01(z.life / Math.max(0.001, z.maxLife));
        ctx.globalAlpha = 0.35 + 0.55 * t;
        // 石核（圈内相对安全）
        ctx.fillStyle = 'rgba(201,160,106,0.12)';
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
        ctx.fill();
        // 外圈石墙
        ctx.strokeStyle = '#c9a06a';
        ctx.lineWidth = 9;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
        ctx.stroke();
        // 沿环均匀排布的岩块 + 向外的推力箭头
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + world.elapsedMs / 2600;
          const cx = Math.cos(a) * z.radius;
          const cy = Math.sin(a) * z.radius;
          ctx.fillStyle = '#8a6a44';
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          ctx.fillRect(-7, -5, 14, 10);
          ctx.restore();
          ctx.strokeStyle = 'rgba(240,179,87,0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * z.radius * 0.55, Math.sin(a) * z.radius * 0.55);
          ctx.lineTo(Math.cos(a) * z.radius * 0.86, Math.sin(a) * z.radius * 0.86);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      if (z.kind === 'rift') {
        const t = clamp01(z.life / Math.max(0.001, z.maxLife));
        // 地裂：暗红裂口 + 边缘余烬；生命尾声时闪一下（塌陷前兆）
        const nearEnd = t < 0.22;
        ctx.globalAlpha = 0.5 + 0.5 * t;
        const g = radial(ctx, 0, 0, 0, 0, 0, safeR(z.radius));
        if (g) {
          g.addColorStop(0, 'rgba(255,120,40,0.85)');
          g.addColorStop(0.5, 'rgba(150,40,20,0.55)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = nearEnd ? '#fff0b0' : 'rgba(240,140,60,0.85)';
        ctx.lineWidth = nearEnd ? 3 : 2;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(z.radius * 0.8), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      if (z.kind === 'scorch' || z.kind === 'sunfire') {
        const t = clamp01(z.life / Math.max(0.001, z.maxLife));
        const fire = z.kind === 'sunfire';
        ctx.globalAlpha = 0.25 + 0.5 * t;
        const g = radial(ctx, 0, 0, 0, 0, 0, safeR(z.radius));
        if (g) {
          g.addColorStop(0, fire ? 'rgba(255,240,176,0.75)' : 'rgba(255,138,90,0.6)');
          g.addColorStop(0.6, fire ? 'rgba(255,196,80,0.3)' : 'rgba(180,60,30,0.28)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
          ctx.fill();
        }
        // 日火：金色火舌（与焦痕区分开）
        if (fire) {
          ctx.strokeStyle = 'rgba(255,240,176,0.7)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2 + world.elapsedMs / 500;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * z.radius * 0.35, Math.sin(a) * z.radius * 0.35);
            ctx.lineTo(Math.cos(a) * z.radius * 0.92, Math.sin(a) * z.radius * 0.92);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      if (z.kind === 'poison' && z.plagueDepth >= 0) {
        // 百巫的蛊毒雾：青玉色毒雾 + 一圈向外扩散的"传染"涟漪（与普通瘴气区分开）
        const t = clamp01(z.life / Math.max(0.001, z.maxLife));
        ctx.globalAlpha = 0.3 + 0.5 * t;
        const g = radial(ctx, 0, 0, 0, 0, 0, safeR(z.radius));
        if (g) {
          g.addColorStop(0, 'rgba(143,240,221,0.55)');
          g.addColorStop(0.6, 'rgba(47,158,143,0.28)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
          ctx.fill();
        }
        // 传染涟漪：层数越深圈越多（一眼看出"传到第几层"）
        const rings = Math.min(3, (z.plagueDepth | 0) + 1);
        ctx.strokeStyle = 'rgba(143,240,221,0.6)';
        ctx.lineWidth = 2;
        for (let i = 0; i < rings; i++) {
          const p = ((world.elapsedMs / 900 + i / rings) % 1);
          ctx.globalAlpha = 0.55 * (1 - p);
          ctx.beginPath();
          arc(ctx, 0, 0, safeR(z.radius * (0.2 + 0.8 * p)), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }
      if (z.delay > 0) {
        // 预警圈。进度必须用"预警总时长"来算：
        // 曾经用 (maxLife - 0.5) 反推，链式落雷那种 maxLife≈0.4 的实体会算出
        // t ≈ -400，半径变负数 → ctx.arc 抛异常 → 主循环死掉 → 游戏定格。
        const total = z.warnTotal > 0 ? z.warnTotal : Math.max(0.001, z.maxLife);
        const t = clamp01(1 - z.delay / total);
        const fillR = Math.max(0, z.radius * t);
        ctx.strokeStyle = z.color;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        arc(ctx, 0, 0, Math.max(0, z.radius), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = z.color;
        ctx.globalAlpha = 0.22 + 0.2 * Math.sin(t * 12);
        ctx.beginPath();
        arc(ctx, 0, 0, fillR, 0, Math.PI * 2);
        ctx.fill();
      } else if (z.dps > 0 || z.kind === 'poison') {
        const g = radial(ctx, 0, 0, safeR(z.radius * 0.15), 0, 0, safeR(z.radius));
        g.addColorStop(0, 'rgba(155,224,138,0.32)');
        g.addColorStop(1, 'rgba(155,224,138,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(z.radius), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(155,224,138,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        // 震地波
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(z.radius * clamp01(1 - z.life / Math.max(0.001, z.maxLife))), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawDrops(ctx, world) {
    const { source } = getAsset('icon_drop');
    for (const d of world.drops.active) {
      const bob = Math.sin(d.bob) * 2;
      if (d.kind === 'heal') {
        ctx.fillStyle = '#ff7a8a';
        ctx.beginPath();
        arc(ctx, d.x, d.y + bob, d.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe3e8';
        ctx.fillRect(d.x - 1.5, d.y + bob - 5, 3, 10);
        ctx.fillRect(d.x - 5, d.y + bob - 1.5, 10, 3);
      } else if (source) {
        ctx.drawImage(source, d.x - d.radius, d.y + bob - d.radius, d.radius * 2, d.radius * 2);
      } else {
        ctx.fillStyle = '#7fd6ee';
        ctx.beginPath();
        arc(ctx, d.x, d.y + bob, d.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawEnemies(ctx, world) {
    for (const e of world.enemies.active) {
      const slotId = e.isBoss ? 'boss_xiangliu' : 'enemy_' + e.kind;
      const { source } = getAsset(slotId);
      const r = e.radius;
      ctx.save();
      ctx.translate(e.x, e.y);
      if (e.hitFlash > 0 && this.effectsOn) {
        ctx.globalAlpha = 0.9;
      }
      // 精英光环
      if (e.elite) {
        ctx.strokeStyle = e.color || '#ffe08a';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        arc(ctx, 0, 0, r * 1.35, world.elapsedMs * 0.002, world.elapsedMs * 0.002 + Math.PI * 1.6);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 预警提示（公平性）：自爆引信 / 冲锋蓄力都必须先看得见，再打得到
      if (e.fuseUntil > world.elapsedMs) {
        const p = 1 - (e.fuseUntil - world.elapsedMs) / 450;
        ctx.fillStyle = `rgba(255,120,90,${0.25 + 0.35 * Math.abs(Math.sin(world.elapsedMs / 70))})`;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(e.boomRadius || 62), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ff8a5a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        arc(ctx, 0, 0, safeR((e.boomRadius || 62) * clamp01(p + 0.25)), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (e.chargeState === 2) {
        ctx.strokeStyle = 'rgba(255,220,120,0.85)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 6]);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(e.chargeAngle) * 260, Math.sin(e.chargeAngle) * 260);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (source && this.quality === QUALITY.HIGH) {
        const w = source.width * (e.scale || 1) * (r / 14);
        const h = source.height * (e.scale || 1) * (r / 14);
        if (e.hitFlash > 0) {
          // 受击帧：整体泛白（不做四向行走动画，见规格 §12）
          ctx.filter = 'brightness(2.2)';
        }
        ctx.drawImage(source, -w / 2, -h / 2, w, h);
        ctx.filter = 'none';
      } else {
        ctx.fillStyle = e.hitFlash > 0 ? '#ffffff' : e.color || (SERIES.shan.color);
        ctx.beginPath();
        arc(ctx, 0, 0, safeR(r), 0, Math.PI * 2);
        ctx.fill();
      }
      // 血条（受击后短暂显示，避免满屏血条）
      if (e.hp < e.maxHp && (e.elite || e.isBoss || e.hitFlash > 0)) {
        const bw = Math.max(22, r * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-bw / 2, -r - 9, bw, 4);
        ctx.fillStyle = e.isBoss ? '#ff8a6a' : '#e8e2d0';
        ctx.fillRect(-bw / 2, -r - 9, bw * Math.max(0, e.hp / e.maxHp), 4);
      }
      ctx.restore();
    }
  }

  drawMinions(ctx, world) {
    const { source } = getAsset('proj_zhaoyin');
    for (const m of world.minions.active) {
      ctx.save();
      ctx.translate(m.x, m.y);
      if (source) ctx.drawImage(source, -m.radius, -m.radius, m.radius * 2, m.radius * 2);
      for (let h = 1; h < m.heads; h++) {
        const a = (h / m.heads) * Math.PI * 2;
        ctx.drawImage(source, Math.cos(a) * m.radius - m.radius * 0.6, Math.sin(a) * m.radius - m.radius * 0.6, m.radius * 1.2, m.radius * 1.2);
      }
      ctx.restore();
    }
  }

  drawPlayer(ctx, world) {
    const p = world.player;
    const { source } = getAsset('char_' + world.characterId);
    const ser = SERIES[world.series] || SERIES.shan;
    ctx.save();
    ctx.translate(p.x, p.y);
    // 无敌帧闪烁
    if (world.elapsedMs < p.iframeUntil && Math.floor(world.elapsedMs / 60) % 2 === 0) ctx.globalAlpha = 0.45;
    // 拾取半径（低调提示）
    if (this.effectsOn) {
      ctx.strokeStyle = 'rgba(127,214,238,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      arc(ctx, 0, 0, safeR(world.stats.pickup), 0, Math.PI * 2);
      ctx.stroke();
    }
    // 素体：每持有一件道具就长出一个挂件（规格 §9）
    const traits = [];
    for (const w of world.slots.weapons) traits.push({ kind: 'w', id: w.id, superId: w.superId });
    for (const pid of world.slots.passives) traits.push({ kind: 'p', id: pid });
    const tCount = Math.min(7, traits.length);
    for (let i = 0; i < tCount; i++) {
      const a = (i / 7) * Math.PI * 2 + world.elapsedMs / 2600;
      const rad = 22 + (i % 2) * 4;
      const tx = Math.cos(a) * rad;
      const ty = Math.sin(a) * rad;
      const t = traits[i];
      const slotId = t.kind === 'w' ? (t.superId ? 'icon_super' : 'icon_' + t.id) : passiveIconSlot(t.id);
      const { source: ts } = getAsset(slotId);
      if (ts) ctx.drawImage(ts, tx - 6, ty - 6, 12, 12);
    }
    if (source) {
      // 身体尺寸由碰撞半径推导 → "看到的身体"就是"真的判定圈"，
      // 避免"明明碰到了却不掉血"或"看着没碰到却被打"。
      const pd = (p.radius || 14) * 2.6;
      ctx.drawImage(source, -pd / 2, -pd / 2, pd, pd);
    } else {
      ctx.fillStyle = ser.color;
      ctx.beginPath();
      arc(ctx, 0, 0, p.radius || 14, 0, Math.PI * 2);
      ctx.fill();
    }
    // 护盾环
    if (p.shield > 0.5) {
      ctx.strokeStyle = 'rgba(200,220,255,0.75)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      arc(ctx, 0, 0, 21, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 复活层数
    if (p.reviveLayers > 0) {
      ctx.fillStyle = '#ffe08a';
      for (let i = 0; i < Math.min(5, p.reviveLayers); i++) {
        ctx.beginPath();
        arc(ctx, -10 + i * 6, -26, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawBullets(ctx, world) {
    for (const list of [world.playerBullets, world.enemyBullets]) {
      for (const b of list) {
        const wpn = b.weaponId && WEAPON_BY_ID[b.weaponId];
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.boomerang) ctx.rotate(b.spin || 0);
        else if (!wpn && (b.shape === 'bossArrow' || b.shape === 'bossOrb')) ctx.rotate(Math.atan2(b.vy, b.vx));
        else if (b.shape === 'scale' || b.shape === 'shard') ctx.rotate(Math.atan2(b.vy, b.vx));
        if (wpn) {
          // 玩家武器：按该武器自己的形状画（24 把武器 24 种画法，避免撞脸）
          const v = visualOf(wpn.id);
          ctx.rotate(Math.atan2(b.vy, b.vx));
          drawWeaponShape(ctx, v.shape, b.radius, b.color || v.color, v.accent);
        } else {
          // 敌方子弹：保持简单可读的圆/箭头
          ctx.fillStyle = b.color || '#fff';
          ctx.beginPath();
          arc(ctx, 0, 0, b.radius, 0, Math.PI * 2);
          ctx.fill();
          if (b.shape === 'bossArrow') {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fillRect(-b.radius * 2, -1, b.radius * 1.6, 2);
          }
        }
        ctx.restore();
      }
    }
  }

  /**
   * 环绕刃（兽甲旋刃）。
   * ⚠️ 这里的位置算法与判定共用 render/orbit-view.js 的 bladePositions，
   * 不允许各写一遍——曾经整个绘制函数都不存在，玩家只看到怪在身边莫名掉血。
   */
  drawOrbitBlades(ctx, world) {
    const blades = world.orbitBlades.active;
    if (blades.length === 0) return;
    const p = world.player;
    const positions = bladePositions(p, blades);
    for (let i = 0; i < positions.length; i++) {
      const b = positions[i];
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      const h = b.height;
      const w = b.width || 9;
      if (this.effectsOn) {
        // 挥砍拖影：让"刃扫过这里"这件事看得见
        const g = ctx.createLinearGradient(-h * 0.2, 0, h * 1.6, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, hexToRgba(b.color || '#e8e2d0', 0.28));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        arc(ctx, 0, 0, h * 1.6, -0.5, 0.5);
        ctx.closePath();
        ctx.fill();
      }
      // 刀身：一个细长的菱形，长度就是命中长度
      ctx.fillStyle = b.color || '#e8e2d0';
      ctx.beginPath();
      ctx.moveTo(-h / 2, 0);
      ctx.lineTo(0, -w / 2);
      ctx.lineTo(h / 2, 0);
      ctx.lineTo(0, w / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBeams(ctx, world) {
    for (const bm of world.beams.active) {
      ctx.save();
      ctx.translate(bm.x, bm.y);
      ctx.rotate(bm.angle);
      const a = Math.max(0, bm.life / Math.max(0.001, bm.maxLife));
      ctx.globalAlpha = 0.35 + 0.55 * a;
      if (bm.sweepArc) {
        // 横扫的刀光按武器形状画：爪痕 / 大剑弧 / 长矛（不再所有横扫都一个样）
        const v = bm.ownerWeapon ? visualOf(bm.ownerWeapon) : { shape: 'claw', color: '#f0b357', accent: '#c9553d' };
        const g = radial(ctx, 0, 0, bm.length * 0.2, 0, 0, bm.length);
        g.addColorStop(0, 'rgba(255,255,255,0.04)');
        g.addColorStop(0.7, v.color + '80');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        arc(ctx, 0, 0, bm.length, -bm.sweepArc / 2, bm.sweepArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.translate(bm.length * 0.72, 0);
        drawWeaponShape(ctx, v.shape, bm.width * 0.5, v.color, v.accent);
        ctx.restore();
      } else {
        // 光束（鲸息 / 蓄力贯日 / 天极）：用武器自己的颜色，蓄力束更粗更亮
        const v = bm.ownerWeapon ? visualOf(bm.ownerWeapon) : { color: '#8fd8ff', accent: '#2f7fb8' };
        const g = ctx.createLinearGradient(0, -bm.width / 2, 0, bm.width / 2);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.5, v.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, -bm.width / 2, bm.length, bm.width);
        if (bm.charge) {
          // 蓄力重击：中间加一道白核 + 束口的亮点
          const core = ctx.createLinearGradient(0, -bm.width * 0.22, 0, bm.width * 0.22);
          core.addColorStop(0, 'rgba(255,255,255,0)');
          core.addColorStop(0.5, 'rgba(255,255,255,0.95)');
          core.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = core;
          ctx.fillRect(0, -bm.width * 0.22, bm.length, bm.width * 0.44);
          ctx.save();
          ctx.translate(bm.length * 0.16, 0);
          drawWeaponShape(ctx, v.shape || 'sun-lance', bm.width * 0.7, '#ffffff', v.accent);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  /**
   * 领域武器（日月双环 / 开明守御 / 山崩践踏）的光环。
   * 领域是"以玩家为中心常驻的伤害场"，所以必须有一圈看得见的光环，
   * 否则玩家不知道它的边界在哪（也就没法利用它）。
   */
  drawAuras(ctx, world) {
    const p = world.player;
    for (const slot of world.slots.weapons) {
      const def = WEAPON_BY_ID[slot.id];
      if (!def || def.kind !== 'aura') continue;
      const st = levelStats(def, slot.level);
      const sup = slot.superId ? FUSION_BY_ID[slot.superId] : null;
      const radius = (st.radius || 90) * world.stats.area * (sup && sup.mods.radiusMul ? sup.mods.radiusMul : 1);
      const v = visualOf(slot.id);
      const pulse = 0.5 + 0.5 * Math.sin(world.elapsedMs / 260 + slot.id.length);
      ctx.save();
      ctx.translate(p.x, p.y);
      if (this.effectsOn) {
        const g = radial(ctx, 0, 0, radius * 0.25, 0, 0, radius);
        g.addColorStop(0, 'rgba(255,255,255,0.02)');
        g.addColorStop(0.75, v.color + '26');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        arc(ctx, 0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = v.color;
      ctx.globalAlpha = 0.35 + 0.25 * pulse;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 7]);
      ctx.beginPath();
      arc(ctx, 0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 环上按形状点缀，让不同领域一眼可分
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + world.elapsedMs / 1400;
        ctx.save();
        ctx.translate(Math.cos(ang) * radius, Math.sin(ang) * radius);
        ctx.rotate(ang);
        drawWeaponShape(ctx, v.shape, 5, v.color, v.accent);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /** 归墟潮的水环：扩张 / 回卷的可见边界 + 环上的方向箭头 */
  drawRings(ctx, world) {
    for (const rg of world.rings.active) {
      ctx.save();
      ctx.translate(rg.x, rg.y);
      const out = rg.phase === 'out';
      const fade = clamp01(1 - rg.r / Math.max(1, rg.maxR * 1.2));
      ctx.globalAlpha = 0.35 + 0.5 * fade;
      const inner = safeR(rg.r - rg.band * 0.5);
      const outer = safeR(rg.r + rg.band * 0.5);
      ctx.fillStyle = out ? 'rgba(127,214,238,0.30)' : 'rgba(127,214,238,0.45)';
      ctx.beginPath();
      arc(ctx, 0, 0, outer, 0, Math.PI * 2);
      arc(ctx, 0, 0, inner, 0, Math.PI * 2);
      ctx.fill('evenodd');
      ctx.strokeStyle = out ? 'rgba(191,233,255,0.85)' : 'rgba(143,216,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      arc(ctx, 0, 0, safeR(rg.r), 0, Math.PI * 2);
      ctx.stroke();
      // 方向箭头：扩张朝外，回卷朝内
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + world.elapsedMs / 900;
        const r0 = rg.r + (out ? 12 : -22);
        const r1 = rg.r + (out ? 30 : -4);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * safeR(r0), Math.sin(a) * safeR(r0));
        ctx.lineTo(Math.cos(a) * safeR(r1), Math.sin(a) * safeR(r1));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /** 天罚轮转的雷云：一朵绕玩家公转的云（落雷与焦痕由 zones 负责画） */
  drawStormClouds(ctx, world) {
    const st = world.ultStorm;
    if (!st || !st.clouds || st.clouds.length === 0) return;
    for (const cl of st.clouds) {
      ctx.save();
      ctx.translate(cl.x, cl.y);
      const pulse = 0.5 + 0.5 * Math.sin(world.elapsedMs / 180);
      if (this.effectsOn) {
        const g = radial(ctx, 0, 0, 4, 0, 0, 60);
        if (g) {
          g.addColorStop(0, 'rgba(195,155,240,0.5)');
          g.addColorStop(1, 'rgba(195,155,240,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          arc(ctx, 0, 0, 60, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(78,60,120,0.9)';
      for (const [ox, oy, r] of [[-16, 2, 15], [0, -6, 19], [16, 2, 14]]) {
        ctx.beginPath();
        arc(ctx, ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = pulse > 0.6 ? '#ffe08a' : 'rgba(195,155,240,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 6);
      ctx.lineTo(2, 20);
      ctx.lineTo(-2, 22);
      ctx.lineTo(4, 36);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 十日凌空的太阳轮：身后公转的小太阳 + 每轮射出的**持续光束**（不是投射物）。
   * 齐射瞬间（ultSun.flash）额外画出十条从太阳指向目标的贯穿光柱。
   */
  drawSunwheel(ctx, world) {
    const s = world.ultSun;
    if (!s) return;
    const slot = world.slots.weapons && world.slots.weapons[0];
    const def = slot ? WEAPON_BY_ID[slot.id] : null;
    if (!def || def.kind !== 'sunwheel') return;
    const st = levelStats(def, slot.level);
    const p = world.player;
    const area = world.stats.area;
    const suns = Math.max(1, Math.round(st.suns || 10));
    const orbit = (st.orbit || 128) * area;
    const len = (st.beamLen || 620) * area;
    const halfW = (st.width || 16) * 0.5 * Math.sqrt(area);
    const stepAngle = (Math.PI * 2) / suns;
    const flash = s.flash > 0;
    for (let i = 0; i < suns; i++) {
      const a = s.spin + i * stepAngle;
      const sx = p.x + Math.cos(a) * orbit;
      const sy = p.y + Math.sin(a) * orbit;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(a);
      // 光束：外层柔光 + 内芯亮线（判定宽度就是 halfW*2，视觉与判定一致）
      ctx.globalAlpha = flash ? 0.55 : 0.3;
      ctx.fillStyle = flash ? '#ffe08a' : '#f7c85a';
      ctx.fillRect(0, -halfW, len, halfW * 2);
      ctx.globalAlpha = flash ? 1 : 0.85;
      ctx.strokeStyle = flash ? '#fff6d0' : '#ffe08a';
      ctx.lineWidth = Math.max(1.5, halfW * 0.5);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
      // 小太阳本体
      ctx.save();
      ctx.translate(sx, sy);
      if (this.effectsOn) {
        const g = radial(ctx, 0, 0, 2, 0, 0, halfW * 3.2);
        if (g) {
          g.addColorStop(0, 'rgba(255,246,208,0.95)');
          g.addColorStop(0.4, 'rgba(255,200,90,0.55)');
          g.addColorStop(1, 'rgba(255,160,40,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          arc(ctx, 0, 0, halfW * 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = flash ? '#fff8d8' : '#ffd76a';
      ctx.beginPath();
      arc(ctx, 0, 0, Math.max(4, halfW * 0.95), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // 齐射光柱
    if (flash && s.lines) {
      ctx.strokeStyle = 'rgba(255,240,176,0.9)';
      ctx.lineWidth = 4;
      for (const l of s.lines) {
        ctx.beginPath();
        ctx.moveTo(l.x0, l.y0);
        ctx.lineTo(l.x1, l.y1);
        ctx.stroke();
      }
    }
  }

  /** 昆仑永镇的玉璧环：自转的玉环（Lv3 起第二层反向自转），环上带璧形刻纹 */
  drawBulwark(ctx, world) {
    const bw = world.ultBulwark;
    if (!bw || !bw.active) return;
    const p = world.player;
    ctx.save();
    ctx.fillStyle = 'rgba(159,240,216,0.045)';
    ctx.beginPath();
    arc(ctx, p.x, p.y, safeR(bw.radius - bw.band * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const ring = (radius, angle, alpha, color, accent) => {
      const r = safeR(radius);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      arc(ctx, 0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // 环上的璧（玉片）：随自转角一起转，宽度与判定带一致
      const n = 12;
      const seg = safeR((bw.band || 22) * 0.5);
      for (let i = 0; i < n; i++) {
        const a = angle + (i / n) * Math.PI * 2;
        ctx.save();
        ctx.translate(Math.cos(a) * r, Math.sin(a) * r);
        ctx.rotate(a);
        ctx.fillStyle = accent;
        ctx.fillRect(-seg * 0.5, -seg * 0.7, seg, seg * 1.4);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };
    ring(bw.radius, bw.angle, 0.85, '#9ff0d8', 'rgba(159,240,216,0.75)');
    if (bw.rings > 1) ring(bw.radius * 0.78, bw.angle2, 0.6, '#dfe6f2', 'rgba(223,230,242,0.6)');
  }

  /** 拉弓瞄准：方向线 + 准星（满蓄变金）+ 蓄力环 */
  drawBow(ctx, world) {
    const b = world.bow;
    if (!b || b.phase === 'idle') return;
    const p = world.player;
    const c = clamp01(b.c || 0);
    const full = c >= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    // 方向线（反向拖拽 = 拉弦，箭向反方向飞）
    const len = 420 + 260 * c;
    ctx.strokeStyle = full ? 'rgba(255,224,138,0.9)' : 'rgba(255,224,138,0.5)';
    ctx.lineWidth = full ? 3 : 2;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(Math.cos(b.angle) * 20, Math.sin(b.angle) * 20);
    ctx.lineTo(Math.cos(b.angle) * len, Math.sin(b.angle) * len);
    ctx.stroke();
    ctx.setLineDash([]);
    // 准星
    const cx = Math.cos(b.angle) * len;
    const cy = Math.sin(b.angle) * len;
    ctx.strokeStyle = full ? '#ffe08a' : 'rgba(255,224,138,0.75)';
    ctx.lineWidth = full ? 3 : 2;
    ctx.beginPath();
    arc(ctx, cx, cy, full ? 20 : 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy + 26);
    ctx.stroke();
    // 蓄力环
    ctx.strokeStyle = full ? '#ffe08a' : 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    arc(ctx, 0, 0, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawParticles(ctx, world) {
    if (!this.effectsOn) return;
    for (const p of world.particles.active) {
      ctx.globalAlpha = Math.max(0, p.life / Math.max(0.001, p.maxLife));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      arc(ctx, p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawDamageNumbers(ctx, world) {
    ctx.textAlign = 'center';
    for (const d of world.damageNumbers.active) {
      const a = Math.max(0, d.life / Math.max(0.001, d.maxLife));
      ctx.globalAlpha = a;
      if (d.kind === 'heal') {
        ctx.fillStyle = '#8ef0a0';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText('+' + Math.round(d.value), d.x, d.y);
      } else if (d.kind === 'hurt') {
        ctx.fillStyle = '#ff8080';
        ctx.font = 'bold 15px system-ui, sans-serif';
        ctx.fillText('-' + Math.round(d.value), d.x, d.y);
      } else {
        ctx.fillStyle = d.crit ? '#ffe08a' : '#ffffff';
        ctx.font = (d.crit ? 'bold 17px' : '13px') + ' system-ui, sans-serif';
        const txt = Math.round(d.value) + (d.merged > 1 ? `×${d.merged}` : '');
        ctx.fillText(txt, d.x, d.y);
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // ---------------- HUD ----------------

  drawHud(ctx, world, ui) {
    const s = this.safe;
    const pad = 12;
    const L = pad + s.left;
    const R = LOGIC_W - pad - s.right;
    const T = pad + s.top;
    const B = LOGIC_H - pad - s.bottom;
    const p = world.player;

    // 生命条
    const barW = 260;
    const barH = 16;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(L, T, barW, barH);
    const hpFrac = Math.max(0, p.hp / Math.max(1, p.maxHp));
    ctx.fillStyle = hpFrac > 0.35 ? '#d8492f' : '#ff6a4a';
    ctx.fillRect(L, T, barW * hpFrac, barH);
    if (p.shield > 0.5) {
      ctx.fillStyle = 'rgba(190,220,255,0.85)';
      ctx.fillRect(L, T - 4, barW * Math.min(1, p.shield / Math.max(1, world.stats.shield)), 3);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L + 0.5, T + 0.5, barW, barH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.ceil(p.hp)} / ${p.maxHp}`, L + 8, T + barH / 2);

    // 经验条
    const xpY = T + barH + 5;
    const xpFrac = Math.max(0, Math.min(1, p.xp / Math.max(1, p.xpNext)));
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(L, xpY, barW, 7);
    ctx.fillStyle = '#4fb3d9';
    ctx.fillRect(L, xpY, barW * xpFrac, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`Lv ${p.level}`, L + barW + 8, xpY + 4);

    // 计时与难度档
    const tSec = Math.floor(world.elapsedMs / 1000);
    const mm = String(Math.floor(tSec / 60)).padStart(2, '0');
    const ss = String(tSec % 60).padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = world.bossActive ? '#ff9a6a' : '#f0e6d2';
    ctx.fillText(`${mm}:${ss}`, LOGIC_W / 2, T + 16);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(`难度档 ${world.runStats.maxTier + 1}　击杀 ${world.runStats.kills}`, LOGIC_W / 2, T + 38);
    ctx.textAlign = 'left';

    // Boss 血条
    if (world.bossActive) {
      const boss = world.enemies.active.find((e) => e.isBoss);
      if (boss) {
        const bw = 420;
        const bx = (LOGIC_W - bw) / 2;
        const by = T + 50;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx, by, bw, 12);
        ctx.fillStyle = '#ff7a5a';
        ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 12);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.strokeRect(bx + 0.5, by + 0.5, bw, 12);
        ctx.fillStyle = '#ffe0d0';
        ctx.font = 'bold 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`相柳 · ${BOSS.phases[world.bossState.phase].name}（${world.bossState.heads} 首）`, LOGIC_W / 2, by + 26);
        ctx.textAlign = 'left';
      }
    }

    // 槽位面板（左上角下方）
    this.drawSlotPanel(ctx, world, L, xpY + 18);

    // 摇杆（浮动式）：未按时在左下画一个淡提示圈，按下后整个摇杆跟着手指走。
    const js = ui.joystick;
    if (js) {
      const jr = TOUCH.joy.r;
      const gx = TOUCH.joy.guideX + Math.max(0, s.left - 12);
      const gy = TOUCH.joy.guideY - Math.max(0, s.bottom - 12);
      if (!js.active) {
        ctx.strokeStyle = 'rgba(255,255,255,0.16)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        arc(ctx, gx, gy, jr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const jx = js.active && js.origin ? js.origin.x : gx;
      const jy = js.active && js.origin ? js.origin.y : gy;
      ctx.strokeStyle = js.active ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      arc(ctx, jx, jy, jr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fill();
      const kx = jx + (js.dx || 0) * jr * 0.55;
      const ky = jy + (js.dy || 0) * jr * 0.55;
      ctx.fillStyle = js.active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      arc(ctx, kx, ky, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    // 右下角：闪避按钮 + 主动技能按钮（主动技能在三把同系超武解锁后显示）
    const dx = -Math.max(0, s.right - 12);
    const dy = -Math.max(0, s.bottom - 12);
    this.drawRoundButton(
      ctx,
      TOUCH.dash.cx + dx,
      TOUCH.dash.cy + dy,
      TOUCH.dash.r,
      '闪避',
      1 - Math.max(0, Math.min(1, p.dashCd / Math.max(0.01, world.stats.dashCd))),
      '#9fe4ff',
    );
    if (world.activeSkillUnlocked) {
      const skill = ACTIVE_SKILL_BY_ID[world.activeSkillUnlocked];
      const skillReady = world.activeSkillCd <= 0;
      const cdRatio = skill ? 1 - Math.max(0, Math.min(1, world.activeSkillCd / skill.cd)) : 0;
      // 拉弓（瞄准类）：按住期间按钮显示**蓄力进度**，满蓄变亮 —— 与准星变金是同一套反馈
      const bowing = !!(skill && skill.type === 'aim' && world.bow && world.bow.phase !== 'idle');
      const frac = bowing ? clamp01(world.bow.c) : cdRatio;
      const color = bowing
        ? (world.bow.c >= 1 ? '#fff6d6' : '#ffd27f')
        : (skillReady ? '#ffe08a' : 'rgba(255,224,138,0.35)');
      this.drawRoundButton(
        ctx,
        TOUCH.skill.cx + dx,
        TOUCH.skill.cy + dy,
        TOUCH.skill.r,
        skill ? skill.cn : '主动',
        frac,
        color,
        !bowing && !skillReady,
      );
    }

    // 提示语
    if (world.hintText && world.elapsedMs < world.hintUntil) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 20px system-ui, sans-serif';
      const a = Math.min(1, (world.hintUntil - world.elapsedMs) / 600);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(world.hintText, LOGIC_W / 2, LOGIC_H * 0.32);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    // 帧率（开发模式）
    if (ui.showFps) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px monospace';
      ctx.fillText(`${this.fps.toFixed(0)}fps ${this.quality === QUALITY.LOW ? 'low' : 'high'}`, R - 90, B - 4);
    }
  }

  drawSlotPanel(ctx, world, x, y) {
    const cell = 30;
    let i = 0;
    for (const w of world.slots.weapons) {
      const slotId = w.superId ? 'icon_super' : 'icon_' + w.id;
      const { source } = getAsset(slotId);
      const cx = x + i * (cell + 4);
      ctx.fillStyle = w.superId ? 'rgba(255,224,138,0.18)' : 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx, y, cell, cell);
      ctx.strokeStyle = w.superId ? '#ffe08a' : 'rgba(255,255,255,0.18)';
      ctx.lineWidth = w.superId ? 2 : 1;
      ctx.strokeRect(cx + 0.5, y + 0.5, cell - 1, cell - 1);
      if (source) ctx.drawImage(source, cx + 3, y + 3, cell - 6, cell - 6);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.fillText('Lv' + w.level, cx + 3, y + cell - 3);
      i++;
    }
    // 合体终极武器只占 1 个数组元素，但逻辑上占满 4 个槽：把剩余 3 格画成"金色锁定格"
    const totalDrawn = world.fusedWeapon ? SLOT_WEAPONS : world.slots.weapons.length;
    for (let k = totalDrawn; k < SLOT_WEAPONS; k++) {
      const cx = x + k * (cell + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(cx + 0.5, y + 0.5, cell - 1, cell - 1);
      ctx.setLineDash([]);
    }
    if (world.fusedWeapon) {
      // 合体后：**1 格终极 + 3 格纯金色锁定格**（规格 §3）。
      // 锁定格刻意**不画**被合掉那三把武器的微缩图标 —— 它们已经被消耗掉了，
      // 画缩略图会让玩家以为那三把还在工作。"合体是消耗"这个认知必须清晰。
      for (let k = 1; k < SLOT_WEAPONS; k++) {
        const cx = x + k * (cell + 4);
        ctx.fillStyle = 'rgba(255,224,138,0.16)';
        ctx.fillRect(cx, y, cell, cell);
        ctx.strokeStyle = 'rgba(255,224,138,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx + 0.5, y + 0.5, cell - 1, cell - 1);
      }
      // 终极武器的等级 + 质变标记：Lv3（一档质变）、Lv5（终档质变）
      const ult = world.slots.weapons[0];
      const lv = ult ? ult.level : 1;
      const cx0 = x + cell - 6;
      if (lv >= 3) {
        ctx.fillStyle = '#ffe08a';
        ctx.beginPath();
        arc(ctx, cx0, y + 6, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (lv >= 5) {
        ctx.strokeStyle = '#fff6d6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        arc(ctx, cx0, y + 6, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (lv >= 3) {
        ctx.fillStyle = 'rgba(255,224,138,0.95)';
        ctx.font = 'bold 8px system-ui, sans-serif';
        ctx.fillText(lv >= 5 ? '变Ⅱ' : '变Ⅰ', x + 3, y + 10);
      }
    }
    i = 0;
    const py = y + cell + 4;
    for (const pid of world.slots.passives) {
      const { source } = getAsset(passiveIconSlot(pid));
      const cx = x + i * (cell + 4);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx, py, cell * 0.8, cell * 0.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.strokeRect(cx + 0.5, py + 0.5, cell * 0.8 - 1, cell * 0.8 - 1);
      if (source) ctx.drawImage(source, cx + 2, py + 2, cell * 0.8 - 4, cell * 0.8 - 4);
      i++;
    }
    // 被动空槽（按配置上限画，主动槽位满了之后也要看得出还剩几个空位）
    for (let k = world.slots.passives.length; k < SLOT_PASSIVES; k++) {
      const cx = x + k * (cell + 4);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(cx + 0.5, py + 0.5, cell * 0.8 - 1, cell * 0.8 - 1);
      ctx.setLineDash([]);
    }
  }

  drawRoundButton(ctx, x, y, r, label, frac, color, disabled = false) {
    ctx.save();
    ctx.globalAlpha = disabled ? 0.45 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    arc(ctx, x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    if (frac > 0 && frac < 1) {
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      arc(ctx, x, y, r - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
    // 内部图标：闪避 = 三道速度线；主动 = 一个圆点
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (label === '闪避') {
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 12, y + i * 7);
        ctx.lineTo(x + 12, y + i * 7);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      arc(ctx, x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      arc(ctx, x, y, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = (label.length > 2 ? '9px' : '10px') + ' system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 11);    ctx.textAlign = 'left';
    ctx.restore();
  }
}

/** 卡片/图鉴用的道具图标槽位 */
export function iconSlotForCard(card) {
  // 兜底：通用被动图标（找不到具体卡片时用，属于刻意的回退分支）
  if (!card) return 'icon_passive';
  // 被动类卡片一律走"那件被动自己的图标"。
  // 这里曾经先特判 `card.type === 'passive'` 直接返回通用图标 —— 逻辑与 ui.js 重复了一份，
  // 于是修了 ui.js 却漏了这里，被动图标依然全是同一个。
  if (card.type === 'passive' || card.type === 'passive-up') return passiveIconSlot(card.passiveId);
  if (card.type === 'weapon-up' || card.type === 'weapon-new') return 'icon_' + card.weaponId;
  return 'icon_super';
}

export function weaponName(id) {
  const w = WEAPON_BY_ID[id];
  return w ? w.cn : id;
}

export function passiveName(id) {
  const p = PASSIVE_BY_ID[id];
  return p ? p.cn : id;
}

export function superName(id) {
  const f = FUSION_BY_ID[id];
  return f ? f.cn : id;
}
