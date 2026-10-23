/** 武器数值配置（FR-W5：全部武器数值集中于此，前后端同源加载；M1 单机由客户端消费，M2 服务端用同一份数据做权威结算） */

/** 武器 id：6 类常规武器（WEAPON_ORDER 槽位）+ rush 彩蛋冲锋枪（不入槽位，仅由服务端口令授予，FR-E1） */
export type WeaponId = 'pistol' | 'smg' | 'ar' | 'shotgun' | 'sniper' | 'lmg' | 'rush';

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
  /** 彩蛋冲锋枪（FR-E1）：超高射速 + 超远射程 + 无限弹药（无限弹药语义由库存 rushActive 标志实现，
   *  不消耗弹匣、不需要换弹）；不入 WEAPON_ORDER，数字键/滚轮/switchTo 白名单均不可选，仅服务端口令授予 */
  rush: {
    id: 'rush',
    nameKey: 'weapon.rush',
    damage: 16,
    pellets: 1,
    fireMode: 'auto',
    rpm: 1200,
    magSize: 60,
    reloadTime: 0,
    reserveAmmo: 0,
    spreadDeg: 2,
    moveSpreadDeg: 2.5,
    fullDamageRange: 40,
    maxRange: 60,
    minDamageMult: 0.7,
    recoil: 0.35,
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

// ---------- 武器解锁链（FR-W1：按类累计击杀数升级，跨局进度见 FR-A1） ----------

export interface WeaponTier {
  spec: WeaponSpec;
  /** 达到该层级所需的该类累计击杀数（T1 恒 0） */
  killsRequired: number;
}

/** 每类武器一条 3 级解锁链：T1 基础 → T2（8 杀）→ T3（20 杀）；id 保持类 id（协议/槽位不变，仅数值与名称升级） */
export const WEAPON_TIERS: Record<WeaponId, WeaponTier[]> = {
  pistol: [
    { spec: WEAPONS.pistol, killsRequired: 0 },
    {
      spec: { ...WEAPONS.pistol, nameKey: 'weapon.pistol.t2', damage: 18, pellets: 2, rpm: 420, magSize: 24, reloadTime: 1.8, reserveAmmo: 144, spreadDeg: 2.2, moveSpreadDeg: 3.5, fullDamageRange: 14, maxRange: 28, minDamageMult: 0.45, recoil: 0.8 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.pistol, nameKey: 'weapon.pistol.t3', damage: 55, pellets: 1, rpm: 200, magSize: 6, reloadTime: 2.6, reserveAmmo: 48, spreadDeg: 0.8, moveSpreadDeg: 2.5, fullDamageRange: 22, maxRange: 40, minDamageMult: 0.6, recoil: 2.2 },
      killsRequired: 20,
    },
  ],
  smg: [
    { spec: WEAPONS.smg, killsRequired: 0 },
    {
      spec: { ...WEAPONS.smg, nameKey: 'weapon.smg.t2', damage: 17, rpm: 960, magSize: 35, reloadTime: 1.7, reserveAmmo: 175, spreadDeg: 3.0, moveSpreadDeg: 3.4, fullDamageRange: 13, maxRange: 26, recoil: 0.5 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.smg, nameKey: 'weapon.smg.t3', damage: 19, rpm: 1020, magSize: 40, reloadTime: 1.8, reserveAmmo: 200, spreadDeg: 2.7, moveSpreadDeg: 3.2, fullDamageRange: 14, maxRange: 28, recoil: 0.45 },
      killsRequired: 20,
    },
  ],
  ar: [
    { spec: WEAPONS.ar, killsRequired: 0 },
    {
      spec: { ...WEAPONS.ar, nameKey: 'weapon.ar.t2', damage: 30, rpm: 560, magSize: 25, reloadTime: 1.9, reserveAmmo: 125, spreadDeg: 1.4, moveSpreadDeg: 3.0, fullDamageRange: 22, maxRange: 42, minDamageMult: 0.55, recoil: 1.0 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.ar, nameKey: 'weapon.ar.t3', damage: 34, rpm: 520, magSize: 25, reloadTime: 2.0, reserveAmmo: 125, spreadDeg: 1.2, moveSpreadDeg: 2.8, fullDamageRange: 24, maxRange: 45, minDamageMult: 0.6, recoil: 1.1 },
      killsRequired: 20,
    },
  ],
  shotgun: [
    { spec: WEAPONS.shotgun, killsRequired: 0 },
    {
      spec: { ...WEAPONS.shotgun, nameKey: 'weapon.shotgun.t2', damage: 9, pellets: 9, rpm: 75, magSize: 7, reloadTime: 2.4, reserveAmmo: 35, spreadDeg: 5.0, fullDamageRange: 8, maxRange: 18, recoil: 3.4 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.shotgun, nameKey: 'weapon.shotgun.t3', damage: 6, pellets: 10, fireMode: 'auto', rpm: 240, magSize: 8, reloadTime: 2.8, reserveAmmo: 40, spreadDeg: 6.0, moveSpreadDeg: 2.5, fullDamageRange: 6, maxRange: 14, minDamageMult: 0.2, recoil: 2.5 },
      killsRequired: 20,
    },
  ],
  sniper: [
    { spec: WEAPONS.sniper, killsRequired: 0 },
    {
      spec: { ...WEAPONS.sniper, nameKey: 'weapon.sniper.t2', damage: 125, rpm: 48, reloadTime: 2.6, reserveAmmo: 25, spreadDeg: 0.15, moveSpreadDeg: 6, fullDamageRange: 48, maxRange: 75, minDamageMult: 0.85, recoil: 4.8 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.sniper, nameKey: 'weapon.sniper.t3', damage: 150, rpm: 40, magSize: 4, reloadTime: 3.0, reserveAmmo: 20, spreadDeg: 0.1, moveSpreadDeg: 7, fullDamageRange: 55, maxRange: 85, minDamageMult: 0.9, recoil: 5.5 },
      killsRequired: 20,
    },
  ],
  lmg: [
    { spec: WEAPONS.lmg, killsRequired: 0 },
    {
      spec: { ...WEAPONS.lmg, nameKey: 'weapon.lmg.t2', damage: 24, rpm: 680, magSize: 100, reloadTime: 3.8, reserveAmmo: 300, spreadDeg: 3.6, moveSpreadDeg: 5, fullDamageRange: 19, maxRange: 38, recoil: 1.4 },
      killsRequired: 8,
    },
    {
      spec: { ...WEAPONS.lmg, nameKey: 'weapon.lmg.t3', damage: 22, rpm: 820, magSize: 90, reloadTime: 4.0, reserveAmmo: 270, spreadDeg: 4.2, moveSpreadDeg: 5.5, fullDamageRange: 17, maxRange: 34, recoil: 1.5 },
      killsRequired: 20,
    },
  ],
  /** 彩蛋冲锋枪无解锁链（固定数值；占位以满足 Record 完整性，tierForKills 恒返回 0） */
  rush: [{ spec: WEAPONS.rush!, killsRequired: 0 }],
};

/** 按该类累计击杀数解算当前层级（0 起） */
export function tierForKills(classId: WeaponId, classKills: number): number {
  const tiers = WEAPON_TIERS[classId]!;
  let tier = 0;
  for (let i = 1; i < tiers.length; i++) {
    if (classKills >= tiers[i]!.killsRequired) tier = i;
  }
  return tier;
}

/** 取指定层级的武器数值（越界钳制到最高层） */
export function specForTier(classId: WeaponId, tier: number): WeaponSpec {
  const tiers = WEAPON_TIERS[classId]!;
  return tiers[Math.max(0, Math.min(tier, tiers.length - 1))]!.spec;
}