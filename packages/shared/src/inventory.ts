/** 武器库存状态机（前后端同源）：弹匣/备弹、换弹进度、切枪打断换弹（FR-W3/W4/W5）
 *  服务端为权威实例；客户端持预测实例仅用于表现，弹药漂移时按快照校正。 */

import { WEAPONS, WEAPON_ORDER, fireIntervalSec, type WeaponId, type WeaponSpec } from './weapons';

export interface WeaponRuntime {
  ammo: number;
  reserve: number;
  /** 换弹完成的模拟时间（秒），null 表示未在换弹 */
  reloadEnd: number | null;
  /** 下次可开火的模拟时间（秒） */
  nextFireReady: number;
}

/** 切枪硬直（秒），避免无成本速切 */
const SWITCH_DELAY = 0.25;

export class WeaponInventory {
  current: WeaponId = 'pistol';
  readonly states: Record<WeaponId, WeaponRuntime>;
  /** 各武器层级数值覆盖（FR-W1 解锁链；未覆盖的类回落 WEAPONS 基础值） */
  private readonly tierSpecs: Partial<Record<WeaponId, WeaponSpec>> = {};

  constructor() {
    this.states = {} as Record<WeaponId, WeaponRuntime>;
    for (const id of WEAPON_ORDER) {
      this.states[id] = this.freshRuntime(id);
    }
  }

  /** 层级解算后的运行时初始状态（弹匣/备弹按当前层级数值） */
  private freshRuntime(id: WeaponId): WeaponRuntime {
    const spec = this.tierSpecs[id] ?? WEAPONS[id];
    return { ammo: spec.magSize, reserve: spec.reserveAmmo, reloadEnd: null, nextFireReady: 0 };
  }

  get spec() {
    return this.tierSpecs[this.current] ?? WEAPONS[this.current];
  }

  get state(): WeaponRuntime {
    return this.states[this.current];
  }

  /** 应用层级数值（FR-W1 解锁）：若为当前武器，满新弹匣作为升级奖励 */
  setTierSpec(id: WeaponId, spec: WeaponSpec): void {
    this.tierSpecs[id] = spec;
    if (id === this.current) {
      this.state.ammo = spec.magSize;
      this.state.reloadEnd = null;
    }
  }

  /** 按当前层级取某武器的满弹匣/备弹运行时（重置/重生用） */
  private resetRuntime(id: WeaponId): void {
    this.states[id] = this.freshRuntime(id);
  }

  /** 重置全部武器（重生时调用；保留已解锁层级） */
  resetAll(): void {
    for (const id of WEAPON_ORDER) {
      this.resetRuntime(id);
    }
    this.current = 'pistol';
  }

  /** 切枪（打断换弹，FR-W3）；返回是否成功切换 */
  switchTo(id: WeaponId, now: number): boolean {
    // 非法 id 防御（NFR-5）：未知武器会让 spec/state 取值 undefined
    if (!WEAPON_ORDER.includes(id) || id === this.current) return false;
    this.states[this.current].reloadEnd = null;
    this.current = id;
    this.state.nextFireReady = Math.max(this.state.nextFireReady, now + SWITCH_DELAY);
    return true;
  }

  /** 滚轮顺序切换 */
  cycle(delta: number, now: number): void {
    const len = WEAPON_ORDER.length;
    const idx = WEAPON_ORDER.indexOf(this.current);
    const next = WEAPON_ORDER[(idx + delta + len) % len]!;
    this.switchTo(next, now);
  }

  /** 开始换弹；已在换弹/满匣/无备弹时忽略 */
  startReload(now: number): boolean {
    const s = this.state;
    const spec = this.spec;
    if (s.reloadEnd !== null || s.ammo >= spec.magSize || s.reserve <= 0) return false;
    s.reloadEnd = now + spec.reloadTime;
    return true;
  }

  /** 推进换弹完成（切枪打断在 switchTo 内处理） */
  update(now: number): void {
    const s = this.state;
    if (s.reloadEnd !== null && now >= s.reloadEnd) {
      const spec = this.spec;
      const take = Math.min(spec.magSize - s.ammo, s.reserve);
      s.ammo += take;
      s.reserve -= take;
      s.reloadEnd = null;
    }
  }

  canFire(now: number): boolean {
    const s = this.state;
    return s.reloadEnd === null && s.ammo > 0 && now >= s.nextFireReady;
  }

  consumeAmmo(): void {
    this.state.ammo--;
  }

  markFired(now: number): void {
    this.state.nextFireReady = now + fireIntervalSec(this.spec);
  }

  /** 换弹进度 0..1；未在换弹返回 null（快照/HUD 用） */
  reloadProgress(now: number): number | null {
    const s = this.state;
    if (s.reloadEnd === null) return null;
    const total = this.spec.reloadTime;
    return Math.min(1, Math.max(0, 1 - (s.reloadEnd - now) / total));
  }

  /** 按权威状态校正预测弹药（客户端预测漂移过大时调用） */
  resyncAmmo(ammo: number, reserve: number): void {
    const s = this.state;
    s.ammo = ammo;
    s.reserve = reserve;
    s.reloadEnd = null;
  }
}