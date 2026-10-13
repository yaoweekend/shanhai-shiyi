// 武器视觉自检：24 把武器必须"一眼可辨"，不能互相撞脸。
// 背景：用户报"利爪横扫和海矛穿刺特效就是一样的"——根因是 24 把武器
// 共用少数几个占位生成器（横扫类全部走 gen_proj_sweep）。
import { WEAPONS } from '../src/content/weapons.js';
import { WEAPON_VISUAL, visualOf, missingVisuals, duplicateVisuals } from '../src/content/weapon-visuals.js';

let pass = 0;
let fail = 0;
const bad = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else {
    fail++;
    bad.push(name + (detail ? ' — ' + detail : ''));
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

section('1. 每把武器都有视觉配置');
{
  const missing = missingVisuals(WEAPONS);
  check('24 把武器全部有视觉配置', missing.length === 0, missing.join(','));
  check('配置里没有多余的键（不会指到不存在的武器）', Object.keys(WEAPON_VISUAL).every((id) => WEAPONS.some((w) => w.id === id)), Object.keys(WEAPON_VISUAL).filter((id) => !WEAPONS.some((w) => w.id === id)).join(','));
}

section('2. 形状必须够多样（不能撞脸）');
{
  const shapes = new Set(WEAPONS.map((w) => visualOf(w.id).shape));
  console.log(`  形状种类：${shapes.size} 种 —— ${[...shapes].join(', ')}`);
  check('形状种类 ≥ 16（24 把武器不能只有几种画法）', shapes.size >= 16, `${shapes.size} 种`);
  const dups = duplicateVisuals(WEAPONS);
  console.log(`  完全相同的武器对：${dups.length ? dups.map((d) => d.join('=')).join(' ') : '（无）'}`);
  check('不存在"形状 + 颜色"完全相同的武器', dups.length === 0, dups.map((d) => d.join('=')).join(' '));
}

section('3. 同一类型的武器不能共用同一个形状');
{
  // 用户报的具体问题：两个都是 sweep，画出来一样
  const byKind = {};
  for (const w of WEAPONS) {
    byKind[w.kind] = byKind[w.kind] || [];
    byKind[w.kind].push(w);
  }
  const clash = [];
  for (const kind of Object.keys(byKind)) {
    const list = byKind[kind];
    if (list.length < 2) continue;
    const shapeSet = new Set(list.map((w) => visualOf(w.id).shape));
    if (shapeSet.size < list.length) {
      const counts = {};
      for (const w of list) {
        const s = visualOf(w.id).shape;
        counts[s] = (counts[s] || 0) + 1;
      }
      const shared = Object.entries(counts).filter(([, n]) => n > 1).map(([s]) => s);
      clash.push(`${kind}: ${shared.join(',')}`);
    }
  }
  console.log(`  按类型分组：${Object.entries(byKind).map(([k, v]) => `${k}×${v.length}`).join(' ')}`);
  check('同一 kind 的武器形状各不相同', clash.length === 0, clash.join('; '));
  // 具体点名用户报的那一对
  check('利爪横扫 与 海茅穿刺 形状不同', visualOf('w_lizhao').shape !== visualOf('w_haimao').shape, `${visualOf('w_lizhao').shape} vs ${visualOf('w_haimao').shape}`);
  check('利爪横扫 与 海茅穿刺 颜色不同', visualOf('w_lizhao').color !== visualOf('w_haimao').color, `${visualOf('w_lizhao').color} vs ${visualOf('w_haimao').color}`);
}

section('4. 同系武器共享色系，但彼此可辨');
{
  const { SERIES } = await import('../src/content/series.js');
  // 只检查"可通过卡池获得的普通武器"（排除 locked 的四合一终极武器：
  // 它们是单独的一档，与普通武器不构成"同系选择"）
  const regular = WEAPONS.filter((w) => !w.locked);
  for (const sid of ['shan', 'hai', 'huang', 'tian', 'ling', 'kun']) {
    const list = regular.filter((w) => w.series === sid);
    const shapes = list.map((w) => visualOf(w.id).shape);
    check(`${sid} 系 4 把武器形状各不相同`, new Set(shapes).size === 4, shapes.join(','));
    check(`${sid} 系的视觉用到了该系主色`, list.some((w) => visualOf(w.id).color === SERIES[sid].color || visualOf(w.id).accent === SERIES[sid].color), list.map((w) => visualOf(w.id).color).join(','));
  }
}

console.log(`\n================ 武器视觉自检 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
