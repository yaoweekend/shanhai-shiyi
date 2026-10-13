// 一次性迁移脚本（保留在仓库里作为"命名规则变更"的记录）：
// 把武器图标槽位统一为 icon_<武器id>（武器 id 自带 w_ 前缀 → icon_w_shoujia）。
// 用法：node tools/migrate-icon-slots.mjs [--dry]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATCH1_WEAPONS } from '../src/content/weapons.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DRY = process.argv.includes('--dry');

// 期望：槽位 id === 'icon_' + 武器 id（批 1 的 9 把 + 批 2~4 的 3 把占位）
const ALL_WEAPONS = [...BATCH1_WEAPONS, { id: 'w_tian_1' }, { id: 'w_ling_1' }, { id: 'w_kun_1' }];
const want = new Map();
for (const w of ALL_WEAPONS) want.set('icon_' + w.id, w.id);

const targets = ['src/assets/manifest.js', 'src/render/render2d.js', 'src/ui/ui.js', 'test/accept.mjs'];
let totalEdits = 0;
for (const rel of targets) {
  const path = resolve(root, rel);
  let src = readFileSync(path, 'utf8');
  const before = src;
  // ① 清单里的槽位定义：id: 'icon_xxx' → id: 'icon_w_xxx'（按武器 id 反查）
  src = src.replace(/id: '(icon_[a-z0-9_]+)'/g, (m, slotId) => {
    if (!want.has(slotId)) return m; // icon_passive / icon_super / icon_drop 不动
    return `id: '${slotId}'`;
  });
  // ② 清单里漏了 w_ 的：icon_shoujia → icon_w_shoujia
  for (const w of BATCH1_WEAPONS) {
    const wrong = 'icon_' + w.id.replace(/^w_/, '');
    const right = 'icon_' + w.id;
    if (wrong === right) continue;
    src = src.split(`'${wrong}'`).join(`'${right}'`);
  }
  if (src !== before) {
    const n = src.length - before.length;
    totalEdits++;
    console.log(`${DRY ? '[dry] ' : ''}改写 ${rel}（长度变化 ${n}）`);
    if (!DRY) writeFileSync(path, src, 'utf8');
  } else {
    console.log(`跳过 ${rel}（无需改动）`);
  }
}
console.log(DRY ? '（dry run，没有写入）' : `完成，改写了 ${totalEdits} 个文件`);
