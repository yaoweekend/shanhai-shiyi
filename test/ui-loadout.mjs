// 验证"暂停界面显示已获得道具"与"升级卡高亮可合成"。
// 用 stub DOM + 真实 UI 类跑一遍，断言渲染出的 HTML 里内容正确。
// 用法：node test/ui-loadout.mjs
import { World } from '../src/sim/world.js';
import { FUSIONS } from '../src/content/fusions.js';
import { WEAPON_BY_ID } from '../src/content/weapons.js';
import { PASSIVE_BY_ID } from '../src/content/passives.js';
import { WEAPON_MAX_LEVEL, SLOT_WEAPONS, SLOT_PASSIVES } from '../src/config.js';

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

// ---- 极简 DOM stub：只支持 getElementById / createElement / innerHTML / classList ----
function makeEl(id = '') {
  const el = {
    id,
    tagName: 'DIV',
    className: '',
    _html: '',
    hidden: false,
    style: { setProperty() {}, cssText: '' },
    children: [],
    dataset: {},
    classList: {
      _s: new Set(),
      add(c) {
        this._s.add(c);
      },
      remove(c) {
        this._s.delete(c);
      },
      contains(c) {
        return this._s.has(c);
      },
    },
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = String(v);
      this.children = [];
    },
    set textContent(v) {
      this._html = String(v);
    },
    get textContent() {
      return this._html;
    },
    appendChild(c) {
      this.children.push(c);
      this._html += c._html || '';
      return c;
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return null;
    },
    toDataURL() {
      return 'data:image/png;base64,AA==';
    },
  };
  return el;
}

