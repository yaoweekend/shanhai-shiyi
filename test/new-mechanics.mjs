// 新机制回归：领域(aura)、蓄力穿透(charge)、巫蛊标记(mark)。
// 这三件是新系的核心原型，必须证明"真的造成了伤害/真的生效"。
// 用法：node test/new-mechanics.mjs
import { World } from '../src/sim/world.js';
import { WEAPON_BY_ID } from '../src/content/weapons.js';
import { FUSIONS, ULTIMATE_FUSIONS, ACTIVE_SKILLS } from '../src/content/fusions.js';
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

/** 造一个"只有这把武器、敌人在身边"的场景，跑 n 帧，返回敌人总掉血 */
function damageOf(weaponId, { frames = 180, level = 5, enemyTier = 0, count = 8, radius = 60 } = {}) {
  const w = new World({ seed: 11, characterId: 'shanpo' });
  w.paused = false;
  w.slots.weapons = [{ id: weaponId, level, cd: 0, superId: null }];
  w.slots.passives = [];
  w.recompute();
  w.refreshWeaponEntities();
  w.enemies.clear();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    w.spawnEnemyFrom({ kind: 'shanxiao', tier: enemyTier, x: w.player.x + Math.cos(a) * radius, y: w.player.y + Math.sin(a) * radius });
  }
  const hp0 = w.enemies.active.reduce((s, e) => s + e.hp, 0);
  let kills = 0;
  for (let i = 0; i < frames; i++) {
    w.input.mx = 0;
    w.input.my = 0;
    w.step();
  }
  const hp1 = w.enemies.active.reduce((s, e) => s + e.hp, 0);
  kills = w.runStats.kills;
  return { dealt: Math.max(0, hp0 - hp1) + kills * 30, kills, alive: w.enemies.active.length, world: w };
}

section('1. 领域武器（日月双环 / 开明守御 / 山崩践踏）必须持续造成伤害');
{
  const auras = ['w_riyue', 'w_kunlun_4', 'w_shanbeng'];
  for (const id of auras) {
    const r = damageOf(id, { frames: 240, radius: 50 });
    const def = WEAPON_BY_ID[id];
    console.log(`  ${def.cn.padEnd(5)}(${id.padEnd(13)}) 3 秒内造成伤害 ${r.dealt.toFixed(0)}，击杀 ${r.kills}，剩余敌人 ${r.alive}`);
    check(`${def.cn} 作为领域武器能造成伤害`, r.dealt > 0, `伤害 ${r.dealt}`);
  }
  // 领域应该能打到"贴身一圈"的敌人，而且不需要瞄准
  const r = damageOf('w_riyue', { frames: 120, radius: 70, count: 12 });
  check('领域能同时覆盖多个敌人', r.kills >= 1 || r.dealt > 100, `造成 ${r.dealt.toFixed(0)}`);
}

section('2. 蓄力穿透（天极贯日）必须打出贯穿伤害');
{
  const r = damageOf('w_tianji', { frames: 300, radius: 300, count: 6 });
  const def = WEAPON_BY_ID.w_tianji;
  console.log(`  ${def.cn} 5 秒内造成伤害 ${r.dealt.toFixed(0)}，击杀 ${r.kills}`);
  check('蓄力武器能造成伤害', r.dealt > 0, `伤害 ${r.dealt}`);
  // 贯穿：一条直线上的多个敌人应该都吃到
  const w = new World({ seed: 12, characterId: 'shanpo' });
  w.paused = false;
  w.slots.weapons = [{ id: 'w_tianji', level: 5, cd: 0, superId: null }];
  w.slots.passives = [];
  w.recompute();
  w.enemies.clear();
  for (let i = 0; i < 6; i++) w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + 80 + i * 70, y: w.player.y });
  const hp0 = w.enemies.active.map((e) => e.hp);
  for (let i = 0; i < 260; i++) {
    w.input.mx = 0;
    w.input.my = 0;
    w.step();
  }
  const hurtCount = w.enemies.active.filter((e, i) => e.hp < (hp0[i] || 0)).length + w.runStats.kills;
  console.log(`  一条直线上 6 个敌人，被打到的有 ${hurtCount} 个（贯穿应当 > 1）`);
  check('蓄力光束贯穿一线上的多个敌人', hurtCount >= 2, `${hurtCount} 个`);
}

