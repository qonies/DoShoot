/** M2 联网世界：本地预测（移动/开火表现，FR-N4）+ 服务端快照和解（seq ack + 未确认输入重放）+ 远端缓冲插值（FR-N3）
 *  权威边界（FR-W5/N1）：伤害/击杀/重生/弹药最终以服务端为准；客户端预测仅用于表现。 */

import * as THREE from 'three';
import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  RESPAWN_DELAY,
  WeaponInventory,
  resolveCircleWalls,
  resolveShot,
  specForTier,
  tierForKills,
  type GameMap,
  type InputMsg,
  type SnapshotMsg,
  type StandingRow,
  type WeaponId,
  type WelcomeMsg,
} from '@DoShoot/shared';
import { GameScene } from './scene';
import { sfx } from './audio';
import { INTERP_DELAY, LocalPlayer, RemoteEntity } from './entities';
import type { InputCommand } from './input';

export interface WorldCallbacks {
  onKill(killerName: string, victimName: string, weaponId: WeaponId): void;
  onPlayerDamaged(dmg: number): void;
  onPlayerHitEnemy(dmg: number, killed: boolean, wx: number, wy: number): void;
  /** 本人对某武器类解锁新层级（FR-W1 全屏提示） */
  onUnlock(nameKey: string): void;
  /** 本人击杀（FR-A1：客户端按类累计并持久化到 localStorage） */
  onOwnKill(classId: WeaponId): void;
  /** 对局结束（FR-M4 结算面板） */
  onMatchEnd(reason: 'kills' | 'time', standings: StandingRow[]): void;
  /** 再来一局重置（FR-M4：关闭结算面板） */
  onMatchReset(): void;
}

const BLOOM_PER_RECOIL = 0.6;
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
const SHAKE_PER_RECOIL = 0.05;
/** 预测弹药与权威差值超过该阈值时按快照校正 */
const AMMO_RESYNC_DIFF = 2;

