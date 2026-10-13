// 对象池。规格 §11：池覆盖敌人、玩家子弹、敌方子弹、掉落物、伤害数字、粒子。
// 测试要求：长期运行后池计数不得增长（池泄漏是最典型的失败）。

export class Pool {
  constructor(factory, reset, cap) {
    this.factory = factory;
    this.reset = reset;
    this.cap = cap;
    this.free = [];
    this.active = [];
    this.peak = 0;
    this.created = 0;
  }

  // 超限时返回 null —— "不再生成"而不是掉帧
  spawn() {
    if (this.active.length >= this.cap) return null;
    let obj;
    if (this.free.length > 0) {
      obj = this.free.pop();
      this.reset(obj);
    } else {
      obj = this.factory();
      this.created++;
    }
    obj.__alive = true;
    this.active.push(obj);
    if (this.active.length > this.peak) this.peak = this.active.length;
    return obj;
  }

  releaseAt(i) {
    const obj = this.active[i];
    obj.__alive = false;
    this.active.splice(i, 1);
    this.free.push(obj);
    return obj;
  }

  release(obj) {
    const i = this.active.indexOf(obj);
    if (i >= 0) this.releaseAt(i);
  }

  // 每帧清扫：回调返回 true 表示该对象应被回收
  sweep(shouldRecycle) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (shouldRecycle(this.active[i])) this.releaseAt(i);
    }
  }

  clear() {
    for (let i = this.active.length - 1; i >= 0; i--) this.releaseAt(i);
  }

  // 池自身的健康度（测试断言用）
  audit() {
    return { active: this.active.length, free: this.free.length, created: this.created, peak: this.peak };
  }
}
