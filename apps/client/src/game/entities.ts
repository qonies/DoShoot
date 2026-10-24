/** 网络实体渲染：远端玩家/Bot 快照缓冲插值（FR-N3 ~100ms），本地玩家预测表现（FR-N4） */

import * as THREE from 'three';
import type { EntitySnapshot } from '@DoShoot/shared';

const BUFFER_TTL = 1.0;

/** 战斗实体网格（玩家与 Bot 共用造型，M1 延续） */
export function createFighterMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.5, 4, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
  );
  body.position.y = 0.72;
  body.castShadow = true;
  group.add(body);

  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.14, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4 }),
  );
  gun.position.set(0.22, 0.78, 0.42);
  gun.castShadow = true;
  group.add(gun);
  return group;
}

/** 玩家颜色：本地固定蓝色，远端按 id 稳定散列 */
export function colorForEntity(id: string, bot: boolean): number {
  if (bot) return 0xe57373;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = [0xffb74d, 0xba68c8, 0x4db6ac, 0xaed581, 0xf06292, 0x9575cd, 0xffd54f, 0x4fc3f7];
  return palette[h % palette.length]!;
}

interface Snap {
  t: number;
  x: number;
  y: number;
  angle: number;
}

/** 远端实体：快照入缓冲，渲染时按 renderTime 插值 */
export class RemoteEntity {
  readonly group: THREE.Group;
  id: string;
  name: string;
  bot: boolean;
  alive = true;
  kills = 0;
  private buffer: Snap[] = [];

  constructor(scene: THREE.Scene, s: EntitySnapshot, serverTime: number) {
    this.id = s.id;
    this.name = s.name;
    this.bot = s.bot;
    this.group = createFighterMesh(colorForEntity(s.id, s.bot));
    scene.add(this.group);
    this.applySnapshot(s, serverTime);
  }

  applySnapshot(s: EntitySnapshot, serverTime: number): void {
    this.alive = s.alive;
    this.kills = s.kills;
    this.buffer.push({ t: serverTime, x: s.x, y: s.y, angle: s.angle });
  }

  /** 渲染：在 renderTime（服务器时基）两侧快照间插值 */
  render(renderTime: number): void {
    const b = this.buffer;
    // 清理过期缓冲
    while (b.length > 2 && b[0]!.t < renderTime - BUFFER_TTL) b.shift();
    this.group.visible = this.alive;
    if (!this.alive || b.length === 0) return;
    if (b.length === 1) {
      this.group.position.set(b[0]!.x, 0, b[0]!.y);
      this.group.rotation.y = b[0]!.angle;
      return;
    }
    let i = b.length - 2;
    while (i > 0 && b[i]!.t > renderTime) i--;
    const a = b[i]!;
    const c = b[i + 1]!;
    const span = c.t - a.t;
    const f = span > 1e-6 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;
    this.group.position.set(a.x + (c.x - a.x) * f, 0, a.y + (c.y - a.y) * f);
    this.group.rotation.y = a.angle + shortAngle(a.angle, c.angle) * f;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

function shortAngle(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 本地玩家：客户端预测状态 + 表现网格 */
export class LocalPlayer {
  readonly group: THREE.Group;
  x: number;
  y: number;
  angle = 0;
  hp = 100;
  alive = true;
  kills = 0;
  /** 死亡时刻（本地渲染时钟），用于重生倒计时 */
  deathAt: number | null = null;

  constructor(scene: THREE.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.group = createFighterMesh(0x4fc3f7);
    scene.add(this.group);
    this.sync();
  }

  sync(): void {
    this.group.visible = this.alive;
    this.group.position.set(this.x, 0, this.y);
    this.group.rotation.y = this.angle;
  }
}