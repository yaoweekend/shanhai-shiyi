// UI 层（DOM 覆盖层）。渲染层负责画布内的 HUD，这里负责所有屏幕。
// 上架硬门槛（规格 §15）：隐私政策页、关于/许可页、启动自检提示页——三件都在这里。

import { CHARACTERS, BATCH1_CHARACTERS, CHARACTER_BY_ID } from '../content/characters.js';
import { BATCH1_WEAPONS, WEAPON_BY_ID, levelStats, WEAPON_KIND_CN } from '../content/weapons.js';
import { BATCH1_PASSIVES, PASSIVE_BY_ID } from '../content/passives.js';
import { FUSIONS, FUSION_BY_ID } from '../content/fusions.js';
import { SERIES } from '../content/series.js';
import { CHANNEL_BY_ID, formatChannelBonus } from '../core/channels.js';
import { HOOK_LIST } from '../core/hooks.js';
import { TRIALS, trialProgress, isTrialDone, codexBySeries } from '../meta/meta.js';
import { SLOTS, slotById } from '../assets/manifest.js';
import { placeholderStats, getPlaceholder, getAsset, passiveIconSlot } from '../assets/generator.js';
import { VERSION, SLOT_WEAPONS, SLOT_PASSIVES, WEAPON_MAX_LEVEL, PASSIVE_MAX_LEVEL, PLAYER_BASE, CAP_ENEMIES, CAP_PLAYER_BULLETS } from '../config.js';
import { guessEnvironment } from './webview-check.js';

const $ = (id) => document.getElementById(id);

/** 数值卡加成的显示（比率通道按百分比，加法通道按点数） */
function fmtStatValue(channel, value) {
  const c = CHANNEL_BY_ID[channel];
  const pct = c && (c.op === 'mul' || c.op === 'addBase' || c.op === 'cap');
  return pct ? `${Math.round(value * 100)}%` : `${Number.isInteger(value) ? value : value.toFixed(1)}`;
}

/**
 * 通道类卡片（被动升级 / 数值兜底）的"变化"行。
 * 不能复用 deltaList：那套只认武器等级表里的键（damage/cd/radius…），
 * 通道卡会整片落进"数值不变"的兜底分支（真实踩过）。
 */
function channelDeltaLine(pid_or_channel, before, after, cnOverride) {
  const c = CHANNEL_BY_ID[pid_or_channel];
  const cn = cnOverride || (c ? c.cn : pid_or_channel);
  return `<ul class="delta"><li>${cn} ${fmtStatValue(pid_or_channel, before)} → <b>${fmtStatValue(
    pid_or_channel,
    after,
  )}</b></li></ul>`;
}

export class UI {
  /**
   * @param {object} ctl 控制器（由 main.js 提供）
   *   { getSave, persist, getSettings, setSettings, audio, startRun, resumeRun,
   *     takeCard, saveAndQuit, quitRun, restart, toMenu, openEndless, hasUnfinished }
   */
  constructor(ctl) {
    this.ctl = ctl;
    this.currentCardChoices = [];
    this.selectedChar = null;
    this.screens = ['menu', 'hud', 'pause', 'levelup', 'result', 'trials', 'codex', 'settings', 'about', 'privacy'];
    this.bindGlobal();
  }

  el(name) {
    return $(`screen-${name}`);
  }

  hideAll() {
    for (const s of this.screens) {
      const el = this.el(s);
      if (el) el.hidden = true;
    }
  }

  show(name) {
    this.hideAll();
    const el = this.el(name);
    if (el) el.hidden = false;
    this.active = name;
  }

  showOverlay(name) {
    const el = this.el(name);
    if (el) el.hidden = false;
    this.active = name;
  }

