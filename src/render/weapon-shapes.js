// 武器形状绘制：把 weapon-visuals.js 里的 shape 变成实际的画面。
// 24 把武器各自一种画法，避免"利爪横扫和海茅穿刺长得一样"这类撞脸。
// 坐标系：调用方已经把 ctx 平移到弹体中心（子弹会先按飞行方向旋转）。

/** 圆角矩形（兼容旧内核：不用 ctx.roundRect） */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** 通用：画一个细长的锥形（箭/矛/刃都用它变形） */
function lance(ctx, r, len, color, accent) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(0, -r * 0.7);
  ctx.lineTo(-len * 0.35, 0);
  ctx.lineTo(0, r * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

/**
 * 画一个"武器形状"。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} shape
 * @param {number} r 尺寸
 * @param {string} color 主色
 * @param {string} accent 副色
 */
export function drawWeaponShape(ctx, shape, r, color, accent) {
  const c = color || '#ffffff';
  const a = accent || c;
  switch (shape) {
    // ---- 投射物 ----
    case 'sun-arrow':
      lance(ctx, r * 0.9, r * 2.2, c, a);
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(-r * 0.5, 0, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'spear':
      lance(ctx, r * 0.75, r * 2.6, c, a);
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 1.2, 0);
      ctx.lineTo(-r * 2.4, 0);
      ctx.stroke();
      break;
    case 'comet':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(r * 0.4, 0, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(r * 0.4, -r * 0.55);
      ctx.lineTo(-r * 2.6, 0);
      ctx.lineTo(r * 0.4, r * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'scale':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(r * 1.4, 0);
      ctx.lineTo(-r * 0.6, -r);
      ctx.lineTo(-r * 0.6, r);
      ctx.closePath();
      ctx.fill();
      break;
    case 'pearl':
    case 'dew': {
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r * 1.3);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.55, c);
      g.addColorStop(1, a);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'jade-disc':
      roundRect(ctx, -r * 0.55, -r, r * 1.1, r * 2, r * 0.5);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'rune':
      ctx.fillStyle = c;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2;
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * r * 1.3, Math.sin(ang) * r * 1.3);
      }
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'swarm':
      ctx.fillStyle = c;
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * r * 0.6;
        ctx.beginPath();
        ctx.ellipse ? ctx.ellipse(off, off * 0.4, r * 0.6, r * 0.35, 0.4, 0, Math.PI * 2) : ctx.arc(off, off * 0.4, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = a;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r * 0.9, -r * 0.5);
      ctx.lineTo(r * 1.6, -r * 0.9);
      ctx.stroke();
      break;
    case 'bolt':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(2, r * 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 1.3);
      ctx.lineTo(-r * 0.35, 0);
      ctx.lineTo(r * 0.35, 0);
      ctx.lineTo(-r * 0.5, r * 1.3);
      ctx.stroke();
      break;
    case 'shock': {
      const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.6, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    // ---- 近战刀光 ----
    case 'claw':
      // 三道平行爪痕
      ctx.strokeStyle = c;
      ctx.lineCap = 'round';
      for (let i = -1; i <= 1; i++) {
        ctx.lineWidth = Math.max(2, r * (0.22 - Math.abs(i) * 0.05));
        ctx.beginPath();
        ctx.arc(0, 0, r * (0.8 + i * 0.22), -0.55, 0.55);
        ctx.stroke();
      }
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.28, -0.42, 0.42);
      ctx.stroke();
      break;
    case 'kunwu-blade':
      // 一道宽厚的大剑弧
      ctx.strokeStyle = c;
      ctx.lineCap = 'butt';
      ctx.lineWidth = Math.max(4, r * 0.3);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, -0.6, 0.6);
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.24, -0.5, 0.5);
      ctx.stroke();
      break;
    // ---- 领域 ----
    case 'halo':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(3, r * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = Math.max(2, r * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.22, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'aegis':
      // 六边护壁
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(3, r * 0.12);
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const ang = -Math.PI / 2 + (i / 6) * Math.PI * 2;
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'quake':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(3, r * 0.16);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r * 0.75, Math.sin(ang) * r * 0.75);
        ctx.lineTo(Math.cos(ang) * r * 1.25, Math.sin(ang) * r * 1.25);
        ctx.stroke();
      }
      break;
    case 'swirl':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(2, r * 0.12);
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const start = (k / 3) * Math.PI * 2;
        for (let i = 0; i <= 18; i++) {
          const t = i / 18;
          const ang = start + t * Math.PI * 1.5;
          const rad = r * (0.25 + t * 0.85);
          const x = Math.cos(ang) * rad;
          const y = Math.sin(ang) * rad;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    case 'miasma':
    case 'hex-mist': {
      const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
      g.addColorStop(0, c);
      g.addColorStop(0.6, a);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (shape === 'hex-mist') {
        ctx.strokeStyle = c;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const ang = -Math.PI / 2 + (i / 6) * Math.PI * 2;
          const x = Math.cos(ang) * r * 0.6;
          const y = Math.sin(ang) * r * 0.6;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'beast':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.4, -r * 0.9);
      ctx.lineTo(-r, 0);
      ctx.lineTo(-r * 0.4, r * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(r * 0.3, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'wraith':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.7, Math.PI, 0);
      ctx.lineTo(r * 0.7, r * 0.9);
      ctx.lineTo(r * 0.2, r * 0.4);
      ctx.lineTo(-r * 0.2, r * 0.9);
      ctx.lineTo(-r * 0.7, r * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(0, -r * 0.25, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ring-blade':
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(-r * 1.4, 0);
      ctx.lineTo(0, -r * 0.45);
      ctx.lineTo(r * 1.4, 0);
      ctx.lineTo(0, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    case 'bone':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(3, r * 0.42);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.7, Math.PI * 0.2, Math.PI * 1.2);
      ctx.stroke();
      ctx.fillStyle = a;
      for (const [dx, dy] of [[r * 0.65, r * 0.45], [-r * 0.65, r * 0.45]]) {
        ctx.beginPath();
        ctx.arc(dx, dy, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'whale-beam':
      // 光束本体由 drawBeams 画，这里只给一个宽的柔光核
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.9;
      roundRect(ctx, -r * 2, -r * 0.35, r * 4, r * 0.7, r * 0.35);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    case 'sun-lance':
      lance(ctx, r * 0.6, r * 3.2, c, a);
      break;
    // ---- 四合一终极武器（各系专属，比普通武器更"大场面"）----
    case 'ult-mountain':
      // 三重山脊 + 地裂光环
      ctx.fillStyle = c;
      for (const [hx, hy, hw] of [[-r, 0, r * 1.6], [0, -r * 0.35, r * 1.8], [r, 0, r * 1.6]]) {
        ctx.beginPath();
        ctx.moveTo(hx - hw, 0);
        ctx.lineTo(hx, -r * 1.2);
        ctx.lineTo(hx + hw, 0);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'ult-tide':
      // 三重同心潮汐环 + 放射水刃
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      for (const rr of [r * 0.6, r, r * 1.5]) {
        ctx.beginPath();
        ctx.arc(0, 0, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = a;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r * 0.6, Math.sin(ang) * r * 0.6);
        ctx.lineTo(Math.cos(ang) * r * 1.5, Math.sin(ang) * r * 1.5);
        ctx.stroke();
      }
      break;
    case 'ult-inferno':
      // 内火核 + 外焰舌
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang - 0.3) * r * 0.6, Math.sin(ang - 0.3) * r * 0.6);
        ctx.quadraticCurveTo(Math.cos(ang) * r * 1.5, Math.sin(ang) * r * 1.5, Math.cos(ang + 0.3) * r * 0.6, Math.sin(ang + 0.3) * r * 0.6);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'ult-sun':
      // 金色日轮 + 放射光刺
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
        ctx.lineTo(Math.cos(ang) * r * 1.7, Math.sin(ang) * r * 1.7);
        ctx.stroke();
      }
      break;
    case 'ult-wraith':
      // 幽魂面 + 飘散符带
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, -r * 0.2, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, r * 1.6, r, 0);
      ctx.quadraticCurveTo(0, r * 0.6, -r, 0);
      ctx.fill();
      break;
    case 'ult-jade':
      // 玉璧 + 外圆内方
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = a;
      ctx.lineWidth = 2;
      roundRect(ctx, -r * 0.45, -r * 0.45, r * 0.9, r * 0.9, r * 0.15);
      ctx.stroke();
      break;
    default: {
      // 兜底：一个发光的圆点，带一圈副色描边
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = a;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      break;
    }
  }
}
