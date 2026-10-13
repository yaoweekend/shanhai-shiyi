// 列出所有武器的系与解锁层次（调参/核对用）。
import { WEAPONS } from '../src/content/weapons.js';
import { FUSIONS, ULTIMATE_FUSIONS, ACTIVE_SKILLS, ACTIVE_SKILL_TYPES } from '../src/content/fusions.js';
import { PASSIVES } from '../src/content/passives.js';

const series = ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'];
for (const sid of series) {
  const ws = WEAPONS.filter((w) => w.series === sid);
  console.log(`${sid} 系（${ws.length} 把）：`);
  for (const w of ws) {
    const f = FUSIONS.find((x) => x.weapon === w.id);
    console.log(`  ${w.id.padEnd(16)} ${w.cn.padEnd(6)} ${String(w.kind).padEnd(10)} ${String(w.unlock).padEnd(8)} 配方→ ${f ? f.cn : '（无）'}`);
  }
  const ps = PASSIVES.filter((p) => p.series === sid);
  const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
  const sk = ACTIVE_SKILLS.find((x) => x.series === sid);
  console.log(`  被动：${ps.map((p) => p.cn + '(' + p.channel + ')').join('、')}`);
  console.log(`  合体终极：${u ? u.cn + ' — ' + u.passives.map((id) => PASSIVES.find((p) => p.id === id).cn).join('+') : '（无）'}`);
  console.log(`  主动技：${sk ? sk.cn + '（' + ACTIVE_SKILL_TYPES[sk.type] + '）— ' + sk.effect : '（无）'}`);
}
console.log(`\n合计：武器 ${WEAPONS.length}，被动 ${PASSIVES.length}，血统配方 ${FUSIONS.length}，合体终极 ${ULTIMATE_FUSIONS.length}，主动技 ${ACTIVE_SKILLS.length}`);
