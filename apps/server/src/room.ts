/** 权威房间模拟（FR-N1/N2）：30Hz 固定步长、输入校验与结算、伤害/击杀/重生、Bot 填充、快照广播 */

import {
  BOT_FILL_MAX,
  HITBOX_HALF,
  MATCH_KILL_TARGET,
  MATCH_TIME_LIMIT,
  PLAYER_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  RECONNECT_GRACE,
  RESPAWN_DELAY,
  ROOM_CAPACITY,
  SIM_TICK_RATE,
  SNAPSHOT_RATE_MAX,
  WEAPON_ORDER,
  WeaponInventory,
  damageAtRange,
  pickSpawnFarthest,
  resolveCircleWalls,
  resolveShot,
  specForTier,
  tierForKills,
  type BotDifficulty,
  type EntitySnapshot,
  type GameEvent,
  type GameMap,
  type InputMsg,
  type ShotTarget,
  type SnapshotMsg,
  type StandingRow,
  type WelcomeMsg,
  type WeaponId,
} from '@DoShoot/shared';
import type { Server } from 'socket.io';
import { BOT_EXTRA_SPREAD, botSpeedOf, updateBotAI } from './bot';

const TICK_DT = 1 / SIM_TICK_RATE;
/** 后坐力准星扩散（与客户端表现参数一致） */
const BLOOM_PER_RECOIL = 0.6;
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
/** 单连接输入队列上限（限频保护，NFR-5） */
const MAX_QUEUED_INPUTS = 8;
/** 单条输入消息累积按下沿上限 */
const MAX_PRESS_PER_MSG = 3;
/** 半自动/泵动累计待发射按下沿上限（防超射速积压连发，NFR-5） */
const MAX_PENDING_PRESSES = 3;
/** 单次 interval 唤醒最多推进的模拟步数（超过则丢弃积压，防追步风暴） */
const MAX_STEPS_PER_FRAME = 8;

/** 房间内模拟实体（玩家与 Bot 同结构，Bot 由 AI 合成输入） */
export interface SimFighter {
  id: string;
  name: string;
  bot: boolean;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  kills: number;
  /** 本局死亡次数（FR-M4 K/D） */
  deaths: number;
  /** 已消费的最后一条输入 seq（客户端和解 ack，FR-N4） */
  lastSeq: number;
  respawnAt: number | null;
  inv: WeaponInventory;
  bloom: number;
  /** 待处理的半自动/泵动开火沿 */
  firePresses: number;
  /** 最新输入意图（玩家来自 InputMsg，Bot 来自 AI） */
  input: { moveX: number; moveY: number; aimX: number; aimY: number; firing: boolean };
  /** 武器解锁进度：各类累计击杀（含进房基线 FR-A1）与当前层级（FR-W1） */
  classKills: Record<WeaponId, number>;
  tier: Record<WeaponId, number>;
  /** 断线时刻（FR-N5 宽限期重连）；null = 在线 */
  disconnectAt: number | null;
  /** Bot 专用状态 */
  wander: { x: number; y: number };
  wanderUntil: number;
  wanderSince: number;
  nextFireAt: number;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export class Room {
  readonly id: string;
  readonly mapId: string;
  /** 房间创建时刻 */
  readonly createdAt = Date.now();
  /** 房间变为空（无真人玩家）的时刻（FR-N6：空房 60s 后回收的计时基准）；null = 非空 */
  emptySince: number | null = null;
  private readonly fighters = new Map<string, SimFighter>();
  private readonly inputs = new Map<string, InputMsg[]>();
  private botSeq = 0;
  private time = 0;
  private tick = 0;
  /** 对局起始（模拟时间，FR-M1）与结束标志（FR-M4） */
  private matchStart = 0;
  private matchOver = false;
  /** 步进外产生的事件（如 rematch），随下一次广播捎带 */
  private pendingEvents: GameEvent[] = [];
  /** accumulator 固定步长（FR-N2）：模拟按累积真实时间推进，不受 setInterval 定时器粒度影响 */
  private acc = 0;
  private lastStepReal = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly io: Server,
    private readonly map: GameMap,
    roomId: string,
    private readonly difficulty: BotDifficulty = 'normal',
  ) {
    this.id = roomId;
    this.mapId = map.id;
    for (let i = 0; i < BOT_FILL_MAX; i++) this.addBot();
    // interval 只负责按 1000/SNAPSHOT_RATE_MAX 唤醒；每次唤醒推进全部到期模拟步并聚合广播一次快照
    this.lastStepReal = performance.now();
    this.timer = setInterval(() => this.runFrame(), Math.round(1000 / SNAPSHOT_RATE_MAX));
  }

