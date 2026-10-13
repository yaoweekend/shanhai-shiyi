// 槽位命名一致性测试（防止"看着有图标、实际回退到错误占位图"这种静默降级）。
// 覆盖全部 9 把武器、12 件被动、6 个角色、5 种敌人、Boss、9 种投射物。
import { SLOTS, slotById } from '../src/assets/manifest.js';
import { BATCH1_WEAPONS } from '../src/content/weapons.js';
import { BATCH1_PASSIVES } from '../src/content/passives.js';
import { CHARACTERS } from '../src/content/characters.js';
import { ENEMIES } from '../src/content/enemies.js';
import { FUSIONS } from '../src/content/fusions.js';
import { readFileSync } from 'node:fs';

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

section('1. 槽位 id 唯一且完整');
{
  check('槽位 id 唯一', new Set(SLOTS.map((s) => s.id)).size === SLOTS.length);
  check('每个槽位都有生成器（缺文件时能回退）', SLOTS.every((s) => !!s.generator));
  check('每个槽位都有尺寸与锚点', SLOTS.every((s) => s.w > 0 && s.h > 0 && Array.isArray(s.anchor) && s.anchor.length === 2));
  check('anchor 在 [0,1] 内', SLOTS.every((s) => s.anchor.every((v) => v >= 0 && v <= 1)));
}

section('2. 内容 id → 槽位 id 的映射必须存在');
{
  const missingWeapons = BATCH1_WEAPONS.filter((w) => !slotById('icon_' + w.id)).map((w) => w.id);
  check('9 把武器都有图标槽位 icon_<武器id>', missingWeapons.length === 0, missingWeapons.join(','));
  const missingProj = BATCH1_WEAPONS.filter((w) => !slotById('proj_' + w.id.replace('w_', ''))).map((w) => w.id);
  check('9 把武器都有投射物槽位 proj_<无前缀id>', missingProj.length === 0, missingProj.join(','));
  check('被动图标槽位存在', !!slotById('icon_passive'));
  check('超武图标槽位存在（融合后的素体挂件要用）', !!slotById('icon_super'));
  check('掉落物图标槽位存在', !!slotById('icon_drop'));
  const missingChars = CHARACTERS.map((c) => 'char_' + c.id).filter((id) => !slotById(id));
  check('6 个角色都有角色槽位 char_<角色id>（后三系为批 2~4 预留）', missingChars.length === 0, missingChars.join(','));
  // 未解锁系（批 2~4）的占位武器也必须有图标槽位，否则解锁后会每帧回退
  const futureWeapons = ['w_tian_1', 'w_ling_1', 'w_kun_1'].filter((id) => !slotById('icon_' + id));
  check('批 2~4 的占位武器也有图标槽位', futureWeapons.length === 0, futureWeapons.join(','));
  const missingEnemies = Object.keys(ENEMIES).map((k) => 'enemy_' + k).filter((id) => !slotById(id));
  check('5 种敌人都有敌人槽位 enemy_<种类id>', missingEnemies.length === 0, missingEnemies.join(','));
  check('Boss 槽位存在', !!slotById('boss_xiangliu'));
  check('竞技场地板与障碍槽位存在', !!slotById('arena_floor') && !!slotById('arena_obstacle'));
  check('UI 槽位存在（面板/摇杆/两个按钮/卡）', ['ui_panel', 'ui_joystick', 'ui_button_dash', 'ui_button_active', 'ui_card'].every((id) => slotById(id)));
  check('特效槽位存在（命中/爆炸/升级/拾取）', ['fx_hit', 'fx_explode', 'fx_levelup', 'fx_pickup'].every((id) => slotById(id)));
  // 9 条配方的超武都复用 icon_super，检查名字可解析
  check('9 条配方都有超武名与效果', FUSIONS.every((f) => f.cn && f.effect));
}

section('3. 代码里引用的槽位命名必须真实存在');
{
  // 逐条规则：把代码里的拼接表达式还原成实际 id，再检查清单里有没有
  const rules = [
    { file: 'src/render/render2d.js', id: 'char_' + '${world.characterId}', slot: (v) => 'char_' + v, values: CHARACTERS.map((c) => c.id) },
    { file: 'src/render/render2d.js', id: "'enemy_' + e.kind", slot: (v) => 'enemy_' + v, values: Object.keys(ENEMIES) },
    { file: 'src/render/render2d.js', id: 'icon_' + '${t.id}', slot: (v) => 'icon_' + v, values: BATCH1_WEAPONS.map((w) => w.id) },
    { file: 'src/render/render2d.js', id: 'proj_' + "wpn.id.replace('w_','')", slot: (v) => 'proj_' + v.replace('w_', ''), values: BATCH1_WEAPONS.map((w) => w.id) },
    { file: 'src/render/render2d.js', id: 'icon_w_' + 'w.id', slot: (v) => 'icon_w_' + v, values: BATCH1_WEAPONS.map((w) => w.id) },
    { file: 'src/ui/ui.js', id: 'icon_w_' + 'w.id', slot: (v) => 'icon_w_' + v, values: BATCH1_WEAPONS.map((w) => w.id) },
  ];
  const problems = [];
  for (const r of rules) {
    const src = readFileSync(r.file, 'utf8');
    const marker = r.id.split(' + ')[0].replace(/['"]/g, '');
    // 只在该文件确实用了这个前缀时才检查
    const usesIt = r.id.includes('+') ? src.includes(r.id.split(' + ').map((p) => p.replace(/['"]/g, '')).join(' + ')) || src.includes(r.id) : src.includes(r.id);
    if (!usesIt) continue;
    for (const v of r.values) {
      if (!slotById(r.slot(v))) problems.push(`${r.file} 的 ${r.id} 映射到 ${r.slot(v)}，清单里没有`);
    }
  }
  check('代码里所有槽位拼接都能解析到真实槽位', problems.length === 0, problems.slice(0, 6).join('; '));
}

section('4. 生成器名必须在 generator.js 里实现');
{
  const gen = readFileSync('src/assets/generator.js', 'utf8');
  const missing = [...new Set(SLOTS.map((s) => s.generator))].filter((g) => !gen.includes(g + '(') && !gen.includes(g + ':'));
  check('清单里用到的生成器都已实现', missing.length === 0, missing.join(','));
}

console.log(`\n================ 槽位一致性 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
