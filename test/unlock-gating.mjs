// 核对：未解锁的系，它的**武器和被动**都绝不能出现在升级卡池里。
//
// 这个套件存在的理由（真实事故）：第一版只给武器加了系别门禁，漏了被动，
// 结果干净存档下能抽到「夸父踵(天问)」「不死药(昆仑)」「十巫幡(灵山)」。
// 所以现在武器和被动两条线都要单独断言。
import { World } from '../src/sim/world.js';
import { WEAPONS } from '../src/content/weapons.js';
import { PASSIVES, PASSIVE_BY_ID } from '../src/content/passives.js';

const SERIES = ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'];

function poolFor(unlocks, rolls = 400, series = ['shan', 'hai', 'huang']) {
  const w = new World({ seed: 1, characterId: 'shanpo', unlocks, unlockedSeries: series });
  const weapons = new Set();
  const passives = new Set();
  for (let i = 0; i < rolls; i++) {
    for (const c of w.rollCards()) {
      if (c.weaponId) weapons.add(c.weaponId);
      if (c.passiveId) passives.add(c.passiveId);
    }
  }
  return { weapons, passives };
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

const lockedSeriesNames = { tian: '天问', ling: '灵山', kun: '昆仑' };

console.log('=== 玩家只有开局三系（unlocks: []，unlockedSeries: 山海大荒） ===');
const base = poolFor([]);
console.log('  武器池：' + [...base.weapons].sort().join(', '));
console.log('  被动池：' + [...base.passives].sort().join(', '));
for (const sid of ['tian', 'ling', 'kun']) {
  const ws = WEAPONS.filter((w) => w.series === sid).map((w) => w.id);
  const ps = PASSIVES.filter((p) => p.series === sid).map((p) => p.id);
  const leakW = ws.filter((id) => base.weapons.has(id));
  const leakP = ps.filter((id) => base.passives.has(id));
  check(`${lockedSeriesNames[sid]}系的武器一把都不在池里`, leakW.length === 0, leakW.join(','));
  check(`${lockedSeriesNames[sid]}系的被动一件都不在池里`, leakP.length === 0, leakP.join(','));
}
check('开局三系的被动仍在池里（保证能构筑）', ['xuangui', 'jiuweiyi', 'zhulongtong'].some((id) => base.passives.has(id)), [...base.passives].join(','));
check('全部内容里没有任何未解锁系的 id 混入', [...base.weapons, ...base.passives].every((id) => {
  const def = WEAPONS.find((w) => w.id === id) || PASSIVE_BY_ID[id];
  return def && ['shan', 'hai', 'huang'].includes(def.series);
}), [...base.weapons, ...base.passives].filter((id) => {
  const def = WEAPONS.find((w) => w.id === id) || PASSIVE_BY_ID[id];
  return !def || !['shan', 'hai', 'huang'].includes(def.series);
}).join(','));

console.log('=== 解锁天问系后 ===');
const tian = poolFor(['w_riyue', 'w_tianji'], 600, ['shan', 'hai', 'huang', 'tian']);
console.log('  武器池：' + [...tian.weapons].sort().join(', '));
console.log('  被动池：' + [...tian.passives].sort().join(', '));
check('天问系武器进入池', tian.weapons.has('w_riyue') && tian.weapons.has('w_tianji'));
check('天问系被动也进入池', PASSIVES.filter((p) => p.series === 'tian').some((p) => tian.passives.has(p.id)), [...tian.passives].join(','));
const lingKun = [...PASSIVES.filter((p) => p.series === 'ling' || p.series === 'kun').map((p) => p.id), 'w_shigu', 'w_shiwu', 'w_lingwu', 'w_kunlun_2', 'w_kunlun_3'];
check('灵山/昆仑的武器与被动仍不在池里', lingKun.every((id) => !tian.weapons.has(id) && !tian.passives.has(id)), lingKun.filter((id) => tian.weapons.has(id) || tian.passives.has(id)).join(','));

console.log('=== 只解锁了试炼武器（系仍锁着）===');
const trial = poolFor(['w_shanbeng'], 600);
check('解锁的试炼武器进入池', trial.weapons.has('w_shanbeng'), [...trial.weapons].join(','));
check('未解锁的其它试炼武器不在池里', !trial.weapons.has('w_haimao') && !trial.weapons.has('w_dahuangfeng'));
check('锁着的系一件东西都没漏', [...trial.weapons, ...trial.passives].every((id) => {
  const def = WEAPONS.find((w) => w.id === id) || PASSIVE_BY_ID[id];
  return def && ['shan', 'hai', 'huang'].includes(def.series);
}));

console.log('=== 六个系全解锁后，所有内容都应该能出现 ===');
const all = poolFor(
  WEAPONS.filter((w) => !w.locked && w.unlock !== 'initial').map((w) => w.id),
  1500,
  SERIES,
);
// 四合一终极武器（locked: true）不通过卡池获得，因此"应出现"的只算普通武器
const allWeapons = WEAPONS.filter((w) => !w.locked && (w.unlock !== 'trial' || all.weapons.has(w.id)));
check('六系全解锁时武器池覆盖六个系', SERIES.every((sid) => WEAPONS.filter((w) => w.series === sid && !w.locked && w.unlock !== 'trial').every((w) => all.weapons.has(w.id))), SERIES.filter((sid) => !WEAPONS.filter((w) => w.series === sid && !w.locked && w.unlock !== 'trial').every((w) => all.weapons.has(w.id))).join(','));
check('六系全解锁时被动池覆盖六个系', SERIES.every((sid) => PASSIVES.filter((p) => p.series === sid).some((p) => all.passives.has(p.id))), SERIES.filter((sid) => !PASSIVES.filter((p) => p.series === sid).some((p) => all.passives.has(p.id))).join(','));
check('四合一终极武器绝不进入卡池', !WEAPONS.filter((w) => w.locked).some((w) => all.weapons.has(w.id)), WEAPONS.filter((w) => w.locked && all.weapons.has(w.id)).map((w) => w.id).join(','));

console.log(`\n================ 卡池解锁 ${pass} 通过 / ${fail} 失败 ================`);
process.exit(fail === 0 ? 0 : 1);
