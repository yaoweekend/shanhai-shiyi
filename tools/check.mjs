// 静态自检（不需要浏览器，也不需要测试框架）：node tools/check.mjs
// 校验：① 模块能否解析 ② 模块间导出/导入是否对得上 ③ DOM id 是否都存在
//       ④ 内容表完整性（配方/角色/试炼）⑤ 占位覆盖 ⑥ 不联网约束
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
let fail = 0;
let pass = 0;
const bad = [];

function ok(name) {
  pass++;
}
function no(name, detail) {
  fail++;
  bad.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---------------- 1. 模块解析与导入/导出一致性 ----------------

section('1. 模块解析与导入/导出一致性');
const files = (await walk(join(root, 'src'))).filter((f) => f.endsWith('.js'));
const importRe = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
const exportRe = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
const exportBraceRe = /export\s+\{([^}]+)\}/g;

for (const f of files) {
  const src = await readFile(f, 'utf8');
  const rel = relative(root, f);
  // 语法解析（用动态 import 走一遍会更准，但会执行副作用；这里用 Function 只做语法检查不可行，
  // 所以用 node --check 等价手段：动态 import 只在 tools 里不做。改用正则 + 试执行关键模块。）
  const exports = new Set();
  let m;
  while ((m = exportRe.exec(src))) exports.add(m[1]);
  while ((m = exportBraceRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) exports.add(name);
    }
  }
  const imported = new Set();
  importRe.lastIndex = 0;
  while ((m = importRe.exec(src))) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    let ts = null;
    try {
      ts = await stat(target);
    } catch (e) {
      ts = null;
    }
    if (!ts) {
      no(`${rel} 导入的模块存在`, `找不到 ${spec}`);
      continue;
    }
    const tsrc = await readFile(target, 'utf8');
    const texports = new Set();
    let tm;
    const tre = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g;
    while ((tm = tre.exec(tsrc))) texports.add(tm[1]);
    const tbre = /export\s+\{([^}]+)\}/g;
    while ((tm = tbre.exec(tsrc))) {
      for (const part of tm[1].split(',')) {
        const nm = part.trim().split(/\s+as\s+/).pop().trim();
        if (nm) texports.add(nm);
      }
    }
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim())) {
      if (!name) continue;
      imported.add(name);
      if (!texports.has(name) && !tsrc.includes(`export default`)) {
        no(`${rel} 导入名存在`, `${spec} 没有导出 ${name}`);
      }
    }
  }
  ok(rel);
}

// 逐个动态 import 所有模拟层与内容层模块（纯逻辑，无 DOM）
section('2. 模拟层/内容层可加载（不依赖 DOM）');
const pureDirs = ['core', 'content', 'sim', 'config.js', 'meta/save.js'];
const pureFiles = files.filter((f) => pureDirs.some((d) => relative(root, f).startsWith('src/' + d)));
for (const f of pureFiles) {
  try {
    await import(pathToFileURL(f).href);
    ok(relative(root, f));
  } catch (e) {
    no(`加载 ${relative(root, f)}`, String(e && e.message));
  }
}

// ---------------- 3. DOM id 一致性 ----------------

section('3. DOM id 与 JS 引用一致性');
const html = await readFile(join(root, 'index.html'), 'utf8');
const htmlIds = new Set();
let hm;
const idRe = /\bid="([^"]+)"/g;
while ((hm = idRe.exec(html))) htmlIds.add(hm[1]);
const jsForIds = files.filter((f) => relative(root, f).startsWith('src/ui/') || relative(root, f) === 'src/main.js');
const referenced = new Map();
for (const f of jsForIds) {
  const src = await readFile(f, 'utf8');
  let m2;
  const g1 = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m2 = g1.exec(src))) referenced.set(m2[1], relative(root, f));
  const g2 = /\$\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m2 = g2.exec(src))) referenced.set(m2[1], relative(root, f));
}
for (const [id, file] of referenced) {
  if (id.startsWith('screen-')) {
    if (!htmlIds.has(id)) no(`DOM id 存在：${id}`, `被 ${file} 引用但 index.html 里没有`);
    else ok(id);
  } else if (!htmlIds.has(id)) {
    no(`DOM id 存在：${id}`, `被 ${file} 引用但 index.html 里没有`);
  } else ok(id);
}
// 反向：HTML 里的 screen-* 是否都被 UI 的 screens 列表管理
const uiSrc = await readFile(join(root, 'src/ui/ui.js'), 'utf8');
const listMatch = /this\.screens = \[([^\]]+)\]/.exec(uiSrc);
if (listMatch) {
  const list = listMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const id of htmlIds) {
    if (id.startsWith('screen-')) {
      const short = id.replace('screen-', '');
      if (!list.includes(short)) no(`UI.screens 覆盖 ${id}`, `screens 列表里没有 ${short}`);
      else ok(id);
    }
  }
}

