// 音频（规格 §14）。
// 移动端硬约束：
//  ① 音频上下文的恢复必须发生在**用户手势直接触发**的处理函数里（放进定时器无效）；
//  ② iOS 切后台后音频上下文进入中断态，每次回前台都要重新恢复，不能"解锁一次了事"；
//  ③ Android WebView 默认比 Chrome 更严格地要求用户手势；
//  ④ 移动端音频缓冲约 43~46ms，连发音效必须预渲染或限流，否则会糊；
//  ⑤ 不硬编码采样率，读设备实际采样率后离线预渲染。
//
// 素材：批 1 全部为 WebAudio 合成（零素材、零许可风险）。
// 正式音效到位后：把 CC0 文件放进 assets/audio/，在 manifest 里登记后改为播放文件即可。

const SOUND_SPECS = {
  shoot: { dur: 0.06, type: 'square', f0: 640, f1: 320, gain: 0.045 },
  hit: { dur: 0.05, type: 'triangle', f0: 880, f1: 440, gain: 0.05 },
  hurt: { dur: 0.22, type: 'sawtooth', f0: 220, f1: 90, gain: 0.12 },
  explode: { dur: 0.4, type: 'sawtooth', f0: 160, f1: 40, gain: 0.14, noise: 0.5 },
  pickup: { dur: 0.07, type: 'sine', f0: 1200, f1: 1800, gain: 0.05 },
  levelup: { dur: 0.5, type: 'triangle', f0: 520, f1: 1400, gain: 0.09, steps: [0, 0.12, 0.26] },
  super: { dur: 0.8, type: 'triangle', f0: 300, f1: 1800, gain: 0.12, steps: [0, 0.18, 0.4] },
  boss: { dur: 1.0, type: 'sawtooth', f0: 90, f1: 60, gain: 0.16, noise: 0.3 },
  ui: { dur: 0.05, type: 'square', f0: 520, f1: 520, gain: 0.04 },
  dash: { dur: 0.12, type: 'sine', f0: 300, f1: 900, gain: 0.06 },
  death: { dur: 1.2, type: 'sawtooth', f0: 300, f1: 40, gain: 0.16 },
  win: { dur: 1.4, type: 'triangle', f0: 660, f1: 1320, gain: 0.12, steps: [0, 0.2, 0.42, 0.7] },
};

export class AudioKit {
  constructor(opts = {}) {
    this.ctx = null;
    this.master = null;
    this.muted = !!opts.muted;
    this.volume = opts.volume === undefined ? 0.7 : opts.volume;
    this.buffers = {};
    this.ready = false;
    this.lastPlay = {};
    this.minGap = 0.045; // 连发限流：43~46ms 缓冲的硬约束
    this.bgmOn = false;
    this.bgmTimer = null;
    this.bgmStep = 0;
    this.bgmMode = 'calm';
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  /** 必须在用户手势的直接处理函数里调用 */
  unlock() {
    if (!this.supported) return false;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      try {
        this.ctx = new Ctor();
      } catch (e) {
        this.supported = false;
        return false;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.prerender();
    }
    if (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
    this.ready = this.ctx.state === 'running';
    return true;
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  /** 读设备实际采样率后离线预渲染（不硬编码 44100） */
  prerender() {
    const rate = this.ctx.sampleRate;
    for (const name of Object.keys(SOUND_SPECS)) {
      const spec = SOUND_SPECS[name];
      const len = Math.ceil(spec.dur * rate);
      const buf = this.ctx.createBuffer(1, len, rate);
      const data = buf.getChannelData(0);
      let phase = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const f = spec.f0 + (spec.f1 - spec.f0) * t;
        phase += (f / rate) * Math.PI * 2;
        let v;
        switch (spec.type) {
          case 'square':
            v = Math.sin(phase) >= 0 ? 1 : -1;
            break;
          case 'sawtooth':
            v = ((phase / (Math.PI * 2)) % 1) * 2 - 1;
            break;
          case 'triangle':
            v = Math.asin(Math.sin(phase)) * (2 / Math.PI);
            break;
          default:
            v = Math.sin(phase);
        }
        // 指数衰减包络
        const env = Math.pow(1 - t, 2.2);
        // 起音去爆音
        const attack = Math.min(1, i / (rate * 0.004));
        v *= env * attack;
        if (spec.noise) {
          // 确定性伪噪声（避免每次播放不一致）
          const n = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
          v = v * (1 - spec.noise) + (n - Math.floor(n) - 0.5) * 2 * spec.noise * env;
        }
        // 阶梯式上行（升级/胜利音）
        if (spec.steps) {
          for (const s of spec.steps) {
            if (t >= s && t < s + 0.02) v *= 1.8;
          }
        }
        data[i] = Math.max(-1, Math.min(1, v)) * spec.gain;
      }
      this.buffers[name] = buf;
    }
  }

  play(name, opts = {}) {
    if (!this.ctx || this.muted || !this.buffers[name]) return;
    const now = this.ctx.currentTime;
    const gap = opts.gap === undefined ? this.minGap : opts.gap;
    if (gap > 0 && this.lastPlay[name] !== undefined && now - this.lastPlay[name] < gap) return;
    this.lastPlay[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[name];
    if (opts.rate) src.playbackRate.value = opts.rate;
    const g = this.ctx.createGain();
    g.gain.value = opts.gain === undefined ? 1 : opts.gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  /** 只循环一首 BGM：用最少的合成音铺一条循环低音线，Boss 战换调 */
  startBgm() {
    if (!this.ctx || this.bgmTimer) return;
    this.bgmOn = true;
    const note = () => {
      if (!this.bgmOn || this.muted || !this.ctx) return;
      const calm = [110, 138.59, 164.81, 138.59];
      const tense = [98, 116.54, 146.83, 155.56];
      const seq = this.bgmMode === 'boss' ? tense : calm;
      const f = seq[this.bgmStep % seq.length];
      this.bgmStep++;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = this.bgmMode === 'boss' ? 'sawtooth' : 'triangle';
      osc.frequency.value = f;
      const dur = this.bgmMode === 'boss' ? 0.42 : 0.5;
      g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(this.bgmMode === 'boss' ? 0.05 : 0.035, this.ctx.currentTime + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start();
      osc.stop(this.ctx.currentTime + dur + 0.02);
    };
    this.bgmTimer = setInterval(note, 480);
  }

  stopBgm() {
    this.bgmOn = false;
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  setBgmMode(mode) {
    this.bgmMode = mode;
  }

  /** 每次回到前台都要重新恢复（iOS/Android WebView 都会中断） */
  async resume() {
    if (!this.ctx) return false;
    try {
      await this.ctx.resume();
    } catch (e) {
      /* 忽略 */
    }
    return this.ctx.state === 'running';
  }
}
