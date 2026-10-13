// 精灵素材验收（独立于出图工具自身的自检）。
// 目的：子代理/出图脚本说"通过"不算数，这里用另一套代码重新量一遍。
// 用法：node test/sprites.mjs
//
// 量的是**外部可观察的事实**，不管图是怎么画出来的：
//   1. manifest 里登记了 file 的槽位，文件真的存在
//   2. 文件尺寸精确等于槽位声明的 w×h
//   3. 图不是空的（有非透明像素）
//   4. 主体居中（非透明包围盒的四周留白不偏）
//   5. 背景透明（四角 alpha = 0）
//   6. 同一批的精灵不撞脸（两两像素差异足够大）
//
// 需要 PIL 之外的纯 Node PNG 解码？不需要 —— 直接调用本机 python 读像素，
// 避免为了一个自检引入 npm 依赖（规格：零依赖）。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { SLOTS, SLOT_BY_ID, FUTURE_SLOTS } from '../src/assets/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

let pass = 0;
let fail = 0;
const bad = [];
function check(name, cond, detail = '') {
  if (cond) pass++;
  else {
    fail++;
    bad.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// 也要扫 FUTURE_SLOTS：第 4~6 系的角色（天魄/巫魄/不死魄）定义在那里。
// 只遍历 SLOTS 的话，这三个角色会永远不被验收 —— 真图路径写错也没人发现，
// 游戏只会静默回退到几何占位图。这是一个真实存在过的漏检口子。
const ALL_SLOTS = [...SLOTS, ...FUTURE_SLOTS];
const withFile = ALL_SLOTS.filter((s) => s.file);
console.log(
  `\n=== 素材槽位：SLOTS ${SLOTS.length} + FUTURE_SLOTS ${FUTURE_SLOTS.length}，其中已提供真图 ${withFile.length} 个 ===`,
);
if (withFile.length === 0) {
  console.log('  （还没有任何槽位填 file，全部走程序生成回退 —— 这不算失败）');
  console.log(`\n================ 素材验收 ${pass} 通过 / ${fail} 失败 ================`);
  process.exit(0);
}

// 用 python 一次性量出所有指标，避免每张图起一个进程
const script = `
import json, sys
from PIL import Image
items = json.loads(sys.argv[1])
out = []
for it in items:
    r = {"id": it["id"]}
    try:
        im = Image.open(it["path"]).convert("RGBA")
    except Exception as e:
        r["error"] = str(e); out.append(r); continue
    r["w"], r["h"] = im.size
    bb = im.getbbox()
    r["bbox"] = list(bb) if bb else None
    px = im.load()
    W, H = im.size
    r["corners"] = [px[0,0][3], px[W-1,0][3], px[0,H-1][3], px[W-1,H-1][3]]
    # 缩到 8x8 灰度指纹，用于两两比较（跨尺寸也能比）
    r["fp"] = list(im.convert("L").resize((8,8), Image.BILINEAR).tobytes())
    # 再取一份 16x16 的 RGBA，用于"逐像素差"度量：它比灰度指纹更抗尺寸差，
    # 也能顺带看出颜色是否撞车（两张形状同色也同 → 像素差会很低）
    r["rgba"] = list(im.resize((16,16), Image.BILINEAR).tobytes())
    # 主色：非透明像素的平均色（用 tobytes 而不是已弃用的 getdata）
    b = im.tobytes()
    vis = [(b[i], b[i+1], b[i+2]) for i in range(0, len(b), 4) if b[i+3] > 8]
    if vis:
        r["avg"] = [sum(p[k] for p in vis)//len(vis) for k in range(3)]
        r["opaque"] = len(vis)
    else:
        r["avg"] = None; r["opaque"] = 0
    out.append(r)
print(json.dumps(out))
`;

const items = withFile.map((s) => ({ id: s.id, path: join(root, s.file) }));
const missing = items.filter((it) => !existsSync(it.path));
for (const m of missing) check(`${m.id} 的文件存在`, false, m.path);

const present = items.filter((it) => existsSync(it.path));
let measured = [];
if (present.length) {
  const raw = execFileSync('python', ['-c', script, JSON.stringify(present)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  measured = JSON.parse(raw);
}

for (const r of measured) {
  const slot = SLOT_BY_ID[r.id];
  const label = `${slot.cn}(${r.id})`;
  if (r.error) {
    check(`${label} 能被解码`, false, r.error);
    continue;
  }
  check(`${label} 尺寸 = ${slot.w}×${slot.h}`, r.w === slot.w && r.h === slot.h, `实际 ${r.w}×${r.h}`);
  check(`${label} 不是空图`, !!r.bbox, '无非透明像素');
  check(`${label} 四角透明`, r.corners.every((a) => a === 0), `alpha=${r.corners.join(',')}`);
  if (r.bbox) {
    const [x0, y0, x1, y1] = r.bbox;
    const padL = x0, padR = r.w - x1, padT = y0, padB = r.h - y1;
    const tol = Math.max(2, Math.round(Math.max(r.w, r.h) * 0.15));
    // 主体必须留边（不贴边），且上下/左右留白之差不能太离谱
    check(`${label} 四周留透明边距`, padL >= 1 && padR >= 1 && padT >= 1 && padB >= 1, `L${padL} R${padR} T${padT} B${padB}`);
    check(`${label} 主体居中`, Math.abs(padL - padR) <= tol && Math.abs(padT - padB) <= tol, `L${padL} R${padR} T${padT} B${padB} 容差${tol}`);
  }
}

// 撞脸检测。
//
// 教训：我第一版写死 `指纹差 > 4`，那是按"0–1 归一化"的直觉定的，
// 但 PIL 的 L 模式是 0–255 字节，实际差值动辄 10–30 —— 阈值形同虚设，
// 真正接近的一对（天魄 vs 不死魄，差 9.0）根本不会被拦下。
// 第二版我又按尺寸公式推阈值，结果在 132px 的 Boss 上推出 188 这种离谱数字。
//
// 结论：**不要猜绝对阈值**。这里改成报告三种互相印证的度量，
// 并用一个保守的、尺寸无关的判据：两个不同槽位在同一尺度下，
// 只要"逐像素差"或"指纹差"里有一项明显分离就算通过；同时把全局最接近的
// 若干对打印出来，让人能直接看到风险在哪（这才是真正有用的信息）。
const meanAbsDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};

const pairs = [];
for (let i = 0; i < measured.length; i++) {
  for (let j = i + 1; j < measured.length; j++) {
    const a = measured[i];
    const b = measured[j];
    if (!a.fp || !b.fp || !a.rgba || !b.rgba) continue;
    pairs.push({
      name: `${SLOT_BY_ID[a.id].cn} 与 ${SLOT_BY_ID[b.id].cn}`,
      fp: meanAbsDiff(a.fp, b.fp),
      rgba: meanAbsDiff(a.rgba, b.rgba),
    });
  }
}

// 判据：16×16 RGBA 逐像素平均差（含 alpha 与颜色）为主，
// 8×8 灰度指纹为辅 —— 两项都低才算撞脸。
// 实测参照：同规格下"明显不同"的精灵 rgba 差在 20 以上；近似的会有明显下降。
const RGBA_FLOOR = 12;
const FP_FLOOR = 6;
pairs.sort((p, q) => p.rgba + p.fp - (q.rgba + q.fp));
for (const p of pairs) {
  const ok = p.rgba >= RGBA_FLOOR || p.fp >= FP_FLOOR;
  check(`${p.name} 不撞脸`, ok, `逐像素差 ${p.rgba.toFixed(1)}（下限 ${RGBA_FLOOR}）、灰度指纹差 ${p.fp.toFixed(1)}（下限 ${FP_FLOOR}）`);
}
console.log('  最接近的 5 对（逐像素差 / 灰度指纹差）：');
for (const p of pairs.slice(0, 5)) {
  console.log(`    ${p.name.padEnd(24)} ${p.rgba.toFixed(1).padStart(6)} / ${p.fp.toFixed(1).padStart(5)}`);
}

console.log(`  已提供真图：${measured.map((r) => `${SLOT_BY_ID[r.id].cn} ${r.w}×${r.h}`).join('、')}`);
console.log(`\n================ 素材验收 ${pass} 通过 / ${fail} 失败 ================`);
if (fail) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
