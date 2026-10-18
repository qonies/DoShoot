/** M2 联网世界：本地预测（移动/开火表现，FR-N4）+ 服务端快照和解 + 远端缓冲插值（FR-N3）
 *  权威边界（FR-W5/N1）：伤害/击杀/重生/弹药最终以服务端为准；客户端预测仅用于表现。 */

import * as THREE from 'three';
import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_DELAY,
  WeaponInventory,
  resolveCircleWalls,
  resolveShot,
  type GameMap,
  type InputMsg,
  type SnapshotMsg,
  type WeaponId,
  type WelcomeMsg,
} from '@DoShoot/shared';
import { GameScene } from './scene';
import { INTERP_DELAY, LocalPlayer, RemoteEntity } from './entities';
import type { InputCommand } from './input';

export interface WorldCallbacks {
  onKill(killerName: string, victimName: string, weaponId: WeaponId): void;
  onPlayerDamaged(dmg: number): void;
  onPlayerHitEnemy(dmg: number, killed: boolean, wx: number, wy: number): void;
}

const BLOOM_PER_RECOIL = 0.6;
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
const SHAKE_PER_RECOIL = 0.05;
/** 预测弹药与权威差值超过该阈值时按快照校正 */
const AMMO_RESYNC_DIFF = 2;
/** 位置和解：误差小则渐进修正比例，误差大直接吸附 */
const RECONCILE_LERP = 0.2;
const RECONCILE_SNAP = 2;

/** 曳光池（M1 combat.ts 的表现部分保留在客户端） */
const TRACER_TTL = 0.1;
const TRACER_HEIGHT = 0.78;

class TracerPool {
  private readonly tracers: Array<{
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    ttl: number;
  }> = [];

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

export class NetWorld {
  readonly local: LocalPlayer;
  readonly inv = new WeaponInventory();
  recoilBloom = 0;
  playerKillerName: string | null = null;

  private readonly entities = new Map<string, RemoteEntity>();
  private readonly tracers: TracerPool;
  private readonly localId: string;
  private localTime = 0;
  private serverTime = 0;
  private wasDead = false;
  private seq = 0;
  private firePressesPending = 0;
  /** 权威 weaponId 与本地预测 current 不一致的起始时刻（去抖：短暂不一致是切枪快照滞后的正常表现） */
  private weaponMismatchSince: number | null = null;

  constructor(
    private readonly scene: GameScene,
    private readonly map: GameMap,
    private readonly cb: WorldCallbacks,
    welcome: WelcomeMsg,
  ) {
    this.tracers = new TracerPool(scene.scene);
    this.localId = welcome.playerId;
    const me = welcome.entities.find((e) => e.id === welcome.playerId);
    this.local = new LocalPlayer(scene.scene, me?.x ?? 0, me?.y ?? 0);
    for (const e of welcome.entities) {
      if (e.id === welcome.playerId) continue;
      this.entities.set(e.id, new RemoteEntity(scene.scene, e, welcome.time));
    }
  }

  /** 服务端快照 → 本地状态和解 + 远端缓冲 + 事件分发 */
  applySnapshot(msg: SnapshotMsg): void {
    this.serverTime = msg.time;
    const seen = new Set<string>();
    for (const e of msg.entities) {
      seen.add(e.id);
      if (e.id === this.localId) {
        this.reconcileLocal(e);
        continue;
      }
      let ent = this.entities.get(e.id);
      if (!ent) {
        ent = new RemoteEntity(this.scene.scene, e, msg.time);
        this.entities.set(e.id, ent);
      }
      ent.applySnapshot(e, msg.time);
    }
    for (const [id, ent] of this.entities) {
      if (!seen.has(id)) {
        ent.dispose(this.scene.scene);
        this.entities.delete(id);
      }
    }
    this.handleEvents(msg.events);
  }

  /** 每帧：本地预测 + 远端插值渲染 */
  update(dt: number, cmd: InputCommand, aimX: number, aimY: number): void {
    this.localTime += dt;
    this.inv.update(this.localTime);
    this.recoilBloom = Math.max(0, this.recoilBloom - BLOOM_DECAY * dt);

    if (this.local.alive) {
      this.predictMovement(cmd, dt);
      this.predictAim(aimX, aimY);
      this.predictFire(cmd);
      this.handleSwitchAndReload(cmd);
    }
    if (cmd.firePressed) this.firePressesPending++;

    this.local.sync();
    const renderTime = this.serverTime - INTERP_DELAY;
    for (const ent of this.entities.values()) ent.render(renderTime);
    this.tracers.update(dt);
  }

  /** 组装上行输入（~30Hz 由主循环节流调用） */
  buildInput(cmd: InputCommand, aimX: number, aimY: number): InputMsg {
    const alive = this.local.alive;
    const msg: InputMsg = {
      seq: ++this.seq,
      moveX: alive ? cmd.moveX : 0,
      moveY: alive ? cmd.moveY : 0,
      aimX,
      aimY,
      firing: alive && cmd.firing,
      firePressed: this.firePressesPending,
      reload: alive && cmd.reload,
      switchTo: alive ? cmd.switchTo : null,
    };
    this.firePressesPending = 0;
    return msg;
  }

  /** 自身距重生的剩余秒数（存活时为 0） */
  get playerRespawnIn(): number {
    if (!this.wasDead || this.local.deathAt === null) return 0;
    return Math.max(0, RESPAWN_DELAY - (this.localTime - this.local.deathAt));
  }

  /** 本地预测武器换弹进度（HUD 用） */
  reloadProgress(): number | null {
    return this.inv.reloadProgress(this.localTime);
  }