/** 曳光池（M1 combat.ts 的表现部分保留在客户端） */
const TRACER_TTL = 0.1;
const TRACER_HEIGHT = 0.78;
/** 和解重放的未确认输入队列上限（防御性，防异常时无限增长） */
const MAX_PENDING_INPUTS = 120;

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
  /** 已发送但未被服务端确认的输入（快照和解时重放，FR-N4） */
  private pendingInputs: Array<{ seq: number; moveX: number; moveY: number; dt: number }> = [];
  /** 距上次发送输入累计的真实 dt */
  private inputDtAcc = 0;
  /** 权威 weaponId 与本地预测 current 不一致的起始时刻（去抖：短暂不一致是切枪快照滞后的正常表现） */
  private weaponMismatchSince: number | null = null;
  /** 最新快照实体（Tab 计分板 FR-U1） */
  lastEntities: SnapshotMsg['entities'] = [];
  /** 对局剩余秒数（FR-U5 倒计时）；已结束为 null */
  matchTimeLeft: number | null = null;
  private matchOver = false;

  get isMatchOver(): boolean {
    return this.matchOver;
  }

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
    // 应用进房进度基线（FR-W1/A1）：同步本地 HUD 武器层级
    for (const id of Object.keys(welcome.progress ?? {}) as WeaponId[]) {
      const kills = welcome.progress![id] ?? 0;
      const tier = tierForKills(id, kills);
      if (tier > 0) this.inv.setTierSpec(id, specForTier(id, tier));
    }
    for (const e of welcome.entities) {
      if (e.id === welcome.playerId) continue;
      this.entities.set(e.id, new RemoteEntity(scene.scene, e, welcome.time));
    }
  }

  get selfId(): string {
    return this.localId;
  }

  /** 服务端快照 → 本地状态和解 + 远端缓冲 + 事件分发 */
  applySnapshot(msg: SnapshotMsg): void {
    if (msg.version !== PROTOCOL_VERSION) return; // FR-N7：丢弃版本不匹配的快照（防旧服务端污染预测状态）
    this.serverTime = msg.time;
    this.matchTimeLeft = msg.matchTimeLeft;
    this.lastEntities = msg.entities;
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
    this.inputDtAcc += dt;
    this.inv.update(this.localTime);
    this.recoilBloom = Math.max(0, this.recoilBloom - BLOOM_DECAY * dt);

    if (this.local.alive) {
      this.predictMovement(cmd, dt);
      this.predictAim(aimX, aimY);
      this.predictFire(cmd);
      this.handleSwitchAndReload(cmd);
      if (cmd.firePressed) this.firePressesPending++;
    }

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
    if (alive) {
      // 记录该条输入及其覆盖的 dt，供快照和解重放（FR-N4）
      if (this.pendingInputs.length >= MAX_PENDING_INPUTS) this.pendingInputs.shift();
      this.pendingInputs.push({ seq: msg.seq, moveX: msg.moveX, moveY: msg.moveY, dt: this.inputDtAcc });
    }
    this.inputDtAcc = 0;
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
        this.pendingInputs = [];
        return;
      }
      // 位置和解（FR-N4）：对齐权威位置，再重放服务端尚未消费的输入
      //（替代朴素 lerp/吸附——消除快照滞后于本地预测造成的稳态拖影/橡皮筋）
      while (this.pendingInputs.length > 0 && this.pendingInputs[0]!.seq <= e.lastSeq) {
        this.pendingInputs.shift();
      }
      this.local.x = e.x;
      this.local.y = e.y;
      for (const p of this.pendingInputs) this.moveBy(p.moveX, p.moveY, p.dt);
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
      this.local.hp = e.hp; // 血条按权威值清零，否则 HUD 停留在死亡前数值
      this.recoilBloom = 0;
      sfx.death();
      // 死亡期间输入不被消费（服务端清队列、不 ack）；丢弃待重放输入，防止复活时位置漂移
      this.pendingInputs = [];
      this.firePressesPending = 0;
    }
  }

  private handleEvents(events: SnapshotMsg['events']): void {
    for (const ev of events) {
      if (ev.type === 'kill') {
        this.cb.onKill(ev.killerName, ev.victimName, ev.weaponId);
        if (ev.killerId === this.localId) {
          this.cb.onOwnKill(ev.weaponId); // FR-A1：本人击杀 → 客户端持久化进度
          sfx.kill();
        }
        if (ev.victimId === this.localId) this.playerKillerName = ev.killerName;
      } else if (ev.type === 'hit') {
        if (ev.shooterId === this.localId) {
          this.cb.onPlayerHitEnemy(ev.dmg, ev.killed, ev.x, ev.y);
          sfx.hit();
        }
        if (ev.targetId === this.localId) {
          this.cb.onPlayerDamaged(ev.dmg);
          sfx.hurt();
        }
      } else if (ev.type === 'shot') {
        // 远端开火曳光 + 按距离衰减/方位声像的枪声（本地玩家的开火由预测即时表现，FR-S2）
        if (ev.id === this.localId) continue;
        const o = ev.segments[0];
        const dist = o ? Math.hypot(o[0] - this.local.x, o[1] - this.local.y) : 0;
        // 空间声像（FR-S2，M4）：声源相对方位 → 左右 pan（正交俯视相机下屏幕右 ≈ 世界 +x）
        const pan = o && dist > 0.5 ? Math.max(-1, Math.min(1, (o[0] - this.local.x) / dist)) : 0;
        sfx.shoot(ev.weaponId, dist, pan);
        for (const s of ev.segments) this.tracers.spawn(s[0], s[1], s[2], s[3]);
      } else if (ev.type === 'unlock') {
        if (ev.id !== this.localId) continue;
        this.inv.setTierSpec(ev.classId, specForTier(ev.classId, ev.tier));
        sfx.unlock();
        this.cb.onUnlock(ev.nameKey);
      } else if (ev.type === 'matchEnd') {
        this.matchOver = true;
        sfx.matchEnd();
        this.cb.onMatchEnd(ev.reason, ev.standings);
      } else if (ev.type === 'matchReset') {
        this.matchOver = false;
        this.pendingInputs = [];
        this.firePressesPending = 0;
        this.weaponMismatchSince = null;
        this.cb.onMatchReset();
      }
    }
  }

  private predictMovement(cmd: InputCommand, dt: number): void {
    this.moveBy(cmd.moveX, cmd.moveY, dt);
  }

  /** 带碰撞移动（预测与和解重放共用同一实现） */
  private moveBy(moveX: number, moveY: number, dt: number): void {
    const len = Math.hypot(moveX, moveY);
    if (len <= 0) return;
    const nx = this.local.x + (moveX / len) * PLAYER_SPEED * dt;
    const ny = this.local.y + (moveY / len) * PLAYER_SPEED * dt;
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
        this.startReloadPredicted();
      }
      return;
    }
    this.inv.consumeAmmo();
    this.inv.markFired(this.localTime);
    sfx.shoot(spec.id);

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
    if (this.inv.state.ammo === 0) this.startReloadPredicted();
  }

  /** 预测侧开始换弹（含音效；弹尽自动换弹与手动 R 共用） */
  private startReloadPredicted(): void {
    if (this.inv.startReload(this.localTime)) sfx.reload();
  }

  private handleSwitchAndReload(cmd: InputCommand): void {
    if (cmd.switchTo !== null) this.inv.switchTo(cmd.switchTo, this.localTime);
    else if (cmd.wheel !== 0) this.inv.cycle(cmd.wheel > 0 ? 1 : -1, this.localTime);
    if (cmd.reload) this.startReloadPredicted();
  }
}