  bindGlobal() {
    const back = (e) => {
      e.preventDefault();
      this.ctl.audio.play('ui');
      this.renderMenu();
      this.show('menu');
    };
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

    $('btn-start').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.startRun(this.selectedChar || (this.ctl.getSave().unlocks.characters[0] || 'shanpo'));
    });
    $('btn-continue').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.resumeRun();
    });
    $('btn-endless').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.openEndless(this.selectedChar || (this.ctl.getSave().unlocks.characters[0] || 'shanpo'));
    });
    $('btn-trials').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.renderTrials();
      this.show('trials');
    });
    $('btn-codex').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.renderCodex();
      this.show('codex');
    });
    $('btn-settings').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.renderSettings();
      this.show('settings');
    });
    $('btn-about').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.renderAbout();
      this.show('about');
    });
    $('btn-pause').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.pause();
      this.renderPause(this.ctl.world());
      this.show('pause');
    });
    $('btn-resume').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.show('hud');
      this.ctl.resume();
    });
    $('btn-savequit').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      const ok = this.ctl.saveAndQuit();
      this.renderMenu();
      this.show('menu');
      if (!ok) this.toast('保存失败（本机存储不可用），本局已放弃。');
    });
    $('btn-quit').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.quitRun();
      this.renderMenu();
      this.show('menu');
    });
    $('btn-refresh').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.refreshCards();
    });
    $('btn-again').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.restart();
    });
    $('btn-endless2').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.continueEndless();
    });
    $('btn-tomenu').addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.renderMenu();
      this.show('menu');
    });
    $('btn-wipe').addEventListener('click', () => {
      if (window.confirm('清空本机全部进度（最高分 / 图鉴 / 试炼 / 解锁）。确定吗？')) {
        this.ctl.wipe();
        this.renderSettings();
        this.renderMenu();
      }
    });
  }

  // ---------------- 主菜单 ----------------

  renderMenu() {
    const save = this.ctl.getSave();
    const chars = CHARACTERS.filter((c) => save.unlocks.characters.includes(c.id));
    if (!this.selectedChar || !save.unlocks.characters.includes(this.selectedChar)) {
      this.selectedChar = chars[0] ? chars[0].id : 'shanpo';
    }
    const list = $('char-list');
    list.innerHTML = '';
    for (const c of chars) {
      const ser = SERIES[c.series];
      const w = WEAPON_BY_ID[c.weapon];
      const p = PASSIVE_BY_ID[c.passive];
      const div = document.createElement('button');
      div.className = 'char-card' + (c.id === this.selectedChar ? ' selected' : '');
      div.style.setProperty('--series', ser.color);
      div.style.setProperty('--accent', ser.accent);
      div.innerHTML = `
        <div class="char-head"><span class="dot"></span><b>${c.cn}</b><span class="series-tag">${ser.cn}</span></div>
        <div class="char-weapon">初始武器：${w ? w.cn : c.weapon}</div>
        <div class="char-passive">自带被动：${p ? p.cn : c.passive}</div>
        <div class="char-mods">${modsText(c)}</div>
        <div class="char-blurb">${c.blurb || ''}</div>`;
      div.addEventListener('click', () => {
        this.ctl.audio.play('ui');
        this.selectedChar = c.id;
        this.renderMenu();
      });
      list.appendChild(div);
    }

    const hs = save.highScore;
    $('highscore').innerHTML = hs.kills
      ? `<div>最高击杀 <b>${hs.kills}</b>　最长存活 <b>${fmtTime(hs.timeMs)}</b>　最高等级 <b>Lv${hs.level}</b>${hs.won ? '　<span class="won">已通关</span>' : ''}</div>
         <div class="muted small">累计击杀 ${save.counters.killsTotal}　通关次数 ${save.counters.winsTotal}</div>`
      : '<div class="muted">还没有记录。第一局只要活过 30 秒就会写进来。</div>';

    $('btn-continue').hidden = !this.ctl.hasUnfinished();
    $('btn-endless').hidden = !hs.won;
  }

  // ---------------- 暂停：本局已获得道具 ----------------

  /** 暂停界面：把本局已拿到的武器/被动、以及血统配方的达成情况摊开 */
  renderPause(world) {
    const box = $('pause-loadout');
    if (!box) return;
    if (!world) {
      box.innerHTML = '';
      return;
    }
    const weaponItems = world.slots.weapons
      .map((w) => {
        const def = WEAPON_BY_ID[w.id];
        const sup = w.superId ? FUSION_BY_ID[w.superId] : null;
        const ser = SERIES[(def && def.series) || 'shan'];
        const name = sup ? `${sup.cn}` : def ? def.cn : w.id;
        const sub = sup ? `${def ? def.cn : ''} Lv${w.level}` : `Lv${w.level}`;
        return `<span class="loadout-item${sup ? ' is-super' : ''}" style="--series:${ser.color}">
          <img alt="" src="${iconDataUrl(sup ? 'icon_super' : 'icon_' + w.id)}">
          <span class="nm">${name}</span><span class="lv">${sub}</span></span>`;
      })
      .join('');
    const weaponEmpty = Array.from({ length: Math.max(0, SLOT_WEAPONS - world.slots.weapons.length) }, () => '<span class="loadout-slot-empty"></span>').join('');

    const passiveItems = world.slots.passives
      .map((pid) => {
        const p = PASSIVE_BY_ID[pid];
        const ser = SERIES[(p && p.series) || 'shan'];
        const lv = (world.passiveLevels && world.passiveLevels[pid]) || 1;
        return `<span class="loadout-item" style="--series:${ser.color}">
          <img alt="" src="${iconDataUrl(passiveIconSlot(pid))}">
          <span class="nm">${p ? p.cn : pid}</span><span class="lv">Lv${lv}${lv >= PASSIVE_MAX_LEVEL ? ' 满' : ''}</span></span>`;
      })
      .join('');
    const passiveEmpty = Array.from({ length: Math.max(0, SLOT_PASSIVES - world.slots.passives.length) }, () => '<span class="loadout-slot-empty"></span>').join('');

    // 血统配方进度：只有"本系武器"的配方才可能达成
    const rows = [];
    for (const f of FUSIONS) {
      const slot = world.slots.weapons.find((w) => w.id === f.weapon);
      if (!slot) continue;
      const hasPassive = world.slots.passives.includes(f.passive);
      const wDef = WEAPON_BY_ID[f.weapon];
      const maxed = slot.level >= WEAPON_MAX_LEVEL;
      let text;
      if (slot.superId === f.id) text = `<b>${f.cn}</b> 已觉醒`;
      else if (maxed && hasPassive) text = `<b>${f.cn}</b> 条件已满足（即将觉醒）`;
      else text = `<b>${f.cn}</b> = ${wDef ? wDef.cn : f.weapon} 满级（${slot.level}/${WEAPON_MAX_LEVEL}） + ${passiveName(f.passive)}${hasPassive ? '（已有）' : ''}`;
      rows.push(`<div class="fusion-line${maxed && hasPassive ? ' ready' : ''}">${text}</div>`);
    }
    // 还没拿到的武器也能看到它的配方（告诉你下一步该攒什么）
    const notOwned = FUSIONS.filter((f) => !world.slots.weapons.some((w) => w.id === f.weapon));
    const hint = notOwned.length
      ? `<div class="muted-line">未持有的武器还可凑：${notOwned.slice(0, 3).map((f) => `${weaponName(f.weapon)} 满级 + ${passiveName(f.passive)} → ${f.cn}`).join('；')}</div>`
      : '';

    box.innerHTML = `
      <section class="loadout-sec">
        <h3>武器 <span class="count">${world.slots.weapons.length} / ${SLOT_WEAPONS}</span></h3>
        <div class="loadout-list">${weaponItems}${weaponEmpty}</div>
      </section>
      <section class="loadout-sec">
        <h3>被动 <span class="count">${world.slots.passives.length} / ${SLOT_PASSIVES}</span></h3>
        <div class="loadout-list">${passiveItems}${passiveEmpty}</div>
      </section>
      <section class="loadout-sec">
        <h3>血统配方</h3>
        ${rows.join('') || '<div class="muted-line">本局还没有可凑的配方</div>'}
        ${hint}
      </section>
      <div class="muted-line">存活 ${fmtTime(world.elapsedMs)}　等级 Lv${world.player.level}　击杀 ${world.runStats.kills}　难度档 ${world.runStats.maxTier + 1}</div>`;
  }

  // ---------------- 升级三选一 ----------------

  renderLevelUp(world) {
    this.currentCardChoices = world.cardChoices.slice();
    $('levelup-sub').textContent = `等级 ${world.player.level}　剩余待选 ${world.pendingLevelUps}`;
    // 同一轮里不会有两张相同的卡（不放回抽样），所以"能给的都拿完"时可能只有 1~2 张；
    // 这句说明文案跟着实际张数走，不要嘴上说"三张"而画面里只有两张。
    const hintEl = $('levelup-hint');
    if (hintEl) {
      hintEl.textContent =
        this.currentCardChoices.length >= 3
          ? '三张里选一张。刷新每局只有一次，不能跳过。'
          : `能给的都在这儿了（${this.currentCardChoices.length} 张），不能跳过。`;
    }
    // 刷新按钮：跟着剩余次数走。用完了就禁用（而不是藏起来，让玩家知道这机制存在过）。
    const btn = $('btn-refresh');
    if (btn) {
      const left = world.refreshesLeft === undefined ? 0 : world.refreshesLeft;
      btn.textContent = left > 0 ? `刷新（剩 ${left} 次）` : '刷新（已用完）';
      btn.disabled = left <= 0;
    }
    const box = $('cards');
    box.innerHTML = '';
    for (let i = 0; i < this.currentCardChoices.length; i++) {
      const card = this.currentCardChoices[i];
      box.appendChild(this.cardEl(card, i, world));
    }
    if (this.renderLevelUpExtras) this.renderLevelUpExtras(world);
    this.showOverlay('levelup');
  }

  /**
   * 判断这张卡能不能"凑成血统配方"。
   * 两种情况：
   *  · 被动卡 → 若某把已持有武器已满级，且它的配方被动正是这张 → 直接触发
   *  · 武器升级卡 → 若这次升级刚好到满级，且配方被动已持有 → 直接触发
   * @returns {{kind:'now'|'missing', names:string[]}|null}
   */
  fuseOutlook(world, card) {
    if (!world) return null;
    const names = [];
    let missing = false;
    if (card.type === 'passive') {
      for (const f of FUSIONS) {
        if (f.passive !== card.passiveId) continue;
        const slot = world.slots.weapons.find((w) => w.id === f.weapon);
        if (!slot || slot.superId) continue;
        if (slot.level >= WEAPON_MAX_LEVEL) names.push(f.cn);
        else missing = true;
      }
    } else if (card.type === 'weapon-up') {
      const slot = world.slots.weapons.find((w) => w.id === card.weaponId);
      if (!slot) return null;
      const willMax = (card.level || slot.level + 1) >= WEAPON_MAX_LEVEL;
      for (const f of FUSIONS) {
        if (f.weapon !== card.weaponId) continue;
        if (slot.superId) continue;
        if (willMax && world.slots.passives.includes(f.passive)) names.push(f.cn);
        else if (willMax) missing = true;
      }
    } else if (card.type === 'weapon-new') {
      // 新武器本身不触发配方，但可以提示它"值得凑"
      const f = FUSIONS.find((x) => x.weapon === card.weaponId);
      if (f) return { kind: 'missing', names: [], hint: `满级 + ${passiveName(f.passive)} → ${f.cn}` };
      return null;
    }
    if (names.length) return { kind: 'now', names };
    if (missing) return { kind: 'missing', names: [] };
    return null;
  }

  cardEl(card, idx, world) {
    const div = document.createElement('div');
    div.className = 'card';
    const outlook = this.fuseOutlook(world, card);
    let title = '';
    let sub = '';
    let body = '';
    let series = 'shan';
    // 兜底：通用被动图标。具体道具都会在下面各自的分支里覆盖成自己的图标，
    // 只有"数值类兜底卡"这种本来就没有专属图的才留在这里（刻意的回退）。
    let icon = 'icon_passive';
    if (card.type === 'weapon-new' || card.type === 'weapon-up') {
      const w = WEAPON_BY_ID[card.weaponId];
      if (!w) return div;
      series = w.series;
      icon = 'icon_' + w.id;
      title = w.cn;
      const lv = card.type === 'weapon-up' ? card.level : 1;
      sub = `${SERIES[w.series].cn} · ${WEAPON_KIND_CN[w.kind] || '武器'} · Lv${lv}`;
      const cur = card.type === 'weapon-up' ? levelStats(w, card.level) : levelStats(w, 1);
      const prev = card.type === 'weapon-up' ? levelStats(w, card.level - 1) : null;
      body = `<p class="card-desc">${w.blurb || ''}</p>`;
      if (prev) {
        body += `<ul class="delta">${deltaList(prev, cur)}</ul>`;
      } else {
        body += `<ul class="delta"><li>伤害 ${Math.round(cur.damage)}</li><li>冷却 ${cur.cd}s</li></ul>`;
      }
      const f = FUSIONS.find((x) => x.weapon === w.id);
      if (f) body += `<p class="fusion-hint">血统：满级 + ${passiveName(f.passive)} → <b>${f.cn}</b></p>`;
    } else if (card.type === 'passive') {
      const p = PASSIVE_BY_ID[card.passiveId];
      if (!p) return div;
      series = p.series;
      icon = passiveIconSlot(p.id);
      title = p.cn;
      sub = `${SERIES[p.series].cn} · 被动 · Lv1`;
      body = `<p class="card-desc">${p.desc}</p><p class="muted small">修改通道：${CHANNEL_BY_ID[p.channel] ? CHANNEL_BY_ID[p.channel].cn : p.channel}（可继续升级）</p>`;
      const f = FUSIONS.find((x) => x.passive === p.id);
      if (f) body += `<p class="fusion-hint">血统：${weaponName(f.weapon)} 满级 + 本件 → <b>${f.cn}</b></p>`;
    } else if (card.type === 'passive-up') {
      const p = PASSIVE_BY_ID[card.passiveId];
      if (!p) return div;
      const lv = card.level || 2;
      series = p.series;
      icon = passiveIconSlot(p.id);
      title = p.cn;
      sub = `${SERIES[p.series].cn} · 被动 · Lv${lv} / ${PASSIVE_MAX_LEVEL}`;
      const step = PLAYER_BASE.passiveLevelStep || 0.6;
      const before = p.value * (1 + (lv - 2) * step);
      const after = p.value * (1 + (lv - 1) * step);
      body = `<p class="card-desc">${p.desc}</p>${channelDeltaLine(p.channel, before, after)}`;
    } else if (card.type === 'stat') {
      series = 'huang';
      // 数值类兜底卡没有专属图，用通用被动图标（刻意的回退分支）
      icon = 'icon_passive';
      title = card.cn;
      sub = '通用强化 · 已全部升满';
      body = `<p class="card-desc">所有武器与被动都已满级，升级转为永久数值强化。</p>${channelDeltaLine(
        card.channel,
        0,
        card.value,
        card.cn,
      )}`;
    } else {
      title = '无可用提升';
      sub = '内容已全部拿完';
      body = '<p class="card-desc">武器全满级、槽位全满。本次升级作废，继续打下去。</p>';
    }
    div.style.setProperty('--series', SERIES[series].color);
    div.style.setProperty('--accent', SERIES[series].accent);
    if (outlook && outlook.kind === 'now') div.classList.add('can-fuse');
    const badge =
      outlook && outlook.kind === 'now'
        ? `<div class="card-fuse-badge">选它 → 立刻觉醒 ${outlook.names.join('、')}</div>`
        : outlook && outlook.kind === 'missing'
          ? `<div class="card-fuse-badge" style="background:rgba(240,179,87,0.25);color:#ffe08a">${outlook.hint ? outlook.hint : '离觉醒更近一步'}</div>`
          : '';
    div.innerHTML = `
      <div class="card-top">
        <span class="series-tag">${SERIES[series].cn}</span>
        <span class="card-idx">${idx + 1}</span>
      </div>
      <div class="card-icon"><img alt="" src="${iconDataUrl(icon)}"></div>
      <h3>${title}</h3>
      <div class="card-sub">${sub}</div>
      ${badge}
      <div class="card-body">${body}</div>`;
    div.addEventListener('click', () => {
      this.ctl.audio.play('ui');
      this.ctl.takeCard(card);
    });
    return div;
  }

  hideLevelUp() {
    const el = this.el('levelup');
    if (el) el.hidden = true;
  }

  // ---------------- 结算 ----------------

  renderResult(world, extra = {}) {
    const r = world.finish();
    const won = r.outcome === 'win';
    $('result-title').textContent = won ? '通关' : '这一局结束了';
    const slots = world.slots.weapons
      .map((w) => {
        const def = WEAPON_BY_ID[w.id];
        const sup = w.superId ? FUSION_BY_ID[w.superId] : null;
        return `<li>${def ? def.cn : w.id} Lv${w.level}${sup ? ` → <b class="super">${sup.cn}</b>` : ''}</li>`;
      })
      .join('');
    const passives = world.slots.passives
      .map((pid) => {
        const lv = (world.passiveLevels && world.passiveLevels[pid]) || 1;
        return `<li>${passiveName(pid)} Lv${lv}</li>`;
      })
      .join('');
    $('result-body').innerHTML = `
      <div class="result-grid">
        <div><span class="k">存活</span><span class="v">${fmtTime(r.elapsedMs)}</span></div>
        <div><span class="k">击杀</span><span class="v">${r.kills}</span></div>
        <div><span class="k">等级</span><span class="v">Lv${r.level}</span></div>
        <div><span class="k">难度档</span><span class="v">${r.maxTier + 1}</span></div>
        <div><span class="k">超武</span><span class="v">${r.superCount}</span></div>
        <div><span class="k">角色</span><span class="v">${CHARACTER_BY_ID[r.characterId] ? CHARACTER_BY_ID[r.characterId].cn : r.characterId}</span></div>
      </div>
      <div class="result-loadout">
        <div><h4>武器</h4><ul>${slots || '<li>—</li>'}</ul></div>
        <div><h4>被动</h4><ul>${passives || '<li>—</li>'}</ul></div>
      </div>
      ${extra.highScoreBeaten ? '<p class="won">刷新了本机最高击杀记录。</p>' : ''}
      <p class="muted small">${won ? '击杀相柳即通关。现在可以选择继续打无尽模式（每 2 分钟 +1 难度档）。' : '差一点就赢了。下一局可以试试提前规划血统配方。'}</p>`;
    const tbox = $('result-trials');
    tbox.innerHTML = '';
    for (const t of extra.newTrials || []) {
      const d = document.createElement('div');
      d.className = 'trial-unlock';
      d.innerHTML = `<b>试炼达成：${t.name}</b><span>${t.rewardText}</span>`;
      tbox.appendChild(d);
    }
    $('btn-endless2').hidden = !won;
    this.showOverlay('result');
  }

  // ---------------- 试炼 ----------------

  renderTrials() {
    const save = this.ctl.getSave();
    const box = $('trials-body');
    box.innerHTML = '';
    for (const t of TRIALS) {
      const ser = SERIES[t.id];
      const pr = trialProgress(save, t);
      const done = isTrialDone(save, t);
      const pct = Math.min(100, Math.round((pr.cur / pr.goal) * 100));
      const div = document.createElement('div');
      div.className = 'trial' + (done ? ' done' : '');
      div.style.setProperty('--series', ser.color);
      div.style.setProperty('--accent', ser.accent);
      div.innerHTML = `
        <div class="trial-head">
          <span class="series-tag">${ser.cn}</span>
          <b>${t.name}</b>
          <span class="trial-state">${done ? '已完成' : pr.cur + ' / ' + pr.goal}</span>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="trial-foot">
          <span>条件：${t.hint}</span>
          <span class="reward">奖励：${t.rewardText}</span>
        </div>`;
      box.appendChild(div);
    }
  }

  // ---------------- 图鉴 ----------------

  renderCodex() {
    const save = this.ctl.getSave();
    const data = codexBySeries(save);
    const box = $('codex-body');
    box.innerHTML = '';
    for (const sid of ['shan', 'hai', 'huang', 'tian', 'ling', 'kun']) {
      const vol = data[sid];
      const locked = !save.unlocks.series.includes(sid);
      const sec = document.createElement('section');
      sec.className = 'codex-vol' + (locked ? ' locked' : '');
      sec.style.setProperty('--series', vol.series.color);
      sec.style.setProperty('--accent', vol.series.accent);
      const head = `<h3><span class="series-tag">${vol.series.cn}</span> ${vol.series.title}${locked ? '<span class="muted small">（未解锁）</span>' : ''}</h3>`;
      if (locked) {
        sec.innerHTML = head + '<p class="muted">通过试炼解锁这一卷。</p>';
        box.appendChild(sec);
        continue;
      }
      const weapons = BATCH1_WEAPONS.filter((w) => w.series === sid)
        .map((w) => {
          const seen = !!save.codex[w.id];
          return `<li class="${seen ? 'seen' : 'unseen'}"><b>${seen ? w.cn : '？？？'}</b><span>${seen ? (WEAPON_KIND_CN[w.kind] || '') + ' · 初始 Lv1 伤害 ' + Math.round(levelStats(w, 1).damage) : '还没见过'}</span></li>`;
        })
        .join('');
      const passives = BATCH1_PASSIVES.filter((p) => p.series === sid)
        .map((p) => {
          const seen = !!save.codex[p.id];
          return `<li class="${seen ? 'seen' : 'unseen'}"><b>${seen ? p.cn : '？？？'}</b><span>${seen ? p.desc : '还没见过'}</span></li>`;
        })
        .join('');
      const fusions = FUSIONS.filter((f) => f.series === sid)
        .map((f) => {
          // 配方的"揭示"条件：它涉及的那把武器和那件被动都见过。
          // 否则就是直接把答案告诉玩家——图鉴的价值在于"发现"。
          const seenWeapon = !!save.codex[f.weapon];
          const seenPassive = !!save.codex[f.passive];
          const revealed = !!save.codex[f.id] || (seenWeapon && seenPassive);
          if (!revealed) {
            return `<li class="unseen"><b>？？？</b><span>继续探索以揭示这条血统</span></li>`;
          }
          return `<li class="seen"><b>${f.cn}</b><span>${weaponName(f.weapon)} 满级 + ${passiveName(f.passive)} → ${f.effect}</span></li>`;
        })
        .join('');
      sec.innerHTML = `${head}
        <div class="codex-cols">
          <div><h4>武器</h4><ul>${weapons}</ul></div>
          <div><h4>被动</h4><ul>${passives}</ul></div>
          <div><h4>血统配方</h4><ul>${fusions}</ul></div>
        </div>`;
      box.appendChild(sec);
    }
  }

  // ---------------- 设置 ----------------

  renderSettings() {
    const s = this.ctl.getSettings();
    const save = this.ctl.getSave();
    const allUnlocked = ['shan', 'hai', 'huang', 'tian', 'ling', 'kun'].every((id) => save.unlocks.series.includes(id));
    const box = $('settings-body');
    const row = (label, id, checked, hint = '') => `
      <label class="set-row"><span>${label}${hint ? `<em>${hint}</em>` : ''}</span>
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}></label>`;
    box.innerHTML = `
      ${row('静音', 'set-muted', s.muted, '地铁上玩的时候用')}
      <label class="set-row"><span>音量<em>${Math.round(s.volume * 100)}%</em></span>
        <input type="range" id="set-volume" min="0" max="100" value="${Math.round(s.volume * 100)}"></label>
      <label class="set-row"><span>画质<em>低端机建议自动降档</em></span>
        <select id="set-quality">
          <option value="auto"${s.quality === 'auto' ? ' selected' : ''}>自动</option>
          <option value="high"${s.quality === 'high' ? ' selected' : ''}>高（开特效）</option>
          <option value="low"${s.quality === 'low' ? ' selected' : ''}>低（关特效）</option>
        </select></label>
      ${row('打击特效', 'set-effects', s.effects, '粒子与光效')}
      ${row('屏幕震动', 'set-shake', s.shake)}
      ${row('伤害数字', 'set-damageNumbers', s.damageNumbers, '关掉能明显省性能')}
      ${row('开发模式：占位图标注槽位 id', 'set-devLabels', s.devLabels, '正式美术替换时用')}
      ${row('开发模式：解锁全部神系与角色（跳过试炼）', 'set-unlockAll', allUnlocked, '只用来检查系统层；后三系内容仍是骨架')}
      <div class="muted small">音频解锁需要一次用户手势；切后台再回前台会自动重新恢复。</div>`;
    const upd = (patch) => {
      this.ctl.setSettings(patch);
      this.renderSettings();
    };
    $('set-muted').addEventListener('change', (e) => {
      this.ctl.audio.setMuted(e.target.checked);
      upd({ muted: e.target.checked });
    });
    $('set-volume').addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      this.ctl.audio.volume = v;
      if (this.ctl.audio.master) this.ctl.audio.master.gain.value = this.ctl.audio.muted ? 0 : v;
      upd({ volume: v });
    });
    $('set-quality').addEventListener('change', (e) => upd({ quality: e.target.value }));
    $('set-effects').addEventListener('change', (e) => upd({ effects: e.target.checked }));
    $('set-shake').addEventListener('change', (e) => upd({ shake: e.target.checked }));
    $('set-damageNumbers').addEventListener('change', (e) => upd({ damageNumbers: e.target.checked }));
    $('set-devLabels').addEventListener('change', (e) => upd({ devLabels: e.target.checked }));
    $('set-unlockAll').addEventListener('change', (e) => {
      this.ctl.setUnlockAll(e.target.checked);
      this.renderSettings();
    });
  }

  // ---------------- 关于 / 许可 ----------------

  renderAbout() {
    const env = guessEnvironment();
    const stats = placeholderStats();
    const counts = {};
    for (const s of SLOTS) counts[s.category] = (counts[s.category] || 0) + 1;
    const catRows = Object.keys(counts)
      .map((k) => `<li>${k}：${counts[k]} 个槽位</li>`)
      .join('');
    $('about-body').innerHTML = `
      <p>《山海拾遗》v${VERSION} —— 单页网页游戏（HTML + Canvas 2D + 原生 JavaScript），零依赖、零构建期框架。</p>
      <h3>运行环境</h3>
      <ul>
        <li>用户代理：<code>${escapeHtml(env.ua || '未知')}</code></li>
        <li>Android 版本：${env.androidVersion || '未知'}　Chrome 内核：${env.chromeVersion || '未知'}${env.isWebView ? '（WebView）' : ''}</li>
      </ul>
      <h3>素材许可</h3>
      <p>游戏使用本项目自绘的像素精灵与程序生成的 Canvas 2D 图形，音效由 WebAudio 合成。当前未使用需要单独署名的第三方素材。</p>
      <p>槽位总数 ${stats.total}：程序生成 ${stats.generated}，已替换为正式文件 ${stats.supplied}。</p>
      <ul>${catRows}</ul>
      <p>已替换的精灵由本项目绘制；如后续使用第三方素材，会在此列出来源与许可信息。</p>
      <h3>字体</h3>
      <p>界面使用设备自带字体，应用内未打包第三方字体。</p>
      <h3>不联网声明</h3>
      <p>运行期间不发出任何网络请求：没有 SDK、没有云存档、没有排行榜、没有广告、没有内购、没有账号体系。</p>
      <h3>其他</h3>
      <ul>
        <li>隐私政策：<a href="#" id="link-privacy">查看本机隐私说明</a></li>
        <li>本机存档只保存在浏览器 localStorage 中，可以随时在「设置」里清空。</li>
      </ul>`;
    const link = $('link-privacy');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.renderPrivacy();
        this.show('privacy');
      });
    }
  }

  renderPrivacy() {
    $('privacy-body').innerHTML = `
      <p>运营者：开水的工作室　更新日期：2026 年 10 月 12 日</p>
      <p>本政策适用于 Android 游戏《山海拾遗》（包名：com.wuqijiangye.shanhai）。游戏可离线运行，不要求注册或登录。请阅读以下说明，了解游戏如何处理数据。</p>
      <h3>一、我们处理哪些数据</h3>
      <p>游戏不主动收集、上传或共享你的姓名、手机号、身份信息、位置、通讯录等个人信息。游戏运行时不向我们的服务器发送网络请求，也不使用广告、统计、推送或崩溃上报服务。</p>
      <p>为了保存游玩进度，游戏仅在你的设备上保存最高分、累计击杀、图鉴、试炼与解锁进度、设置，以及未完成的一局。这些数据保存在应用内部 WebView 的本地存储中，不会同步到我们的服务器。</p>
      <h3>二、设备权限</h3>
      <p>Android 安装包声明了网络权限，用于 WebView 通过应用内部虚拟地址加载安装包中的本地页面和素材；这一加载过程由应用在设备内处理。游戏本体不向外部服务器请求游玩数据。游戏不申请位置、相机、麦克风或通讯录权限。</p>
      <h3>三、存储、删除与共享</h3>
      <p>本机进度在你使用游戏期间保存在设备上。你可以在游戏内“设置 → 清空本机进度”删除这些数据；卸载应用或清除应用数据也会删除本机进度。我们不会出售、共享或向第三方传输游戏进度。</p>
      <h3>四、未成年人</h3>
      <p>游戏不以收集未成年人个人信息为目的。未成年人应在监护人指导下使用游戏。通过第三方平台下载或游玩时，平台可能依据其自身隐私政策和未成年人保护规则处理账户及设备信息；请同时阅读相应平台的说明。</p>
      <h3>五、政策变更与联系</h3>
      <p>如果游戏的数据处理方式发生变化，我们会更新本政策和游戏内说明，并在更新时注明日期。如对隐私事项有疑问，请联系 3522249258@qq.com。</p>`;
  }

  toast(text) {
    const el = $('hud-hint');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => {
      el.hidden = true;
    }, 3200);
  }
}

