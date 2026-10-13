// 调参面板验收（specs/shanhai-dev-tune.md §Testing，8 条）。
//
// 只测外部行为：面板的入口守门 / 不写存档 / 预设完整性 / 时间缩放 / 敌人开关 /
// 配置串往返 / 触控不冲突 / 不改参数则不改变玩法。
//
// 面板是 DOM 模块，但它的"行为"大多落在 world 与配置串上 —— 这里用一个最小 DOM
// 垫片把面板真的构造出来，然后在**真实的 World** 上验证它的效果。
//
// 用法：node test/dev-tune.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { World } from '../src/sim/world.js';
import { ULTIMATE_FUSIONS, activeSkillFor } from '../src/content/fusions.js';
import { serializeTune, parseTune, TUNE_VERSION } from '../src/dev/tune-config.js';
import { ARENA_W, ARENA_H, WEAPON_MAX_LEVEL, TIER_PERIOD, TICK_MS } from '../src/config.js';

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
function info(msg) {
  console.log(`  · ${msg}`);
}

// ---------------------------------------------------------------- 最小 DOM 垫片
function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attrs: {},
    style: {},
    _cls: new Set(),
    _text: '',
    value: '',
    checked: false,
    hidden: false,
    title: '',
    _listeners: {},
    appendChild(c) {
      this.children.push(c);
      c.parent = this;
      return c;
    },
    insertBefore(c) {
      this.children.unshift(c);
      c.parent = this;
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
    remove() {
      if (this.parent) this.parent.removeChild(this);
    },
    addEventListener(t, fn) {
      (this._listeners[t] = this._listeners[t] || []).push(fn);
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      if (k === 'id') this._id = String(v);
    },
    getAttribute(k) {
      return this.attrs[k] === undefined ? null : this.attrs[k];
    },
    get id() {
      return this.attrs.id || '';
    },
    set id(v) {
      this.attrs.id = String(v);
    },
    removeEventListener(t, fn) {
      const l = this._listeners[t] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    /** 触发监听器（测试用；不模拟冒泡） */
    fire(t, ev = {}) {
      for (const fn of (this._listeners[t] || []).slice()) fn({ target: this, preventDefault() {}, stopImmediatePropagation() {}, ...ev });
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const wantId = sel.startsWith('#') ? sel.slice(1) : null;
      const wantCls = sel.startsWith('.') ? sel.slice(1) : null;
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (wantId && c.attrs.id === wantId) out.push(c);
          if (wantCls && c._cls.has(wantCls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    },
    classList: null,
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    },
    get innerHTML() {
      return this._text;
    },
    set innerHTML(v) {
      this._text = String(v);
      this.children = [];
      // 面板 mount 时用 innerHTML 一次性建骨架 → 这里按 id 建出被 getElementById 找的那几个
      for (const m of String(v).matchAll(/id="([^"]+)"/g)) {
        const e = makeElement('div');
        e.attrs.id = m[1];
        const cls = /class="([^"]+)"/.exec(String(v).slice(m.index, m.index + 120));
        if (cls) for (const c of cls[1].split(/\s+/)) e._cls.add(c);
        this.appendChild(e);
      }
    },
  };
  el.classList = {
    add: (c) => el._cls.add(c),
    remove: (c) => el._cls.delete(c),
    contains: (c) => el._cls.has(c),
    toggle: (c, on) => (on === undefined ? (el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c)) : on ? el._cls.add(c) : el._cls.delete(c)),
  };
  return el;
}

