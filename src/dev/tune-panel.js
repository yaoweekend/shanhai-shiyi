// 开发/测试用：实时调参浮层（规格 specs/shanhai-dev-tune.md）。
//
// ⚠️ 这个文件**只在带 `?dev=tune` 时被动态 import**（见 main.js）。
//    正式包里没有任何引用路径能到达它；tools/check.mjs 的静态检查会守住这条。
//    因此这里可以放心使用 DOM，不必迁就模拟层的"无 DOM"约束。
//
// 三条硬约束（规格 §6）：
//  ① 入口不得进正式包 —— 由 tools/check.mjs 的守卫断言；
//  ② 只作用于当前这一局、**绝不写存档** —— 本文件从不 import meta/save.js，
//     并且进入调参局时 runs[] 的 endRun 走"不计入"分支（见 main.js 的 endRun）；
//  ③ 不联网 —— 只有 DOM 操作与 import。
import {
  ARENA_W, ARENA_H, CAP_ENEMIES, CAP_PLAYER_BULLETS, CAP_ENEMY_BULLETS,
  CAP_DROPS, CAP_PARTICLES, CAP_MINIONS, TICK_MS, VERSION, RUN_T, LOGIC_W, LOGIC_H,
  SLOT_WEAPONS, SLOT_PASSIVES, WEAPON_MAX_LEVEL, PASSIVE_MAX_LEVEL, TIER_PERIOD,
} from '../config.js';
import { ENEMIES } from '../content/enemies.js';
import { WEAPONS, WEAPON_BY_ID } from '../content/weapons.js';
import { PASSIVES, PASSIVE_BY_ID } from '../content/passives.js';
import { ULTIMATE_FUSIONS, FUSIONS, activeSkillFor } from '../content/fusions.js';
import { CHARACTERS, CHARACTER_BY_ID } from '../content/characters.js';
import { serializeTune, parseTune, TUNE_VERSION, seriessOfWeapon } from './tune-config.js';

const ENEMY_IDS = Object.keys(ENEMIES);
const TIME_SCALES = [0.25, 0.5, 1, 2, 4];
const STYLE_ID = 'dev-tune-style';

/** 面板默认的"安全状态"（每次开一局都从它开始） */
export function defaultTuneState(seed) {
  const perEnemy = {};
  for (const id of ENEMY_IDS) perEnemy[id] = { on: true, from: null, weight: 1, count: 1 };
  return {
    v: TUNE_VERSION,
    seed: seed >>> 0,
    t: 0,
    ts: 1,
    inv: false,
    dmgMul: 1,
    speedMul: 1,
    hpMul: 1,
    enemyHp: 1,
    enemySpd: 1,
    spawn: 1,
    elite: 1,
    tier: -1,
    xp: 1,
    drop: 1,
    perEnemy,
  };
}

/** 把 URL 里的 ?tune=... 配置串读进来（没有就返回 null） */
export function tuneFromUrl(search) {
  try {
    const p = new URLSearchParams(search || '').get('tune');
    if (!p) return null;
    const parsed = parseTune(decodeURIComponent(p));
    return parsed.ok ? parsed.state : null;
  } catch {
    return null;
  }
}

/**
 * 当前生效的面板实例（规格 §2 的 HUD 按键是**共享 DOM**：一局结束重开时面板会被重建，
 * 但按键元素还在，所以监听器必须指向"最新的那个面板"，不能绑在已被丢弃的实例上）。
 */
let activePanel = null;

export class TunePanel {
  /**
   * @param {object} deps
   * @param {() => object|null} deps.getWorld   当前局（可能为 null）
   * @param {() => object}       deps.getRenderer 读 fps / 逻辑坐标换算
   * @param {() => object}       deps.getController
   * @param {object}             deps.state      调参状态（跨局保留）
   * @param {(msg:string)=>void} [deps.toast]
   */
  constructor(deps) {
    this.deps = deps;
    this.state = deps.state || defaultTuneState(1);
    this.open = false;
    this.dragging = false;
    this.dot = { x: ARENA_W - 50, y: 30 };
    this.refreshers = [];
    this.root = null;
    this.dotEl = null;
    this.bodyEl = null;
    this._built = false;
    this._raf = 0;
  }

  get isOpen() {
    return this.open;
  }

  mount() {
    if (this._built) return this;
    injectStyle();
    const host = document.body;
    const root = document.createElement('div');
    root.id = 'dev-tune';
    root.className = 'dt-root dt-collapsed';
    root.innerHTML = `
      <button id="dt-dot" class="dt-dot" title="调参面板（拖动可挪）">⚙</button>
      <div id="dt-body" class="dt-body" hidden>
        <header class="dt-head">
          <b>调参面板</b>
          <span class="dt-ver">v${VERSION} · ${TUNE_VERSION}</span>
          <button id="dt-close" class="dt-x" aria-label="收起">✕</button>
        </header>
        <div class="dt-groups" id="dt-groups"></div>
        <footer class="dt-foot">
          <button id="dt-export" class="dt-btn">导出 URL</button>
          <button id="dt-import" class="dt-btn">导入 URL</button>
          <button id="dt-state" class="dt-btn">导出局状态</button>
          <span class="dt-note" id="dt-note"></span>
        </footer>
      </div>`;
    host.appendChild(root);
    this.root = root;
    this.dotEl = root.querySelector('#dt-dot');
    this.bodyEl = root.querySelector('#dt-body');
    this.noteEl = root.querySelector('#dt-note');
    root.querySelector('#dt-close').addEventListener('click', () => this.setOpen(false));
    this.dotEl.addEventListener('pointerdown', (e) => this._dotDown(e));
    root.querySelector('#dt-export').addEventListener('click', () => this.copyExport());
    root.querySelector('#dt-import').addEventListener('click', () => this.promptImport());
    root.querySelector('#dt-state').addEventListener('click', () => this.copyRunState());
    this.buildControls(root.querySelector('#dt-groups'));
    this.bindKeys();
    this.applyLayout();
    this.mountHudKey();
    this._built = true;
    this._startTicker();
    return this;
  }