const els = new Map();
function installDom() {
  const doc = {
    createElement: (tag) => {
      const el = makeEl();
      el.tagName = String(tag).toUpperCase();
      return el;
    },
    getElementById: (id) => {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    querySelectorAll: () => [],
    addEventListener() {},
  };
  globalThis.document = doc;
  globalThis.window = { devicePixelRatio: 1, innerWidth: 960, innerHeight: 540, addEventListener() {}, AudioContext: null };
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  globalThis.confirm = () => false;
}
installDom();

// ui.js 在模块顶层会 import generator.js（需要 canvas），用一个空壳顶住
const { UI } = await import('../src/ui/ui.js');

const ctl = {
  getSave: () => ({
    unlocks: { series: ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'], characters: ['shanpo'], weapons: [] },
    counters: { killsTotal: 0, winsTotal: 0, winsBySeries: {} },
    trials: {},
    settings: { muted: false, volume: 0.7, quality: 'auto', effects: true, shake: true, damageNumbers: true, devLabels: false },
    highScore: { kills: 0, timeMs: 0, level: 0, won: false },
    codex: {},
  }),
  getSettings: () => ({ muted: false, volume: 0.7, quality: 'auto', effects: true, shake: true, damageNumbers: true, devLabels: false }),
  world: () => null,
  audio: { play() {}, setMuted() {}, volume: 1, muted: false },
  hasUnfinished: () => false,
  startRun() {},
  takeCard() {},
  pause() {},
  resume() {},
  saveAndQuit() {
    return true;
  },
  quitRun() {},
  restart() {},
  toMenu() {},
  wipe() {},
  setUnlockAll() {},
  setSettings() {},
  resumeRun() {},
  openEndless() {},
  continueEndless() {},
};

const ui = new UI(ctl);

section('1. 暂停界面必须列出本局已获得的武器与被动');
{
  const w = new World({ seed: 20260926, characterId: 'shanpo' });
  w.slots.weapons = [
    { id: 'w_shoujia', level: 5, cd: 0, superId: 'f1' },
    { id: 'w_guhai', level: 3, cd: 0, superId: null },
    { id: 'w_linyu', level: 2, cd: 0, superId: null },
  ];
  w.slots.passives = ['dangkangya', 'jiuweiyi', 'zhulongtong'];
  w.recompute();

  ui.renderPause(w);
  const html = document.getElementById('pause-loadout').innerHTML;

  // 三把武器都要出现（超武显示超武名，未超武显示武器名）
  check('列出全部已获得武器（含超武）', html.includes('狂兽环') && html.includes('骨骸回旋') && html.includes('鳞雨散射'), html.slice(0, 200).replace(/\s+/g, ' '));
  check('武器带等级', html.includes('Lv3') && html.includes('Lv2'), '');
  check('列出全部已获得被动', html.includes('当康牙') && html.includes('九尾尾') && html.includes('烛龙瞳'), '');
  check('显示槽位占用（武器 x/4、被动 y/5）', html.includes(`1 / ${SLOT_WEAPONS}`) === false && html.includes(`${w.slots.weapons.length} / ${SLOT_WEAPONS}`), '');
  check('被动槽计数正确', html.includes(`${w.slots.passives.length} / ${SLOT_PASSIVES}`), '');
  check('有血统配方区块', html.includes('血统配方'), '');
  check('已觉醒的配方标注"已觉醒"', html.includes('已觉醒'), '');
  check('空槽也画出来（看得见还剩几个位置）', html.includes('loadout-slot-empty'), '');
  console.log(`  武器显示：${w.slots.weapons.map((x) => x.id).join(', ')}`);
}

section('2. 暂停界面要能显示"离合成还差什么"');
{
  const w = new World({ seed: 1, characterId: 'shanpo' });
  // 武器已满级但被动还没拿 → 应该提示"条件已满足（即将觉醒）"或列出缺口
  w.slots.weapons = [{ id: 'w_shoujia', level: WEAPON_MAX_LEVEL, cd: 0, superId: null }];
  w.slots.passives = [];
  w.recompute();
  ui.renderPause(w);
  const html = document.getElementById('pause-loadout').innerHTML;
  check('满级武器 + 缺被动时列出配方缺口', html.includes('当康牙') && html.includes(`${WEAPON_MAX_LEVEL}/${WEAPON_MAX_LEVEL}`), html.replace(/\s+/g, ' ').slice(0, 260));
  check('缺口提示不是"已觉醒"', !html.includes('已觉醒'), '');
}

section('3. 升级卡：能直接凑成血统的必须高亮');
{
  const w = new World({ seed: 2, characterId: 'shanpo' });
  const f = FUSIONS[0]; // 兽甲旋刃 + 当康牙 → 狂兽环
  w.slots.weapons = [{ id: f.weapon, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }];
  w.slots.passives = [];
  w.recompute();

  // ① 被动卡正是配方所需 → 必须是 now
  const passiveCard = { type: 'passive', passiveId: f.passive };
  const o1 = ui.fuseOutlook(w, passiveCard);
  check(`被动卡（${PASSIVE_BY_ID[f.passive].cn}）识别为"直接合成"`, o1 && o1.kind === 'now' && o1.names.includes(f.cn), JSON.stringify(o1));

  // ② 无关被动 → 不应高亮
  const other = { type: 'passive', passiveId: 'jiaorenyan' };
  const o2 = ui.fuseOutlook(w, other);
  check('无关被动卡不高亮为"直接合成"', !o2 || o2.kind !== 'now', JSON.stringify(o2));

  // ③ 武器升级卡刚好到满级、且被动已有 → now
  const w2 = new World({ seed: 3, characterId: 'shanpo' });
  w2.slots.weapons = [{ id: f.weapon, level: WEAPON_MAX_LEVEL - 1, cd: 0, superId: null }];
  w2.slots.passives = [f.passive];
  w2.recompute();
  const upCard = { type: 'weapon-up', weaponId: f.weapon, level: WEAPON_MAX_LEVEL };
  const o3 = ui.fuseOutlook(w2, upCard);
  check('升级到满级且被动已有时识别为"直接合成"', o3 && o3.kind === 'now' && o3.names.includes(f.cn), JSON.stringify(o3));

  // ④ 武器升级卡到满级但被动还没拿 → missing（提示"更近一步"）
  const w3 = new World({ seed: 4, characterId: 'shanpo' });
  w3.slots.weapons = [{ id: f.weapon, level: WEAPON_MAX_LEVEL - 1, cd: 0, superId: null }];
  w3.slots.passives = [];
  w3.recompute();
  const o4 = ui.fuseOutlook(w3, upCard);
  check('满级但缺被动时标记为"更近一步"', o4 && o4.kind === 'missing', JSON.stringify(o4));

  // ⑤ 已超武的武器不再提示合成
  const w4 = new World({ seed: 5, characterId: 'shanpo' });
  w4.slots.weapons = [{ id: f.weapon, level: WEAPON_MAX_LEVEL, cd: 0, superId: f.id }];
  w4.slots.passives = [f.passive];
  w4.recompute();
  const o5 = ui.fuseOutlook(w4, passiveCard);
  check('已觉醒的武器不再重复提示合成', !o5 || o5.kind !== 'now', JSON.stringify(o5));

  // ⑥ 卡片 DOM 里真的带上了高亮 class 与徽标
  // 术语：这里产出的是**血统**（武器满级 + 被动 → 超武），文案用"觉醒"，
  // 不再用"合成"（"融合"更是废弃词，见 test/batch1-rework.mjs 第 9 节）。
  const cardEl = ui.cardEl(passiveCard, 0, w);
  check('可觉醒的卡片带 can-fuse 高亮类', cardEl.classList.contains('can-fuse'), cardEl.className);
  check('卡片上有觉醒徽标文案', cardEl.innerHTML.includes('立刻觉醒') && cardEl.innerHTML.includes(f.cn), cardEl.innerHTML.replace(/\s+/g, ' ').slice(0, 160));
  const plainEl = ui.cardEl(other, 1, w);
  check('无关卡片没有高亮类', !plainEl.classList.contains('can-fuse'), plainEl.className);

  // ⑦ 新增的被动升级卡 / 数值兜底卡也必须能渲染（曾经只处理三种卡型）
  const upPid = w.slots.passives[0] || 'xuangui';
  const upEl = ui.cardEl({ type: 'passive-up', passiveId: upPid, level: 2 }, 0, w);
  check('被动升级卡显示等级与该通道的真实变化', /Lv2 \/ 2/.test(upEl.innerHTML) && !upEl.innerHTML.includes('数值不变'), JSON.stringify(upEl.innerHTML.slice(0, 300)));
  const statEl = ui.cardEl({ type: 'stat', statId: 'dmg', channel: 'damage', value: 0.06, cn: '伤害' }, 1, w);
  check('数值兜底卡是数值强化而非占位卡', statEl.innerHTML.includes('通用强化') && !statEl.innerHTML.includes('无可用提升'), statEl.innerHTML.replace(/\s+/g, ' ').slice(0, 200));
}

section('4. 每个系都要有"可被高亮"的配方（内容完整性）');
{
  const bySeries = {};
  for (const f of FUSIONS) bySeries[f.series] = (bySeries[f.series] || 0) + 1;
  console.log('  各系配方数：', Object.entries(bySeries).map(([k, v]) => `${k}=${v}`).join(' '));
  for (const s of ['shan', 'hai', 'huang', 'tian', 'ling', 'kun']) {
    check(`${s} 系有血统配方`, (bySeries[s] || 0) > 0, String(bySeries[s] || 0));
  }
  // 每把武器都要能被某条配方的"武器升级卡"路径高亮到
  const w = new World({ seed: 6, characterId: 'shanpo' });
  const noOutlook = [];
  for (const f of FUSIONS) {
    const def = WEAPON_BY_ID[f.weapon];
    if (!def) {
      noOutlook.push(`${f.weapon}(武器不存在)`);
      continue;
    }
    const w2 = new World({ seed: 7, characterId: 'shanpo' });
    w2.slots.weapons = [{ id: f.weapon, level: WEAPON_MAX_LEVEL - 1, cd: 0, superId: null }];
    w2.slots.passives = [f.passive];
    w2.recompute();
    const o = ui.fuseOutlook(w2, { type: 'weapon-up', weaponId: f.weapon, level: WEAPON_MAX_LEVEL });
    if (!o || o.kind !== 'now') noOutlook.push(f.weapon);
  }
  check('每条配方的武器升级路径都能被高亮', noOutlook.length === 0, noOutlook.join(','));
}

console.log(`\n================ UI 自检 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