// ---------------- 4. 内容表完整性 ----------------

section('4. 内容表完整性');
const { BATCH1_WEAPONS } = await import(pathToFileURL(join(root, 'src/content/weapons.js')).href);
const { BATCH1_PASSIVES } = await import(pathToFileURL(join(root, 'src/content/passives.js')).href);
const { FUSIONS } = await import(pathToFileURL(join(root, 'src/content/fusions.js')).href);
const { BATCH1_CHARACTERS, CHARACTERS } = await import(pathToFileURL(join(root, 'src/content/characters.js')).href);
const { SLOTS } = await import(pathToFileURL(join(root, 'src/assets/manifest.js')).href);
const { CHANNELS } = await import(pathToFileURL(join(root, 'src/core/channels.js')).href);

// 数量不再写死：期望值就从"6 系 × 4 把/4 件"推出来，避免每次加内容都要改测试
const EXPECT_WEAPONS = 24; // 6 系 × 4 把
const EXPECT_PASSIVES = 24; // 6 系 × 4 件
if (BATCH1_WEAPONS.length === EXPECT_WEAPONS) ok(`武器共 ${EXPECT_WEAPONS} 把（6 系 × 4）`);
else no('武器数量', `实际 ${BATCH1_WEAPONS.length}（期望 ${EXPECT_WEAPONS}）`);
if (BATCH1_PASSIVES.length === EXPECT_PASSIVES) ok(`被动共 ${EXPECT_PASSIVES} 件（6 系 × 4）`);
else no('被动数量', `实际 ${BATCH1_PASSIVES.length}（期望 ${EXPECT_PASSIVES}）`);
if (FUSIONS.length === EXPECT_WEAPONS) ok(`血统配方共 ${FUSIONS.length} 条（每把武器一条）`);
else no('配方数量', `实际 ${FUSIONS.length}（期望 ${EXPECT_WEAPONS}）`);
// 每个系必须自洽：4 把武器 / 4 件被动 / ≥3 条血统配方 / 1 条合体终极
{
  const { ULTIMATE_FUSIONS } = await import(pathToFileURL(join(root, 'src/content/fusions.js')).href);
  const { CHARACTERS } = await import(pathToFileURL(join(root, 'src/content/characters.js')).href);
  for (const sid of ['shan', 'hai', 'huang', 'tian', 'ling', 'kun']) {
    const w = BATCH1_WEAPONS.filter((x) => x.series === sid).length;
    const p = BATCH1_PASSIVES.filter((x) => x.series === sid).length;
    const f = FUSIONS.filter((x) => x.series === sid).length;
    const u = ULTIMATE_FUSIONS.filter((x) => x.series === sid).length;
    const c = CHARACTERS.filter((x) => x.series === sid).length;
    if (w === 4 && p === 4 && f >= 3 && u === 1 && c === 1) ok(`${sid} 系内容完整（4 武器/4 被动/${f} 配方/1 终极/1 角色）`);
    else no(`${sid} 系内容完整`, `武器 ${w}/4，被动 ${p}/4，配方 ${f}，终极 ${u}/1，角色 ${c}/1`);
  }
  // 每把武器都要有配方
  for (const w of BATCH1_WEAPONS) {
    if (!FUSIONS.some((f) => f.weapon === w.id)) no(`武器 ${w.id} 有配方`);
  }
}
if (CHANNELS.length === 24) ok('修饰器通道 24 条');
else no('通道数量', `实际 ${CHANNELS.length}`);