// ---------------- 小工具 ----------------

function fmtTime(ms) {
  const s = Math.floor((ms || 0) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function weaponName(id) {
  const w = WEAPON_BY_ID[id];
  return w ? w.cn : id;
}

function passiveName(id) {
  const p = PASSIVE_BY_ID[id];
  return p ? p.cn : id;
}

function modsText(c) {
  const parts = [];
  for (const k of Object.keys(c.mods || {})) {
    const ch = CHANNEL_BY_ID[k];
    if (!ch) continue;
    const v = c.mods[k];
    parts.push(`${ch.cn} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`);
  }
  return parts.join('　');
}

function deltaList(prev, cur) {
  const keys = ['damage', 'cd', 'count', 'radius', 'speed', 'size', 'arc', 'duration', 'width', 'length', 'spread', 'knockback', 'hp', 'delay'];
  const label = { damage: '伤害', cd: '冷却', count: '数量', radius: '范围', speed: '弹速', size: '体积', arc: '角度', duration: '持续', width: '宽度', length: '长度', spread: '散布', knockback: '击退', hp: '生命', delay: '延迟' };
  const out = [];
  for (const k of keys) {
    if (prev[k] === undefined || cur[k] === undefined) continue;
    if (prev[k] === cur[k]) continue;
    const a = Math.round(prev[k] * 100) / 100;
    const b = Math.round(cur[k] * 100) / 100;
    out.push(`<li>${label[k]} ${a} → <b>${b}</b></li>`);
  }
  return out.join('') || '<li>数值不变</li>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 卡片图标：直接取占位生成器画出的 dataURL，避免额外请求
// 卡片 / 暂停栏里的图标。
//
// 这里曾经直接调 getPlaceholder(slot) —— 那会**绕过 manifest 的 file 字段**，
// 于是"给 icon_* 槽位填了正式图"在 DOM 层完全无效，卡片上永远是程序生成的占位图；
// 而画布内的槽位面板走的是 getAsset()，两处显示的图标会对不上。
// 现在统一走 getAsset()：有 file 用 file，没 file 或加载失败才回退到占位图。
function iconDataUrl(slotId) {
  // 兜底：找不到槽位时用通用被动图标
  const slot = slotById(slotId) || slotById('icon_passive');
  try {
    const { source, isPlaceholder } = getAsset(slot.id);
    if (!isPlaceholder && source) {
      // source 是 Image 元素：画到临时 canvas 上取 dataURL（<img> 需要 URL 而不是元素）
      if (typeof source.toDataURL === 'function') return source.toDataURL();
      const c = document.createElement('canvas');
      c.width = source.width || slot.w;
      c.height = source.height || slot.h;
      const ctx = c.getContext('2d');
      ctx.drawImage(source, 0, 0, c.width, c.height);
      return c.toDataURL();
    }
    return getPlaceholder(slot).toDataURL();
  } catch (e) {
    // 任何异常都不能让卡片渲染失败（宁可显示占位图）
    try {
      return getPlaceholder(slot).toDataURL();
    } catch (e2) {
      return '';
    }
  }
}