  private reconcileLocal(e: SnapshotMsg['entities'][number]): void {
    if (e.alive) {
      if (this.wasDead) {
        // 刚复活：直接对齐权威位置并重置预测状态
        this.wasDead = false;
        this.playerKillerName = null;
        this.local.alive = true;
        this.local.deathAt = null;
        this.local.hp = e.hp;
        this.local.kills = e.kills;
        this.local.x = e.x;
        this.local.y = e.y;
        this.inv.resetAll();
        this.weaponMismatchSince = null;
        this.recoilBloom = 0;
        return;
      }
      // 位置和解（FR-N4）：误差大吸附，小则渐进修正
      const dx = e.x - this.local.x;
      const dy = e.y - this.local.y;
      if (Math.hypot(dx, dy) > RECONCILE_SNAP) {
        this.local.x = e.x;
        this.local.y = e.y;
      } else {
        this.local.x += dx * RECONCILE_LERP;
        this.local.y += dy * RECONCILE_LERP;
      }
      this.local.hp = e.hp;
      this.local.kills = e.kills;
      // 权威武器校正：切换输入丢失/被限频丢弃时防两端 current 分叉；
      // ~250ms 去抖以容忍「客户端已预测切枪、服务端快照尚未跟上」的瞬时不一致
      if (e.weaponId !== this.inv.current) {
        if (this.weaponMismatchSince === null) {
          this.weaponMismatchSince = this.localTime;
        } else if (this.localTime - this.weaponMismatchSince > 0.25) {
          this.inv.switchTo(e.weaponId, this.localTime);
          this.weaponMismatchSince = null;
        }
      } else {
        this.weaponMismatchSince = null;
      }
      // 弹药漂移校正（权威优先）
      const st = this.inv.state;
      if (
        Math.abs(st.ammo - e.ammo) >= AMMO_RESYNC_DIFF ||
        Math.abs(st.reserve - e.reserve) >= AMMO_RESYNC_DIFF
      ) {
        this.inv.resyncAmmo(e.ammo, e.reserve);
      }
    } else if (!this.wasDead) {
      // 权威死亡（击杀者由 kill 事件补充）
      this.wasDead = true;
      this.local.alive = false;
      this.local.deathAt = this.localTime;
      this.recoilBloom = 0;
    }
  }

  private handleEvents(events: SnapshotMsg['events']): void {
    for (const ev of events) {
      if (ev.type === 'kill') {
        this.cb.onKill(ev.killerName, ev.victimName, ev.weaponId);
        if (ev.victimId === this.localId) this.playerKillerName = ev.killerName;
      } else if (ev.type === 'hit') {
        if (ev.shooterId === this.localId) {
          this.cb.onPlayerHitEnemy(ev.dmg, ev.killed, ev.x, ev.y);
        }
        if (ev.targetId === this.localId) this.cb.onPlayerDamaged(ev.dmg);
      } else {
        // 远端开火曳光（本地玩家的曳光由预测即时表现）
        if (ev.id === this.localId) continue;
        for (const s of ev.segments) this.tracers.spawn(s[0], s[1], s[2], s[3]);
      }
    }
  }

  private predictMovement(cmd: InputCommand, dt: number): void {
    const len = Math.hypot(cmd.moveX, cmd.moveY);
    if (len <= 0) return;
    const nx = this.local.x + (cmd.moveX / len) * PLAYER_SPEED * dt;
    const ny = this.local.y + (cmd.moveY / len) * PLAYER_SPEED * dt;
    const r = resolveCircleWalls(this.map, nx, ny, PLAYER_RADIUS);
    this.local.x = r.x;
    this.local.y = r.y;
  }

  private predictAim(aimX: number, aimY: number): void {
    const adx = aimX - this.local.x;
    const ady = aimY - this.local.y;
    if (Math.hypot(adx, ady) > 0.1) this.local.angle = Math.atan2(adx, ady);
  }

  /** 开火表现预测：曳光/弹药/后坐力即时反馈；伤害由服务端权威结算 */
  private predictFire(cmd: InputCommand): void {
    const spec = this.inv.spec;
    const wantFire = spec.fireMode === 'auto' ? cmd.firing : cmd.firePressed;
    if (!wantFire) return;

    if (!this.inv.canFire(this.localTime)) {
      if (this.inv.state.ammo === 0 && this.inv.state.reloadEnd === null) {
        this.inv.startReload(this.localTime);
      }
      return;
    }
    this.inv.consumeAmmo();
    this.inv.markFired(this.localTime);

    const moving = Math.hypot(cmd.moveX, cmd.moveY) > 0;
    const spread = spec.spreadDeg + (moving ? spec.moveSpreadDeg : 0) + this.recoilBloom;
    const pellets = resolveShot(
      this.map,
      this.local.x,
      this.local.y,
      this.local.angle,
      spread,
      spec,
      [], // 客户端预测不做命中伤害（服务端权威）
    );
    for (const p of pellets) {
      this.tracers.spawn(p.segment.ox, p.segment.oy, p.segment.ex, p.segment.ey);
    }

    this.recoilBloom = Math.min(MAX_BLOOM, this.recoilBloom + spec.recoil * BLOOM_PER_RECOIL);
    this.scene.addShake(spec.recoil * SHAKE_PER_RECOIL);
    if (this.inv.state.ammo === 0) this.inv.startReload(this.localTime);
  }

  private handleSwitchAndReload(cmd: InputCommand): void {
    if (cmd.switchTo !== null) this.inv.switchTo(cmd.switchTo, this.localTime);
    else if (cmd.wheel !== 0) this.inv.cycle(cmd.wheel > 0 ? 1 : -1, this.localTime);
    if (cmd.reload) this.inv.startReload(this.localTime);
  }
}