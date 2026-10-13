// 空间哈希 broad-phase。规格 §11：邻近查询不得使用全表线性扫描。
// 每帧重建（实体数上限 300 量级，重建比增量维护更不容易出错）。

import { HASH_CELL } from '../config.js';

export class SpatialHash {
  constructor(cell = HASH_CELL) {
    this.cell = cell;
    this.map = new Map();
  }

  key(cx, cy) {
    return cx * 73856093 ^ cy * 19349663;
  }

  clear() {
    this.map.clear();
  }

  insert(obj) {
    const cx = Math.floor(obj.x / this.cell);
    const cy = Math.floor(obj.y / this.cell);
    const k = this.key(cx, cy);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = [];
      this.map.set(k, bucket);
    }
    bucket.push(obj);
  }

  rebuild(list) {
    this.clear();
    for (let i = 0; i < list.length; i++) this.insert(list[i]);
  }

  /**
   * 查询半径内的候选对象，写入 out 数组（复用，避免每帧分配）。
   * ⚠️ out 是复用的：若遍历过程中调用了会再次查询的函数（伤害/击杀/钩子），
   * 必须传一个新数组（`query(x, y, r, [])`），否则候选表会被中途覆写。
   */
  query(x, y, r, out) {
    out.length = 0;
    const c = this.cell;
    const minX = Math.floor((x - r) / c);
    const maxX = Math.floor((x + r) / c);
    const minY = Math.floor((y - r) / c);
    const maxY = Math.floor((y + r) / c);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.map.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }

  // 最近目标（追踪/召唤用）。返回 null 表示半径内无目标。
  nearest(x, y, r, filter) {
    const c = this.cell;
    const minX = Math.floor((x - r) / c);
    const maxX = Math.floor((x + r) / c);
    const minY = Math.floor((y - r) / c);
    const maxY = Math.floor((y + r) / c);
    let best = null;
    let bestD = r * r;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.map.get(this.key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const o = bucket[i];
          if (filter && !filter(o)) continue;
          const dx = o.x - x;
          const dy = o.y - y;
          const d = dx * dx + dy * dy;
          if (d <= bestD) {
            bestD = d;
            best = o;
          }
        }
      }
    }
    return best;
  }
}
