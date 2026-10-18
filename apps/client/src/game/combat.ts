/** 开火解算：散布、多弹丸、墙体/实体射线判定、射程衰减与伤害结算（FR-C2/C5、FR-W2） */

import * as THREE from 'three';
import { damageAtRange, raycastWalls, rayVsAABB, type GameMap, type WeaponSpec } from '@deadshot/shared';
import type { Fighter } from './fighter';

const TRACER_TTL = 0.1;
const TRACER_HEIGHT = 0.78;

interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  ttl: number;
}

/** 曳光池：统一创建/回收射线表现 */
export class TracerPool {
  private readonly tracers: Tracer[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(ox: number, oy: number, ex: number, ey: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, TRACER_HEIGHT, oy),
      new THREE.Vector3(ex, TRACER_HEIGHT, ey),
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95 });
    const line = new THREE.Line(geo, material);
    this.scene.add(line);
    this.tracers.push({ line, material, ttl: TRACER_TTL });
  }

  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i]!;
      tr.ttl -= dt;
      if (tr.ttl <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.material.dispose();
        this.tracers.splice(i, 1);
      } else {
        tr.material.opacity = Math.max(0, (tr.ttl / TRACER_TTL) * 0.95);
      }
    }
  }
}

export interface FireRequest {
  pool: TracerPool;
  map: GameMap;
  shooter: Fighter;
  /** 候选目标（调用方保证存活且不含 shooter） */
  targets: readonly Fighter[];
  spec: WeaponSpec;
  ox: number;
  oy: number;
  /** 瞄准方向角（弧度，与 Fighter.aimAngle 同基准，+Z 为 0） */
  aimAngle: number;
  /** 总散布半锥角（度）：基础 + 移动 + 后坐力扩散，由调用方合成 */
  spreadDeg: number;
  onHit: (target: Fighter, dmg: number, dist: number, killed: boolean) => void;
}

/** 尝试开火一次（按 spec.pellets 发射弹丸），同步结算伤害 */
export function fireWeapon(req: FireRequest): void {
  const { pool, map, targets, spec, ox, oy, aimAngle, spreadDeg, onHit } = req;
  for (let p = 0; p < spec.pellets; p++) {
    const spreadRad = ((Math.random() * 2 - 1) * spreadDeg * Math.PI) / 180;
    const angle = aimAngle + spreadRad;
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);

    // 先取墙体命中距离，再与各实体命中盒求最近命中（FR-C5 掩体挡子弹）
    let hitDist = raycastWalls(map, ox, oy, dx, dy, spec.maxRange) ?? spec.maxRange;
    let victim: Fighter | null = null;
    for (const t of targets) {
      const d = rayVsAABB(ox, oy, dx, dy, t.hitbox);
      if (d !== null && d < hitDist) {
        hitDist = d;
        victim = t;
      }
    }

    const ex = ox + dx * hitDist;
    const ey = oy + dy * hitDist;
    pool.spawn(ox, oy, ex, ey);

    // 同一次开火中先前弹丸已击杀的目标跳过（takeDamage 对死者无效，但表现不应重复）
    if (victim !== null && victim.alive) {
      const dmg = damageAtRange(spec, hitDist);
      const killed = victim.takeDamage(dmg);
      onHit(victim, dmg, hitDist, killed);
    }
  }
}