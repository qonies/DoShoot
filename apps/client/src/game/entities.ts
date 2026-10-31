/** 网络实体渲染：远端玩家/Bot 快照缓冲插值（FR-N3 ~100ms），本地玩家预测表现（FR-N4）
 *  + 头顶血条（FR-C3/U1，v0.3.9）：每个玩家/Bot 头顶悬浮实时血板（本地=预测血量，远端=快照血量） */

import * as THREE from 'three';
import { PLAYER_HP } from '@DoShoot/shared';
import type { EntitySnapshot } from '@DoShoot/shared';
import { decayFactor } from './smoothing';

const BUFFER_TTL = 1.0;

// ---------- 头顶血条（FR-C3/U1，v0.3.9） ----------

const HP_BAR_BG_W = 1.1;
const HP_BAR_BG_H = 0.16;
const HP_BAR_FILL_W = 1.02;
const HP_BAR_FILL_H = 0.1;
/** 悬浮高度：明显高于身体胶囊顶部（~1.32），不遮挡玩家角色；
 *  也高于墙高（1.6）→ 掩体后玩家的血板会浮现在墙顶上方（顶视角射击游戏惯例） */
const HP_BAR_Y = 1.8;
/** 血板朝向与 GameScene 相机俯视角匹配（相机 position.y=22 / z 偏移 12），正对相机 */
const HP_BAR_TILT = -Math.atan2(22, 12);
/** 血量分段颜色：低 / 中 / 高 */
const HP_BAR_COLORS: readonly number[] = [0xe57373, 0xffb74d, 0x4caf50];
/** 滑铲视觉追上时间常数（秒，FR-C7）：偏移指数衰减，~0.12s 后残差 <10%（短促滑行观感）；
 *  v0.4.2 起同一机制同时服务快照和解修正的视觉平滑（画面平滑优化，见 smoothing.ts） */
const VISUAL_SMOOTH_TAU = 0.05;
/** 表现层视觉偏移总量上限（世界单位，v0.4.2）：滑铲 + 和解修正叠加时防滞后无限累积 */
const VISUAL_OFFSET_MAX = 1.0;

interface HealthBar {
  group: THREE.Group;
  fill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  bg: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** 上次血量比例（避免每快照/每帧重写 scale） */
  width: number;
  /** 上次颜色分段（-1 = 未初始化） */
  bucket: number;
}

function createHealthBar(): HealthBar {
  const group = new THREE.Group();
  group.rotation.x = HP_BAR_TILT;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(HP_BAR_BG_W, HP_BAR_BG_H),
    new THREE.MeshBasicMaterial({ color: 0x10151b }),
  );
  const fillGeo = new THREE.PlaneGeometry(HP_BAR_FILL_W, HP_BAR_FILL_H);
  fillGeo.translate(HP_BAR_FILL_W / 2, 0, 0); // 左端锚定：scale.x = 血量比例
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: HP_BAR_COLORS[2]! }));
  fill.position.set(-HP_BAR_FILL_W / 2, 0, 0.001); // 沿法线抬高，避免与底板 z-fighting
  group.add(bg, fill);
  group.visible = false;
  return { group, fill, bg, width: -1, bucket: -1 };
}

/** 血条刷新：宽度/颜色仅在变化时更新（远端 ~28Hz 快照、本地每帧 sync 调用） */
function syncHealthBar(bar: HealthBar, hp: number, alive: boolean): void {
  const pct = Math.max(0, Math.min(1, hp / PLAYER_HP));
  bar.group.visible = alive && pct > 0;
  if (Math.abs(pct - bar.width) > 0.004) {
    bar.width = pct;
    bar.fill.scale.x = Math.max(pct, 0.0001); // 0 缩放会退化矩阵，钳到极小值
  }
  const bucket = hp > 55 ? 2 : hp > 25 ? 1 : 0;
  if (bucket !== bar.bucket) {
    bar.bucket = bucket;
    bar.fill.material.color.setHex(HP_BAR_COLORS[bucket]!);
  }
}

