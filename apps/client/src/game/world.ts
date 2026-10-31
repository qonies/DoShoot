/** M2 联网世界：本地预测（移动/开火表现，FR-N4）+ 服务端快照和解（seq ack + 未确认输入重放）+ 远端缓冲插值（FR-N3）
 *  权威边界（FR-W5/N1）：伤害/击杀/重生/弹药最终以服务端为准；客户端预测仅用于表现。 */

import * as THREE from 'three';
import {
  DASH_COOLDOWN,
  DASH_DISTANCE,
  DASH_TOTAL_TIME,
  INTERP_DELAY,
  MATCH_KILL_TARGET,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  RESPAWN_DELAY,
  WeaponInventory,
  dashMove,
  dashProgress,
  nextWeaponId,
  resolveCircleWalls,
  resolveShot,
  specForTier,
  tierForKills,
  type GameEvent,
  type GameMap,
  type InputMsg,
  type SnapshotMsg,
  type StandingRow,
  type WeaponId,
  type WelcomeMsg,
} from '@DoShoot/shared';
import { GameScene } from './scene';
import { sfx } from './audio';
import { LocalPlayer, RemoteEntity } from './entities';
import { CORRECTION_SMOOTH_MAX, isSmoothableCorrection } from './smoothing';
import type { InputCommand } from './input';

export interface WorldCallbacks {
  onKill(killerName: string, victimName: string, weaponId: WeaponId): void;
  onPlayerDamaged(dmg: number): void;
  onPlayerHitEnemy(dmg: number, killed: boolean, wx: number, wy: number): void;
  /** 本人对某武器类解锁新层级（FR-W1 全屏提示） */
  onUnlock(nameKey: string): void;
  /** 对局结束（FR-M4 结算面板） */
  onMatchEnd(reason: 'kills' | 'time', standings: StandingRow[], killTarget?: number): void;
  /** 再来一局重置（FR-M4：关闭结算面板） */
  onMatchReset(): void;
  /** 冲锋枪彩蛋模式激活（FR-E1：服务端授予后经快照 rush 字段同步，客户端全屏提示） */
  onRushActivated(): void;
}

