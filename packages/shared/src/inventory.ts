/** 武器库存状态机（前后端同源）：弹匣/备弹、换弹进度、切枪打断换弹（FR-W3/W4/W5）
 *  服务端为权威实例；客户端持预测实例仅用于表现，弹药漂移时按快照校正。 */

import { WEAPONS, WEAPON_ORDER, fireIntervalSec, nextWeaponId, type WeaponId, type WeaponSpec } from './weapons';

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
  /** 冲锋枪彩蛋模式激活中（FR-E1，服务端口令验证后授予 / 回合结束撤销；
   *  激活期间：无限弹药不消耗、无需换弹、跨重生保留） */
  rushActive = false;

  constructor() {
    this.states = {} as Record<WeaponId, WeaponRuntime>;
    for (const id of WEAPON_ORDER) {
      this.states[id] = this.freshRuntime(id);
    }
    this.states.rush = this.freshRuntime('rush');
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

  /** 重置全部武器（重生时调用；保留已解锁层级）。
   *  冲锋枪彩蛋模式（FR-E1）跨重生保留：rushActive 时重置后仍持 rush 满匣；
   *  「不带到下一局」由服务端回合结束时 revokeRush 后的 resetAll 承接。 */
  resetAll(): void {
    for (const id of WEAPON_ORDER) {
      this.resetRuntime(id);
    }
    this.states.rush = this.freshRuntime('rush');
    this.current = this.rushActive ? 'rush' : 'pistol';
  }

  /** 清除全部已解锁层级并重置（FR-A1 v0.4.1：武器解锁进度按局计，新局/再来一局回最初级）。
   *  服务端 rematch/resetMatch 与客户端 matchReset 事件两侧同源调用 */
  resetTiers(): void {
    for (const id of WEAPON_ORDER) {
      delete this.tierSpecs[id];
    }
    this.resetAll();
  }

  /** 授予冲锋枪彩蛋模式（FR-E1，服务端口令验证后调用）：切至 rush 满匣，带切枪硬直；已激活返回 false */
  grantRush(now: number): boolean {
    if (this.rushActive) return false;
    this.rushActive = true;
    this.states.rush = this.freshRuntime('rush');
    this.states[this.current].reloadEnd = null;
    this.current = 'rush';
    this.state.nextFireReady = Math.max(this.state.nextFireReady, now + SWITCH_DELAY);
    return true;
  }

  /** 撤销冲锋枪彩蛋模式（FR-E1，回合结束调用）：切回手枪满匣；未激活返回 false */
  revokeRush(): boolean {
    if (!this.rushActive) return false;
    this.rushActive = false;
    if (this.current === 'rush') {
      this.current = 'pistol';
      this.resetRuntime('pistol');
    }
    return true;
  }

  /** 切枪（打断换弹，FR-W3）；返回是否成功切换。
   *  白名单仅含 WEAPON_ORDER（NFR-5）：rush 彩蛋武器不可经切枪输入获得/切走（FR-E1）。
   *  彩蛋模式中手动切枪 = 主动放弃彩蛋（rushActive 复位，可重新输入口令再次激活），
   *  避免无限弹药语义泄漏到切过去的常规武器上。 */
  switchTo(id: WeaponId, now: number): boolean {
    // 非法 id 防御（NFR-5）：未知武器会让 spec/state 取值 undefined
    // 运行时数组不含 'rush'（类型层面已入联合），白名单仍然拒绝 rush 与非法 id（NFR-5/FR-E1）
    if (!WEAPON_ORDER.includes(id) || id === this.current) return false;
    this.rushActive = false;
    this.states[this.current].reloadEnd = null;
    this.current = id;
    this.state.nextFireReady = Math.max(this.state.nextFireReady, now + SWITCH_DELAY);
    return true;
  }

  /** 滚轮顺序切换 */
  cycle(delta: number, now: number): void {
    this.switchTo(nextWeaponId(this.current, delta), now);
  }

  /** 开始换弹；已在换弹/满匣/无备弹时忽略；彩蛋模式无限弹药无需换弹（FR-E1） */
  startReload(now: number): boolean {
    if (this.rushActive) return false;
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
    // 彩蛋模式无限弹药：不校验弹匣（FR-E1）
    if (this.rushActive) return s.reloadEnd === null && now >= s.nextFireReady;
    return s.reloadEnd === null && s.ammo > 0 && now >= s.nextFireReady;
  }

  consumeAmmo(): void {
    if (this.rushActive) return; // 彩蛋模式弹药不消耗（FR-E1）
    this.state.ammo--;
  }

  markFired(now: number): void {
    this.state.nextFireReady = now + fireIntervalSec(this.spec);
  }

  /** 换弹进度 0..1；未在换弹返回 null（快照/HUD 用） */
  reloadProgress(now: number): number | null {
    const s = this.state;
    if (s.reloadEnd === null) return null; // rush 彩蛋模式禁用换弹，reloadEnd 恒为 null（FR-E1）
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