function disposeHealthBar(bar: HealthBar, scene: THREE.Scene): void {
  scene.remove(bar.group);
  bar.bg.geometry.dispose();
  bar.bg.material.dispose();
  bar.fill.geometry.dispose();
  bar.fill.material.dispose();
}

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
  /** 最新快照血量（头顶血条用，FR-C3/U1） */
  hp = PLAYER_HP;
  private buffer: Snap[] = [];
  private readonly hpBar: HealthBar;

  constructor(scene: THREE.Scene, s: EntitySnapshot, serverTime: number) {
    this.id = s.id;
    this.name = s.name;
    this.bot = s.bot;
    this.group = createFighterMesh(colorForEntity(s.id, s.bot));
    scene.add(this.group);
    this.hpBar = createHealthBar();
    scene.add(this.hpBar.group);
    this.applySnapshot(s, serverTime);
  }

  applySnapshot(s: EntitySnapshot, serverTime: number): void {
    this.alive = s.alive;
    this.kills = s.kills;
    this.hp = s.hp;
    syncHealthBar(this.hpBar, s.hp, s.alive); // 头顶血条（FR-C3/U1）：随快照血量刷新
    this.buffer.push({ t: serverTime, x: s.x, y: s.y, angle: s.angle });
  }

  /** 渲染：在 renderTime（服务器时基）两侧快照间插值 */
  render(renderTime: number): void {
    const b = this.buffer;
    // 清理过期缓冲
    while (b.length > 2 && b[0]!.t < renderTime - BUFFER_TTL) b.shift();
    this.group.visible = this.alive;
    this.hpBar.group.visible = this.alive;
    if (!this.alive || b.length === 0) return;
    let px: number;
    let pz: number;
    if (b.length === 1) {
      px = b[0]!.x;
      pz = b[0]!.y;
      this.group.rotation.y = b[0]!.angle;
    } else {
      let i = b.length - 2;
      while (i > 0 && b[i]!.t > renderTime) i--;
      const a = b[i]!;
      const c = b[i + 1]!;
      const span = c.t - a.t;
      const f = span > 1e-6 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;
      px = a.x + (c.x - a.x) * f;
      pz = a.y + (c.y - a.y) * f;
      this.group.rotation.y = a.angle + shortAngle(a.angle, c.angle) * f;
    }
    this.group.position.set(px, 0, pz);
    this.hpBar.group.position.set(px, HP_BAR_Y, pz);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    disposeHealthBar(this.hpBar, scene);
  }
}

function shortAngle(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 本地玩家：客户端预测状态 + 表现网格 + 头顶血条（FR-C3/U1）
 *  滑铲视觉平滑（FR-C7，v0.4.1）：物理位置瞬时到位，表现网格/镜头经衰减偏移 ~0.12s 追上，
 *  把瞬时滑铲呈现为短促滑行（远端由既有快照插值自然平滑，无需处理） */
export class LocalPlayer {
  readonly group: THREE.Group;
  private readonly hpBar: HealthBar;
  x: number;
  y: number;
  angle = 0;
  hp = 100;
  alive = true;
  kills = 0;
  /** 死亡时刻（本地渲染时钟），用于重生倒计时 */
  deathAt: number | null = null;
  /** 滑铲视觉偏移（表现层）：物理位移差，随时间指数衰减到 0（镜头/网格用它追上物理位置） */
  private visualOffX = 0;
  private visualOffY = 0;

  constructor(scene: THREE.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.group = createFighterMesh(0x4fc3f7);
    scene.add(this.group);
    this.hpBar = createHealthBar();
    scene.add(this.hpBar.group);
    this.sync();
  }

  /** 位移类表现偏移（滑铲 FR-C7 / 快照和解修正 v0.4.2）：视觉从旧位置开始追上（偏移 = −位移差）。
   *  总量钳制到 VISUAL_OFFSET_MAX，防止连续修正叠加成持续滞后 */
  addVisualOffset(dx: number, dy: number): void {
    let ox = this.visualOffX - dx;
    let oy = this.visualOffY - dy;
    const mag = Math.hypot(ox, oy);
    if (mag > VISUAL_OFFSET_MAX) {
      const k = VISUAL_OFFSET_MAX / mag;
      ox *= k;
      oy *= k;
    }
    this.visualOffX = ox;
    this.visualOffY = oy;
  }

  /** 每帧衰减视觉偏移（VISUAL_SMOOTH_TAU 时间常数，~0.12s 残差 <10%）；死亡/复位时直接清零 */
  decayVisual(dt: number): void {
    if (this.visualOffX === 0 && this.visualOffY === 0) return;
    const k = decayFactor(dt, VISUAL_SMOOTH_TAU);
    this.visualOffX *= k;
    this.visualOffY *= k;
    if (Math.abs(this.visualOffX) < 0.01 && Math.abs(this.visualOffY) < 0.01) {
      this.visualOffX = 0;
      this.visualOffY = 0;
    }
  }

  resetVisual(): void {
    this.visualOffX = 0;
    this.visualOffY = 0;
  }

  /** 镜头/表现跟随位置（物理位置 + 视觉偏移） */
  get viewX(): number {
    return this.x + this.visualOffX;
  }
  get viewY(): number {
    return this.y + this.visualOffY;
  }

  sync(): void {
    this.group.visible = this.alive;
    this.group.position.set(this.viewX, 0, this.viewY);
    this.group.rotation.y = this.angle;
    // 头顶血条（FR-C3/U1）：位置随预测位置每帧更新；宽度/颜色仅在变化时改写
    this.hpBar.group.position.set(this.viewX, HP_BAR_Y, this.viewY);
    syncHealthBar(this.hpBar, this.hp, this.alive);
  }
}