  /**
   * HUD 上的**独立调参按键**（规格 §1 的真机快捷入口）。
   *
   * 它由本模块**动态插进 #screen-hud**，而不是写在 index.html 里 ——
   * 这样正式包的 DOM 里根本不存在这个元素（守门规则见 tools/check.mjs §10）。
   * 位置避开了摇杆触发区与闪避/主动技命中区（与暂停键同一行，靠左一个身位）。
   */
  mountHudKey() {
    activePanel = this;
    // `hudBtn` 是**实例属性**：每个面板记自己的按键，但按键元素是共享的。
    // 监听器统一走 activePanel，所以重开一局后按键依然开关"当前那个面板"。
    if (!this.hudBtn) {
      const exist = document.getElementById('btn-tune');
      if (exist) this.hudBtn = exist;
    }
    if (document.getElementById('btn-tune')) return this.hudBtn;
    const hud = document.getElementById('screen-hud');
    if (!hud || !hud.appendChild) return null;
    const b = document.createElement('button');
    b.id = 'btn-tune';
    b.className = 'hud-tune';
    b.type = 'button';
    b.textContent = '⚙';
    b.title = '调参面板';
    b.setAttribute('aria-label', '调参面板');
    b.addEventListener('click', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (activePanel) activePanel.setOpen(!activePanel.open);
    });
    hud.appendChild(b);
    this.hudBtn = b;
    return b;
  }

  /** 面板开着时把 HUD 按键也点亮，一眼能看出状态 */
  syncHudKey() {
    if (this.hudBtn) this.hudBtn.classList.toggle('on', this.open);
  }

  /**
   * 逻辑像素 → 屏幕像素：与画布的等比缩放共用同一套换算（规格 §2 逻辑像素布局）。
   *
   * 基准是**可见画布**（960×540 逻辑分辨率），不是竞技场（2400×1350）——
   * 竞技场是"世界"，触控命中区与 HUD 都活在可见画布里。
   * 踩过的坑：一开始按 ARENA_W 缩放，结果面板被缩到 0.355 倍、
   * 贴着左上角变成一小条（真机截图一看就知道不对）。
   */
  applyLayout() {
    const cv = document.getElementById('game');
    const r = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    if (!r || !r.width) return;
    const s = r.width / LOGIC_W;
    const h = Math.round(r.height / s) || LOGIC_H;
    if (this.root) {
      this.root.style.left = `${r.left}px`;
      this.root.style.top = `${r.top}px`;
      this.root.style.width = `${LOGIC_W}px`;
      this.root.style.height = `${h}px`;
      this.root.style.transform = `scale(${s})`;
      this.root.style.transformOrigin = '0 0';
    }
    return s;
  }

  setOpen(on) {
    this.open = !!on;
    if (!this._built) this.mount();
    this.root.classList.toggle('dt-collapsed', !this.open);
    this.bodyEl.hidden = !this.open;
    this.applyLayout();
    this.syncHudKey();
    if (this.open) this.refresh();
  }

  toggle() {
    this.setOpen(!this.open);
    return this.open;
  }

  // ---------------- 拖动小圆点 ----------------

  _dotDown(e) {
    e.preventDefault();
    this.dragging = true;
    const start = { x: e.clientX, y: e.clientY, dx: this.dot.x, dy: this.dot.y };
    const move = (ev) => {
      const s = this._scale() || 1;
      this.dot.x = Math.max(16, Math.min(ARENA_W - 16, start.dx + (ev.clientX - start.x) / s));
      this.dot.y = Math.max(16, Math.min(ARENA_H - 16, start.dy + (ev.clientY - start.y) / s));
      this._placeDot();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.dragging = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    this._placeDot();
  }

  _scale() {
    const cv = document.getElementById('game');
    const r = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect() : null;
    return r && r.width ? r.width / ARENA_W : 1;
  }

  _placeDot() {
    if (!this.dotEl) return;
    this.dotEl.style.left = `${this.dot.x}px`;
    this.dotEl.style.top = `${this.dot.y}px`;
  }

  // ---------------- 控件 ----------------

  buildControls(host) {
    host.textContent = '';
    this.refreshers = [];
    host.appendChild(this.groupPlayer());
    host.appendChild(this.groupLoadout());
    host.appendChild(this.groupEnemies());
    host.appendChild(this.groupTime());
    host.appendChild(this.groupWorld());
    host.appendChild(this.groupDiag());
  }

  _group(title) {
    const g = document.createElement('section');
    g.className = 'dt-group';
    const h = document.createElement('h3');
    h.textContent = title;
    g.appendChild(h);
    const rows = document.createElement('div');
    rows.className = 'dt-rows';
    g.appendChild(rows);
    g.rows = rows;
    return g;
  }

  _row(parent, label, node, opts = {}) {
    const r = document.createElement('div');
    r.className = 'dt-row';
    const l = document.createElement('label');
    l.className = 'dt-label';
    l.textContent = label;
    r.appendChild(l);
    r.appendChild(node);
    if (opts.readout) {
      const out = document.createElement('span');
      out.className = 'dt-read';
      r.appendChild(out);
      opts.readout(out);
    }
    parent.appendChild(r);
    return r;
  }

  _btn(parent, text, on, cls = '') {
    const b = document.createElement('button');
    b.className = `dt-btn ${cls}`.trim();
    b.textContent = text;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      on(b);
    });
    parent.appendChild(b);
    return b;
  }

  _btnRow(parent) {
    const r = document.createElement('div');
    r.className = 'dt-btnrow';
    parent.appendChild(r);
    return r;
  }

  _slider(parent, label, min, max, step, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'dt-slide';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const value = () => get();
    input.value = String(value());
    input.addEventListener('input', () => {
      set(Number(input.value));
    });
    wrap.appendChild(input);
    this._row(parent, label, wrap, {
      readout: (out) => {
        out.textContent = formatNum(value());
        this.refreshers.push(() => {
          if (document.activeElement !== input) input.value = String(value());
          out.textContent = formatNum(value());
        });
      },
    });
    return input;
  }

  _select(parent, label, options, get, set) {
    const sel = document.createElement('select');
    sel.className = 'dt-sel';
    for (const o of options) {
      const op = document.createElement('option');
      op.value = o.value;
      op.textContent = o.label;
      sel.appendChild(op);
    }
    sel.value = String(get());
    sel.addEventListener('change', () => set(sel.value));
    this._row(parent, label, sel);
    this.refreshers.push(() => {
      const v = String(get());
      if (sel.value !== v) sel.value = v;
    });
    return sel;
  }

  _check(parent, label, get, set) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'dt-check';
    input.checked = !!get();
    input.addEventListener('change', () => set(input.checked));
    this._row(parent, label, input);
    this.refreshers.push(() => {
      input.checked = !!get();
    });
    return input;
  }

  // ---------------- A. 玩家 ----------------

  groupPlayer() {
    const g = this._group('玩家');
    const st = this.state;
    const w = () => this.deps.getWorld();

    this._row(g.rows, '生命', (() => {
      const box = document.createElement('div');
      box.className = 'dt-inline';
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'dt-num';
      input.addEventListener('change', () => {
        const ww = w();
        if (ww) ww.player.hp = Math.max(1, Math.min(ww.player.maxHp, Number(input.value) || 1));
      });
      const full = this._btn(box, '回满', () => {
        const ww = w();
        if (ww) ww.player.hp = ww.player.maxHp;
      });
      const mul = this._btn(box, '上限 ×2', () => {
        const ww = w();
        if (ww) {
          ww.player.maxHp = Math.round(ww.player.maxHp * 2);
          ww.player.hp = ww.player.maxHp;
        }
      });
      void full; void mul;
      box.insertBefore(input, box.firstChild);
      this.refreshers.push(() => {
        const ww = w();
        if (ww) input.value = String(Math.round(ww.player.hp));
      });
      return box;
    })());

    this._check(g.rows, '无敌', () => st.inv, (v) => {
      st.inv = v;
      const ww = w();
      if (ww) ww.invincible = v;
    });
    this._slider(g.rows, '伤害倍率', 0.25, 4, 0.05, () => st.dmgMul, (v) => {
      st.dmgMul = v;
      const ww = w();
      if (ww) ww.damageMul = v;
    });
    this._slider(g.rows, '移速倍率', 0.5, 2, 0.05, () => st.speedMul, (v) => {
      st.speedMul = v;
      const ww = w();
      if (ww) ww.speedMul = v;
    });
    this._slider(g.rows, '护盾值', 0, 300, 5, () => {
      const ww = w();
      return ww ? Math.round(ww.player.shield || 0) : 0;
    }, (v) => {
      const ww = w();
      if (ww) {
        ww.player.shieldMax = Math.max(ww.player.shieldMax, Math.round(v));
        ww.player.shield = Math.round(v);
      }
    });
    this._row(g.rows, '经验等级', (() => {
      const box = document.createElement('div');
      box.className = 'dt-inline';
      this._btn(box, '−1', () => {
        const ww = w();
        if (ww) {
          ww.player.level = Math.max(1, ww.player.level - 1);
          ww.recompute();
        }
      });
      this._btn(box, '+1', () => {
        const ww = w();
        if (ww) {
          ww.player.level += 1;
          ww.recompute();
        }
      });
      this._btn(box, '一键升级', () => {
        const ww = w();
        if (!ww) return;
        for (let i = 0; i < 20; i++) ww.player.level += 1;
        ww.recompute();
        ww.player.hp = ww.player.maxHp;
      });
      return box;
    })());
    return g;
  }

  // ---------------- B. 配装 ----------------

  groupLoadout() {
    const g = this._group('配装');
    const w = () => this.deps.getWorld();
    const state = this.state;

    const weaponOptions = [{ value: '', label: '（空）' }].concat(
      WEAPONS.filter((x) => !x.locked).map((x) => ({ value: x.id, label: x.cn })),
    );
    const passiveOptions = [{ value: '', label: '（空）' }].concat(
      PASSIVES.filter((x) => !x.locked).map((x) => ({ value: x.id, label: `${x.cn}（${x.desc}）` })),
    );

    const readSlots = () => {
      const ww = w();
      if (!ww) return null;
      return { weapons: ww.slots.weapons, passives: ww.slots.passives };
    };

    for (let i = 0; i < SLOT_WEAPONS; i++) {
      const line = document.createElement('div');
      line.className = 'dt-slotline';
      const sel = document.createElement('select');
      sel.className = 'dt-sel';
      for (const o of weaponOptions) {
        const op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => {
        const ww = w();
        if (!ww) return;
        const id = sel.value;
        if (!id) {
          ww.slots.weapons.splice(i, 1);
        } else if (ww.slots.weapons[i]) {
          ww.slots.weapons[i] = { ...ww.slots.weapons[i], id, superId: ww.slots.weapons[i].superId || null };
        } else {
          ww.slots.weapons.splice(i, 0, { id, level: 1, cd: 0, superId: null });
        }
        ww.recompute();
        ww.refreshWeaponEntities();
      });
      const lv = document.createElement('input');
      lv.type = 'range';
      lv.min = '1';
      lv.max = String(WEAPON_MAX_LEVEL);
      lv.step = '1';
      lv.addEventListener('input', () => {
        const ww = w();
        const slot = ww && ww.slots.weapons[i];
        if (slot) {
          slot.level = Number(lv.value);
          ww.recompute();
          ww.refreshWeaponEntities();
        }
      });
      const lvOut = document.createElement('span');
      lvOut.className = 'dt-read';
      line.appendChild(labelEl(`武器${i + 1}`));
      line.appendChild(sel);
      line.appendChild(lv);
      line.appendChild(lvOut);
      g.rows.appendChild(line);
      this.refreshers.push(() => {
        const r = readSlots();
        const slot = r && r.weapons[i];
        const id = slot ? slot.id : '';
        if (sel.value !== id) sel.value = id;
        const level = slot ? slot.level : 1;
        if (Number(lv.value) !== level) lv.value = String(level);
        lvOut.textContent = `Lv${level}`;
      });
    }

    for (let i = 0; i < SLOT_PASSIVES; i++) {
      this._select(g.rows, `被动${i + 1}`, passiveOptions, () => {
        const r = readSlots();
        return r && r.passives[i] ? r.passives[i] : '';
      }, (v) => {
        const ww = w();
        if (!ww) return;
        if (!v) ww.slots.passives.splice(i, 1);
        else if (ww.slots.passives[i]) ww.slots.passives[i] = v;
        else ww.slots.passives.splice(i, 0, v);
        ww.recompute();
        ww.refreshWeaponEntities();
      });
    }

    const row = this._btnRow(g.rows);
    this._btn(row, '一键满级本系配装', () => this.presetFullLoadout());
    this._btn(row, '解锁本系主动技', () => this.presetUnlockSkill());
    this._btn(row, '一键合体', () => this.presetFuse());
    this._btn(row, '清空配装', () => {
      const ww = w();
      if (!ww) return;
      ww.fusedWeapon = null;
      ww.slots.weapons = [];
      ww.slots.passives = [];
      ww.recompute();
      ww.refreshWeaponEntities();
      ww.initUltimateState();
    });
    this._select(g.rows, '角色', CHARACTERS.map((c) => ({ value: c.id, label: c.cn })), () => {
      const ww = w();
      return ww ? ww.characterId : 'shanpo';
    }, (v) => {
      const ww = w();
      if (ww) ww.characterId = v;
    });
    void state;
    return g;
  }

  // ---------------- C. 怪物 ----------------

  groupEnemies() {
    const g = this._group('怪物');
    const st = this.state;

    for (const id of ENEMY_IDS) {
      const def = ENEMIES[id];
      const line = document.createElement('div');
      line.className = 'dt-slotline';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'dt-check';
      cb.checked = st.perEnemy[id].on;
      cb.addEventListener('change', () => {
        st.perEnemy[id].on = cb.checked;
      });
      const fromIn = document.createElement('input');
      fromIn.type = 'number';
      fromIn.className = 'dt-num';
      fromIn.title = '出现时间（秒）';
      fromIn.value = String(def.from / 1000);
      fromIn.addEventListener('change', () => {
        st.perEnemy[id].from = Math.max(0, Number(fromIn.value) || 0) * 1000;
      });
      const wt = document.createElement('input');
      wt.type = 'range';
      wt.min = '0';
      wt.max = '4';
      wt.step = '0.1';
      wt.value = String(st.perEnemy[id].weight);
      wt.addEventListener('input', () => {
        st.perEnemy[id].weight = Number(wt.value);
      });
      const wtOut = document.createElement('span');
      wtOut.className = 'dt-read';
      line.appendChild(labelEl(def.cn));
      line.appendChild(cb);
      line.appendChild(fromIn);
      line.appendChild(wt);
      line.appendChild(wtOut);
      g.rows.appendChild(line);
      this.refreshers.push(() => {
        cb.checked = st.perEnemy[id].on;
        wtOut.textContent = `×${st.perEnemy[id].weight.toFixed(1)}`;
      });
    }

    const quick = this._btnRow(g.rows);
    this._btn(quick, '全开', () => this.setAllEnemies(true, false));
    this._btn(quick, '全关', () => this.setAllEnemies(false, false));
    this._btn(quick, '只留近战', () => this.setAllEnemies(true, true));

    this._slider(g.rows, '数量倍率', 0, 4, 0.1, () => st.perEnemy.shanxiao.count, (v) => {
      for (const id of ENEMY_IDS) st.perEnemy[id].count = v;
    });
    this._slider(g.rows, '生成速率', 0, 5, 0.1, () => st.spawn, (v) => {
      st.spawn = v;
    });
    this._slider(g.rows, '怪生命倍率', 0.2, 5, 0.1, () => st.enemyHp, (v) => {
      st.enemyHp = v;
    });
    this._slider(g.rows, '怪速度倍率', 0.2, 3, 0.1, () => st.enemySpd, (v) => {
      st.enemySpd = v;
    });
    this._slider(g.rows, '精英频率', 0, 4, 0.25, () => st.elite, (v) => {
      st.elite = v;
    });
    this._slider(g.rows, '难度档', -1, 8, 1, () => st.tier, (v) => {
      st.tier = v;
      const ww = this.deps.getWorld();
      if (ww) ww.spawner.lastTier = v < 0 ? ww.spawner.lastTier : v;
    });
    return g;
  }

  setAllEnemies(on, meleeOnly) {
    for (const id of ENEMY_IDS) {
      const ranged = ENEMIES[id].ai === 'ranged';
      this.state.perEnemy[id].on = meleeOnly ? !ranged : on;
    }
    this.refresh();
  }

  // ---------------- D. 时间 ----------------

  groupTime() {
    const g = this._group('时间');
    const st = this.state;

    this._row(g.rows, '局内时间', (() => {
      const box = document.createElement('div');
      box.className = 'dt-inline';
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'dt-num';
      input.step = '30';
      const go = this._btn(box, '跳转', () => this.presetJumpTo(Number(input.value) * 1000));
      void go;
      box.insertBefore(input, box.firstChild);
      this.refreshers.push(() => {
        const ww = this.deps.getWorld();
        const sec = ww ? ww.elapsedMs / 1000 : 0;
        if (document.activeElement !== input) input.value = String(Math.round(sec));
      });
      return box;
    })());

    this._row(g.rows, '时间缩放', (() => {
      const box = document.createElement('div');
      box.className = 'dt-inline';
      for (const s of TIME_SCALES) {
        this._btn(box, `${s}×`, () => {
          st.ts = s;
          this.refresh();
        }, 'dt-scale');
      }
      this.refreshers.push(() => {
        const btns = box.querySelectorAll('button');
        for (let i = 0; i < btns.length; i++) btns[i].classList.toggle('on', TIME_SCALES[i] === st.ts);
      });
      return box;
    })());

    const row = this._btnRow(g.rows);
    this._btn(row, '暂停/继续', () => {
      const ctl = this.deps.getController();
      const ww = this.deps.getWorld();
      if (!ww) return;
      if (ww.paused) ctl.resume();
      else ctl.pause();
    });
    this._btn(row, '跳到 3:00', () => this.presetJumpTo(180000));
    this._btn(row, '跳到 9:00', () => this.presetJumpTo(540000));
    this._btn(row, '跳到 Boss 前', () => this.presetJumpTo(590000));
    this._btn(row, '立即召唤 Boss', () => this.presetBoss());
    return g;
  }

  // ---------------- E. 世界 ----------------

  groupWorld() {
    const g = this._group('世界');
    const st = this.state;

    this._row(g.rows, '随机种子', (() => {
      const box = document.createElement('div');
      box.className = 'dt-inline';
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'dt-num';
      input.value = String(st.seed);
      input.addEventListener('change', () => {
        st.seed = Number(input.value) >>> 0;
      });
      box.appendChild(input);
      this._btn(box, '以此种子重开', () => {
        st.seed = Number(input.value) >>> 0;
        this.restartWithSeed(st.seed);
      });
      return box;
    })());

    this._slider(g.rows, '掉落倍率', 0, 5, 0.1, () => st.drop, (v) => {
      st.drop = v;
      const ww = this.deps.getWorld();
      if (ww) ww.dropMul = v;
    });
    this._slider(g.rows, '经验倍率', 0, 5, 0.1, () => st.xp, (v) => {
      st.xp = v;
      const ww = this.deps.getWorld();
      if (ww) ww.xpMul = v;
    });
    this._select(g.rows, '画质档位', [{ value: 'high', label: '高' }, { value: 'low', label: '低' }], () => {
      const r = this.deps.getRenderer();
      return r.quality || 'high';
    }, (v) => {
      const r = this.deps.getRenderer();
      r.quality = v;
    });
    this._check(g.rows, '伤害数字', () => {
      const ww = this.deps.getWorld();
      return ww ? ww.showDamageNumbers !== false : true;
    }, (v) => {
      const ww = this.deps.getWorld();
      if (ww) ww.showDamageNumbers = v;
    });
    return g;
  }

  // ---------------- F. 诊断 ----------------

  groupDiag() {
    const g = this._group('诊断（只读）');
    const mk = (label) => {
      const out = document.createElement('span');
      out.className = 'dt-read dt-diag';
      this._row(g.rows, label, out);
      return (fn) => this.refreshers.push(() => {
        out.textContent = fn();
      });
    };
    const setFps = mk('FPS');
    const setEnt = mk('实体：敌/我弹/敌弹');
    const setPools = mk('池使用率');
    const setTier = mk('难度档 / 计时');
    const setSeed = mk('种子');
    const setBuild = mk('配装 / 血统');

    this.refreshers.push(() => {
      const r = this.deps.getRenderer();
      const ww = this.deps.getWorld();
      setFps(() => (r.fps ? r.fps.toFixed(0) : '—'));
      setEnt(() => (ww ? `${ww.enemies.active.length} / ${ww.playerBullets.length} / ${ww.enemyBullets.length}` : '—'));
      setPools(() => {
        if (!ww) return '—';
        const parts = [];
        for (const [name, pool, cap] of [
          ['敌', ww.enemies, CAP_ENEMIES],
          ['我弹', ww.playerBullets, CAP_PLAYER_BULLETS],
          ['敌弹', ww.enemyBullets, CAP_ENEMY_BULLETS],
          ['掉落', ww.drops, CAP_DROPS],
          ['粒子', ww.particles, CAP_PARTICLES],
          ['随从', ww.minions, CAP_MINIONS],
        ]) {
          if (!pool) continue;
          const cap2 = pool.cap || cap;
          parts.push(`${name} ${Math.round((pool.active.length / Math.max(1, cap2)) * 100)}%`);
        }
        return parts.join(' · ');
      });
      setTier(() => {
        if (!ww) return '—';
        const forced = this.state.tier >= 0 ? `（手调 ${this.state.tier}）` : '';
        return `tier ${ww.spawner.lastTier}${forced} / ${(ww.elapsedMs / 1000).toFixed(0)}s`;
      });
      setSeed(() => (ww ? String(ww.seed) : '—'));
      setBuild(() => {
        if (!ww) return '—';
        const wnames = ww.slots.weapons.map((s) => `${(WEAPON_BY_ID[s.id] || {}).cn || s.id}:${s.level}`).join(' ');
        const pnames = ww.slots.passives.map((p) => (PASSIVE_BY_ID[p] || {}).cn || p).join(' ');
        return `${wnames} | ${pnames} | fused=${ww.fusedWeapon || '无'} skill=${ww.activeSkillUnlocked || '无'}`;
      });
    });
    return g;
  }

  // ---------------- 预设 ----------------

  /** 当前局的"本系"：优先合体/角色所在系 */
  currentSeries(world) {
    const ch = world && CHARACTER_BY_ID[world.characterId];
    if (world && world.fusedWeapon) {
      const u = ULTIMATE_FUSIONS.find((x) => x.id === world.fusedWeapon);
      if (u) return u.series;
    }
    if (world && world.slots.weapons[0]) {
      const s = seriessOfWeapon(world.slots.weapons[0].id);
      if (s) return s;
    }
    return (ch && ch.series) || 'shan';
  }

  /** 一键满级本系配装：该系 4 把武器满级 + 该系 4 件被动（角色修正不动） */
  presetFullLoadout(seriesId) {
    const world = this.deps.getWorld();
    if (!world) return false;
    const sid = seriesId || this.currentSeries(world);
    const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
    const weapons = WEAPONS.filter((x) => x.series === sid && !x.locked).slice(0, SLOT_WEAPONS);
    world.fusedWeapon = null;
    world.slots.weapons = weapons.map((x) => {
      const f = FUSIONS.find((y) => y.weapon === x.id);
      return { id: x.id, level: WEAPON_MAX_LEVEL, cd: 0, superId: f ? f.id : null };
    });
    world.slots.passives = u ? u.passives.slice(0, SLOT_PASSIVES) : [];
    world.passiveLevels = {};
    for (const p of world.slots.passives) world.passiveLevels[p] = PASSIVE_MAX_LEVEL;
    world.recompute();
    world.refreshWeaponEntities();
    world.initUltimateState();
    this.note(`已置入 ${sid} 系满级配装：${weapons.map((x) => x.cn).join(' / ')}`);
    this.refresh();
    return true;
  }

  /** 解锁该系主动技（合体的硬前置） */
  presetUnlockSkill(seriesId) {
    const world = this.deps.getWorld();
    if (!world) return false;
    const sid = seriesId || this.currentSeries(world);
    const skill = activeSkillFor(sid);
    if (!skill) return false;
    world.activeSkillUnlocked = skill.id;
    world.recompute();
    this.note(`已解锁主动技：${skill.cn}（${skill.id}）`);
    this.refresh();
    return true;
  }

  /**
   * 一键合体：**自动补齐全部前置**（4 把满级 + 4 件指定被动 + 主动技已解锁）。
   * 规格 §4 明确要求"不能只改一半"——按了没反应比没有这个按钮更糟。
   */
  presetFuse(seriesId) {
    const world = this.deps.getWorld();
    if (!world) return false;
    const sid = seriesId || this.currentSeries(world);
    const u = ULTIMATE_FUSIONS.find((x) => x.series === sid);
    if (!u) return false;
    this.presetFullLoadout(sid);
    const skill = activeSkillFor(sid);
    world.activeSkillUnlocked = skill ? skill.id : null;
    world.recompute();
    world.checkFusions();
    const ok = world.fusedWeapon === u.id;
    if (!ok) {
      // 前置仍不满足时，直接置入终极武器本身（面板是调试工具，不做"静默失败"）
      world.fusedWeapon = u.id;
      world.slots.weapons = [{ id: u.weaponId, level: WEAPON_MAX_LEVEL, cd: 0, superId: null }];
      world.recompute();
      world.refreshWeaponEntities();
      world.initUltimateState();
    }
    this.note(ok ? `已合体：${u.cn || u.id}` : `已强制置入终极武器 ${u.id}（合体判定未通过，已直接赋值）`);
    this.refresh();
    return true;
  }

  /** 两次精英之间的间隔（毫秒）。tune.elite 越大间隔越短；0 = 关掉精英。 */
  eliteIntervalMs() {
    const mul = Number.isFinite(this.state.elite) ? this.state.elite : 1;
    if (mul <= 0) return Infinity;
    const base = (RUN_T.eliteTimes && RUN_T.eliteTimes[1]) || 120;
    return base * 1000 / mul;
  }

  /**
   * 跳到指定局内时间：设时间 → 重算档位 → 补一波怪 → 重置刷怪计时（规格 §4 硬要求）。
   * **不追溯补发已经过去的精英**：跳过去是去看后期，不是去看一串精英同时扑上来。
   */
  presetJumpTo(ms) {
    const world = this.deps.getWorld();
    if (!world) return false;
    const target = Math.max(0, Math.min(ms, 3600 * 1000));
    // 时间与 tick 必须一起设：world.step() 里 `elapsedMs = tick × TICK_MS`，
    // 只改一个的话下一帧就会被另一个顶回去（"面板跳到 9 分钟、下一帧弹回 0 秒"）。
    world.tick = Math.round(target / TICK_MS);
    world.elapsedMs = world.tick * TICK_MS;
    if (this.state.tier >= 0) world.tune.tier = this.state.tier;
    world.spawner.acc = 0;
    world.spawner.waveIndex = Math.floor(target / 30000);
    world.spawner.eliteIdx = 0;
    world.pendingWaveStart = -1;
    // 目标档位：面板手调优先，否则按时间算
    const tier = this.state.tier >= 0 ? this.state.tier : Math.floor(target / (TIER_PERIOD * 1000));
    world.spawner.lastTier = tier;
    // 按目标档位补一波满场怪（不补的话就是"时间是后期、场上是空的"假状态）
    const n = 24;
    const w = world;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 260 + (i % 5) * 40;
      const kind = this.pickFillKind();
      const e = w.spawnEnemyFrom({
        kind, tier,
        x: Math.max(30, Math.min(ARENA_W - 30, w.player.x + Math.cos(a) * r)),
        y: Math.max(30, Math.min(ARENA_H - 30, w.player.y + Math.sin(a) * r)),
      });
      if (!e) break;
    }
    this.state.t = target;
    // Boss 状态最后设：此刻已经不在 step 里，bossSpawned 不会被刷怪日程覆盖
    const pastBoss = target >= RUN_T.bossAt * 1000;
    world.spawner.bossSpawned = pastBoss;
    world.spawner.warnFired = target >= RUN_T.warnAt * 1000;
    world.bossActive = pastBoss;
    this.note(`已跳到 ${(target / 1000).toFixed(0)}s，档位 ${tier}，补了 ${world.enemies.active.length} 只怪`);
    this.refresh();
    return true;
  }

  pickFillKind() {
    const st = this.state;
    const usable = ENEMY_IDS.filter((id) => st.perEnemy[id].on && st.perEnemy[id].count > 0);
    const pool = usable.length ? usable : ['shanxiao'];
    return pool[Math.floor(pool.length / 2)] || 'shanxiao';
  }

  /** 立即召唤 Boss */
  presetBoss() {
    const world = this.deps.getWorld();
    if (!world) return false;
    world.spawner.bossSpawned = true;
    world.spawner.warnFired = true;
    world.bossActive = true;
    const tier = this.state.tier >= 0 ? this.state.tier : world.spawner.lastTier;
    world.spawnEnemyFrom({ kind: 'boss', boss: true, x: world.player.x, y: world.player.y - 220, tier });
    this.note('已召唤 Boss');
    this.refresh();
    return true;
  }

  restartWithSeed(seed) {
    const ctl = this.deps.getController();
    const world = this.deps.getWorld();
    const charId = world ? world.characterId : 'shanpo';
    if (typeof ctl.startRunWithSeed === 'function') {
      ctl.startRunWithSeed(charId, seed >>> 0);
      this.note(`已用种子 ${seed >>> 0} 重开`);
      this.refresh();
      return true;
    }
    this.note('当前构建不支持指定种子重开');
    return false;
  }

  // ---------------- 配置串 ----------------

  syncStateFromWorld() {
    const world = this.deps.getWorld();
    if (!world) return;
    this.state.seed = world.seed >>> 0;
    this.state.t = world.elapsedMs;
    this.state.weapons = world.slots.weapons.map((s) => ({ id: s.id, level: s.level }));
    this.state.passives = world.slots.passives.slice();
    this.state.dmgMul = world.damageMul || 1;
    this.state.speedMul = world.speedMul || 1;
    this.state.inv = !!world.invincible;
    this.state.enemyHp = world.tune ? world.tune.enemyHp : 1;
    this.state.enemySpd = world.tune ? world.tune.enemySpd : 1;
    this.state.spawn = world.tune ? world.tune.spawn : 1;
    this.state.elite = world.tune ? world.tune.elite : 1;
    this.state.tier = world.tune ? world.tune.tier : -1;
    this.state.xp = world.xpMul || 1;
    this.state.drop = world.dropMul || 1;
    const st = this.state;
    for (const id of ENEMY_IDS) {
      const live = world.tune && world.tune.enemies && world.tune.enemies[id];
      st.perEnemy[id] = {
        on: live ? live.on !== false : st.perEnemy[id].on,
        from: live && live.from !== undefined && live.from !== null ? live.from : st.perEnemy[id].from,
        weight: live && live.weight !== undefined ? live.weight : st.perEnemy[id].weight,
        count: live && live.count !== undefined ? live.count : st.perEnemy[id].count,
      };
    }
  }

  exportUrl() {
    this.syncStateFromWorld();
    const str = serializeTune(this.state);
    const loc = typeof location !== 'undefined' ? location : { origin: '', pathname: '' };
    const base = `${loc.origin}${loc.pathname}`;
    return `${base}?dev=tune&tune=${encodeURIComponent(str)}`;
  }

  copyExport() {
    const url = this.exportUrl();
    copyText(url).then(
      (ok) => this.note(ok ? 'URL 已复制（配置串可分享）' : `复制失败，手抄：${url}`),
      () => this.note(`复制失败，手抄：${url}`),
    );
    return url;
  }

  exportRunState() {
    const world = this.deps.getWorld();
    if (!world) return '';
    return JSON.stringify(world.toSnapshot());
  }

  copyRunState() {
    const json = this.exportRunState();
    if (!json) {
      this.note('当前没有进行中的一局');
      return '';
    }
    copyText(json).then(
      (ok) => this.note(ok ? '局状态 JSON 已复制' : '复制失败（见控制台）'),
      () => this.note('复制失败（见控制台）'),
    );
    if (typeof console !== 'undefined') console.log('[调参面板] 局状态 JSON：', json);
    return json;
  }

  promptImport() {
    const raw = window.prompt('粘贴配置串或整条 URL：', '');
    if (raw === null) return false;
    return this.importString(raw);
  }

  importString(raw) {
    const text = String(raw).trim();
    const str = text.includes('tune=') ? decodeURIComponent(text.split('tune=')[1].split('&')[0]) : text;
    const parsed = parseTune(str);
    if (!parsed.ok) {
      this.note(`导入被拒绝：${parsed.error}`);
      return false;
    }
    this.state = { ...this.state, ...parsed.state, perEnemy: { ...this.state.perEnemy, ...parsed.state.perEnemy } };
    this.applyState();
    this.buildControls(document.getElementById('dt-groups'));
    this.note(`已导入配置（${parsed.state.v}）`);
    return true;
  }

  /** 把 state 落到当前局（不改存档） */
  applyState() {
    const world = this.deps.getWorld();
    const st = this.state;
    if (!world) return false;
    world.damageMul = st.dmgMul;
    world.speedMul = st.speedMul;
    world.invincible = !!st.inv;
    world.xpMul = st.xp;
    world.dropMul = st.drop;
    world.tune.enemies = {};
    for (const id of ENEMY_IDS) {
      world.tune.enemies[id] = { ...st.perEnemy[id] };
    }
    world.tune.enemyHp = st.enemyHp;
    world.tune.enemySpd = st.enemySpd;
    world.tune.spawn = st.spawn;
    world.tune.elite = st.elite;
    world.tune.tier = st.tier;
    return true;
  }

  note(msg) {
    if (this.noteEl) this.noteEl.textContent = msg;
  }

  refresh() {
    for (const fn of this.refreshers) {
      try {
        fn();
      } catch {
        /* 面板永远不能把主循环带崩 */
      }
    }
    if (this._built) this._placeDot();
  }

  _startTicker() {
    if (this._raf) return;
    const tick = () => {
      if (this.open) this.refresh();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  bindKeys() {
    window.addEventListener('resize', () => this.applyLayout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.applyLayout(), 220));
  }
}

