// 编码体检（纳入测试套件）：保证所有源文件是合法 UTF-8、中文没被打碎。
// 用法：node test/encoding.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTS = ['.js', '.mjs', '.html', '.css', '.md', '.json', '.webmanifest'];
const SKIP = ['artifacts', 'cdp-profile', 'cdp-profile-save', 'node_modules'];

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

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

const files = await walk(root);
const strict = new TextDecoder('utf-8', { fatal: true });
let invalid = 0;
let replacement = 0;
let rare = 0;
let cjkFiles = 0;
for (const f of files) {
  const buf = await readFile(f);
  let text;
  try {
    text = strict.decode(buf);
  } catch (e) {
    invalid++;
    console.log(`  ✗ ${relative(root, f)} 不是合法 UTF-8`);
    continue;
  }
  if (text.includes('\uFFFD')) {
    replacement++;
    console.log(`  ✗ ${relative(root, f)} 含替换字符 U+FFFD`);
  }
  // CJK 扩展/兼容区字符不该出现在本项目的源码与文档里（乱码的典型残留）
  const m = text.match(/[\u3400-\u4DBF\uF900-\uFAFF\u2E80-\u2EFF\u31C0-\u31EF]/);
  if (m) {
    rare++;
    console.log(`  ✗ ${relative(root, f)} 含生僻区字符 ${m[0]}（U+${m[0].codePointAt(0).toString(16).toUpperCase()}）`);
  }
  // 控制字符（除 \t \n \r）
  const ctrl = [...text].filter((c) => c.charCodeAt(0) < 32 && c !== '\t' && c !== '\n' && c !== '\r');
  if (ctrl.length) {
    console.log(`  ✗ ${relative(root, f)} 含 ${ctrl.length} 个异常控制字符`);
    fail++;
    bad.push(`${relative(root, f)} 含异常控制字符`);
  }
  if ([...text].some((c) => c >= '\u4e00' && c <= '\u9fff')) cjkFiles++;
}

check('全部源文件是合法 UTF-8', invalid === 0, `${invalid} 个文件解码失败`);
check('没有替换字符（解码失败残留）', replacement === 0, `${replacement} 个文件`);
check('没有乱码生僻字残留', rare === 0, `${rare} 个文件`);
check('有中文内容的文件仍然保留中文', cjkFiles >= 20, `只有 ${cjkFiles} 个文件含中文`);

// 关键中文串必须完好（抽样：如果编码被打碎，这些词会消失）
const probes = [
  ['src/sim/world.js', '相柳'],
  ['src/content/weapons.js', '兽甲旋刃'],
  ['src/ui/ui.js', '隐私政策'],
  ['index.html', '开始一局'],
  ['README.md', '验收对照'],
  ['src/core/channels.js', '修饰器通道'],
];
for (const [f, needle] of probes) {
  const text = await readFile(join(root, f), 'utf8');
  check(`${f} 里中文串「${needle}」完好`, text.includes(needle));
}

console.log(`\n================ 编码体检 ${pass} 通过 / ${fail} 失败（扫描 ${files.length} 个文件） ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
