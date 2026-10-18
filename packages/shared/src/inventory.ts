/** 武器库存状态机（前后端同源）：弹匣/备弹、换弹进度、切枪打断换弹（FR-W3/W4/W5）
 *  服务端为权威实例；客户端持预测实例仅用于表现，弹药漂移时按快照校正。 */

import { WEAPONS, WEAPON_ORDER, fireIntervalSec, type WeaponId } from './weapons';

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

  constructor() {
    this.states = {} as Record<WeaponId, WeaponRuntime>;
    for (const id of WEAPON_ORDER) {
      const spec = WEAPONS[id];
      this.states[id] = {
        ammo: spec.magSize,
        reserve: spec.reserveAmmo,
        reloadEnd: null,
        nextFireReady: 0,
      };
    }
  }

  get spec() {
    return WEAPONS[this.current];
  }

  get state(): WeaponRuntime {
    return this.states[this.current];
  }

  /** 重置全部武器（重生时调用） */
  resetAll(): void {
    for (const id of WEAPON_ORDER) {
      const spec = WEAPONS[id];
      this.states[id] = {
        ammo: spec.magSize,
        reserve: spec.reserveAmmo,
        reloadEnd: null,
        nextFireReady: 0,
      };
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