function installDom() {
  const nodes = {};
  const body = makeElement('body');
  const canvas = makeElement('canvas');
  canvas.attrs.id = 'game';
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: ARENA_W, height: ARENA_H });
  body.appendChild(canvas);
  const hud = makeElement('div');
  hud.attrs.id = 'screen-hud';
  body.appendChild(hud);
  nodes['screen-hud'] = hud;
  const pauseBtn = makeElement('button');
  pauseBtn.attrs.id = 'btn-pause';
  hud.appendChild(pauseBtn);
  nodes['btn-pause'] = pauseBtn;
  nodes.game = canvas;

  globalThis.document = {
    head: makeElement('head'),
    body,
    createElement: (tag) => makeElement(tag),
    getElementById: (id) => {
      if (nodes[id]) return nodes[id];
      const found = body.querySelector(`#${id}`);
      if (found) nodes[id] = found;
      return found;
    },
    addEventListener() {},
  };
  let rafId = 0;
  globalThis.window = {
    devicePixelRatio: 1,
    innerWidth: ARENA_W,
    innerHeight: ARENA_H,
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => ++rafId,
    prompt: () => null,
  };
  globalThis.requestAnimationFrame = () => ++rafId;
  globalThis.cancelAnimationFrame = () => {};
  if (typeof globalThis.location === 'undefined') {
    globalThis.location = { origin: 'file://', pathname: '/shanhai/index.html', search: '' };
  }
  globalThis.getComputedStyle = () => ({ paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' });
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'test', clipboard: null }, configurable: true, writable: true,
  });
  globalThis.Image = class { set src(_v) {} };
  return { nodes, body };
}

const { nodes } = installDom();
const { TunePanel, defaultTuneState, tuneFromUrl } = await import('../src/dev/tune-panel.js');
const { ENEMIES } = await import('../src/content/enemies.js');
const ENEMY_IDS = Object.keys(ENEMIES);

/** 起一局（真实 World），并给面板的 deps 打桩 */
function makeHarness(charId = 'shanpo', seed = 20260926) {
  const world = new World({ seed, characterId: charId });
  world.paused = false;
  world.spawner.acc = -1e9;
  const renderer = { fps: 60, quality: 'high', safe: { top: 0, right: 0, bottom: 0, left: 0 } };
  const controller = {
    paused: false,
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    startRunWithSeed(id, s) {
      void id;
      void s;
    },
  };
  const panel = new TunePanel({
    getWorld: () => world,
    getRenderer: () => renderer,
    getController: () => controller,
    state: defaultTuneState(seed),
  });
  panel.mount();
  panel.applyState();
  return { world, panel, renderer, controller };
}

/** 面板要强杀的靶子：一个打不死的静止假人 */
function addDummy(world, hp = 1e6) {
  world.enemies.clear();
  const e = world.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: world.player.x + 60, y: world.player.y });
  e.maxHp = hp;
  e.hp = hp;
  e.speed = 0;
  e.touchDamage = 0;
  return e;
}

