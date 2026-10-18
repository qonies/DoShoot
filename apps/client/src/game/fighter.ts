/** 战斗实体：玩家与 Bot 共用的胶囊体模型、HP、受击/死亡/重生（FR-C3/C4） */

import * as THREE from 'three';
import { HITBOX_HALF, PLAYER_HP, type AABB } from '@deadshot/shared';

export class Fighter {
  readonly group = new THREE.Group();
  x: number;
  y: number;
  aimAngle = 0;
  hp = PLAYER_HP;
  alive = true;
  /** 死亡后的预定重生时间（对局秒），存活时为 null */
  respawnAt: number | null = null;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly isPlayer: boolean,
    scene: THREE.Scene,
    spawnX: number,
    spawnY: number,
    color: number,
  ) {
    this.x = spawnX;
    this.y = spawnY;

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 0.5, 4, 16),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
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
    this.sync();
  }

  /** 命中判定盒（略大于碰撞半径，FR-C2 手感从宽） */
  get hitbox(): AABB {
    return {
      minX: this.x - HITBOX_HALF,
      minY: this.y - HITBOX_HALF,
      maxX: this.x + HITBOX_HALF,
      maxY: this.y + HITBOX_HALF,
    };
  }

  /** 受伤；返回是否因此死亡（击杀记录由调用方负责） */
  takeDamage(dmg: number): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) {
      this.alive = false;
      this.group.visible = false;
      return true;
    }
    return false;
  }

  respawn(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.hp = PLAYER_HP;
    this.alive = true;
    this.respawnAt = null;
    this.group.visible = true;
    this.sync();
  }

  sync(): void {
    this.group.position.set(this.x, 0, this.y);
    this.group.rotation.y = this.aimAngle;
  }
}