section('3. 巫蛊标记必须真的放大伤害');
{
  // 用 dealDamage 直接结算，才能精确比较"有标记 / 无标记"的差别
  // （用武器打会受命中次数、暴击、轮空等影响，测不出倍率）
  const { dealDamage } = await import('../src/sim/stats.js');
  const measure = (markStacks) => {
    const w = new World({ seed: 13, characterId: 'shanpo' });
    w.paused = false;
    w.enemies.clear();
    const e = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + 40, y: w.player.y });
    e.hp = 1e9;
    e.maxHp = 1e9;
    if (markStacks > 0) {
      e.mark = markStacks;
      e.markUntil = 1e9;
    }
    const before = e.hp;
    // 固定 30 点伤害，关闭暴击波动
    w.stats = { ...w.stats, critChance: 0, curse: 0 };
    dealDamage(w, e, 30, { source: 'test', rollCrit: false });
    return before - e.hp;
  };
  const plain = measure(0);
  const m1 = measure(1);
  const m3 = measure(3);
  console.log(`  30 点基础伤害 → 无标记 ${plain.toFixed(1)}，1 层标记 ${m1.toFixed(1)}，3 层标记 ${m3.toFixed(1)}`);
  check('1 层标记放大伤害（+12%）', m1 > plain * 1.1, `${plain} vs ${m1}`);
  check('3 层标记放大更多（+36%）', m3 > plain * 1.3, `${plain} vs ${m3}`);
  check('标记层数越多伤害越高', m3 > m1 && m1 > plain, `${plain} / ${m1} / ${m3}`);

  // 武器本身要能挂上标记
  const w = new World({ seed: 14, characterId: 'shanpo' });
  w.paused = false;
  w.slots.weapons = [{ id: 'w_wugu', level: 5, cd: 0, superId: null }];
  w.slots.passives = [];
  w.recompute();
  w.enemies.clear();
  const t = w.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: w.player.x + 45, y: w.player.y });
  t.hp = 1e9;
  for (let i = 0; i < 120; i++) {
    w.input.mx = 0;
    w.input.my = 0;
    w.step();
  }
  console.log(`  巫蛊引命中后敌人标记层数 = ${t.mark || 0}`);
  check('武器命中会给敌人挂上标记', (t.mark || 0) > 0, String(t.mark || 0));
}

