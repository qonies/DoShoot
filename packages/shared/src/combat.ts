/** 开火解算（纯函数，无渲染依赖）：散布、多弹丸、墙体/实体射线判定（FR-C2/C5、FR-W2）
 *  服务端（权威结算，FR-W5/N1）与客户端（本地预测表现，FR-N4）共用同一实现，杜绝两端分叉。 */

import { raycastWalls, rayVsAABB, type AABB } from './collision';
import type { GameMap } from './map';
import type { WeaponSpec } from './weapons';

/** 可被子弹命中的目标（服务端传实体命中盒；客户端预测时传空数组） */
export interface ShotTarget {
  hitbox: AABB;
  alive: boolean;
}

export interface ShotSegment {
  ox: number;
  oy: number;
  ex: number;
  ey: number;
}

export interface PelletResult {
  segment: ShotSegment;
  /** 命中 targets 的索引；null = 打墙或射程内无目标 */
  hitIndex: number | null;
  /** 弹丸实际飞行距离（伤害衰减用 damageAtRange） */
  dist: number;
}

/** 解算一次开火的全部弹丸（随机散布在函数内完成） */
export function resolveShot(
  map: GameMap,
  ox: number,
  oy: number,
  aimAngle: number,
  spreadDeg: number,
  spec: WeaponSpec,
  targets: readonly ShotTarget[],
): PelletResult[] {
  const out: PelletResult[] = [];
  for (let p = 0; p < spec.pellets; p++) {
    const spreadRad = ((Math.random() * 2 - 1) * spreadDeg * Math.PI) / 180;
    const angle = aimAngle + spreadRad;
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);

    // 先取墙体命中距离，再与各实体命中盒求最近命中（FR-C5 掩体挡子弹）
    let hitDist = raycastWalls(map, ox, oy, dx, dy, spec.maxRange) ?? spec.maxRange;
    let hitIndex: number | null = null;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]!;
      if (!t.alive) continue;
      const d = rayVsAABB(ox, oy, dx, dy, t.hitbox);
      if (d !== null && d < hitDist) {
        hitDist = d;
        hitIndex = i;
      }
    }

    out.push({
      segment: { ox, oy, ex: ox + dx * hitDist, ey: oy + dy * hitDist },
      hitIndex,
      dist: hitDist,
    });
  }
  return out;
}