  destroy(): void {
    clearInterval(this.timer);
  }

  /** interval 唤醒：按累积真实时间推进全部到期模拟步，再聚合广播一次快照（跨步事件合并） */
  private runFrame(): void {
    const nowReal = performance.now();
    let elapsedMs = nowReal - this.lastStepReal;
    this.lastStepReal = nowReal;
    if (elapsedMs > 250) elapsedMs = 250; // 长时间停顿（如进程挂起）后丢弃积压
    this.acc += elapsedMs / 1000;
    const events: GameEvent[] = this.pendingEvents;
    this.pendingEvents = [];
    let steps = 0;
    while (this.acc >= TICK_DT && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= TICK_DT;
      this.step(events);
      steps++;
    }
    if (this.acc > TICK_DT * MAX_STEPS_PER_FRAME) this.acc = 0; // 防御：积压异常时清零
    if (steps > 0 || events.length > 0) this.broadcast(events);
  }

  get playerCount(): number {
    let n = 0;
    for (const f of this.fighters.values()) if (!f.bot) n++;
    return n;
  }

  get hasCapacity(): boolean {
    return this.playerCount < ROOM_CAPACITY;
  }

  addPlayer(id: string, name: string, progress?: Partial<Record<WeaponId, number>>): void {
    const f = this.createFighter(id, name, false);
    this.applyProgress(f, progress);
    this.fighters.set(id, f);
    this.inputs.set(id, []);
    this.adjustBots();
    this.emptySince = null;
  }

  removePlayer(id: string): void {
    this.fighters.delete(id);
    this.inputs.delete(id);
    this.adjustBots();
    if (this.playerCount === 0) this.emptySince = Date.now(); // FR-N6：从变空时刻起计时
  }

  /** 断线（FR-N5）：保留实体进入宽限期，输入清零（残影原地站立，仍可被命中） */
  markDisconnected(id: string): void {
    const f = this.fighters.get(id);
    if (!f || f.disconnectAt !== null) return;
    f.disconnectAt = this.time;
    f.input.moveX = 0;
    f.input.moveY = 0;
    f.input.firing = false;
    f.firePresses = 0;
    const q = this.inputs.get(id);
    if (q) q.length = 0;
  }

  hasFighter(id: string): boolean {
    return this.fighters.has(id);
  }

  isDisconnected(id: string): boolean {
    return this.fighters.get(id)?.disconnectAt !== null && this.fighters.has(id);
  }

  /** 断线重连（FR-N5）：宽限期内恢复连接；成功返回 true */
  tryRejoin(id: string): boolean {
    const f = this.fighters.get(id);
    if (!f || f.disconnectAt === null) return false;
    f.disconnectAt = null;
    return true;
  }

  /** 再来一局（FR-M4）：kills/deaths 清零、全员重生重置；武器解锁进度（生涯计数）保留 */
  rematch(): boolean {
    if (!this.matchOver) return false;
    this.matchOver = false;
    this.matchStart = this.time;
    for (const f of this.fighters.values()) {
      f.kills = 0;
      f.deaths = 0;
      f.alive = false;
      f.respawnAt = this.time;
      f.disconnectAt = null;
    }
    this.pendingEvents.push({ type: 'matchReset' });
    return true;
  }

  /** 应用进房武器进度基线（FR-A1：客户端 localStorage 上报；仅信任数值，越权在内部测试可接受） */
  private applyProgress(f: SimFighter, progress?: Partial<Record<WeaponId, number>>): void {
    for (const id of WEAPON_ORDER) {
      const kills = Math.max(0, Math.floor(Number(progress?.[id] ?? 0)) || 0);
      f.classKills[id] = kills;
      const tier = tierForKills(id, kills);
      f.tier[id] = tier;
      if (tier > 0) f.inv.setTierSpec(id, specForTier(id, tier));
    }
  }