section('4. 合体终极与主动技（改判后：合体必须要求该系主动技已解锁）');
{
  let ok = 0;
  const { WEAPONS } = await import('../src/content/weapons.js');
  const setup = (u, { superCount = 3 } = {}) => {
    const w = new World({ seed: 15, characterId: 'shanpo' });
    const mine = WEAPONS.filter((x) => x.series === u.series && !x.locked).slice(0, 4);
    w.slots.weapons = mine.map((x, i) => ({
      id: x.id,
      level: WEAPON_MAX_LEVEL,
      cd: 0,
      // 前 superCount 把成为超武 —— 三把同系超武才解锁该系主动技
      superId: i < superCount ? (FUSIONS.find((f) => f.weapon === x.id) || {}).id || null : null,
    }));
    w.slots.passives = u.passives.slice();
    w.recompute();
    w.checkActiveSkillUnlock();
    w.checkUltimateFusion();
    return w;
  };
  for (const u of ULTIMATE_FUSIONS) {
    const w = setup(u);
    const fused = w.fusedWeapon;
    const oneSlot = w.slots.weapons.length === 1;
    const weaponId = w.slots.weapons[0] && w.slots.weapons[0].id;
    if (fused === u.id && oneSlot && weaponId === u.weaponId) ok++;
    else console.log(`  ✗ ${u.cn}: fused=${fused} slots=${w.slots.weapons.length} weapon=${weaponId}`);
  }
  check('6 条合体都能触发，且合体后占满 4 槽（数组里只剩 1 把）', ok === ULTIMATE_FUSIONS.length, `${ok}/${ULTIMATE_FUSIONS.length}`);

  // 硬前置：4 把满级 + 4 件被动，但**主动技没解锁**（没有 3 把超武）→ 不得合体
  const uShan = ULTIMATE_FUSIONS.find((u) => u.series === 'shan');
  const noSkill = setup(uShan, { superCount: 0 });
  check('缺「该系主动技已解锁」时不得合体', noSkill.fusedWeapon === null, String(noSkill.fusedWeapon));

  // 先解锁技能 → 再合体 → 技能仍可用（跨合体持久化）
  const w5 = setup(uShan);
  const skillBefore = w5.activeSkillUnlocked;
  w5.activeSkillCd = 0;
  const firedAfterFuse = w5.triggerActiveSkill();
  check('合体后主动技仍然解锁', !!skillBefore && w5.activeSkillUnlocked === skillBefore, String(w5.activeSkillUnlocked));
  check('合体后主动技仍然可以触发', firedAfterFuse === true || w5.activeSkillCd > 0, `fired=${firedAfterFuse} cd=${w5.activeSkillCd}`);
  check('主动技进入冷却', w5.activeSkillCd > 0, String(w5.activeSkillCd));
  check('主动技冷却期间不能再次触发', w5.triggerActiveSkill() === false, '');
  // 每系都有主动技，且六个类型两两不同
  check('6 系各有主动技', ACTIVE_SKILLS.length === 6 && new Set(ACTIVE_SKILLS.map((s) => s.series)).size === 6, String(ACTIVE_SKILLS.length));
  check('六个主动技的类型两两不同', new Set(ACTIVE_SKILLS.map((s) => s.type)).size === 6, ACTIVE_SKILLS.map((s) => s.type).join(','));
}

section('5. 六系内容在真实对局里都能跑（每系角色各开一局）');
{
  const { CHARACTERS } = await import('../src/content/characters.js');
  const { kitingPolicy } = await import('./kite.mjs');
  const { autoTakeCards } = await import('./policy.mjs');
  const rows = [];
  for (const ch of CHARACTERS) {
    try {
      const w = new World({ seed: 20260926, characterId: ch.id, unlocks: ['w_lizhao', 'w_jingxi', 'w_zhaoyin', 'w_tianji', 'w_lingwu', 'w_kunlun_4', 'w_shanbeng', 'w_haimao', 'w_dahuangfeng'] });
      w.paused = false;
      for (let i = 0; i < 60 * 200 && w.running; i++) {
        kitingPolicy(w);
        w.step();
        if (w.awaitingChoice) autoTakeCards(w);
      }
      rows.push({ cn: ch.cn, t: w.elapsedMs / 1000, kills: w.runStats.kills, lv: w.player.level, w: w.slots.weapons.map((x) => x.id).join('/'), ok: true });
    } catch (e) {
      rows.push({ cn: ch.cn, ok: false, err: e.message });
    }
  }
  for (const r of rows) {
    if (r.ok) console.log(`  ${r.cn.padEnd(4)} 200 秒：等级 ${r.lv}，击杀 ${r.kills}，武器 ${r.w}`);
    else console.log(`  ${r.cn} 失败：${r.err}`);
  }
  check('6 个角色都能跑完 200 秒且不抛异常', rows.every((r) => r.ok), rows.filter((r) => !r.ok).map((r) => `${r.cn}:${r.err}`).join('; '));
  check('每系角色都至少击杀 50 只', rows.every((r) => r.ok && r.kills >= 50), JSON.stringify(rows.map((r) => `${r.cn}:${r.kills}`)));
  check('槽位上限仍是 4 武器 / 5 被动', SLOT_WEAPONS === 4 && SLOT_PASSIVES === 5);
}

console.log(`\n================ 新机制回归 ${pass} 通过 / ${fail} 失败 ================`);
if (bad.length) {
  console.log('失败项：');
  for (const b of bad) console.log('  - ' + b);
}
process.exit(fail === 0 ? 0 : 1);