const BLOOM_PER_RECOIL = 0.6;
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
const SHAKE_PER_RECOIL = 0.05;
/** 预测弹药与权威差值超过该阈值时按快照校正 */
const AMMO_RESYNC_DIFF = 2;
/** 切枪上报后等待服务端确认的窗口（秒，FR-E1 防闪烁）：窗口内快照仍带 rush 时不回授 */
const RUSH_SWITCH_ACK_TTL = 1;

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
  /** 待上报的切枪意图（数字键直选 / 滚轮折算，FR-W4）：经 buildInput 发送后清空。
   *  修复：滚轮切枪此前只改本地预测、从不上报服务端，~250ms 后被权威 weaponId 和解「切回」 */
  private pendingSwitch: WeaponId | null = null;
  /** 待上报的滑铲意图（FR-C7）：双击触发时记账，在 buildInput（实际发送点）启动本地滑铲状态
   *  并随该条输入上报——与服务端「消费该输入时启动滑铲」的时序最接近 */
  private pendingDash: { x: number; y: number } | null = null;
  /** 进行中的本地滑铲（FR-C7 分阶段滑行）：与服务端同一 dashProgress 曲线逐帧推进；
   *  滑铲期间跳过权威位置对齐（中途硬对齐会被自身滑行进度拉回产生橡皮筋） */
  private localDash: { dirX: number; dirY: number; startedAt: number; applied: number } | null = null;
  /** 本地滑铲冷却截止时刻（本地渲染时钟秒，FR-C7）：与服务端 DASH_COOLDOWN 同值，
   *  冷却期内的双击不再记账/不再启动本地滑铲（服务端会拒绝） */
  private localDashReadyAt = 0;
  /** 已上报但未被服务端快照确认的切枪（FR-E1 防闪烁，体检修复批次 3）：
   *  pendingSwitch 在 buildInput 上报后立即清空，此后到达的旧快照可能仍带 rush=true——
   *  仅靠它防不住闪烁（窗口 ≈ 一个上行周期 ~33ms）。确认窗口内不回授 rush，
   *  避免「本地放弃 → 旧快照重新授予 → 重复全屏横幅/音效」；确认或超时后解除 */
  private switchAckPending: WeaponId | null = null;
  private switchAckAt = 0;
  /** 已发送但未被服务端确认的输入（快照和解时重放，FR-N4）。
   *  注意：滑铲进行中发送的输入记录 moveX/moveY = 0（服务端滑铲期屏蔽常规移动，重放需一致） */
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
    // 断线重连（FR-N5/E1）：重连时若原实体已处于彩蛋模式，恢复本地预测侧状态
    if (me?.rush === true) this.inv.grantRush(0);
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
    // 滑铲视觉平滑（FR-C7）：表现网格/镜头经衰减偏移追上物理位置
    this.local.decayVisual(dt);

    if (this.local.alive) {
      // 滑铲意图记账（FR-C7）：方向非零、未在滑铲且本地冷却结束时接受；实际启动在 buildInput（发送点）
      if (cmd.dash && this.localDash === null && this.localTime >= this.localDashReadyAt) {
        this.pendingDash = cmd.dash;
      }
      const dashing = this.advanceLocalDash();
      if (!dashing) this.predictMovement(cmd, dt); // 滑铲期方向锁定，屏蔽常规移动（与服务端一致）
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
    // 滑铲启动（FR-C7）：在发送点建立本地滑铲状态（与服务端消费该输入的时序最接近），
    // 位移由 advanceLocalDash 逐帧按 dashProgress 曲线推进；音效/轻震在此一次性触发
    let dash: { x: number; y: number } | undefined;
    if (alive && this.pendingDash !== null) {
      dash = this.startLocalDash(this.pendingDash);
      this.pendingDash = null;
    }
    const dashing = this.localDash !== null; // 本条输入发送时是否在滑铲（服务端会屏蔽其常规移动）
    const msg: InputMsg = {
      seq: ++this.seq,
      moveX: alive && !dashing ? cmd.moveX : 0,
      moveY: alive && !dashing ? cmd.moveY : 0,
      aimX,
      aimY,
      firing: alive && cmd.firing,
      firePressed: this.firePressesPending,
      reload: alive && cmd.reload,
      switchTo: alive ? this.pendingSwitch : null,
      ...(dash !== undefined ? { dash } : {}),
    };
    this.firePressesPending = 0;
    if (alive && this.pendingSwitch !== null) {
      // 记录「已上报待确认」的切枪：rush 回授抑制窗口自本条上报起算（FR-E1 防闪烁）
      this.switchAckPending = this.pendingSwitch;
      this.switchAckAt = this.localTime;
    }
    this.pendingSwitch = null;
    if (alive) {
      // 记录该条输入及其覆盖的 dt，供快照和解重放（FR-N4）；
      // 滑铲期输入已在 msg 中记 0 移动（与服务端屏蔽行为一致，重放不会多走）
      if (this.pendingInputs.length >= MAX_PENDING_INPUTS) this.pendingInputs.shift();
      this.pendingInputs.push({ seq: msg.seq, moveX: msg.moveX, moveY: msg.moveY, dt: this.inputDtAcc });
    }
    this.inputDtAcc = 0;
    return msg;
  }

  /** 启动本地滑铲（FR-C7 分阶段滑行）：在发送点建立状态（与服务端消费该输入的时序最接近），
   *  位移由 advanceLocalDash 逐帧按 dashProgress 曲线推进；表现反馈（音效/轻震）在此一次性触发。
   *  返回实际上报的方向向量 */
  private startLocalDash(dir: { x: number; y: number }): { x: number; y: number } {
    this.localDash = { dirX: dir.x, dirY: dir.y, startedAt: this.localTime, applied: 0 };
    this.localDashReadyAt = this.localTime + DASH_COOLDOWN;
    sfx.dash();
    this.scene.addShake(0.08);
    return { x: dir.x, y: dir.y };
  }

  /** 逐帧推进本地滑铲（FR-C7）：目标累计距离 = DASH_DISTANCE × dashProgress(elapsed)
   *  （shared 解析积分，与服务端 tick 同一函数、与步长无关），差量经 dashMove 分段碰撞位移
   *  （撞墙即停、不穿墙）；DASH_TOTAL_TIME 后结束。返回是否仍在滑铲 */
  private advanceLocalDash(): boolean {
    const d = this.localDash;
    if (d === null) return false;
    const elapsed = this.localTime - d.startedAt;
    const target = DASH_DISTANCE * dashProgress(elapsed);
    const delta = target - d.applied;
    if (delta > 0) {
      const r = dashMove(this.map, this.local.x, this.local.y, d.dirX, d.dirY, PLAYER_RADIUS, delta);
      this.local.x = r.x;
      this.local.y = r.y;
      d.applied = target;
    }
    if (elapsed >= DASH_TOTAL_TIME) {
      this.localDash = null;
      return false;
    }
    return true;
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
        this.inv.resetAll(); // 彩蛋模式跨重生保留（FR-E1）：服务端 respawn 的 resetAll 同语义
        this.weaponMismatchSince = null;
        this.switchAckPending = null;
        this.recoilBloom = 0;
        this.pendingInputs = [];
        this.local.resetVisual(); // 复活为瞬移：不做视觉平滑（死亡时已清，防御性再清一次）
        this.syncRush(e);
        return;
      }
      // 滑铲进行中（FR-C7 分阶段滑行）：位置由本地滑铲曲线驱动，跳过权威位置对齐——
      // 中途硬对齐会被自身滑行进度拉回产生橡皮筋；服务端同曲线推进，滑铲结束后的
      // 首次对齐差值（≈单向延迟的相位差）由视觉平滑吸收。此处仅推进 ack，不动位置
      if (this.localDash !== null) {
        while (this.pendingInputs.length > 0 && this.pendingInputs[0]!.seq <= e.lastSeq) {
          this.pendingInputs.shift();
        }
        return;
      }
      // 位置和解（FR-N4）：对齐权威位置，再重放服务端尚未消费的输入
      //（替代朴素 lerp/吸附——消除快照滞后于本地预测造成的稳态拖影/橡皮筋）
      const prevX = this.local.x;
      const prevY = this.local.y;
      while (this.pendingInputs.length > 0 && this.pendingInputs[0]!.seq <= e.lastSeq) {
        this.pendingInputs.shift();
      }
      this.local.x = e.x;
      this.local.y = e.y;
      for (const p of this.pendingInputs) {
        this.moveBy(p.moveX, p.moveY, p.dt);
      }
      // 和解修正走表现层平滑（v0.4.2 画面优化）：服务端 30Hz 定步 vs 客户端连续预测的相位差
      // 会让快照位置每 ~35ms 阶跃修正一次（实测平均 ~0.075 单位 ≈ 4px）——把差值转成衰减视觉
      // 偏移，相机/网格连续追上，消除移动中的画面抖动。物理位置仍为权威（瞄准/命中不受影响）；
      // 超过 RECONCILE_SMOOTH_MAX 的位移（瞬移/换图等）直接对齐，不做跨图拖影
      const cdx = this.local.x - prevX;
      const cdy = this.local.y - prevY;
      if (isSmoothableCorrection(cdx, cdy, CORRECTION_SMOOTH_MAX)) {
        this.local.addVisualOffset(cdx, cdy); // 视觉落后该修正量，随 decayVisual 连续追上
      } else {
        this.local.resetVisual();
      }
      this.local.hp = e.hp;
      this.local.kills = e.kills;
      // 冲锋枪彩蛋模式权威同步（FR-E1）：先于武器校正，grantRush 后 current='rush' 与快照一致
      this.syncRush(e);
      // 切枪确认：服务端快照已带上目标武器 → 解除 rush 回授抑制窗口（FR-E1 防闪烁）
      if (this.switchAckPending !== null && e.weaponId === this.switchAckPending) {
        this.switchAckPending = null;
      }
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
      this.switchAckPending = null;
      this.pendingDash = null;
      this.localDash = null; // 死亡中断滑铲（服务端 respawn 同样清空）
      this.local.resetVisual();
    }
  }

  /** 冲锋枪彩蛋模式快照同步（FR-E1）：rush 字段为权威状态，本地预测侧跟随（激活时回调提示一次）。
   *  本地已折算出切枪并在服务端确认窗口内（switchAckPending）时不回授 rush：避免
   *  「本地放弃 → 旧快照又授予」的闪烁与重复横幅；该切枪很快会被服务端消费并撤销 rush，
   *  两端自然对齐（窗口超时则按快照权威状态回授，防切枪输入丢失后永久卡在常规武器） */
  private syncRush(e: SnapshotMsg['entities'][number]): void {
    const switching =
      this.switchAckPending !== null && this.localTime - this.switchAckAt < RUSH_SWITCH_ACK_TTL;
    if (e.rush === true && !this.inv.rushActive && !switching) {
      this.inv.grantRush(this.localTime);
      this.cb.onRushActivated();
    } else if (e.rush !== true && this.inv.rushActive) {
      this.inv.revokeRush();
    }
  }

  /** 中途加入已结束对局（FR-M1/L7 修复）：服务端经 welcome.matchEnd 补发最近一次结算——
   *  本地置 matchOver 并弹出结算面板（与 handleEvents 的 matchEnd 分支同语义） */
  adoptMatchEnd(ev: Extract<GameEvent, { type: 'matchEnd' }>): void {
    this.matchOver = true;
    sfx.matchEnd();
    this.cb.onMatchEnd(ev.reason, ev.standings, ev.killTarget ?? MATCH_KILL_TARGET);
  }

  private handleEvents(events: SnapshotMsg['events']): void {
    for (const ev of events) {
      if (ev.type === 'kill') {
        this.cb.onKill(ev.killerName, ev.victimName, ev.weaponId);
        if (ev.killerId === this.localId) sfx.kill();
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
        this.cb.onMatchEnd(ev.reason, ev.standings, ev.killTarget ?? MATCH_KILL_TARGET);
      } else if (ev.type === 'matchReset') {
        this.matchOver = false;
        this.pendingInputs = [];
        this.firePressesPending = 0;
        this.weaponMismatchSince = null;
        this.switchAckPending = null;
        // 武器解锁进度按局重置（FR-A1 v0.4.1）：与服务端 rematch/resetProgression 同源，
        // 预测侧库存回最初级（后续 unlock 事件从 0 重新累积）
        this.inv.resetTiers();
        this.pendingDash = null;
        this.localDash = null; // 新局取消进行中的滑铲
        this.local.resetVisual();
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
    // 切枪意图统一在此折算并暂存：数字键直选，滚轮按 WEAPON_ORDER 环绕折算为目标武器
    // （shared nextWeaponId，与 WeaponInventory.cycle 同源）。pendingSwitch 持续到下一次
    // buildInput 上报为止——帧率高于上行 30Hz 时切枪指令不再丢失（FR-W4）。
    if (cmd.switchTo !== null) this.pendingSwitch = cmd.switchTo;
    else if (cmd.wheel !== 0) this.pendingSwitch = nextWeaponId(this.inv.current, cmd.wheel > 0 ? 1 : -1);
    if (this.pendingSwitch !== null) this.inv.switchTo(this.pendingSwitch, this.localTime);
    if (cmd.reload) this.startReloadPredicted();
  }
}