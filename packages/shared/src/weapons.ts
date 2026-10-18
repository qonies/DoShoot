/** 武器数值配置（FR-W5：全部武器数值集中于此，前后端同源加载；M1 单机由客户端消费，M2 服务端用同一份数据做权威结算） */

export type WeaponId = 'pistol' | 'smg' | 'ar' | 'shotgun' | 'sniper' | 'lmg';

/** 开火模式：semi 半自动（每次点击一发）、auto 全自动（按住连发）、pump 泵动/栓动（低射速点射） */
export type FireMode = 'semi' | 'auto' | 'pump';

export interface WeaponSpec {
  id: WeaponId;
  /** 武器名 i18n key */
  nameKey: string;
  /** 单发伤害（霰弹枪为每颗弹丸伤害，见需求 4.3 参考数值） */
  damage: number;
  /** 每次开火的弹丸数（霰弹枪 8，其余 1） */
  pellets: number;
  fireMode: FireMode;
  /** 射速（发/分钟）；semi/pump 表示最快点射节奏上限 */
  rpm: number;
  magSize: number;
  /** 换弹时间（秒，见 FR-W3） */
  reloadTime: number;
  /** 备弹（M1 出生满备弹；正式携带规则 M2 随解锁系统细化，见 FR-W4） */
  reserveAmmo: number;
  /** 基础散布半锥角（度，见 FR-W2） */
  spreadDeg: number;
  /** 移动时附加散布（度） */
  moveSpreadDeg: number;
  /** 满伤害射程（世界单位），超过后线性衰减至 minDamageMult */
  fullDamageRange: number;
  /** 最大射程（子弹到此消失） */
  maxRange: number;
  /** 最大射程处的最低伤害倍率 */
  minDamageMult: number;
  /** 后坐力强度（准星扩散与镜头震动的表现系数，见 FR-W2） */
  recoil: number;
}

/** 槽位顺序（数字键 1~6 / 滚轮切换顺序） */
export const WEAPON_ORDER: readonly WeaponId[] = [
  'pistol',
  'smg',
  'ar',
  'shotgun',
  'sniper',
  'lmg',
];

/** 6 类武器数值表（对照需求 4.3 表格：伤害 / 射速 / 弹匣 / 换弹） */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: {
    id: 'pistol',
    nameKey: 'weapon.pistol',
    damage: 25,
    pellets: 1,
    fireMode: 'semi',
    rpm: 360,
    magSize: 12,
    reloadTime: 1.2,
    reserveAmmo: 72,
    spreadDeg: 1.2,
    moveSpreadDeg: 3,
    fullDamageRange: 18,
    maxRange: 32,
    minDamageMult: 0.5,
    recoil: 1.0,
  },
  smg: {
    id: 'smg',
    nameKey: 'weapon.smg',
    damage: 15,
    pellets: 1,
    fireMode: 'auto',
    rpm: 900,
    magSize: 30,
    reloadTime: 1.6,
    reserveAmmo: 150,
    spreadDeg: 3.2,
    moveSpreadDeg: 3.5,
    fullDamageRange: 12,
    maxRange: 24,
    minDamageMult: 0.45,
    recoil: 0.55,
  },
  ar: {
    id: 'ar',
    nameKey: 'weapon.ar',
    damage: 25,
    pellets: 1,
    fireMode: 'auto',
    rpm: 600,
    magSize: 30,
    reloadTime: 1.8,
    reserveAmmo: 150,
    spreadDeg: 1.8,
    moveSpreadDeg: 3.5,
    fullDamageRange: 20,
    maxRange: 38,
    minDamageMult: 0.5,
    recoil: 0.9,
  },
  shotgun: {
    id: 'shotgun',
    nameKey: 'weapon.shotgun',
    damage: 8,
    pellets: 8,
    fireMode: 'pump',
    rpm: 70,
    magSize: 6,
    reloadTime: 2.2,
    reserveAmmo: 30,
    spreadDeg: 5.5,
    moveSpreadDeg: 2,
    fullDamageRange: 7,
    maxRange: 16,
    minDamageMult: 0.25,
    recoil: 3.2,
  },
  sniper: {
    id: 'sniper',
    nameKey: 'weapon.sniper',
    damage: 110,
    pellets: 1,
    fireMode: 'pump',
    rpm: 45,
    magSize: 5,
    reloadTime: 2.5,
    reserveAmmo: 25,
    spreadDeg: 0.2,
    moveSpreadDeg: 7,
    fullDamageRange: 45,
    maxRange: 70,
    minDamageMult: 0.8,
    recoil: 4.5,
  },
  lmg: {
    id: 'lmg',
    nameKey: 'weapon.lmg',
    damage: 22,
    pellets: 1,
    fireMode: 'auto',
    rpm: 700,
    magSize: 75,
    reloadTime: 3.5,
    reserveAmmo: 225,
    spreadDeg: 3.8,
    moveSpreadDeg: 5,
    fullDamageRange: 18,
    maxRange: 36,
    minDamageMult: 0.5,
    recoil: 1.3,
  },
};

/** rpm → 最小开火间隔（秒） */
export function fireIntervalSec(spec: WeaponSpec): number {
  return 60 / spec.rpm;
}

/** 射程衰减后的单发伤害（FR-W2：满伤害射程内全额，随后线性衰减至最低倍率） */
export function damageAtRange(spec: WeaponSpec, dist: number): number {
  if (dist <= spec.fullDamageRange) return spec.damage;
  if (dist >= spec.maxRange) return spec.damage * spec.minDamageMult;
  const f = (dist - spec.fullDamageRange) / (spec.maxRange - spec.fullDamageRange);
  return spec.damage * (1 - f * (1 - spec.minDamageMult));
}