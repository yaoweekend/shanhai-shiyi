// 入口：把模拟层、渲染层、UI 层接起来。
// 这里也是"固定步长 + 渲染解耦"落地的地方（规格 §11）。

import { TICK_MS, VERSION, LOGIC_W, LOGIC_H, QUALITY } from './config.js';
import { World } from './sim/world.js';
import { Renderer } from './render/render2d.js';
import { AudioKit } from './render/audio.js';
import { UI } from './ui/ui.js';
import { loadSave, persist, clearSave } from './meta/save.js';
import { recordRun, contentSelfCheck } from './meta/meta.js';
import { runBootChecks, renderBootFailure, suggestQuality, guessEnvironment } from './ui/webview-check.js';
import { setShowLabels } from './assets/generator.js';
import { runAssetDiagnostics } from './assets/diag.js';
import { TOUCH, hitTestTouch, resolveJoyOrigin, inJoyRegion } from './render/touch-layout.js';
import { CHARACTERS } from './content/characters.js';
import { BATCH1_WEAPONS } from './content/weapons.js';
import { TRIALS } from './meta/meta.js';
import { WEAPON_BY_ID } from './content/weapons.js';
import { PASSIVE_BY_ID } from './content/passives.js';
import { FUSION_BY_ID } from './content/fusions.js';
import { SERIES } from './content/series.js';

/**
 * 开发/测试开关：URL 里的 `?dev=...`。**支持逗号分隔的多个值**（规格 §7-1）：
 *   ?dev=ultimate        开局直接进入"血统超武 + 合体终极 + 主动技"状态
 *   ?dev=tune            打开调参浮层（规格 specs/shanhai-dev-tune.md）
 *   ?dev=diag            只跑资源诊断
 *   ?dev=ultimate,tune   组合（最常用：直接合体 + 又能调参）
 *
 * 正式玩法不带这个参数时所有开关都是 false，**行为与发布版逐值一致**；
 * 页面加载时读一次并缓存，运行中改 URL 不生效（避免半途换状态造成诡异现象）。
 */
