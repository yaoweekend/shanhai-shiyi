// 命名一致性检查（不需要浏览器）：武器图标槽位规则 icon_<武器id> 必须在清单与代码里一致。
// 用法：node tools/verify-icon-slots.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BATCH1_WEAPONS, WEAPONS } from '../src/content/weapons.js';
import { PASSIVES } from '../src/content/passives.js';
import { SLOT_BY_ID, SLOTS, FUTURE_SLOTS } from '../src/assets/manifest.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const problems = [];

// ① 清单里必须有每个武器的图标槽位，且 id 恰好是 icon_ + 武器id（含批 2~4 的占位武器）
for (const w of WEAPONS) {
  const id = 'icon_' + w.id;
  if (!SLOT_BY_ID[id]) problems.push(`清单缺少 ${id}`);
}

// ② 生产代码里拼接图标 id 的地方必须用同一个规则
const FILES = [
  { f: 'src/render/render2d.js', expect: ["'icon_' + t.id", "'icon_' + w.id"] },
  { f: 'src/ui/ui.js', expect: ["'icon_' + w.id"] },
];
for (const { f, expect } of FILES) {
  const src = readFileSync(resolve(root, f), 'utf8');
  for (const e of expect) if (!src.includes(e)) problems.push(`${f} 里缺少 ${e}`);
  if (/'icon_w_' \+/.test(src)) problems.push(`${f} 里出现 'icon_w_' 前缀（规则是 'icon_' + 武器id）`);
}

// ③ 清单里的槽位必须对应真实内容
for (const s of [...SLOTS, ...FUTURE_SLOTS]) {
  if (!s.id.startsWith('icon_')) continue;
  const bare = s.id.slice('icon_'.length);
  // 通用图标（被动/超武/掉落）不是"某把武器的图标"
  if (['passive', 'super', 'drop'].includes(bare)) continue;
  // 被动的专属图标槽位：icon_passive_<被动id>
  if (bare.startsWith('passive_')) {
    const pid = bare.slice('passive_'.length);
    if (!PASSIVES.some((p) => p.id === pid)) problems.push(`清单里的 ${s.id} 不对应任何被动`);
    continue;
  }
  // 其余一律视为武器图标：icon_<武器id>
  if (!WEAPONS.some((w) => w.id === bare)) problems.push(`清单里的 ${s.id} 不对应任何武器（应为 icon_<武器id>）`);
}

if (problems.length === 0) {
  console.log('================ 槽位命名一致性 1 通过 / 0 失败 ================');
  console.log('✓ 武器图标槽位命名一致（清单与生产代码都用 icon_<武器id>）');
  process.exit(0);
}
console.log(`================ 槽位命名一致性 0 通过 / 1 失败 ================`);
console.log(`发现 ${problems.length} 个命名问题：`);
for (const p of problems) console.log('  - ' + p);
process.exit(1);