  /** 入队玩家输入（非阻塞；队列满时丢弃最旧一条——最新输入携带当前状态，不可丢弃，NFR-5 限频基线） */
  enqueueInput(id: string, msg: InputMsg): void {
    const q = this.inputs.get(id);
    if (!q) return;
    if (q.length >= MAX_QUEUED_INPUTS) q.shift();
    q.push(msg);
  }

  /** 进房首帧全量状态 */
  welcome(playerId: string): WelcomeMsg {
    const me = this.fighters.get(playerId);
    return {
      version: PROTOCOL_VERSION,
      playerId,
      tick: this.tick,
      time: this.time,
      mapId: this.mapId,
      entities: this.snapshotEntities(),
      progress: me ? { ...me.classKills } : undefined,
    };
  }

  private snapshotEntities(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const f of this.fighters.values()) {
      out.push({
        id: f.id,
        name: f.name,
        bot: f.bot,
        x: Math.round(f.x * 100) / 100,
        y: Math.round(f.y * 100) / 100,
        angle: Math.round(f.angle * 1000) / 1000,
        hp: Math.round(f.hp),
        alive: f.alive,
        weaponId: f.inv.current,
        ammo: f.inv.state.ammo,
        reserve: f.inv.state.reserve,
        reloadProgress: f.inv.reloadProgress(this.time),
        kills: f.kills,
        deaths: f.deaths,
        lastSeq: f.lastSeq,
      });
    }
    return out;
  }

  // ---------- 模拟主循环 ----------

  private step(events: GameEvent[]): void {
    const dt = TICK_DT;
    this.time += dt;
    const now = this.time;
    this.tick++;

    // 0. 断线宽限清扫（FR-N5）：超过宽限期未重连的实体移除
    const expired: string[] = [];
    for (const f of this.fighters.values()) {
      if (f.disconnectAt !== null && now - f.disconnectAt > RECONNECT_GRACE) expired.push(f.id);
    }
    for (const id of expired) this.removePlayer(id);

    // 1. 消费玩家输入（校验 + 应用动作；断线宽限期内不消费）
    for (const [id, q] of this.inputs) {
      const f = this.fighters.get(id);
      if (!f || !f.alive || f.disconnectAt !== null) {
        q.length = 0;
        continue;
      }
      for (const msg of q) {
        f.input.moveX = clampUnit(msg.moveX);
        f.input.moveY = clampUnit(msg.moveY);
        // 瞄准回退仅对非有限值生效（0 是合法坐标，原 `Number()||` falsy 判断会误判）
        const ax = Number(msg.aimX);
        const ay = Number(msg.aimY);
        f.input.aimX = Number.isFinite(ax) ? ax : f.x;
        f.input.aimY = Number.isFinite(ay) ? ay : f.y;
        f.input.firing = msg.firing === true;
        f.firePresses = Math.min(
          MAX_PENDING_PRESSES,
          f.firePresses + Math.min(MAX_PRESS_PER_MSG, Math.max(0, Math.floor(msg.firePressed) || 0)),
        );
        if (msg.reload === true) f.inv.startReload(now);
        // switchTo 白名单校验（NFR-5）：非法 id 会让 WEAPONS[id]/inv.state 取值 undefined 而崩溃
        if (msg.switchTo !== null && msg.switchTo !== undefined && WEAPON_ORDER.includes(msg.switchTo)) {
          f.inv.switchTo(msg.switchTo, now);
        }
        // 记录已消费 seq（客户端和解 ack，FR-N4）：仅接受单调递增的合法数值
        const seq = Math.floor(Number(msg.seq));
        if (Number.isFinite(seq) && seq > f.lastSeq) f.lastSeq = seq;
      }
      q.length = 0;
    }

    // 2. 推进换弹完成（权威库存状态机；漏调会导致 reloadEnd 永不清除、弹尽后无法再开火）
    for (const f of this.fighters.values()) {
      f.inv.update(now);
    }

    // 3. 重生（距敌最远出生点，FR-MP3/C4；对局结束后冻结）
    for (const f of this.fighters.values()) {
      if (!this.matchOver && !f.alive && f.respawnAt !== null && now >= f.respawnAt) this.respawn(f);
    }

    // 4. Bot AI（合成输入，走与玩家同一管线；断线宽限期内挂机）
    const all = [...this.fighters.values()];
    for (const f of all) {
      if (f.bot && f.alive && f.disconnectAt === null) updateBotAI(f, now, all, this.map, this.difficulty);
    }

    // 5. 移动 / 瞄准 / 开火（对局结束后仅保留移动表现，停止开火与重生，FR-M4）
    for (const f of all) {
      if (!f.alive) continue;
      const adx = f.input.aimX - f.x;
      const ady = f.input.aimY - f.y;
      if (Math.hypot(adx, ady) > 0.1) f.angle = Math.atan2(adx, ady);

      let moving = false;
      const len = Math.hypot(f.input.moveX, f.input.moveY);
      if (len > 0.01) {
        moving = true;
        const speed = PLAYER_SPEED * (f.bot ? botSpeedOf(f) : 1);
        const r = resolveCircleWalls(
          this.map,
          f.x + (f.input.moveX / len) * speed * dt,
          f.y + (f.input.moveY / len) * speed * dt,
          PLAYER_RADIUS,
        );
        f.x = r.x;
        f.y = r.y;
      }

      if (!this.matchOver) {
        this.processFire(f, now, moving, events);
      }
      f.bloom = Math.max(0, f.bloom - BLOOM_DECAY * dt);
    }

    // 6. 对局结束判定（FR-M1：先到 MATCH_KILL_TARGET 杀或时限）
    if (!this.matchOver) {
      const timeUp = now - this.matchStart >= MATCH_TIME_LIMIT;
      const killTarget = [...this.fighters.values()].some((f) => f.kills >= MATCH_KILL_TARGET);
      if (timeUp || killTarget) this.endMatch(killTarget ? 'kills' : 'time', events);
    }
  }

  /** 结束对局（FR-M1/M4）：冻结开火与重生，广播排名 */
  private endMatch(reason: 'kills' | 'time', events: GameEvent[]): void {
    this.matchOver = true;
    const standings: StandingRow[] = [...this.fighters.values()]
      .map((f) => ({ id: f.id, name: f.name, bot: f.bot, kills: f.kills, deaths: f.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    events.push({ type: 'matchEnd', reason, standings });
  }

  /** 快照广播：全量快照 + 事件捎带（频率 = 唤醒频率，落在 SNAPSHOT_RATE_MIN~MAX） */
  private broadcast(events: GameEvent[]): void {
    const snapshot: SnapshotMsg = {
      version: PROTOCOL_VERSION,
      tick: this.tick,
      time: this.time,
      matchTimeLeft: this.matchOver ? null : Math.max(0, MATCH_TIME_LIMIT - (this.time - this.matchStart)),
      entities: this.snapshotEntities(),
      events,
    };
    this.io.to(this.id).emit('snapshot', snapshot);
  }

  /** 处理一次开火意图：弹药/冷却校验 → 弹丸解算 → 伤害/击杀结算 → 事件 */
  private processFire(f: SimFighter, now: number, moving: boolean, events: GameEvent[]): void {
    const spec = f.inv.spec;
    const wantFire = spec.fireMode === 'auto' ? f.input.firing : f.firePresses > 0;
    if (!wantFire) return;

    if (!f.inv.canFire(now)) {
      // 弹尽自动换弹（FR-W3）
      if (f.inv.state.ammo === 0 && f.inv.state.reloadEnd === null) f.inv.startReload(now);
      return;
    }
    f.inv.consumeAmmo();
    f.inv.markFired(now);
    if (spec.fireMode !== 'auto') f.firePresses--;

    const spread =
      spec.spreadDeg +
      (moving ? spec.moveSpreadDeg : 0) +
      f.bloom +
      (f.bot ? BOT_EXTRA_SPREAD : 0);

    const list: SimFighter[] = [];
    const targets: ShotTarget[] = [];
    for (const o of this.fighters.values()) {
      if (o === f || !o.alive) continue;
      list.push(o);
      targets.push({
        hitbox: {
          minX: o.x - HITBOX_HALF,
          minY: o.y - HITBOX_HALF,
          maxX: o.x + HITBOX_HALF,
          maxY: o.y + HITBOX_HALF,
        },
        alive: true,
      });
    }

    const pellets = resolveShot(this.map, f.x, f.y, f.angle, spread, spec, targets);
    const segments = pellets.map(
      (p) => [p.segment.ox, p.segment.oy, p.segment.ex, p.segment.ey] as [number, number, number, number],
    );
    events.push({ type: 'shot', id: f.id, weaponId: spec.id, segments });

    for (const p of pellets) {
      if (p.hitIndex === null) continue;
      const victim = list[p.hitIndex]!;
      if (!victim.alive) continue; // 同次开火先前弹丸已击杀
      const dmg = damageAtRange(spec, p.dist);
      victim.hp = Math.max(0, victim.hp - dmg);
      const killed = victim.hp <= 0;
      events.push({
        type: 'hit',
        shooterId: f.id,
        targetId: victim.id,
        dmg,
        killed,
        x: victim.x,
        y: victim.y,
      });
      if (killed) {
        victim.alive = false;
        victim.deaths++;
        victim.respawnAt = now + RESPAWN_DELAY;
        f.kills++;
        this.registerKill(f, spec.id, events);
        events.push({
          type: 'kill',
          killerId: f.id,
          killerName: f.name,
          victimId: victim.id,
          victimName: victim.name,
          weaponId: spec.id,
        });
      }
    }

    f.bloom = Math.min(MAX_BLOOM, f.bloom + spec.recoil * BLOOM_PER_RECOIL);
    if (f.inv.state.ammo === 0) f.inv.startReload(now);
  }

  /** 武器解锁进度记账（FR-W1/B5：按类累计击杀，Bot 击杀同样计入；跨阈值即时解锁并广播事件） */
  private registerKill(f: SimFighter, classId: WeaponId, events: GameEvent[]): void {
    f.classKills[classId] = (f.classKills[classId] ?? 0) + 1;
    const tier = tierForKills(classId, f.classKills[classId]!);
    if (tier > (f.tier[classId] ?? 0)) {
      f.tier[classId] = tier;
      const spec = specForTier(classId, tier);
      f.inv.setTierSpec(classId, spec); // 解锁即时生效（FR-W1），当前武器满新弹匣
      events.push({ type: 'unlock', id: f.id, classId, tier, nameKey: spec.nameKey });
    }
  }

  private respawn(f: SimFighter): void {
    const enemies = [...this.fighters.values()].filter((o) => o !== f && o.alive);
    const s = pickSpawnFarthest(this.map, enemies);
    f.x = s.x;
    f.y = s.y;
    f.hp = PLAYER_HP;
    f.alive = true;
    f.respawnAt = null;
    f.bloom = 0;
    f.firePresses = 0;
    f.inv.resetAll();
  }

  private createFighter(id: string, name: string, bot: boolean): SimFighter {
    const enemies = [...this.fighters.values()].filter((o) => o.alive);
    const s = pickSpawnFarthest(this.map, enemies);
    const classKills = {} as Record<WeaponId, number>;
    const tier = {} as Record<WeaponId, number>;
    for (const wid of WEAPON_ORDER) {
      classKills[wid] = 0;
      tier[wid] = 0;
    }
    return {
      id,
      name,
      bot,
      x: s.x,
      y: s.y,
      angle: 0,
      hp: PLAYER_HP,
      alive: true,
      kills: 0,
      deaths: 0,
      lastSeq: 0,
      respawnAt: null,
      inv: new WeaponInventory(),
      bloom: 0,
      firePresses: 0,
      input: { moveX: 0, moveY: 0, aimX: s.x, aimY: s.y - 1, firing: false },
      classKills,
      tier,
      disconnectAt: null,
      wander: { x: s.x, y: s.y },
      wanderUntil: 0,
      wanderSince: 0,
      nextFireAt: 0,
    };
  }

  private addBot(): void {
    this.botSeq++;
    const id = `bot-${this.botSeq}`;
    this.fighters.set(id, this.createFighter(id, `BOT-${this.botSeq}`, true));
  }

  /** Bot 填充（FR-B1）：保持 bots = min(BOT_FILL_MAX, 房容量 - 玩家数) */
  private adjustBots(): void {
    const want = Math.min(BOT_FILL_MAX, ROOM_CAPACITY - this.playerCount);
    const bots = [...this.fighters.values()].filter((f) => f.bot);
    let have = bots.length;
    for (let i = bots.length - 1; i >= 0 && have > want; i--) {
      this.fighters.delete(bots[i]!.id);
      have--;
    }
    while (have < want) {
      this.addBot();
      have++;
    }
  }
}