const DEV_PARAMS = (new URLSearchParams(location.search).get('dev') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DEV_ULTIMATE = DEV_PARAMS.includes('ultimate');
const DEV_TUNE = DEV_PARAMS.includes('tune');
// 资源诊断：?dev=diag 只跑诊断；?dev=ultimate 也顺带跑（测试包默认带它）
const DEV_DIAG = DEV_PARAMS.includes('diag') || DEV_ULTIMATE;

// ---------------- 启动自检（老内核降级提示优先于一切） ----------------
const bootRoot = document.getElementById('bootfail');
const check = runBootChecks();
if (!check.ok) {
  bootRoot.hidden = false;
  renderBootFailure(bootRoot, check);
} else {
  start();
}

function start() {
  const save = loadSave();
  const env = guessEnvironment();
  const settings = save.settings;
  const audio = new AudioKit({ muted: settings.muted, volume: settings.volume });
  let quality = settings.quality === 'auto' ? suggestQuality() : settings.quality;
  setShowLabels(settings.devLabels);

  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas, {
    quality,
    shake: settings.shake,
    damageNumbers: settings.damageNumbers,
    effects: settings.effects,
  });

  /** @type {World|null} */
  let world = null;
  let mode = 'menu'; // menu | playing | paused | levelup | result
  let accumulator = 0;
  let lastFrame = performance.now();
  // 时间缩放只作用于**模拟推进量**（accumulator），不碰渲染帧率，
  // 也不改 TICK_MS —— 物理与判定始终是同一个固定步长（规格 §7-2 / US34）。
  let timeScale = 1;
  /** 调参面板实例（只在 ?dev=tune 时被动态 import 出来，正式包永远为 null） */
  let tunePanel = null;
  // 注意：ui 必须在 controller 初始化完成后再构造（controller 初始化时会用到 ui）
  let ui = null;
  const input = { mx: 0, my: 0, dashRequested: false, skillRequested: false, joyId: null, joyOrigin: null,
    // 主动技的非点按手势（批 1 只有天问「拉弓」用）：按下点 / 当前点 / 松手沿
    skillDown: false, skillId: null, skillStartX: 0, skillStartY: 0, skillCurX: 0, skillCurY: 0, skillReleased: false };
  const prevTelemetry = { hp: 0, kills: 0, level: 1, bossActive: false, drops: 0, bowCharge: 0 };

  // ---------------- 控制器 ----------------

  const controller = {
    getSave: () => save,
    getSettings: () => save.settings,
    world: () => world,
    audio,
    setSettings(patch) {
      Object.assign(save.settings, patch);
      persist(save);
      if (patch.quality !== undefined) {
        quality = patch.quality === 'auto' ? suggestQuality() : patch.quality;
        renderer.quality = quality;
      }
      if (patch.effects !== undefined) renderer.effectsOn = patch.effects;
      if (patch.shake !== undefined) renderer.shakeOn = patch.shake;
      if (patch.damageNumbers !== undefined) renderer.damageNumbersOn = patch.damageNumbers;
      if (patch.devLabels !== undefined) setShowLabels(patch.devLabels);
    },
    hasUnfinished: () => !!save.unfinishedRun,
    startRun(charId) {
      world = new World({ seed: (Date.now() ^ 0x5f3759df) >>> 0, characterId: charId, unlocks: save.unlocks.weapons, unlockedSeries: save.unlocks.series, devUltimate: DEV_ULTIMATE });
      beginRun(world);
    },
    /** 调参面板用：以指定种子重开（规格 §3E「换种子并重开」） */
    startRunWithSeed(charId, seed) {
      world = new World({ seed: seed >>> 0, characterId: charId, unlocks: save.unlocks.weapons, unlockedSeries: save.unlocks.series, devUltimate: DEV_ULTIMATE });
      beginRun(world);
    },
    openEndless(charId) {
      world = new World({ seed: (Date.now() ^ 0x9e3779b9) >>> 0, characterId: charId, unlocks: save.unlocks.weapons, unlockedSeries: save.unlocks.series, endless: true, devUltimate: DEV_ULTIMATE });
      beginRun(world);
    },
    continueEndless() {
      const charId = world ? world.characterId : 'shanpo';
      world = new World({ seed: (world ? world.seed : 1) + 1, characterId: charId, unlocks: save.unlocks.weapons, unlockedSeries: save.unlocks.series, endless: true, devUltimate: DEV_ULTIMATE });
      beginRun(world);
    },
    resumeRun() {
      if (!save.unfinishedRun) return;
      try {
        world = World.fromSnapshot(save.unfinishedRun);
        beginRun(world, true);
      } catch (e) {
        // 存档读不出来时，绝不把玩家留在"所有屏幕都隐藏"的空状态
        console.error('[存档] 读取失败，已丢弃这一局：', e && e.message);
        save.unfinishedRun = null;
        persist(save);
        ui.renderMenu();
        ui.show('menu');
        ui.toast('存档无法读取，已丢弃这一局。');
      }
    },
    takeCard(card) {
      if (!world) return;
      world.takeCard(card);
      ui.hideLevelUp();
      // 注意：必须先 show('hud') 再判断是否还有待选卡。
      // ui.show() 内部会 hideAll()，如果放在 else 分支里，
      // "选完最后一张卡"这条路径会把 HUD 一起隐藏 —— 局内在跑但屏幕全空。
      ui.show('hud');
      if (world.awaitingChoice) {
        ui.renderLevelUp(world);
      } else {
        mode = 'playing';
      }
    },
    // 刷新三选一（每局限一次）。只重抽卡面，不消耗升级次数、不改变待选数。
    refreshCards() {
      if (!world) return false;
      const next = world.refreshCards();
      if (!next) return false;
      ui.renderLevelUp(world);
      return true;
    },
    pause() {
      if (mode === 'playing') mode = 'paused';
    },
    resume() {
      if (mode === 'paused') mode = 'playing';
    },
    saveAndQuit() {
      if (!world) return false;
      save.unfinishedRun = world.toSnapshot();
      const ok = persist(save);
      world = null;
      mode = 'menu';
      audio.stopBgm();
      return ok;
    },
    quitRun() {
      if (world) endRun('abandon');
      else {
        mode = 'menu';
        audio.stopBgm();
      }
    },
    restart() {
      const charId = world ? world.characterId : 'shanpo';
      world = new World({ seed: (Date.now() ^ 0x27d4eb2f) >>> 0, characterId: charId, unlocks: save.unlocks.weapons, unlockedSeries: save.unlocks.series, devUltimate: DEV_ULTIMATE });
      beginRun(world);
    },
    toMenu() {
      world = null;
      mode = 'menu';
      audio.stopBgm();
      ui.renderMenu();
      ui.show('menu');
    },
    wipe() {
      clearSave();
      const fresh = loadSave();
      Object.assign(save, fresh);
      ui.renderMenu();
    },
    /**
     * 开发模式：一键解锁/锁定全部神系与角色（跳过试炼）。
     * 用途：检查系统层（角色列表、图鉴分卷、试炼奖励、解锁判定）。
     * 注意：后三系的内容本身仍是骨架（占位武器、无配方、被动无钩子效果），
     * 所以解锁它们只能验证"框架通不通"，不能验证"内容好不好玩"。
     */
    setUnlockAll(on) {
      const allSeries = CHARACTERS.map((c) => c.series);
      const allChars = CHARACTERS.map((c) => c.id);
      const trialWeapons = BATCH1_WEAPONS.filter((w) => w.unlock === 'trial').map((w) => w.id);
      if (on) {
        save.unlocks.series = [...new Set([...save.unlocks.series, ...allSeries])];
        save.unlocks.characters = [...new Set([...save.unlocks.characters, ...allChars])];
        save.unlocks.weapons = [...new Set([...save.unlocks.weapons, ...trialWeapons])];
        // 试炼标记为已完成，保持"解锁状态"与"试炼进度"一致，免得面板自相矛盾
        for (const t of TRIALS) {
          if (!save.trials[t.id]) save.trials[t.id] = { done: false, best: 0 };
          save.trials[t.id].done = true;
        }
        save.devUnlockAll = true;
      } else {
        save.unlocks.series = ['shan', 'hai', 'huang'];
        save.unlocks.characters = ['shanpo', 'haipo', 'huangpo'];
        save.unlocks.weapons = [];
        for (const t of TRIALS) if (save.trials[t.id]) save.trials[t.id].done = false;
        save.devUnlockAll = false;
      }
      persist(save);
      ui.renderMenu();
      ui.toast(on ? '开发模式：已解锁全部神系与角色' : '开发模式：已恢复为初始解锁状态');
    },
  };

  ui = new UI(controller);

  function beginRun(w, resumed = false) {
    // 关键顺序：所有可能抛异常的东西（音频初始化）放在 show('hud') 之后，
    // 这样任何失败都不会把玩家留在"所有屏幕都隐藏"的空状态。
    w.paused = false;
    // 新局与续局都沿用面板当前设置，避免开关显示与新 World 的实际状态不一致。
    // 面板异步加载较晚时，加载完成处也会应用一次。
    if (tunePanel) tunePanel.applyState();
    w.quality = quality;
    w.particlesOn = save.settings.effects;
    w.showDamageNumbers = save.settings.damageNumbers;
    mode = 'playing';
    accumulator = 0;
    lastFrame = performance.now();
    prevTelemetry.hp = w.player.hp;
    prevTelemetry.kills = 0;
    prevTelemetry.level = w.player.level;
    prevTelemetry.bossActive = false;
    prevTelemetry.bowCharge = 0;
    input.mx = 0;
    input.my = 0;
    input.dashRequested = false;
    input.skillRequested = false;
    input.skillDown = false;
    input.skillId = null;
    input.skillReleased = false;
    ui.show('hud');
    if (!resumed) {
      ui.toast('横屏、左手走位、右手闪避。攻击是自动的。');
      // 立刻写一份断点，手机被打断也不丢这一局
      save.unfinishedRun = w.toSnapshot();
      persist(save);
    }
    try {
      audio.unlock();
      audio.startBgm();
      audio.setBgmMode('calm');
    } catch (e) {
      // 音频失败不能影响可玩性（旧内核/权限受限场景）
      console.warn('[音频] 初始化失败，静音继续：', e && e.message);
    }
  }

  function endRun(reason) {
    if (!world) return;
    const result = world.finish();
    result.seen = collectSeen(world);
    // 调参局（?dev=tune）的结算**一律按"放弃"处理**：不进最高分、不发试炼、不记图鉴
    // —— 面板的改动只作用于当前这一局，绝不能污染真实进度（规格 §6 硬约束 2）。
    const effectiveReason = tunePanel ? 'abandon' : reason;
    const rec = effectiveReason === 'abandon' ? { newTrials: [], highScoreBeaten: false } : recordRun(save, result);
    if (effectiveReason === 'abandon') {
      save.unfinishedRun = null;
      persist(save);
    }
    audio.stopBgm();
    audio.play(result.outcome === 'win' ? 'win' : 'death');
    ui.renderResult(world, rec);
    // 新解锁：在结算画面上再喊一声（解锁只解锁内容，不给数值加成）
    for (const t of rec.newTrials) ui.toast(`试炼达成：${t.name} → ${t.rewardText}`);
    mode = 'result';
    world = null;
  }

  function collectSeen(w) {
    const seen = [];
    for (const s of w.slots.weapons) {
      seen.push(s.id);
      if (s.superId) seen.push(s.superId);
    }
    for (const pid of w.slots.passives) seen.push(pid);
    // 图鉴记录"见过"：本局真的出现在三选一里的卡片才算。
    // 注意：不能把"候选池"里的东西都算见过——那等于把没玩过的内容也标成已发现，
    // 图鉴的价值就在于"我真的见过它"。
    for (const c of w.cardChoices || []) {
      if (c.weaponId) seen.push(c.weaponId);
      if (c.passiveId) seen.push(c.passiveId);
    }
    // 血统配方：只有真的觉醒过才算"见过"（配方本身靠"武器 + 被动都见过"来揭示）
    for (const s of w.slots.weapons) if (s.superId) seen.push(s.superId);
    for (const e of w.enemies.active) {
      if (e.isBoss) seen.push('boss_xiangliu');
      else seen.push('enemy_' + e.kind);
    }
    seen.push('char_' + w.characterId);
    return seen;
  }

  // ---------------- 音效（从模拟状态的变化反推，模拟层不认识音频） ----------------

  function syncAudio() {
    if (!world) return;
    const t = prevTelemetry;
    if (world.player.hp < t.hp - 0.01) audio.play('hurt', { gap: 0.12 });
    if (world.runStats.kills > t.kills) {
      const delta = world.runStats.kills - t.kills;
      // 连击越高音调越亮（规格 §14）
      const rate = Math.min(2, 1 + Math.min(20, delta) * 0.04);
      if (delta >= 6) audio.play('explode', { rate, gap: 0.06 });
      else audio.play('hit', { rate, gap: 0.035 });
    }
    if (world.player.level > t.level) audio.play('levelup');
    if (world.bossActive && !t.bossActive) {
      audio.play('boss');
      audio.setBgmMode('boss');
      ui.toast('相柳 · 九首齐鸣');
    }
    if (world.drops.active.length > t.drops + 2) audio.play('pickup', { gap: 0.08 });
    // 拉弓满蓄：音效上扬（规格 §6：必须是不看 UI 也能察觉的反馈）
    const bc = world.bow ? world.bow.c || 0 : 0;
    if (bc >= 1 && t.bowCharge < 1) audio.play('super', { rate: 1.6, gap: 0 });
    t.bowCharge = bc;
    t.hp = world.player.hp;
    t.kills = world.runStats.kills;
    t.level = world.player.level;
    t.bossActive = world.bossActive;
    t.drops = world.drops.active.length;
  }

  // ---------------- 输入 ----------------

  function logicalFromEvent(e) {
    return renderer.toLogic(e.clientX, e.clientY);
  }

  // 触控布局与绘制、命中判定共用同一份常量（render/touch-layout.js），
  // 这里不再重复坐标，避免"看得到按不到"。
  function onPointerDown(e) {
    audio.unlock();
    if (mode !== 'playing' || !world) return;
    const p = logicalFromEvent(e);
    if (!p) return;
    const zone = hitTestTouch(p.x, p.y, renderer.safe);
    if (zone === 'dash') {
      input.dashRequested = true;
      audio.play('dash');
      return;
    }
    if (zone === 'skill') {
      // 点按类技能靠 skillRequested 立即施放；拉弓类技能（天问）靠
      // skillDown + 按下点/当前点 + skillReleased 走完整状态机（见 world.updateBow）。
      input.skillRequested = true;
      input.skillDown = true;
      input.skillId = e.pointerId;
      input.skillStartX = p.x;
      input.skillStartY = p.y;
      input.skillCurX = p.x;
      input.skillCurY = p.y;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      audio.play('dash');
      return;
    }
    // 浮动摇杆：左半边（避开顶部暂停键）按哪儿，哪儿就是摇杆原点。
    // 拇指不用先找固定圈的位置 —— 这是"固定摇杆难用"的根因。
    if (inJoyRegion(p.x, p.y)) {
      input.joyId = e.pointerId;
      input.joyOrigin = resolveJoyOrigin(p.x, p.y, renderer.safe);
      input.joyOrigin.safe = renderer.safe;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  function onPointerMove(e) {
    // 主动技拖动（拉弓瞄准）
    if (input.skillId === e.pointerId) {
      const sp = logicalFromEvent(e);
      if (sp) {
        input.skillCurX = sp.x;
        input.skillCurY = sp.y;
      }
    }
    if (mode !== 'playing' || !world || input.joyId !== e.pointerId) return;
    const p = logicalFromEvent(e);
    if (!p || !input.joyOrigin) return;
    let dx = p.x - input.joyOrigin.x;
    let dy = p.y - input.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    // 摇杆位移上限取视觉半径（与 render/touch-layout.js 同一份常量）
    const max = TOUCH.joy.r * 0.62;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    input.mx = dx / max;
    input.my = dy / max;
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (input.skillId === e.pointerId) {
      // 松手沿：世界据此判定"发射"还是"拖回取消"
      input.skillId = null;
      input.skillDown = false;
      input.skillReleased = true;
    }
    if (input.joyId === e.pointerId) {
      input.joyId = null;
      input.joyOrigin = null;
      input.mx = 0;
      input.my = 0;
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // 桌面调试用键盘（规格不要求手柄支持）
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') {
      input.dashRequested = true;
      e.preventDefault();
    }
    if (e.key === 'Escape' && mode === 'playing') {
      controller.pause();
      ui.show('pause');
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  function readKeyboard() {
    let x = 0;
    let y = 0;
    if (keys['a'] || keys['arrowleft']) x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['w'] || keys['arrowup']) y -= 1;
    if (keys['s'] || keys['arrowdown']) y += 1;
    if (x || y) {
      const l = Math.hypot(x, y);
      input.mx = x / l;
      input.my = y / l;
    } else if (!input.joyId) {
      input.mx = 0;
      input.my = 0;
    }
  }

  // 数字键 1/2/3 选卡（桌面调试）
  window.addEventListener('keydown', (e) => {
    if (mode !== 'levelup' || !world) return;
    const i = ['1', '2', '3'].indexOf(e.key);
    if (i >= 0) {
      const card = ui.currentCardChoices[i];
      if (card) controller.takeCard(card);
    }
  });

  // 窗口尺寸变化（含旋转）
  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 220));

  // 回前台：音频上下文会进入中断态，每次都要重新恢复（规格 §14）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      audio.resume().then((ok) => {
        if (ok && mode === 'playing') audio.startBgm();
      });
      // 回到前台时按真实时间对齐，不要让模拟追帧追出一大坨
      lastFrame = performance.now();
      accumulator = 0;
    } else if (mode === 'playing') {
      controller.pause();
      ui.show('pause');
    }
  });

  // 安全区（刘海与圆角）
  function readSafeArea() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    renderer.safe = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    document.body.removeChild(probe);
  }
  readSafeArea();
  window.addEventListener('resize', readSafeArea);

  // ---------------- 主循环 ----------------

  let snapshotTimer = 0;
  let renderErrors = 0;

  function frame(now) {
    const dtMs = Math.min(250, now - lastFrame);
    lastFrame = now;
    renderer.updateFps(dtMs);

    if (mode === 'playing' && world) {
      readKeyboard();
      // 时间缩放只改"喂给固定步长累加器的量"：TICK_MS 不变 → 物理与判定不失稳（规格 §7-2）
      if (timeScale > 0) accumulator += dtMs * timeScale;
      let steps = 0;
      // 固定步长推进（60Hz），最多追 8 步，避免后台切回来的死亡螺旋
      while (accumulator >= TICK_MS && steps < 8) {
        accumulator -= TICK_MS;
        steps++;
        world.input.mx = input.mx;
        world.input.my = input.my;
        world.input.active = Math.hypot(input.mx, input.my) > 0.06;
        if (input.dashRequested) {
          world.input.dashRequested = true;
          input.dashRequested = false;
        }
        if (input.skillRequested) {
          world.input.skillRequested = true;
          input.skillRequested = false;
        }
        // 拉弓状态机需要的原始手势（按下点 / 当前点 / 松手沿）
        world.input.skillDown = input.skillDown;
        world.input.skillStartX = input.skillStartX;
        world.input.skillStartY = input.skillStartY;
        world.input.skillCurX = input.skillCurX;
        world.input.skillCurY = input.skillCurY;
        if (input.skillReleased) {
          world.input.skillReleased = true;
          input.skillReleased = false;
        }
        world.step();
        if (!world.running) break;
        if (world.awaitingChoice) {
          mode = 'levelup';
          ui.renderLevelUp(world);
          break;
        }
      }
      if (world) {
        // 断点：每 5 秒写一次，手机被打断不丢一整局
        snapshotTimer += dtMs;
        if (snapshotTimer > 5000) {
          snapshotTimer = 0;
          save.unfinishedRun = world.toSnapshot();
          persist(save);
        }
        syncAudio();
        if (!world.running && mode === 'playing') endRun('finish');
      }
    }

    // 渲染绝不能把主循环带走：
    // 一次 ctx.arc(负数) 之类的异常会让 requestAnimationFrame 断掉、画面永久定格，
    // 而玩家看到的是"游戏卡了"。所以这里必须 try/catch + 永远把下一帧排上。
    try {
      renderer.render(world, {
        joystick: {
          dx: input.mx,
          dy: input.my,
          active: input.joyId !== null,
          origin: input.joyOrigin,
        },
        showHud: !!world && (mode === 'playing' || mode === 'paused' || mode === 'levelup'),
        showFps: save.settings.devLabels,
      });
    } catch (e) {
      renderErrors++;
      if (renderErrors <= 3) {
        console.error('[渲染异常] 已跳过这一帧，游戏继续运行：', e && e.message, e && e.stack && e.stack.split('\n')[1]);
      }
      // 连续大量异常说明渲染层坏了，降档到最低画质再试（宁可丑，也不能卡死）
      if (renderErrors === 30) {
        renderer.quality = 'low';
        renderer.effectsOn = false;
        console.warn('[渲染异常] 连续异常过多，已自动关闭特效并降画质');
      }
    }

    requestAnimationFrame(frame);
  }

  ui.renderMenu();
  ui.show('menu');

  // 内容自检（开发者可见）：缺配方/缺角色初始武器之类的问题会直接说出来
  const problems = contentSelfCheck();
  if (problems.length) console.warn('[内容自检]', problems);

  console.log(
    `[山海拾遗] v${VERSION} 启动：${env.isWebView ? 'WebView' : '浏览器'} Android ${env.androidVersion || '?'} / Chrome ${env.chromeVersion || '?'}，画质档 ${quality}，自检 ${check.ok ? '通过' : '失败'}${check.soft.length ? '，软性缺失：' + check.soft.map((s) => s.id).join(',') : ''}`,
  );

  requestAnimationFrame((t) => {
    lastFrame = t;
    requestAnimationFrame(frame);
  });

  // 供调试用（不参与游戏逻辑）
  window.__shanhai = { get world() { return world; }, controller, save, renderer, TICK_MS,
    get tunePanel() { return tunePanel; }, get timeScale() { return timeScale; } };

  // ---------------- 调参面板（规格 specs/shanhai-dev-tune.md） ----------------
  //
  // ⚠️ 只在 `?dev=tune`（或 `?dev=ultimate,tune`）时**动态 import**。
  //    正式包里没有任何静态引用路径能到达 src/dev/ —— 这条由 tools/check.mjs 的
  //    守卫断言（"面板只能被动态 import" + "正式包内不存在引用"），
  //    以后重构时如果有人把它改成静态 import，静态检查会失败。
  if (DEV_TUNE) {
    import('./dev/tune-panel.js')
      .then((mod) => {
        const state = mod.tuneFromUrl(location.search) || mod.defaultTuneState(1);
        tunePanel = new mod.TunePanel({
          getWorld: () => world,
          getRenderer: () => renderer,
          getController: () => controller,
          state,
          toast: (m) => { if (ui) ui.toast(m); },
        });
        // 真机入口：**HUD 上的独立按键**（由面板模块动态插进 #screen-hud）。
        // 暂停键保持原样（不再承担任何"长按开面板"的隐式手势）——
        // 隐式手势记不住也误触，独立按键一眼就能看见。
        tunePanel.mount();
        tunePanel.mountHudKey();
        // 无敌由面板开关决定；加载面板本身不应让角色免伤。
        tunePanel.applyState();
        window.addEventListener('resize', () => tunePanel.applyLayout());
        console.log('[调参面板] 已加载：dev=tune（HUD 右上角 ⚙ 键开关）');
      })
      .catch((e) => console.warn('[调参面板] 加载失败：', e && e.message));
  }

  // 真机资源诊断（?dev=diag 或 ?dev=ultimate）：等渲染跑过几帧、图片加载状态稳定后再量。
  // 只在带 dev 参数时执行，正式包不会有任何额外行为。
  if (DEV_DIAG) {
    setTimeout(async () => {
      try {
        await runAssetDiagnostics();
      } catch (e) {
        console.warn('[资源诊断] 失败', e && e.message);
      }
    }, 4000);
  }
}
