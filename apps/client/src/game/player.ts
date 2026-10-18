/** 本地玩家：胶囊体 + 枪管盒子，随瞄准方向旋转（M0 单人） */

import * as THREE from 'three';
import { PLAYER_RADIUS } from '@deadshot/shared';

export class Player {
  readonly group = new THREE.Group();

  /** 世界坐标（x = 地图 x，y = 地图 y / 世界 z） */
  x: number;
  y: number;
  aimAngle = 0;

  constructor(scene: THREE.Scene, spawnX: number, spawnY: number) {
    this.x = spawnX;
    this.y = spawnY;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.5, 4, 16),
      new THREE.MeshStandardMaterial({ color: 0x4fc3f7, roughness: 0.5 }),
    );
    body.position.y = 0.72;
    body.castShadow = true;
    this.group.add(body);

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4 }),
    );
    gun.position.set(0.22, 0.78, 0.42);
    gun.castShadow = true;
    this.group.add(gun);

    scene.add(this.group);
  }

  get radius(): number {
    return PLAYER_RADIUS;
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.y);
    this.group.rotation.y = this.aimAngle;
  }
}