for (const w of BATCH1_WEAPONS) {
  if (w.levels.length !== 5) no(`武器 ${w.id} 等级表`, `应有 5 级，实际 ${w.levels.length}`);
  if (!FUSIONS.some((f) => f.weapon === w.id)) no(`武器 ${w.id} 有配方`);
}
for (const p of BATCH1_PASSIVES) {
  if (!CHANNELS.some((c) => c.id === p.channel)) no(`被动 ${p.id} 的通道存在`, p.channel);
}
for (const f of FUSIONS) {
  if (!BATCH1_WEAPONS.some((w) => w.id === f.weapon)) no(`配方 ${f.id} 武器存在`, f.weapon);
  if (!BATCH1_PASSIVES.some((p) => p.id === f.passive)) no(`配方 ${f.id} 被动存在`, f.passive);
}
for (const c of CHARACTERS) {
  if (c.locked) continue;
  if (!BATCH1_WEAPONS.some((w) => w.id === c.weapon)) no(`角色 ${c.id} 初始武器`, c.weapon);
  if (!BATCH1_PASSIVES.some((p) => p.id === c.passive)) no(`角色 ${c.id} 初始被动`, c.passive);
  const mods = Object.keys(c.mods || {});
  if (mods.length !== 2) no(`角色 ${c.id} 双向微调`, `应有 2 条，实际 ${mods.length}`);
  for (const k of mods) {
    if (Math.abs(c.mods[k]) > 0.1) no(`角色 ${c.id} 微调幅度 ${k}`, `${c.mods[k]} 超过 10%`);
    if (!CHANNELS.some((ch) => ch.id === k)) no(`角色 ${c.id} 微调通道存在`, k);
  }
  const hasPlus = mods.some((k) => c.mods[k] > 0);
  const hasMinus = mods.some((k) => c.mods[k] < 0);
  if (!(hasPlus && hasMinus)) no(`角色 ${c.id} 禁止纯增益`, JSON.stringify(c.mods));
}
// 硬上限
const dr = CHANNELS.find((c) => c.id === 'dr');
const crit = CHANNELS.find((c) => c.id === 'critChance');
if (dr && dr.hardCap < 0.8) ok('减伤硬上限 < 80%');
else no('减伤硬上限', String(dr && dr.hardCap));
if (crit && crit.hardCap <= 1) ok('暴击率硬上限 ≤ 100%');
else no('暴击率硬上限', String(crit && crit.hardCap));

// ---------------- 5. 占位覆盖 ----------------

section('5. 资源清单与占位覆盖');
const requiredSlots = [
  'char_shanpo', 'char_haipo', 'char_huangpo',
  'enemy_shanxiao', 'enemy_bifang', 'enemy_huashe', 'enemy_xinang', 'enemy_qiangliang',
  'boss_xiangliu', 'arena_floor', 'arena_obstacle',
];
for (const id of requiredSlots) {
  if (SLOTS.some((s) => s.id === id)) ok(id);
  else no(`槽位存在：${id}`);
}
for (const s of SLOTS) {
  if (!s.generator) no(`槽位 ${s.id} 有占位生成器`);
  if (!s.w || !s.h) no(`槽位 ${s.id} 有尺寸`);
}

// ---------------- 6. 不联网约束 ----------------

section('6. 严格不联网约束（架构硬约束）');
const allFiles = [...files, join(root, 'index.html'), join(root, 'src/ui/styles.css')];
const netRe = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.sendBeacon)\b/;
const urlRe = /https?:\/\/(?!127\.0\.0\.1|localhost)[^\s'")]+/g;
for (const f of allFiles) {
  const src = await readFile(f, 'utf8');
  const rel = relative(root, f);
  if (rel.endsWith('tools/serve.mjs') || rel.endsWith('check.mjs')) continue;
  if (netRe.test(src)) no(`${rel} 不含网络调用`, netRe.exec(src)[1]);
  let m3;
  urlRe.lastIndex = 0;
  while ((m3 = urlRe.exec(src))) {
    // 允许注释里的文档链接（源码中出现的 http 链接只应在注释/许可说明里）
    const line = src.slice(0, m3.index).split('\n').pop();
    if (!/^\s*(\/\/|\*|\/\*)/.test(line)) {
      no(`${rel} 不含外部 URL`, m3[0]);
    }
  }
}
ok('网络调用静态检查');

// ---------------- 7. 触控常量不许再手写（防止"删了定义还在用"这类真机 bug） ----------------

section('7. 触控布局常量引用检查');
{
  // 教训：曾把 JOY 的定义删掉，但摇杆拖动里还在用 JOY.r，
  // 结果每帧抛 ReferenceError、真机摇杆全废 —— 桌面自动化没覆盖到那条交互路径。
  const files = ['src/main.js', 'src/render/render2d.js'];
  const banned = /\bJOY\b|\bBTN\b/;
  for (const f of files) {
    const src = await readFile(join(root, f), 'utf8');
    if (banned.test(src)) no(`${f} 不再手写 JOY/BTN 常量`, '应统一使用 render/touch-layout.js 导出的 TOUCH');
    else ok(f);
  }
  // main.js 里凡是用到 TOUCH.joy.r 之类的，必须真的 import 了 TOUCH
  const mainSrc = await readFile(join(root, 'src/main.js'), 'utf8');
  if (/\bTOUCH\./.test(mainSrc) && !/import\s*\{[^}]*\bTOUCH\b[^}]*\}/.test(mainSrc)) {
    no('main.js 使用 TOUCH 前有导入', '少了 TOUCH 的 import');
  } else {
    ok('main.js 的 TOUCH 导入');
  }
  // 不允许把触控坐标写死在别的文件里
  const renderSrc = await readFile(join(root, 'src/render/render2d.js'), 'utf8');
  if (/LOGIC_W\s*-\s*16\s*-\s*50/.test(renderSrc)) no('render2d.js 不手写按钮坐标', '应使用 TOUCH.dash.cx');
  else ok('render2d.js 的触控坐标来源');
}

