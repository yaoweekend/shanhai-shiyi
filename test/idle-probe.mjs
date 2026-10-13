// 站桩诊断：直接测"敌人有没有真的贴到玩家身上、有没有造成接触伤害"。
import { World } from '../src/sim/world.js';
import { ENEMY_LIST } from '../src/content/enemies.js';
import { autoTakeCards } from './policy.mjs';
import * as stats from '../src/sim/stats.js';

const charId = process.argv[2] || 'huangpo';
const seed = Number(process.argv[3] || 3);

// 用 world 上的 hurtPlayer 无法拦截（ESM 只读），改用 hp 差值 + 贴脸帧统计
const w = new World({ seed, characterId: charId });
w.paused = false;

let frames = 0;
let framesWithContact = 0;
let minDist = 999;
let hpDropEvents = 0;
let hpDropTotal = 0;
let lastHp = w.player.hp;
const byKind = {};

for (let i = 0; i < 60 * 180 && w.running; i++) {
  w.input.mx = 0;
  w.input.my = 0;
  const before = w.player.hp;
  w.step();
  if (w.awaitingChoice) autoTakeCards(w);
  frames++;
  const p = w.player;
  let contact = false;
  for (const e of w.enemies.active) {
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < minDist) minDist = d;
    if (d <= e.radius + p.radius) {
      contact = true;
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    }
  }
  if (contact) framesWithContact++;
  if (w.player.hp < before - 0.001) {
    hpDropEvents++;
    hpDropTotal += before - w.player.hp;
  }
  lastHp = w.player.hp;
}

console.log(`角色 ${charId} seed ${seed} 站桩 3 分钟：`);
console.log(`  总帧 ${frames}，其中"有敌人贴脸"的帧 ${framesWithContact}（${((framesWithContact / frames) * 100).toFixed(1)}%）`);
console.log(`  历史最近距离 ${minDist.toFixed(1)}px（玩家半径 ${w.player.radius}）`);
console.log(`  掉血事件 ${hpDropEvents} 次，累计 ${hpDropTotal.toFixed(0)}`);
console.log(`  血量 ${w.player.hp.toFixed(0)}/${w.player.maxHp.toFixed(0)}，击杀 ${w.runStats.kills}，同屏 ${w.enemies.active.length}`);
console.log(`  贴脸帧按敌人种类：${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(' ') || '（从未贴脸）'}`);