// ---------------- 小工具 ----------------

function labelEl(text) {
  const l = document.createElement('span');
  l.className = 'dt-label';
  l.textContent = text;
  return l;
}

function formatNum(v) {
  if (!Number.isFinite(v)) return '—';
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2);
}

function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => false);
    }
  } catch {
    /* 老内核没有 clipboard：退化成提示手抄 */
  }
  return Promise.resolve(false);
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
.dt-root{position:absolute;pointer-events:none;z-index:60}
.dt-root.dt-collapsed .dt-body{display:none}
.dt-dot{position:absolute;width:48px;height:48px;border-radius:50%;border:1px solid #4a4560;
  background:rgba(20,18,28,.82);color:#f0b357;font-size:22px;line-height:1;pointer-events:auto;
  touch-action:none;cursor:grab;padding:0}
.dt-body{position:absolute;left:420px;top:4px;width:400px;max-height:316px;display:flex;flex-direction:column;
  pointer-events:auto;background:rgba(12,11,18,.86);border:1px solid #3a3550;border-radius:10px;
  color:#e8e6f0;font:15px/1.35 "Microsoft YaHei",system-ui,sans-serif;backdrop-filter:blur(2px)}
.dt-head{display:flex;align-items:center;gap:10px;padding:6px 10px;border-bottom:1px solid #2a2640}
.dt-head b{color:#f0b357;font-size:16px}
.dt-ver{color:#8b87a0;font-size:12px}
.dt-x{margin-left:auto;width:40px;height:34px;border-radius:6px;border:1px solid #4a4560;
  background:#1b1826;color:#e8e6f0;font-size:16px}
.dt-groups{display:flex;gap:8px;padding:8px 10px;overflow:auto}
.dt-group{flex:0 0 210px;min-width:210px;background:rgba(28,25,40,.6);border:1px solid #2f2a44;border-radius:8px;padding:6px 8px}
.dt-group h3{margin:2px 0 6px;font-size:13px;color:#f0b357;letter-spacing:.5px}
.dt-rows{display:flex;flex-direction:column;gap:6px}
.dt-row{display:flex;align-items:center;gap:6px;min-height:34px}
.dt-label{color:#a9a4c0;font-size:12px;min-width:58px;flex:0 0 auto}
.dt-read{color:#7fe3b0;font-size:12px;min-width:34px}
.dt-diag{color:#cfe9ff;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dt-btn{min-height:34px;min-width:44px;padding:0 10px;border-radius:6px;border:1px solid #4a4560;
  background:#221f30;color:#e8e6f0;font-size:13px}
.dt-btn:active,.dt-btn.on{background:#f0b357;color:#1a1620;border-color:#f0b357}
/* HUD 上的 ⚙ 键属于 ui/styles.css（它在 index.html 里就加载了）；
   这条是"万一样式表没生效"时的自包含兜底，保持按键在任何情况下都看得见、点得到 */
.hud-tune{pointer-events:auto;position:absolute;top:calc(8px + env(safe-area-inset-top, 0px));
  right:calc(68px + env(safe-area-inset-right, 0px));width:48px;min-height:44px;padding:0;
  font-size:18px;line-height:1;border-radius:6px;background:rgba(0,0,0,.45);
  border:1px solid rgba(255,255,255,.12);color:#f0b357}
.hud-tune.on{background:#f0b357;color:#1a1620}
.dt-btnrow{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.dt-scale{min-width:52px}
.dt-slide{flex:1 1 auto}
.dt-slide input[type=range]{width:100%;height:34px}
.dt-sel{flex:1 1 auto;min-height:34px;background:#221f30;color:#e8e6f0;border:1px solid #4a4560;border-radius:6px;font-size:12px}
.dt-check{width:26px;height:26px}
.dt-num{width:74px;min-height:34px;background:#221f30;color:#e8e6f0;border:1px solid #4a4560;border-radius:6px;font-size:13px;padding:0 6px}
.dt-inline{display:flex;align-items:center;gap:6px;flex:1 1 auto}
.dt-slotline{display:flex;align-items:center;gap:6px}
.dt-slotline .dt-sel{min-width:70px}
.dt-foot{display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid #2a2640}
.dt-note{color:#f0b357;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
  document.head.appendChild(s);
}
