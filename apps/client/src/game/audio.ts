/** WebAudio 合成音效（FR-S1 子集：射击/命中/击杀/换弹/死亡/解锁/结算；免外部素材）。
 *  AudioContext 需在首次用户交互后创建/恢复（浏览器自动播放策略，见需求风险表）。 */

import type { WeaponId } from '@DoShoot/shared';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.5;
  /** BGM 独立音量通道（FR-S3，M4） */
  private bgmGain: GainNode | null = null;
  private bgmVolume = 0.3;

  /** 首次用户交互时调用（startGame 点击），创建/恢复音频上下文 */
  ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      // 白噪声缓冲（射击/命中底色，创建一次复用）
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startBgm();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** BGM 独立音量（FR-S3：与音效音量分开控制）；AudioContext 未建时先存值 */
  setBgmVolume(v: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, v));
    if (this.bgmGain) this.bgmGain.gain.value = this.bgmVolume * 0.25;
  }

  /** 合成 BGM（FR-S3 子集，M4）：免素材环境音循环——A 小调 pad + 低通慢扫，独立音量通道 */
  private startBgm(): void {
    const ctx = this.ctx;
    if (!ctx || this.bgmGain) return;
    this.bgmGain = ctx.createGain();
    this.bgmGain.gain.value = this.bgmVolume * 0.25;
    this.bgmGain.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05; // 慢扫滤波（呼吸感）
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    filter.connect(this.bgmGain);
    const notes = [110, 164.81, 220, 261.63]; // A2 E3 A3 C4
    for (const [i, f] of notes.entries()) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = f * (1 + (i - 1.5) * 0.0012); // 轻微失谐
      const g = ctx.createGain();
      g.gain.value = 0.05;
      osc.connect(g).connect(filter);
      osc.start();
    }
  }

  /** 射击（按武器类音色；dist 为声源距离衰减，pan 为左右声像 -1..1——远端开火用，FR-S2） */
  shoot(weaponId: WeaponId, dist = 0, pan = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.noise) return;
    // 音色参数：低频"砰"的截止频率与噪声时长按武器区分
    const cutoff = weaponId === 'sniper' ? 700 : weaponId === 'shotgun' ? 900 : weaponId === 'pistol' ? 1600 : 2400;
    const dur = weaponId === 'sniper' ? 0.3 : weaponId === 'shotgun' ? 0.28 : 0.12;
    const gain = dist > 0 ? Math.max(0.05, 1 - dist / 30) : 1;
    const t = ctx.currentTime;
    // 空间声像（FR-S2，M4）：按声源相对方位左右定位（不支持 StereoPanner 时静默降级）
    const panner =
      pan !== 0 && typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(master);
    }
    const out = panner ?? master;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.55 * gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(env).connect(out);
    src.start(t);
    src.stop(t + dur);

    // 低频冲击（体感"砰"）
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(weaponId === 'sniper' ? 90 : 140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
    const oEnv = ctx.createGain();
    oEnv.gain.setValueAtTime(0.5 * gain, t);
    oEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(oEnv).connect(out);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** 命中标记（短促高频 tick） */
  hit(): void {
    this.blip(1800, 0.05, 0.18, 'square');
  }

  /** 自己受击（低频闷响） */
  hurt(): void {
    this.blip(160, 0.12, 0.4, 'sawtooth');
  }

  /** 击杀（双音上行提示音） */
  kill(): void {
    this.blip(880, 0.09, 0.3, 'square');
    window.setTimeout(() => this.blip(1320, 0.12, 0.3, 'square'), 80);
  }

  /** 换弹（两声机械咔哒） */
  reload(): void {
    this.blip(500, 0.04, 0.25, 'square');
    window.setTimeout(() => this.blip(700, 0.05, 0.25, 'square'), 110);
  }

  /** 死亡（下滑音） */
  death(): void {
    this.blip(300, 0.5, 0.4, 'sawtooth', 60);
  }

  /** 武器解锁（三连上行琶音，FR-W1 全屏提示配套） */
  unlock(): void {
    [660, 880, 1100].forEach((f, i) => {
      window.setTimeout(() => this.blip(f, 0.14, 0.3, 'triangle'), i * 90);
    });
  }

  /** 对局结束（结算面板提示音） */
  matchEnd(): void {
    [520, 660, 520, 780].forEach((f, i) => {
      window.setTimeout(() => this.blip(f, 0.16, 0.3, 'triangle'), i * 140);
    });
  }

  /** 简易单音（振荡器 + 指数衰减包络；freqEnd 可做滑音） */
  private blip(freq: number, dur: number, gain: number, type: OscillatorType, freqEnd?: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(master);
    osc.start(t);
    osc.stop(t + dur);
  }
}

export const sfx = new Sfx();