// ---------------- 8. 素材取用必须走 getAsset（不许绕过 manifest 的 file 字段） ----------------

section('8. 素材取用路径检查（file 字段必须真的生效）');
{
  // 教训：ui.js 的 iconDataUrl 曾经直接调 getPlaceholder(slot)，
  // 于是"给 icon_* 槽位填了正式图"在 DOM 层完全无效 —— 升级卡和暂停栏里
  // 永远显示程序生成的占位图，而画布内的槽位面板走的是 getAsset()，
  // 两处图标对不上。这类 bug 不报错、不崩、只是"素材白画了"，很难被发现。
  //
  // 规则：任何**展示素材**的模块，要么调 getAsset()，要么调 getPlaceholder()
  // 但必须同时用 getAsset()（即：允许它在 getAsset 的回退分支里出现）。
  const viewers = ['src/ui/ui.js', 'src/render/render2d.js'];
  for (const f of viewers) {
    const src = await readFile(join(root, f), 'utf8');
    const usesPlaceholder = /\bgetPlaceholder\s*\(/.test(src);
    const usesAsset = /\bgetAsset\s*\(/.test(src);
    if (usesPlaceholder && !usesAsset) {
      no(`${f} 展示素材时走 getAsset`, '只调了 getPlaceholder，会绕过 manifest 的 file 字段');
    } else if (usesPlaceholder && !/import\s*\{[^}]*\bgetAsset\b[^}]*\}/.test(src)) {
      no(`${f} 导入了 getAsset`, '用了 getPlaceholder 就必须同时导入 getAsset 作为首选路径');
    } else {
      ok(`${f} 的素材取用路径`);
    }
  }
  // iconDataUrl 这个名字是 DOM 层图标的唯一入口，必须基于 getAsset
  const uiSrc = await readFile(join(root, 'src/ui/ui.js'), 'utf8');
  const m = /function iconDataUrl\([\s\S]*?\n\}/.exec(uiSrc);
  if (!m) no('ui.js 里能找到 iconDataUrl', '函数被改名或删除了？');
  else if (!/getAsset\s*\(/.test(m[0])) no('iconDataUrl 基于 getAsset', '它绕过了 file 字段，填了正式图也不会显示');
  else ok('iconDataUrl 的取图路径');
}

// ---------------- 9. 具体道具必须用自己那个图标（不许一律落到通用图标） ----------------

section('9. 道具图标接线检查（每件道具要用自己的图）');
{
  // 教训：24 个被动图标全画了、全进包了，却一处都没接上 ——
  // ui.js / render2d.js 里 5 个调用点各自手写 'icon_passive'，
  // 于是所有被动在卡片、暂停栏、HUD 槽位、角色挂件上长得一模一样。
  // 这种错误不报错、不崩、素材也不缺，只是**等于没画**，必须静态拦住。
  //
  // 规则：能拿到具体被动 id 的地方，必须走 passiveIconSlot(pid)；
  // 字面量 'icon_passive' 只允许出现在两处：passiveIconSlot 自己的回退分支、
  // 以及找不到 id 时的兜底默认值。
  const files = ['src/ui/ui.js', 'src/render/render2d.js'];
  for (const f of files) {
    const src = await readFile(join(root, f), 'utf8');
    const hits = [...src.matchAll(/['"]icon_passive['"]/g)];
    // 允许的行：注释里明确标注了"回退/兜底/默认"的，或含 passiveIconSlot 的回退分支。
    // 注释通常写在上一行，所以要看匹配点前两行到本行这一小段，只看本行会漏判。
    const suspicious = hits.filter((h) => {
      const lineStart = src.lastIndexOf('\n', h.index) + 1;
      const lineEnd = src.indexOf('\n', h.index);
      const prevStart = src.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
      const win = src.slice(prevStart, lineEnd);
      return !/passiveIconSlot|fallback|回退|兜底|默认/.test(win);
    });
    if (suspicious.length > 0) {
      no(
        `${f} 不为具体被动硬写通用 'icon_passive'`,
        `还有 ${suspicious.length} 处：${suspicious.map((h) => src.slice(src.lastIndexOf('\n', h.index) + 1, src.indexOf('\n', h.index)).trim()).join(' | ')}`,
      );
    } else {
      ok(`${f} 的被动图标接线`);
    }
  }
  // 渲染层必须真的调用了 passiveIconSlot（否则等于没接）
  const r2 = await readFile(join(root, 'src/render/render2d.js'), 'utf8');
  if (!/passiveIconSlot\s*\(/.test(r2)) no('render2d.js 使用 passiveIconSlot', 'HUD 槽位面板与角色挂件仍会显示同一个通用被动图标');
  else ok('render2d.js 使用被动专属图标');
}

// ---------------- 10. 调参面板的守门（规格 specs/shanhai-dev-tune.md §6） ----------------

section('10. 调参面板不得进入正式包（守门）');
{
  // 规矩：`src/dev/` 只有一个入口 —— main.js 里那一句**动态** `import('./dev/tune-panel.js')`，
  // 且它被 `if (DEV_TUNE)` 守着。任何**静态** import 都会让面板连同它的 DOM 一起进正式包，
  // 而这类改动不会报错、不会崩，只是悄悄把调试功能发给了玩家 —— 必须静态拦住。
  const srcFiles = files.filter((f) => f.endsWith('.js'));
  const offenders = [];
  for (const f of srcFiles) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const src = await readFile(f, 'utf8');
    // 静态 import 到 src/dev/ 的一律违规
    const staticImports = [...src.matchAll(/^\s*import\s[^;]*from\s*['"][^'"]*\/dev\//gm)];
    for (const m of staticImports) offenders.push(`${rel} 静态 import 了 dev/：${m[0].trim()}`);
  }
  if (offenders.length) no('src/dev/ 只能被动态 import', offenders.join(' | '));
  else ok('src/dev/ 没有静态导入点');

  const mainSrc = await readFile(join(root, 'src/main.js'), 'utf8');
  if (!/import\(\s*['"]\.\/dev\/tune-panel\.js['"]\s*\)/.test(mainSrc)) {
    no('main.js 用动态 import 加载调参面板', '面板入口被改成了静态 import 或路径变了');
  } else ok('main.js 的动态 import 入口');

  // 入口必须被 DEV_TUNE 守着：检查动态 import 之前最近的一个条件里出现 DEV_TUNE
  const idx = mainSrc.search(/import\(\s*['"]\.\/dev\/tune-panel\.js['"]\s*\)/);
  const guard = idx >= 0 ? mainSrc.slice(Math.max(0, idx - 400), idx) : '';
  if (!/if\s*\(\s*DEV_TUNE\s*\)/.test(guard)) {
    no('调参面板入口被 DEV_TUNE 守住', 'DEV_TUNE 不见了，等于正式包也会加载面板');
  } else ok('调参面板入口的守卫');

  // ?dev= 的解析必须是"逗号分隔的集合"，且 tune 不在其中时 DEV_TUNE 为 false
  if (!/\.split\(','\)/.test(mainSrc)) no('?dev= 支持逗号分隔的多个值', '规格 §7-1');
  else ok('?dev= 的组合参数解析');

  // 面板不得写存档：src/dev/ 里不许出现存档写入路径
  const devFiles = files.filter((f) => /[\\/]src[\\/]dev[\\/]/.test(f));
  if (!devFiles.length) no('存在 src/dev/ 面板文件', '面板被删了？');
  for (const f of devFiles) {
    const rel = relative(root, f).replace(/\\/g, '/');
    const src = await readFile(f, 'utf8');
    if (/\b(persist|loadSave|clearSave|localStorage|sessionStorage)\b/.test(src)) {
      no(`${rel} 不写存档`, '面板改动只作用于当前这一局，严禁落盘');
    } else ok(`${rel} 不碰存档`);
  }
}

// ---------------- 汇总 ----------------
console.log(`\n================ 静态自检 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('问题项：');
  for (const b of bad) console.log(`  - ${b}`);
}
process.exit(fail === 0 ? 0 : 1);
