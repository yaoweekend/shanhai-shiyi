// 程序生成占位图形（规格 §12）。
// 每个系一套主色、每类弹道一个几何形状、每件道具一个符号。
// 开发模式下在图上叠加槽位标签。
//
// 这里就是"正式美术到位前的全部美术"：把 file 填进 manifest.js 即可整体替换，逻辑不动。

import { SLOTS, SLOT_BY_ID, FUTURE_SLOTS } from './manifest.js';
import { SERIES } from '../content/series.js';

const cache = new Map();
const loaded = new Map();
let showLabels = false;

export function setShowLabels(v) {
  showLabels = !!v;
  cache.clear();
}

function seriesColor(sid) {
  const s = SERIES[sid] || SERIES.shan;
  return { main: s.color, accent: s.accent };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function polygon(ctx, cx, cy, r, sides, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function star(ctx, cx, cy, r1, r2, points, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? r1 : r2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const GENERATORS = {
  gen_character(ctx, s, w, h) {
    const { main, accent } = seriesColor(s.series);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.38;
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 朝向指示（一只"眼"）
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx + r * 0.42, cy - r * 0.12, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // 素体幼体的两撇"须"
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, cy - r * 0.85);
    ctx.lineTo(cx - r * 0.55, cy - r * 1.35);
    ctx.moveTo(cx + r * 0.2, cy - r * 0.85);
    ctx.lineTo(cx + r * 0.55, cy - r * 1.35);
    ctx.stroke();
  },

  gen_enemy(ctx, s, w, h) {
    const { main, accent } = seriesColor(s.series);
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.4;
    ctx.fillStyle = main;
    ctx.globalAlpha = 0.92;
    switch (s.id) {
      case 'enemy_shanxiao':
        polygon(ctx, cx, cy, r, 3, -Math.PI / 2);
        break;
      case 'enemy_bifang':
        polygon(ctx, cx, cy, r, 4, Math.PI / 4);
        break;
      case 'enemy_huashe':
        ctx.beginPath();
        ctx.moveTo(cx - r, cy + r * 0.5);
        ctx.quadraticCurveTo(cx, cy - r * 1.2, cx + r, cy + r * 0.2);
        ctx.quadraticCurveTo(cx, cy + r * 0.4, cx - r, cy + r * 0.9);
        ctx.closePath();
        break;
      case 'enemy_xinang':
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        break;
      default:
        polygon(ctx, cx, cy, r, 6, 0);
        break;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 一只血色的眼
    ctx.fillStyle = '#1a1015';
    ctx.beginPath();
    ctx.arc(cx + r * 0.25, cy - r * 0.15, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_boss(ctx, s, w, h) {
    const { main, accent } = seriesColor('huang');
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.3;
    // 九首：一圈小头 + 一个躯干
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 - Math.PI / 2;
      const hx = cx + Math.cos(a) * R * 1.55;
      const hy = cy + Math.sin(a) * R * 1.55;
      ctx.strokeStyle = main;
      ctx.lineWidth = R * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(hx, hy, R * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#241018';
      ctx.beginPath();
      ctx.arc(hx + Math.cos(a) * R * 0.12, hy + Math.sin(a) * R * 0.12, R * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = main;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
  },

  gen_floor(ctx, s, w, h) {
    ctx.fillStyle = '#1b1a20';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.02)';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
  },

  gen_obstacle(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#2b2a33';
    polygon(ctx, cx, cy, Math.min(w, h) * 0.42, 5, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = '#3f3d4a';
    ctx.lineWidth = 2;
    ctx.stroke();
  },

  gen_proj_orbit(ctx, s, w, h) {
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w * 0.7, 0);
    ctx.lineTo(w, h * 0.5);
    ctx.lineTo(w * 0.7, h);
    ctx.closePath();
    ctx.fill();
  },

  gen_proj_boomerang(ctx, s, w, h) {
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = Math.max(3, w * 0.16);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, w * 0.3, Math.PI * 0.15, Math.PI * 1.35);
    ctx.stroke();
    ctx.strokeStyle = '#b9b0a0';
    ctx.lineWidth = Math.max(2, w * 0.08);
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, w * 0.3, Math.PI * 1.35, Math.PI * 1.85);
    ctx.stroke();
  },

  gen_proj_sweep(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createRadialGradient(cx, cy, w * 0.12, cx, cy, w * 0.5);
    g.addColorStop(0, 'rgba(240,179,87,0.05)');
    g.addColorStop(0.75, 'rgba(240,179,87,0.55)');
    g.addColorStop(1, 'rgba(240,179,87,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, w * 0.5, -0.6, 0.6);
    ctx.closePath();
    ctx.fill();
  },

  gen_proj_scale(ctx, s, w, h) {
    ctx.fillStyle = '#7fd6ee';
    polygon(ctx, w / 2, h / 2, Math.min(w, h) * 0.45, 3, 0);
    ctx.fill();
    ctx.strokeStyle = '#d9f6ff';
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  gen_proj_orb(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.42;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.15, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#9fe4ff');
    g.addColorStop(1, '#2f7fb8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_proj_beam(ctx, s, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(143,216,255,0)');
    g.addColorStop(0.5, 'rgba(220,245,255,0.95)');
    g.addColorStop(1, 'rgba(143,216,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },

  gen_proj_strike(ctx, s, w, h) {
    const cx = w / 2;
    ctx.strokeStyle = '#c39bf0';
    ctx.lineWidth = Math.max(3, w * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + w * 0.12, 0);
    ctx.lineTo(cx - w * 0.12, h * 0.55);
    ctx.lineTo(cx + w * 0.12, h * 0.55);
    ctx.lineTo(cx - w * 0.1, h);
    ctx.stroke();
  },

  gen_proj_zone(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createRadialGradient(cx, cy, w * 0.1, cx, cy, w * 0.5);
    g.addColorStop(0, 'rgba(155,224,138,0.5)');
    g.addColorStop(1, 'rgba(155,224,138,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.5, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_proj_summon(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#c39bf0';
    polygon(ctx, cx, cy, Math.min(w, h) * 0.42, 4, Math.PI / 4);
    ctx.fill();
    ctx.fillStyle = '#2a1a33';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.1, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_icon_weapon(ctx, s, w, h) {
    const { main, accent } = seriesColor(s.series);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = main;
    star(ctx, w / 2, h / 2, Math.min(w, h) * 0.26, Math.min(w, h) * 0.12, 4, 0);
    ctx.fill();
  },

  gen_icon_passive(ctx, s, w, h) {
    const { main, accent } = seriesColor(s.series);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    polygon(ctx, w / 2, h / 2, Math.min(w, h) * 0.3, 6, 0);
    ctx.fill();
    ctx.fillStyle = main;
    polygon(ctx, w / 2, h / 2, Math.min(w, h) * 0.16, 6, Math.PI / 6);
    ctx.fill();
  },

  gen_icon_super(ctx, s, w, h) {
    ctx.fillStyle = 'rgba(255,224,138,0.14)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffe08a';
    star(ctx, w / 2, h / 2, Math.min(w, h) * 0.4, Math.min(w, h) * 0.17, 5, -Math.PI / 2);
    ctx.fill();
    ctx.strokeStyle = '#fff6d6';
    ctx.lineWidth = 1;
    ctx.stroke();
  },

  gen_icon_drop(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#7fd6ee';
    polygon(ctx, cx, cy, Math.min(w, h) * 0.4, 6, 0);
    ctx.fill();
    ctx.fillStyle = '#eafcff';
    polygon(ctx, cx, cy, Math.min(w, h) * 0.18, 6, 0);
    ctx.fill();
  },

  gen_ui_panel(ctx, s, w, h) {
    ctx.fillStyle = 'rgba(18,17,22,0.86)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(240,179,87,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  },

  gen_ui_joystick(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_ui_button(ctx, s, w, h) {
    const { accent } = seriesColor(s.series);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fill();
  },

  gen_ui_card(ctx, s, w, h) {
    ctx.fillStyle = 'rgba(22,21,28,0.95)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(240,179,87,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  },

  gen_fx_hit(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * w * 0.12, cy + Math.sin(a) * h * 0.12);
      ctx.lineTo(cx + Math.cos(a) * w * 0.44, cy + Math.sin(a) * h * 0.44);
      ctx.stroke();
    }
  },

  gen_fx_explode(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const g = ctx.createRadialGradient(cx, cy, w * 0.05, cx, cy, w * 0.5);
    g.addColorStop(0, 'rgba(255,240,200,0.9)');
    g.addColorStop(0.35, 'rgba(255,160,80,0.7)');
    g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, w * 0.5, 0, Math.PI * 2);
    ctx.fill();
  },

  gen_fx_levelup(ctx, s, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = `rgba(255,224,138,${0.7 - i * 0.2})`;
      ctx.lineWidth = 3 - i;
      ctx.beginPath();
      ctx.arc(cx, cy, w * (0.16 + i * 0.14), 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  gen_fx_pickup(ctx, s, w, h) {
    ctx.strokeStyle = 'rgba(127,214,238,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  },
};

/** 生成（或取缓存）某槽位的占位图 */
export function getPlaceholder(slot) {
  const key = slot.id + (showLabels ? '|label' : '');
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = makeCanvas(slot.w, slot.h);
  const ctx = canvas.getContext('2d');
  const gen = GENERATORS[slot.generator] || GENERATORS.gen_enemy;
  try {
    gen(ctx, slot, slot.w, slot.h);
  } catch (err) {
    ctx.fillStyle = '#f0f';
    ctx.fillRect(0, 0, slot.w, slot.h);
  }
  if (showLabels) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, slot.w, 10);
    ctx.fillStyle = '#9fe4ff';
    ctx.font = '8px monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(slot.id, 2, 1);
  }
  cache.set(key, canvas);
  return canvas;
}

/**
 * 取某槽位的可用图形：有 file 就用文件，否则用占位图。
 * 加载状态机：未登记 → 'loading' → 'ready' | 'failed'。
 * 失败后不再重试（否则缺一个文件就会每帧发起一次加载）。
 * 返回 { source, isPlaceholder }。
 */
export function getAsset(slotId) {
  const slot = SLOT_BY_ID[slotId];
  if (!slot) return { source: null, isPlaceholder: true, slot: null };
  if (slot.file) {
    const state = loaded.get(slot.id);
    if (state === undefined) {
      loaded.set(slot.id, 'loading');
      const el = new Image();
      el.onload = () => loaded.set(slot.id, el);
      el.onerror = () => loaded.set(slot.id, 'failed');
      el.src = slot.file;
    } else if (state && state !== 'loading' && state !== 'failed') {
      return { source: state, isPlaceholder: false, slot };
    }
    return { source: getPlaceholder(slot), isPlaceholder: true, slot };
  }
  return { source: getPlaceholder(slot), isPlaceholder: true, slot };
}

/** 资源加载状态（自检/关于页用） */
export function assetState(slotId) {
  const slot = SLOT_BY_ID[slotId];
  if (!slot) return 'missing-slot';
  if (!slot.file) return 'placeholder';
  const state = loaded.get(slot.id);
  if (state === undefined) return 'not-requested';
  if (state === 'loading') return 'loading';
  if (state === 'failed') return 'failed';
  return 'ready';
}

/**
 * 某件被动的图标槽位 id。
 *
 * 这条规则以前**散落在 5 个地方各自手写字符串**，结果 24 个被动图标全画了、
 * 全进包了，却一处都没接上 —— 到处都硬编码 'icon_passive'，于是所有被动
 * 在卡片/暂停栏/HUD/角色挂件上长得一模一样（用户原话："被动图标是同一个"）。
 * 现在收敛成一个函数，UI 层与渲染层共用，新增被动也不用再改调用点。
 * 查不到专属槽位时回退到通用 'icon_passive'（那时显示程序生成的占位图，不会崩）。
 */
export function passiveIconSlot(pid) {
  const id = 'icon_passive_' + pid;
  return SLOT_BY_ID[id] ? id : 'icon_passive';
}

export function placeholderStats() {
  // 也要算上 FUTURE_SLOTS：第 4~6 系的角色（天魄/巫魄/不死魄）定义在那里，
  // 它们已经有正式图了。只统计 SLOTS 会让关于页少报（"已替换 9" 而实际 12）。
  const all = [...SLOTS, ...FUTURE_SLOTS];
  let generated = 0;
  let supplied = 0;
  for (const s of all) {
    if (s.file) supplied++;
    else generated++;
  }
  return { total: all.length, generated, supplied };
}
