// 调参配置串（规格 specs/shanhai-dev-tune.md §5）——纯数据，无 DOM、无副作用，可在 node 里直接测。
//
// 格式：**紧凑键值对**，不用 base64 JSON（URL 要能被人读、也要短）：
//   v1;seed=12345;t=540;ts=1;inv=1;
//   w=w_ult_shan:5,w_guhai:5;
//   p=xuangui,kuiniu;
//   en=shanxiao*1.5,bifang*0;
//   spawn=2.0;hp=1.5;spd=1.0;elite=1.5;tier=-1;
//
// 版本不匹配时**拒绝并给出理由**，绝不猜测（规格 §5：不得静默按错误的串配置）。

import { ENEMIES } from '../content/enemies.js';
import { WEAPONS } from '../content/weapons.js';
import { PASSIVES } from '../content/passives.js';

export const TUNE_VERSION = 'v1';

const ENEMY_IDS = Object.keys(ENEMIES);
const WEAPON_IDS = new Set(WEAPONS.map((w) => w.id));
const PASSIVE_IDS = new Set(PASSIVES.map((p) => p.id));

/** 该武器属于哪个系（面板用它判断"本系"） */
export function seriessOfWeapon(weaponId) {
  const w = WEAPONS.find((x) => x.id === weaponId);
  return w ? w.series : null;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 把调参状态序列化成配置串。
 * @param {object} st 见 tune-panel.js 的 defaultTuneState()
 */
export function serializeTune(st) {
  const parts = [TUNE_VERSION];
  parts.push(`seed=${st.seed >>> 0}`);
  parts.push(`t=${Math.max(0, Math.round(num(st.t, 0)))}`);
  if (num(st.ts, 1) !== 1) parts.push(`ts=${num(st.ts, 1)}`);
  if (st.inv) parts.push('inv=1');
  if (num(st.dmgMul, 1) !== 1) parts.push(`dmg=${num(st.dmgMul, 1)}`);
  if (num(st.speedMul, 1) !== 1) parts.push(`spdm=${num(st.speedMul, 1)}`);
  const w = (st.weapons || []).filter(Boolean).map((s) => `${s.id}:${s.level}`);
  if (w.length) parts.push(`w=${w.join(',')}`);
  const p = (st.passives || []).filter(Boolean);
  if (p.length) parts.push(`p=${p.join(',')}`);
  const en = [];
  for (const id of ENEMY_IDS) {
    const e = (st.perEnemy || {})[id];
    if (!e) continue;
    const bits = [];
    if (e.count !== undefined && num(e.count, 1) !== 1) bits.push(`c${num(e.count, 1)}`);
    if (e.weight !== undefined && num(e.weight, 1) !== 1) bits.push(`w${num(e.weight, 1)}`);
    if (e.from !== undefined && e.from !== null) bits.push(`f${Math.round(num(e.from, 0))}`);
    if (e.on === false) bits.push('off');
    if (bits.length) en.push(`${id}*${bits.join('+')}`);
  }
  if (en.length) parts.push(`en=${en.join(',')}`);
  if (num(st.spawn, 1) !== 1) parts.push(`spawn=${num(st.spawn, 1)}`);
  if (num(st.enemyHp, 1) !== 1) parts.push(`hp=${num(st.enemyHp, 1)}`);
  if (num(st.enemySpd, 1) !== 1) parts.push(`spd=${num(st.enemySpd, 1)}`);
  if (num(st.elite, 1) !== 1) parts.push(`elite=${num(st.elite, 1)}`);
  if (Number.isFinite(Number(st.tier)) && Number(st.tier) >= 0) parts.push(`tier=${Math.round(Number(st.tier))}`);
  if (num(st.xp, 1) !== 1) parts.push(`xp=${num(st.xp, 1)}`);
  if (num(st.drop, 1) !== 1) parts.push(`drop=${num(st.drop, 1)}`);
  return parts.join(';');
}

/**
 * 解析配置串。
 * @returns {{ok:true,state:object}|{ok:false,error:string}}
 */
export function parseTune(str) {
  const text = String(str || '').trim();
  if (!text) return { ok: false, error: '空配置串' };
  // ⚠️ 只能按 `;` 切分**分组**：`en=` 与 `w=`/`p=` 的**值内部**用逗号分隔，
  //    一起当分隔符会把 en 的第二个种类切成一个不成 key=value 的碎片。
  const tokens = text.split(';').map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return { ok: false, error: '空配置串' };
  const head = tokens[0];
  if (head !== TUNE_VERSION) {
    return { ok: false, error: `版本不匹配：期望 ${TUNE_VERSION}，收到 ${head}` };
  }
  const st = {
    v: TUNE_VERSION,
    seed: 0,
    t: 0,
    ts: 1,
    inv: false,
    dmgMul: 1,
    speedMul: 1,
    weapons: [],
    passives: [],
    perEnemy: {},
    spawn: 1,
    enemyHp: 1,
    enemySpd: 1,
    elite: 1,
    tier: -1,
    xp: 1,
    drop: 1,
  };
  for (let i = 1; i < tokens.length; i++) {
    const tk = tokens[i];
    const eq = tk.indexOf('=');
    if (eq < 0) return { ok: false, error: `无法识别的片段「${tk}」（应为 key=value）` };
    const key = tk.slice(0, eq).trim();
    const val = tk.slice(eq + 1).trim();
    switch (key) {
      case 'seed': st.seed = Number(val) >>> 0; break;
      case 't': st.t = Math.max(0, num(val, 0)); break;
      case 'ts': st.ts = clamp(num(val, 1), 0.1, 8); break;
      case 'inv': st.inv = val === '1' || val === 'true'; break;
      case 'dmg': st.dmgMul = clamp(num(val, 1), 0, 20); break;
      case 'spdm': st.speedMul = clamp(num(val, 1), 0.1, 10); break;
      case 'w': {
        for (const item of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          const [id, lv] = item.split(':');
          if (!WEAPON_IDS.has(id)) return { ok: false, error: `未知武器 id「${id}」` };
          st.weapons.push({ id, level: clamp(Math.round(num(lv, 1)), 1, 5) });
        }
        break;
      }
      case 'p': {
        for (const item of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!PASSIVE_IDS.has(item)) return { ok: false, error: `未知被动 id「${item}」` };
          st.passives.push(item);
        }
        break;
      }
      case 'en': {
        for (const item of val.split(',').map((s) => s.trim()).filter(Boolean)) {
          const star = item.indexOf('*');
          const id = star < 0 ? item : item.slice(0, star);
          if (!ENEMY_IDS.includes(id)) return { ok: false, error: `未知敌人 id「${id}」` };
          const flags = star < 0 ? '' : item.slice(star + 1);
          const e = { on: true, count: 1, weight: 1, from: null };
          for (const f of flags.split('+').map((s) => s.trim()).filter(Boolean)) {
            if (f === 'off') e.on = false;
            else if (f.startsWith('c')) e.count = clamp(num(f.slice(1), 1), 0, 20);
            else if (f.startsWith('w')) e.weight = clamp(num(f.slice(1), 1), 0, 20);
            else if (f.startsWith('f')) e.from = Math.max(0, num(f.slice(1), 0));
            else return { ok: false, error: `敌人「${id}」上有无法识别的标记「${f}」` };
          }
          st.perEnemy[id] = e;
        }
        break;
      }
      case 'spawn': st.spawn = clamp(num(val, 1), 0, 20); break;
      case 'hp': st.enemyHp = clamp(num(val, 1), 0.01, 100); break;
      case 'spd': st.enemySpd = clamp(num(val, 1), 0.01, 100); break;
      case 'elite': st.elite = clamp(num(val, 1), 0, 20); break;
      case 'tier': st.tier = Math.round(num(val, -1)); break;
      case 'xp': st.xp = clamp(num(val, 1), 0, 50); break;
      case 'drop': st.drop = clamp(num(val, 1), 0, 50); break;
      default:
        return { ok: false, error: `未知配置键「${key}」` };
    }
  }
  return { ok: true, state: st };
}

function clamp(v, lo, hi) {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
