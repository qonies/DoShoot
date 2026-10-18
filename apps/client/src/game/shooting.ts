/** 射击：射线判定（共享包 raycastWalls / rayVsAABB）+ 曳光表现 + 命中盒子反馈（FR-C2） */

import * as THREE from 'three';
import {
  FIRE_INTERVAL,
  MAX_RAY_DIST,
  raycastWalls,
  rayVsAABB,
  type GameMap,
} from '@deadshot/shared';
import type { DummyTarget } from './scene';

interface Tracer {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  ttl: number;
}

const TRACER_TTL = 0.12;

export class Shooting {
  private readonly tracers: Tracer[] = [];
  private fireCooldown = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly hitPoint = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly map: GameMap,
    private readonly dummies: readonly DummyTarget[],
  ) {}

  /** 计算瞄准点：鼠标 NDC → 地面 y=0 平面世界坐标 */
  getAimPoint(camera: THREE.Camera, ndcX: number, ndcY: number, out: THREE.Vector2): void {
    this.ndc.set(ndcX, ndcY);
    this.raycaster.setFromCamera(this.ndc, camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
      out.set(this.hitPoint.x, this.hitPoint.z);
    }
  }

  /**
   * 尝试开火（按住连发，射速 FIRE_INTERVAL）。
   * 判定：先取墙体命中距离，再与各盒子 AABB 求最近命中。
   */
  tryFire(
    dt: number,
    ox: number,
    oy: number,
    aimX: number,
    aimY: number,
    firing: boolean,
  ): void {
    this.fireCooldown -= dt;
    if (!firing || this.fireCooldown > 0) return;
    this.fireCooldown = FIRE_INTERVAL;

    const dx = aimX - ox;
    const dy = aimY - oy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const ux = dx / len;
    const uy = dy / len;

    let hitDist = raycastWalls(this.map, ox, oy, ux, uy, MAX_RAY_DIST) ?? MAX_RAY_DIST;
    let hitDummy: DummyTarget | null = null;
    for (const d of this.dummies) {
      const t = rayVsAABB(ox, oy, ux, uy, d.aabb);
      if (t !== null && t < hitDist) {
        hitDist = t;
        hitDummy = d;
      }
    }

    const ex = ox + ux * hitDist;
    const ey = oy + uy * hitDist;
    this.spawnTracer(ox, oy, ex, ey);
    if (hitDummy !== null) hitDummy.flash(performance.now());
  }

  private spawnTracer(ox: number, oy: number, ex: number, ey: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(ox, 0.78, oy),
      new THREE.Vector3(ex, 0.78, ey),
    ]);
    const material = new THREE.LineBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.95,
    });
    const line = new THREE.Line(geo, material);
    this.scene.add(line);
    this.tracers.push({ line, material, ttl: TRACER_TTL });
  }

  /** 每帧更新曳光淡出 */
  update(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
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
