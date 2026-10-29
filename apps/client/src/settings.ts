/** 设置持久化（FR-L5，M4）：音量 / BGM / 画质存 localStorage；界面语言由 i18n 模块独立持久化。
 *  鼠标灵敏度项不适用：V1 为绝对指针瞄准（无指针锁定），已在需求 v0.3.1 修订说明。 */

import { sfx } from './game/audio';

export type QualityLevel = 'low' | 'medium' | 'high';

export interface GameSettings {
  /** 音效音量 0..1 */
  volume: number;
  /** BGM 音量 0..1（FR-S3 独立控制） */
  bgm: number;
  quality: QualityLevel;
  /** 触屏操作模式（FR-U6，v0.3.8）：pad = D-pad + 点击射击（默认）；stick = 双虚拟摇杆 */
  touchMode: TouchMode;
}

export type TouchMode = 'pad' | 'stick';

const KEY = 'DoShoot.settings';
const DEFAULTS: GameSettings = { volume: 0.5, bgm: 0.3, quality: 'high', touchMode: 'pad' };

export function loadSettings(): GameSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<GameSettings>;
    const clamp01 = (v: unknown, d: number): number => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : d;
    };
    return {
      volume: clamp01(raw.volume, DEFAULTS.volume),
      bgm: clamp01(raw.bgm, DEFAULTS.bgm),
      quality:
        raw.quality === 'low' || raw.quality === 'medium' || raw.quality === 'high'
          ? raw.quality
          : DEFAULTS.quality,
      touchMode: raw.touchMode === 'stick' ? 'stick' : 'pad',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

/** 应用音量设置（AudioContext 未初始化时由 sfx 内部暂存，ensure() 后生效） */
export function applyAudioSettings(s: GameSettings): void {
  sfx.setVolume(s.volume);
  sfx.setBgmVolume(s.bgm);
}