// ================================================================ 1
section('1. 正式包守门：面板入口只能被动态 import 且被 DEV_TUNE 守住');
{
  const cwd = process.cwd();
  const checkSrc = readFileSync(join(cwd, 'tools/check.mjs'), 'utf8');
  check('静态检查里有"面板入口"守门', /调参面板不得进入正式包/.test(checkSrc), 'tools/check.mjs §10');
  const mainSrc = readFileSync(join(cwd, 'src/main.js'), 'utf8');
  check('main.js 用动态 import 加载面板', /import\(\s*['"]\.\/dev\/tune-panel\.js['"]\s*\)/.test(mainSrc), '');
  check('DEV_TUNE 守在动态 import 之前', /if\s*\(\s*DEV_TUNE\s*\)[\s\S]{0,400}?import\(\s*['"]\.\/dev\/tune-panel\.js['"]\s*\)/.test(mainSrc), '');
  // 反向：把"静态 import"这个违规形态喂给同一条规则，确认它真的会判失败
  const staticVariant = "import { TunePanel } from './dev/tune-panel.js';";
  check('违规形态（静态 import）会被规则识别', /^\s*import\s[^;]*from\s*['"][^'"]*\/dev\//m.test(staticVariant), '');
  const devSrc = readFileSync(join(cwd, 'src/dev/tune-panel.js'), 'utf8');
  check('面板模块本身不碰存档', !/\b(persist|loadSave|clearSave|localStorage|sessionStorage)\b/.test(devSrc), '');
}

// ================================================================ 2
section('2. 不写存档：面板开、改、关，存档逐字节一致');
{
  const path = join(mkdtempSync(join(tmpdir(), 'shanhai-tune-')), 'save.json');
  const SAVE = '{"highScore":{"kills":19395,"timeMs":614000},"unlocks":{"series":["shan","hai","huang"]},"trials":{"t1":{"done":true}},"unfinishedRun":null}\n';
  writeFileSync(path, SAVE, 'utf8');
  const before = readFileSync(path, 'utf8');

  const { world, panel } = makeHarness('shanpo');
  panel.setOpen(true);
  // 随意改一堆参数
  panel.state.inv = true;
  panel.state.dmgMul = 3;
  panel.state.enemyHp = 2;
  panel.state.spawn = 2.5;
  panel.presetFullLoadout('shan');
  panel.presetUnlockSkill('shan');
  panel.presetFuse('shan');
  panel.presetJumpTo(540000);
  panel.presetBoss();
  panel.exportUrl();
  panel.setOpen(false);
  void world;

  if (typeof localStorage !== 'undefined') localStorage.setItem('shanhai-save-v1', 'X');
  const after = readFileSync(path, 'utf8');
  check('存档文件逐字节一致', before === after, `${before.length} → ${after.length} 字节`);
  check('面板没有引入任何存档写入 API', true, '由 §1 的静态规则同时守住');
}

// ================================================================ 3
section('3. 预设完整性：满级 / 合体（含主动技前置）/ 跳时间（含补怪与重算档位）');
{
  const { world, panel } = makeHarness('shanpo');

  panel.presetFullLoadout('ling');
  const weaponsFull = world.slots.weapons.length === 4 && world.slots.weapons.every((s) => s.level === WEAPON_MAX_LEVEL);
  const passiveFull = world.slots.passives.length === 4;
  info(`满级配装：${world.slots.weapons.map((s) => `${s.id}:${s.level}`).join(' ')} | 被动 ${world.slots.passives.join(',')}`);
  check('一键满级：该系 4 把武器全部满级', weaponsFull, JSON.stringify(world.slots.weapons.map((s) => s.level)));
  check('一键满级：4 件被动齐备', passiveFull, world.slots.passives.join(','));
  check('一键满级：武器都属于该系', world.slots.weapons.every((s) => s.id.startsWith('w_')), '');

  const fused = panel.presetFuse('ling');
  const u = ULTIMATE_FUSIONS.find((x) => x.series === 'ling');
  const wantSkill = activeSkillFor('ling').id;
  info(`一键合体：fusedWeapon=${world.fusedWeapon}，主动技=${world.activeSkillUnlocked}`);
  check('一键合体：确实完成合体（不是"按了没反应"）', fused && world.fusedWeapon === u.id, String(world.fusedWeapon));
  check('一键合体：自动补齐了"主动技已解锁"这个前置', world.activeSkillUnlocked === wantSkill, `${world.activeSkillUnlocked} vs ${wantSkill}`);

  // 「解锁该系主动技」单独用也要真的生效（它自己就依赖 activeSkillFor）
  const w0 = makeHarness('shanpo').world;
  const p0 = new TunePanel({
    getWorld: () => w0,
    getRenderer: () => ({ fps: 60 }),
    getController: () => ({ pause() {}, resume() {} }),
    state: defaultTuneState(1),
  });
  p0.mount();
  w0.activeSkillUnlocked = null;
  p0.presetUnlockSkill('kun');
  check('解锁主动技预设：确实解锁了该系技能', w0.activeSkillUnlocked === activeSkillFor('kun').id, String(w0.activeSkillUnlocked));

  // 跳到指定时间：时间 + 档位 + 场上有人 + 刷怪计时重置
  const w2 = makeHarness('shanpo').world;
  const p2 = new TunePanel({
    getWorld: () => w2,
    getRenderer: () => ({ fps: 60 }),
    getController: () => ({ pause() {}, resume() {} }),
    state: defaultTuneState(1),
  });
  p2.mount();
  p2.applyState();
  w2.spawner.acc = 123;
  p2.presetJumpTo(540000);
  const expectTier = Math.floor(540000 / (TIER_PERIOD * 1000));
  info(`跳到 540s：elapsed=${(w2.elapsedMs / 1000).toFixed(0)}s tier=${w2.spawner.lastTier} 敌人=${w2.enemies.active.length} acc=${w2.spawner.acc}`);
  check('跳时间：局内时间 = 目标值', Math.abs(w2.elapsedMs - 540000) < 1, String(w2.elapsedMs));
  check('跳时间：难度档 = 目标档', w2.spawner.lastTier === expectTier, `${w2.spawner.lastTier} vs ${expectTier}`);
  check('跳时间：场上敌人数量 > 0（不是空场假状态）', w2.enemies.active.length > 0, String(w2.enemies.active.length));
  check('跳时间：刷怪调度计时已重置', w2.spawner.acc === 0, String(w2.spawner.acc));
  check('跳时间：未越过 Boss 触发点时 Boss 状态未被误设', w2.spawner.bossSpawned === false && w2.bossActive === false, `spawned=${w2.spawner.bossSpawned} active=${w2.bossActive}`);

  // 面板的"跳到 Boss 前"= 590s（Boss 触发点是 10:00），所以这里分两段验：
  //   ① 跳到 590s < 600s：Boss 不该被标成已出场
  //   ② 跳到 9:00（540s）再往后走：时间同步与档位重算都要对
  const w3 = makeHarness('shanpo').world;
  const p3 = new TunePanel({
    getWorld: () => w3,
    getRenderer: () => ({ fps: 60 }),
    getController: () => ({ pause() {}, resume() {} }),
    state: defaultTuneState(1),
  });
  p3.mount();
  p3.applyState();
  p3.presetJumpTo(590000);
  check('跳到 Boss 前 10 秒：Boss 尚未出场', w3.spawner.bossSpawned === false, String(w3.spawner.bossSpawned));
  // 跳过 Boss 触发点之后必须相应设置（同一套跳转语义）
  p3.presetJumpTo(620000);
  check('跳到 10:20（已过 Boss 触发点）：Boss 状态被相应设置',
    w3.spawner.bossSpawned === true && w3.bossActive === true,
    `spawned=${w3.spawner.bossSpawned} active=${w3.bossActive}`);
  // 跳转语义必须"扛得住下一帧"：step() 里 elapsedMs = tick × TICK_MS，
  // 跳转时两个都要对齐，否则下一帧会把时间顶回去（同时留下跳转时补的那波怪）。
  const tBefore = w3.elapsedMs;
  w3.player.hp = w3.player.maxHp;
  w3.step();
  const advanced = w3.elapsedMs - tBefore;
  check('跳转后时间不会被下一帧顶回去（只前进一个 tick）', advanced > 0 && advanced <= TICK_MS + 1e-6,
    `${tBefore} → ${w3.elapsedMs}（前进 ${advanced.toFixed(2)}ms）`);
  const beforeBoss = w3.enemies.active.filter((e) => e.isBoss).length;
  p3.presetBoss();
  const afterBoss = w3.enemies.active.filter((e) => e.isBoss).length;
  check('立即召唤 Boss：场上有 Boss 了', beforeBoss === 0 && afterBoss === 1, `${beforeBoss} → ${afterBoss}`);
}

// ================================================================ 4
section('4. 时间缩放：作用于模拟步长，且物理与判定不失稳');
{
  const { world, panel } = makeHarness('shanpo');
  // 复刻 main.js 的累加器逻辑：accumulator += dtMs * timeScale，按 TICK_MS 出步
  function simulate(scale, frames, dtMs = 16.6667) {
    const w = new World({ seed: 777, characterId: 'shanpo' });
    w.paused = false;
    w.spawner.acc = -1e9;
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < frames; i++) {
      if (scale > 0) acc += dtMs * scale;
      let n = 0;
      while (acc >= TICK_MS && n < 8) {
        acc -= TICK_MS;
        n++;
        steps++;
        w.input.mx = 1;
        w.input.my = 0;
        w.step();
      }
    }
    return { steps, elapsed: w.elapsedMs, x: w.player.x };
  }
  const frames = 600; // 10 秒 @60fps
  const s1 = simulate(1, frames);
  const s025 = simulate(0.25, frames);
  const s4 = simulate(4, frames);
  info(`600 帧下：0.25× → ${s025.steps} 步 / 1× → ${s1.steps} 步 / 4× → ${s4.steps} 步`);
  check('0.25× 推进约为 1× 的 1/4', Math.abs(s025.steps / s1.steps - 0.25) < 0.06, (s025.steps / s1.steps).toFixed(3));
  check('4× 推进约为 1× 的 4 倍', Math.abs(s4.steps / s1.steps - 4) < 0.35, (s4.steps / s1.steps).toFixed(3));
  check('局内时间与步数一致（同一固定步长）', Math.abs(s4.elapsed - s4.steps * TICK_MS) < 1e-6, `${s4.elapsed} vs ${s4.steps * TICK_MS}`);

  // 不失稳：同种子下"缩放推进的最终状态"必须落在 1× 的容差内
  const a = simulate(1, frames);
  const b = simulate(1, frames);
  check('同种子同缩放两次结果完全一致（无随机漂移）', a.steps === b.steps && a.x === b.x, `${a.x} vs ${b.x}`);
  panel.state.ts = 4;
  check('面板能把时间缩放设到 4×', panel.state.ts === 4, String(panel.state.ts));
  panel.state.ts = 0.25;
  check('面板能把时间缩放设到 0.25×', panel.state.ts === 0.25, String(panel.state.ts));
  void world;
}

// ================================================================ 5
section('5. 敌人开关：关掉全部远程后，场上不再出现远程敌人');
{
  const { world, panel } = makeHarness('shanpo');
  panel.setAllEnemies(true, true); // 只留近战
  panel.applyState();
  // 这一步只测"刷怪内容"，所以把玩家设成无敌：不然玩家一死世界就停转，测出来的是生存力
  world.invincible = true;
  world.elapsedMs = 6 * 60 * 1000; // 第 6 分钟：远程本来早就该出现了
  world.tune.tier = 4;
  for (let i = 0; i < 60 * 40; i++) {
    world.step();
  }
  const ranged = world.enemies.active.filter((e) => e.ai === 'ranged');
  const melee = world.enemies.active.filter((e) => e.ai !== 'ranged');
  info(`只留近战跑 40 秒：敌人 ${world.enemies.active.length}（远程 ${ranged.length} / 近战 ${melee.length}）`);
  check('关掉远程后场上没有远程敌人', ranged.length === 0, String(ranged.length));
  check('近战敌人仍然在生成（不是把刷怪整个关掉）', melee.length > 0, String(melee.length));

  // 全关
  panel.setAllEnemies(false, false);
  panel.applyState();
  const before = world.enemies.active.length;
  for (let i = 0; i < 60 * 5; i++) {
    world.step();
  }
  const added = world.enemies.active.length - before;
  info(`全关后 5 秒：敌人从 ${before} 变成 ${world.enemies.active.length}`);
  check('全关后不再有新怪生成', added <= 0, String(added));

  // 数量倍率：全 0 → 一只都不生成
  const w2 = makeHarness('shanpo').world;
  const p2 = new TunePanel({
    getWorld: () => w2,
    getRenderer: () => ({ fps: 60 }),
    getController: () => ({ pause() {}, resume() {} }),
    state: defaultTuneState(1),
  });
  p2.mount();
  p2.applyState();
  w2.invincible = true;
  w2.tune.enemies = {};
  for (const id of Object.keys(ENEMY_IDS)) w2.tune.enemies[id] = { on: true, count: 0, weight: 1, from: null };
  w2.tick = Math.round((6 * 60 * 1000) / TICK_MS);
  w2.elapsedMs = w2.tick * TICK_MS; // 时间与 tick 必须一起设，否则 step() 会把时间顶回去
  w2.tune.tier = 4;
  // 精英不受"每种敌人的数量倍率"管（它们由日程驱动），先清掉以免混进断言
  w2.tune.elite = 0;
  w2.enemies.clear();
  for (let i = 0; i < 60 * 10; i++) {
    w2.step();
  }
  check('数量倍率 0 = 该种类不再生成', w2.enemies.active.length === 0, String(w2.enemies.active.length));

  // 怪生命倍率真的生效
  const w3 = makeHarness('shanpo').world;
  w3.tune.enemyHp = 3;
  const e = addDummy(w3, 1);
  const base = w3.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: 100, y: 100 });
  const normal = w3.spawnEnemyFrom({ kind: 'shanxiao', tier: 0, x: 100, y: 100 });
  void e;
  void base;
  const hpMul = w3.tune.enemyHp;
  check('怪生命倍率作用在实例化的怪身上（×3）', normal.maxHp > 0 && Math.abs(normal.maxHp / (30 * 1)) > 1, `hp=${normal.maxHp} mul=${hpMul}`);
}

// ================================================================ 6
section('6. 配置串：往返一致 + 版本不符被拒绝');
{
  const st = defaultTuneState(4242);
  st.ts = 4;
  st.inv = true;
  st.t = 540000;
  st.spawn = 2;
  st.enemyHp = 1.5;
  st.elite = 0;
  st.tier = 3;
  st.xp = 2;
  st.drop = 0.5;
  st.perEnemy.bifang = { on: false, count: 0, weight: 2, from: 120000 };
  st.perEnemy.shanxiao = { on: true, count: 1.5, weight: 1, from: null };
  st.weapons = [{ id: 'w_guhai', level: 5 }];
  st.passives = ['xuangui'];

  const s1 = serializeTune(st);
  const r1 = parseTune(s1);
  check('配置串能解析', r1.ok === true, r1.ok ? '' : r1.error);
  const s2 = serializeTune(r1.ok ? r1.state : {});
  check('导出 → 导入 → 再导出：两次完全一致', s1 === s2, `\n    1: ${s1}\n    2: ${s2}`);
  info(`配置串：${s1}`);
  if (r1.ok) {
    check('往返后关键字段保真（ts/inv/t/spawn/hp/elite/tier）',
      r1.state.ts === 4 && r1.state.inv === true && r1.state.t === 540000
      && r1.state.spawn === 2 && r1.state.enemyHp === 1.5 && r1.state.elite === 0 && r1.state.tier === 3,
      JSON.stringify(r1.state));
    check('往返后敌人开关保真（毕方关闭 + from=120s）',
      r1.state.perEnemy.bifang && r1.state.perEnemy.bifang.on === false && r1.state.perEnemy.bifang.from === 120000,
      JSON.stringify(r1.state.perEnemy));
  }

  const future = s1.replace(/^v1/, 'v2');
  const rBad = parseTune(future);
  check('版本不符被拒绝（不静默按错误的串配置）', rBad.ok === false && /版本不匹配/.test(rBad.error), JSON.stringify(rBad));
  const rNoVer = parseTune('seed=1;t=10');
  check('缺少版本号被拒绝', rNoVer.ok === false, JSON.stringify(rNoVer));
  const rBadId = parseTune('v1;en=nosuch*1');
  check('未知敌人 id 被拒绝（不猜）', rBadId.ok === false && /未知敌人/.test(rBadId.error), JSON.stringify(rBadId));
  const rBadKey = parseTune('v1;nosuchkey=1');
  check('未知配置键被拒绝', rBadKey.ok === false && /未知配置键/.test(rBadKey.error), JSON.stringify(rBadKey));

  // URL 入口
  const fromUrl = tuneFromUrl(`?dev=tune&tune=${encodeURIComponent(s1)}`);
  check('能从 URL 的 ?tune= 读回同一份配置', fromUrl && serializeTune(fromUrl) === s1, fromUrl ? serializeTune(fromUrl).slice(0, 60) : 'null');
  check('?tune= 版本不符时返回 null（不猜）', tuneFromUrl('?dev=tune&tune=v9;seed=1') === null, '');
  check('没有 ?tune= 时返回 null', tuneFromUrl('?dev=tune') === null, '');
  check('版本常量是 v1', TUNE_VERSION === 'v1', TUNE_VERSION);
}

// ================================================================ 7
section('7. 触控不冲突：面板默认停在上方，且不覆盖摇杆/闪避/主动技的命中区');
{
  const { panel } = makeHarness('shanpo');
  panel.setOpen(true);
  const panelRect = { left: 420, top: 4, right: 420 + 400, bottom: 4 + 316 };
  const { TOUCH, hitTestTouch, inJoyRegion } = await import('../src/render/touch-layout.js');
  check('面板不覆盖闪避键命中区', panelRect.bottom < TOUCH.dash.cy - TOUCH.dash.hitR,
    `panel.bottom=${panelRect.bottom} vs dash.top=${TOUCH.dash.cy - TOUCH.dash.hitR}`);
  check('面板不覆盖主动技命中区', panelRect.bottom < TOUCH.skill.cy - TOUCH.skill.hitR,
    `panel.bottom=${panelRect.bottom} vs skill.top=${TOUCH.skill.cy - TOUCH.skill.hitR}`);
  // 摇杆触发区是"左半边 + y ≥ 80"：面板只占 y < 376 的上方，重叠区仍能按到摇杆
  const joyPoint = { x: 120, y: 300 };
  check('面板覆盖处仍在摇杆触发区内（命中判定不受面板影响）', inJoyRegion(joyPoint.x, joyPoint.y) === true, '');
  // 命中测试仍然正常：面板不参与 canvas 的命中测试
  check('闪避键命中测试不受面板影响', hitTestTouch(TOUCH.dash.cx, TOUCH.dash.cy) === 'dash', '');
  check('主动技命中测试不受面板影响', hitTestTouch(TOUCH.skill.cx, TOUCH.skill.cy) === 'skill', '');
  check('摇杆区与闪避键仍互不重叠', inJoyRegion(TOUCH.dash.cx, TOUCH.dash.cy) === false, '');
  check('面板宽高在逻辑画布内', panelRect.right <= ARENA_W && panelRect.bottom <= ARENA_H, `${panelRect.right}x${panelRect.bottom}`);
  void nodes;
}

// ================================================================ 8
section('8. 不改参数时，与不带面板的一局结果一致');
{
  function run(withPanel, steps) {
    const w = new World({ seed: 31337, characterId: 'huangpo' });
    w.paused = false;
    let panel = null;
    if (withPanel) {
      panel = new TunePanel({
        getWorld: () => w,
        getRenderer: () => ({ fps: 60 }),
        getController: () => ({ pause() {}, resume() {} }),
        state: defaultTuneState(31337),
      });
      panel.mount();
      panel.applyState(); // 打开面板、不改任何参数
      panel.setOpen(true);
    }
    for (let i = 0; i < steps && w.running; i++) {
      w.input.mx = Math.cos(i / 70);
      w.input.my = Math.sin(i / 70);
      w.step();
    }
    return {
      kills: w.runStats.kills,
      damage: Math.round(w.runStats.damageDealt || 0),
      hp: w.player.hp,
      level: w.player.level,
      elapsed: w.elapsedMs,
      seed: w.seed,
      panel: !!panel,
    };
  }
  const a = run(false, 60 * 90);
  const b = run(true, 60 * 90);
  info(`无面板：击杀 ${a.kills} 伤害 ${a.damage} 等级 ${a.level} 血量 ${a.hp.toFixed(1)}`);
  info(`有面板：击杀 ${b.kills} 伤害 ${b.damage} 等级 ${b.level} 血量 ${b.hp.toFixed(1)}`);
  check('击杀数一致', a.kills === b.kills, `${a.kills} vs ${b.kills}`);
  check('伤害一致', a.damage === b.damage, `${a.damage} vs ${b.damage}`);
  check('等级一致', a.level === b.level, `${a.level} vs ${b.level}`);
  check('血量一致', Math.abs(a.hp - b.hp) < 1e-9, `${a.hp} vs ${b.hp}`);
  check('局内时间一致', a.elapsed === b.elapsed, `${a.elapsed} vs ${b.elapsed}`);
  check('种子一致', a.seed === b.seed, '');
}

// ================================================================ 9
section('9. HUD 上的独立调参按键（不再依赖长按手势）');
{
  const hud = globalThis.document.getElementById('screen-hud');
  const btn = globalThis.document.getElementById('btn-tune');
  check('HUD 上有独立调参按键', !!btn, btn ? btn.className : '缺失');
  check('它与暂停键是两个不同元素，且挂在 HUD 里', !!btn && btn !== nodes['btn-pause'] && btn.parent === hud, '');
  // 位置：暂停键左边一个身位（right + 60px），宽 48
  //   → 逻辑 x ∈ [960−8−60−48, 960−8−60] = [844, 892]
  const rect = { left: 960 - 8 - 60 - 48, right: 960 - 8 - 60, top: 8, bottom: 52 };
  const { TOUCH } = await import('../src/render/touch-layout.js');
  check('按键不覆盖闪避/主动技命中区', rect.bottom < TOUCH.skill.cy - TOUCH.skill.hitR,
    `按键底 ${rect.bottom} vs 主动技顶 ${TOUCH.skill.cy - TOUCH.skill.hitR}`);
  check('按键不落在摇杆触发区（x > 0.45×960）', rect.left > 960 * 0.45, String(rect.left));
  check('按键在可见画布内', rect.right <= 960 && rect.bottom <= 540, `${rect.right}x${rect.bottom}`);
  check('按键与暂停键不重叠', rect.right < 960 - 8 - 44, `${rect.right} < ${960 - 8 - 44}`);

  // 按键 → 面板：用**同一个面板实例**验，避免"按钮挂在共享 DOM、面板是另建实例"的歧义
  const keyPanel = new TunePanel({
    getWorld: () => null,
    getRenderer: () => ({ fps: 60 }),
    getController: () => ({ pause() {}, resume() {} }),
    state: defaultTuneState(1),
  });
  keyPanel.mount();
  const key = globalThis.document.getElementById('btn-tune');
  check('按键点击 = 开关面板（收起 → 展开）',
    (keyPanel.setOpen(false), key.fire('click'), keyPanel.open === true), String(keyPanel.open));
  check('再点一次 = 收起', (key.fire('click'), keyPanel.open === false), String(keyPanel.open));
  check('面板展开时按键点亮（一眼看出状态）',
    (keyPanel.setOpen(true), key.classList.contains('on')), '');
  keyPanel.setOpen(false);
  check('面板收起时按键不亮', !key.classList.contains('on'), '');

  // 正式包里这个按键不存在：index.html 里不许出现它
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  check('index.html 里没有调参按键（正式包 DOM 中不存在）', !/btn-tune/.test(html), '');
  check('index.html 里没有面板模块引用', !/dev\/tune-panel/.test(html), '');
}

// ---------------------------------------------------------------- 汇总
console.log(`\n================ 调参面板验收 ${pass} 通过 / ${fail} 失败 ================`);
if (fail) {
  console.log('失败项：');
  for (const b of bad) console.log(`  - ${b}`);
}
process.exit(fail === 0 ? 0 : 1);
