/** 权威房间模拟（FR-N1/N2）：30Hz 固定步长、输入校验与结算、伤害/击杀/重生、Bot 填充、快照广播 */

import {
  BOT_COUNT_DEFAULT,
  BOT_COUNT_OPTIONS,
  CHEAT_RUSH_CODE,
  DASH_COOLDOWN,
  DASH_DISTANCE,
  DASH_TOTAL_TIME,
  HITBOX_HALF,
  INTERP_DELAY,
  KILL_TARGET_OPTIONS,
  LAG_COMP_HISTORY,
  LAG_COMP_MAX_REWIND,
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
  TIME_LIMIT_OPTIONS,
  WEAPON_ORDER,
  WeaponInventory,
  damageAtRange,
  dashMove,
  dashProgress,
  getMap,
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
  type RoomInfoMsg,
  type RoomPlayerInfo,
  type RoomSettingsMsg,
  type RoomState,
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
/** 输入超时（秒，NFR-5）：超过该时长未收到玩家输入则清空最后意图——
 *  防止客户端切后台/网络卡顿/恶意停发时，「最后一条 firing=true/moveX=1」被无限沿用 */
const INPUT_TIMEOUT = 0.25;
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
  /** 客户端最近 RTT（ms，延迟补偿回溯 FR-N4 用；Bot 恒 0） */
  pingMs: number;
  /** 滑铲冷却截止的模拟时间（秒，FR-C7）：期内收到的 dash 意图被忽略 */
  dashReadyAt: number;
  /** 进行中的滑铲状态（FR-C7 分阶段滑行）：方向锁定 + 开始时刻 + 已走距离；
   *  每 tick 按 dashProgress 推进，DASH_TOTAL_TIME 后置 null。null = 未在滑铲 */
  dash: { dirX: number; dirY: number; startedAt: number; applied: number } | null;
  /** 最近一次收到该玩家输入的模拟时间（输入超时保护 INPUT_TIMEOUT 用） */
  lastInputAt: number;
  /** 位置历史（延迟补偿回溯，M4）：每 tick 记录，容量 ≈ LAG_COMP_HISTORY 秒 */
  hist: Array<{ t: number; x: number; y: number }>;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export class Room {
  readonly id: string;
  /** 房间号（FR-L8，4 位数字）：局域网玩家在大厅输入后按号进房 */
  readonly code: string;
  /** 房间状态（FR-L8）：waiting = 等待开局（不模拟不广播、房主可调参数）；running = 对局中 */
  state: RoomState;
  /** 房主（FR-L8）：等待态唯一可调参数/开局者；离开或断线时移交下一位真人 */
  hostId: string | null = null;
  /** 地图（FR-L8 等待态可换）：换图时全员重置出生点 */
  private map: GameMap;
  get mapId(): string {
    return this.map.id;
  }
  /** 房间变为空（无真人玩家）的时刻（FR-N6：空房 60s 后回收的计时基准）；null = 非空 */
  emptySince: number | null = null;
  /** Bot 难度（FR-B3；FR-L8 等待态可调） */
  difficulty: BotDifficulty;
  /** 对局生命周期（FR-L7；FR-L8 等待态可调）：先到击杀目标或时限即结束（FR-M1） */
  killTarget: number;
  timeLimitSec: number;
  /** 房内 Bot 数量（FR-L8，BOT_COUNT_OPTIONS；等待期间不加入，开局时按此补齐） */
  botCount: number;
  private readonly fighters = new Map<string, SimFighter>();
  private readonly inputs = new Map<string, InputMsg[]>();
  private botSeq = 0;
  private time = 0;
  private tick = 0;
  /** 对局起始（模拟时间，FR-M1）与结束标志（FR-M4） */
  private matchStart = 0;
  private matchOver = false;
  /** 最近一次对局结算事件（FR-M1/L7）：中途加入已结束房间时经 welcome 补发；对局重置时清空 */
  private lastMatchEnd: Extract<GameEvent, { type: 'matchEnd' }> | null = null;
  /** 步进外产生的事件（如 rematch），随下一次广播捎带 */
  private pendingEvents: GameEvent[] = [];
  /** accumulator 固定步长（FR-N2）：模拟按累积真实时间推进，不受 setInterval 定时器粒度影响 */
  private acc = 0;
  private lastStepReal = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly io: Server,
    map: GameMap,
    roomId: string,
    /** Bot 难度（FR-B3，等待态可调，FR-L8） */
    difficulty: BotDifficulty = 'normal',
    /** 对局生命周期（FR-L7，等待态可调）：先到击杀目标或时限即结束（FR-M1） */
    killTarget: number = MATCH_KILL_TARGET,
    timeLimitSec: number = MATCH_TIME_LIMIT,
    /** 房内 Bot 数量（FR-L8，等待态可调）：等待期间不加入，开局时按此补齐 */
    botCount: number = BOT_COUNT_DEFAULT,
    /** 房间号（FR-L8，由 RoomManager 生成传入） */
    code = '',
    /** 快速加入新建房间时立即开局（FR-L1 保持「秒进对局」）；「新建游戏」= false（等待房主开局） */
    autoStart = false,
  ) {
    this.id = roomId;
    this.code = code;
    this.map = map;
    this.difficulty = difficulty;
    this.killTarget = killTarget;
    this.timeLimitSec = timeLimitSec;
    this.botCount = botCount;
    this.state = autoStart ? 'running' : 'waiting';
    // Bot 不在构造时填充：addPlayer → adjustBots 按「状态 + botCount」补齐（等待态恒 0，开局才加入）
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
    // 空房（Bot 已清零、等待回收）或等待开局（FR-L8）：无可模拟实体/对局未开始，
    // 跳过步进与广播省 CPU；lastStepReal 照常推进，重新进房/开局时不产生积压追步
    if (this.state === 'waiting' || this.fighters.size === 0) return;
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

  addPlayer(id: string, name: string, asHost = false): void {
    const wasEmpty = this.playerCount === 0;
    const f = this.createFighter(id, name, false);
    this.fighters.set(id, f);
    this.inputs.set(id, []);
    // 空房复用（FR-N6 回收等待期 ≤60s / 首名玩家）：重置对局——不把上一场的 matchStart
    // 倒计时与「已结束」状态残留给新玩家（否则会秒结束 / 无法开火且无结算面板，卡死）
    if (wasEmpty) this.resetMatch();
    // 房主（FR-L8）：显式指定（建房者）优先；否则首位真人自动接任（房主离开后的后来者）
    if (asHost || this.hostId === null) this.hostId = id;
    this.adjustBots();
    this.emptySince = null;
    // 等待界面实时同步新成员（FR-L8）；对局中玩家列表经快照/计分板呈现，无需 roomUpdate。
    // 注意：加入者此时可能尚未 socket.join，其等待界面由 welcome.room 承载
    if (this.state === 'waiting') this.broadcastRoomInfo();
  }

  /** 对局重置（空房复用）：回合计时起点、清除已结束状态与遗留 rematch 事件 */
  private resetMatch(): void {
    this.matchOver = false;
    this.matchStart = this.time;
    this.lastMatchEnd = null;
    this.pendingEvents = this.pendingEvents.filter((e) => e.type !== 'matchReset');
    this.resetProgression();
  }

  /** 武器解锁进度按局重置（FR-A1 v0.4.1）：新局（开局/空房复用/再来一局）全员回最初级——
   *  本局各类击杀清零、层级清零、库存层级覆盖清空。跨局持久化已取消（浏览器不记忆） */
  private resetProgression(): void {
    for (const f of this.fighters.values()) {
      for (const wid of WEAPON_ORDER) {
        f.classKills[wid] = 0;
        f.tier[wid] = 0;
      }
      f.inv.resetTiers();
    }
  }

  removePlayer(id: string): void {
    this.fighters.delete(id);
    this.inputs.delete(id);
    // 房主移交（FR-L8）：房主离开时把房主权交给剩余的第一位真人；无人则置空（房间照常回收）
    if (this.hostId === id) {
      const next = [...this.fighters.values()].find((f) => !f.bot);
      this.hostId = next ? next.id : null;
    }
    this.adjustBots();
    if (this.playerCount === 0) this.emptySince = Date.now(); // FR-N6：从变空时刻起计时
    if (this.state === 'waiting') this.broadcastRoomInfo();
  }

  /** 断线（FR-N5）：对局中保留实体进入宽限期，输入清零（残影原地站立，仍可被命中）；
   *  等待开局态（FR-L8）无对局状态可保留，且模拟时钟冻结会使宽限计时失效——视作立即离开 */
  markDisconnected(id: string): void {
    if (this.state === 'waiting') {
      this.removePlayer(id);
      return;
    }
    const f = this.fighters.get(id);
    if (!f || f.disconnectAt !== null) return;
    f.disconnectAt = this.time;
    f.input.moveX = 0;
    f.input.moveY = 0;
    f.input.firing = false;
    f.firePresses = 0;
    f.dash = null; // 断线残影取消滑铲（滑行期输入不可用，防止残影继续位移）
    const q = this.inputs.get(id);
    if (q) q.length = 0;
  }

  hasFighter(id: string): boolean {
    return this.fighters.has(id);
  }

  isDisconnected(id: string): boolean {
    const f = this.fighters.get(id);
    return f !== undefined && f.disconnectAt !== null;
  }

  /** 断线重连（FR-N5）：宽限期内恢复连接；成功返回 true */
  tryRejoin(id: string): boolean {
    const f = this.fighters.get(id);
    if (!f || f.disconnectAt === null) return false;
    f.disconnectAt = null;
    return true;
  }

  // ---------- 等待房间（FR-L8） ----------

  /** 房间信息快照（等待界面 / welcome.room 消费） */
  roomInfo(): RoomInfoMsg {
    const players: RoomPlayerInfo[] = [];
    for (const f of this.fighters.values()) {
      if (f.bot) continue; // 等待界面只列真人；Bot 数量经 botCount 单独呈现
      players.push({ id: f.id, name: f.name, host: f.id === this.hostId });
    }
    return {
      code: this.code,
      hostId: this.hostId ?? '',
      state: this.state,
      mapId: this.mapId,
      difficulty: this.difficulty,
      killTarget: this.killTarget,
      timeLimitSec: this.timeLimitSec,
      botCount: this.botCount,
      capacity: ROOM_CAPACITY,
      players,
    };
  }

  /** 广播房间信息（FR-L8）：等待态任何变化（加入/离开/改参数/换房主） */
  broadcastRoomInfo(): void {
    this.io.to(this.id).emit('roomUpdate', this.roomInfo());
  }

  /** 房主调整房间参数（FR-L8）：仅等待态且房主本人；返回是否生效。
   *  换地图时全员按新图重置出生点并清位置历史（防延迟补偿按旧图坐标回溯） */
  updateSettings(byId: string, patch: RoomSettingsMsg): boolean {
    if (this.state !== 'waiting' || this.hostId !== byId) return false;
    let changed = false;
    if (typeof patch.mapId === 'string') {
      const next = getMap(patch.mapId);
      if (next && next.id !== this.map.id) {
        this.map = next;
        // 全员重新分布出生点（新图坐标系），并重置延迟补偿位置历史
        const placed: SimFighter[] = [];
        for (const f of this.fighters.values()) {
          const s = pickSpawnFarthest(this.map, placed.filter((o) => o.alive));
          f.x = s.x;
          f.y = s.y;
          f.respawnAt = null;
          f.hist.length = 0;
          f.hist.push({ t: this.time, x: f.x, y: f.y });
          placed.push(f);
        }
        changed = true;
      }
    }
    if (
      (patch.difficulty === 'easy' || patch.difficulty === 'normal' || patch.difficulty === 'hard') &&
      patch.difficulty !== this.difficulty
    ) {
      this.difficulty = patch.difficulty;
      changed = true;
    }
    if (typeof patch.killTarget === 'number' && KILL_TARGET_OPTIONS.includes(patch.killTarget) && patch.killTarget !== this.killTarget) {
      this.killTarget = patch.killTarget;
      changed = true;
    }
    if (typeof patch.timeLimitSec === 'number' && TIME_LIMIT_OPTIONS.includes(patch.timeLimitSec) && patch.timeLimitSec !== this.timeLimitSec) {
      this.timeLimitSec = patch.timeLimitSec;
      changed = true;
    }
    if (typeof patch.botCount === 'number' && BOT_COUNT_OPTIONS.includes(patch.botCount) && patch.botCount !== this.botCount) {
      this.botCount = patch.botCount;
      changed = true;
    }
    if (changed) {
      this.resetMatch(); // 参数即「下一局」的规则：重置计时基准，避免残留旧 matchStart
      this.broadcastRoomInfo();
    }
    return changed;
  }

  /** 房主开局（FR-L8）：等待态 → 对局态；按 botCount 补齐 Bot、重置对局计时。返回是否生效 */
  start(byId: string): boolean {
    if (this.state !== 'waiting' || this.hostId !== byId) return false;
    this.state = 'running';
    this.resetMatch();
    this.adjustBots();
    this.emptySince = null;
    return true;
  }

  /** 再来一局（FR-M4）：kills/deaths 清零、全员重生重置；武器解锁进度按局重置（FR-A1 v0.4.1：
   *  新一局即新游戏，全员回最初级，不再保留「生涯计数」） */
  rematch(): boolean {
    if (this.state !== 'running' || !this.matchOver) return false;
    this.matchOver = false;
    this.matchStart = this.time;
    this.lastMatchEnd = null;
    for (const f of this.fighters.values()) {
      f.kills = 0;
      f.deaths = 0;
      f.alive = false;
      f.respawnAt = this.time;
      // 断线宽限中的玩家不恢复在线（disconnectAt 保持）：否则会被「复活」成永久挂机幽灵——
      // 不被宽限清扫、也无法再凭 rejoinId 回来。其 K/D 照常清零，宽限内重连即以 0 杀
      // 随新局重生（step 的重生判定不区分断线）；未重连则照常被宽限清扫移除。
    }
    this.resetProgression();
    this.pendingEvents.push({ type: 'matchReset' });
    return true;
  }

  /** 冲锋枪彩蛋模式口令验证（FR-E1）：对局进行中输入正确 4 位口令授予；
   *  仅 running 态生效（NFR-5，体检修复批次 3）：等待态授予会在开局自带无限弹药；
   *  对局结束（endMatch）自动撤销，「不会带到下一局」由 rematch 后的 respawn resetAll 承接 */
  requestRush(id: string, code: unknown): boolean {
    if (this.state !== 'running' || this.matchOver) return false;
    const f = this.fighters.get(id);
    if (!f) return false;
    if (typeof code !== 'string' || code !== CHEAT_RUSH_CODE) return false;
    return f.inv.grantRush(this.time);
  }

  /** 入队玩家输入（非阻塞；队列满时丢弃最旧一条——最新输入携带当前状态，不可丢弃，NFR-5 限频基线）。
   *  等待开局态（FR-L8）直接丢弃：对局未开始，客户端也不应上报输入（防伪造预跑） */
  enqueueInput(id: string, msg: InputMsg): void {
    if (this.state !== 'running') return;
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
      // 本局武器解锁进度（FR-W1；v0.4.1 起按局计，新进房恒全 0，重连/中途加入用于同步层级）
      progress: me ? { ...me.classKills } : undefined,
      // 中途加入已结束对局（FR-M1/L7 修复）：补发最近一次结算，客户端据此弹出结算面板
      matchEnd: this.matchOver ? (this.lastMatchEnd ?? undefined) : undefined,
      // 房间信息（FR-L8）：客户端据此进入等待界面（waiting）或直接进对局（running）
      room: this.roomInfo(),
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
        rush: f.inv.rushActive,
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
        f.lastInputAt = now; // 心跳：任何输入都刷新（输入超时保护）
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
        // 滑铲意图（FR-C7）：方向取消息携带的归一化向量（双击方向键时的移动向量）。
        // 权威侧为「分阶段滑铲状态机」——助跑加速 → 匀速滑行 → 减速到停（DASH_TOTAL_TIME 内
        // 走完 DASH_DISTANCE，位移由后续 tick 按 dashProgress 推进，见移动阶段）；
        // 冷却期内 / 滑铲进行中重复意图忽略。滑铲中屏蔽常规移动（方向锁定），瞄准/开火不受影响
        if (msg.dash && typeof msg.dash === 'object' && f.dash === null && now >= f.dashReadyAt) {
          const dx = clampUnit(Number(msg.dash.x));
          const dy = clampUnit(Number(msg.dash.y));
          if ((dx !== 0 || dy !== 0) && Number.isFinite(dx) && Number.isFinite(dy)) {
            f.dash = { dirX: dx, dirY: dy, startedAt: now, applied: 0 };
            f.dashReadyAt = now + DASH_COOLDOWN;
          }
        }
        // 记录已消费 seq（客户端和解 ack，FR-N4）：仅接受单调递增的合法数值
        const seq = Math.floor(Number(msg.seq));
        if (Number.isFinite(seq) && seq > f.lastSeq) f.lastSeq = seq;
        // 射击者 RTT（延迟补偿回溯 FR-N4，M4）：钳制到合理区间
        const ping = Math.floor(Number(msg.pingMs) || 0);
        if (Number.isFinite(ping) && ping >= 0) f.pingMs = Math.min(500, ping);
      }
      q.length = 0;
    }

    // 1.5 输入超时保护（NFR-5）：玩家停发输入（切后台/卡顿/恶意只发一条 firing=true）时
    // 清空最后意图，避免残影持续移动/开火（服务端不会自动 reload，所以开火可持续到弹尽再循环）
    for (const f of this.fighters.values()) {
      if (f.bot || f.disconnectAt !== null) continue;
      if (now - f.lastInputAt > INPUT_TIMEOUT) {
        f.input.moveX = 0;
        f.input.moveY = 0;
        f.input.firing = false;
        f.firePresses = 0;
      }
    }

    // 2. 推进换弹完成（权威库存状态机；漏调会导致 reloadEnd 永不清除、弹尽后无法再开火）
    for (const f of this.fighters.values()) {
      f.inv.update(now);
    }

    // 3. 重生（距敌最远出生点，FR-MP3/C4；对局结束后冻结）
    for (const f of this.fighters.values()) {
      if (!this.matchOver && !f.alive && f.respawnAt !== null && now >= f.respawnAt) this.respawn(f, now);
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
      if (f.dash !== null) {
        // 滑铲进行中（FR-C7 分阶段滑行）：沿锁定方向按共享速度曲线推进——
        // 目标累计距离 = DASH_DISTANCE × dashProgress(elapsed)（解析积分，与步长无关），
        // 差量经 dashMove 分段碰撞位移（撞墙即停、不穿墙）；滑铲期屏蔽常规移动输入（方向锁定）
        moving = true;
        const elapsed = now - f.dash.startedAt;
        const target = DASH_DISTANCE * dashProgress(elapsed);
        const delta = target - f.dash.applied;
        if (delta > 0) {
          const r = dashMove(this.map, f.x, f.y, f.dash.dirX, f.dash.dirY, PLAYER_RADIUS, delta);
          f.x = r.x;
          f.y = r.y;
          f.dash.applied = target;
        }
        if (elapsed >= DASH_TOTAL_TIME) f.dash = null;
      } else {
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
      }

      if (!this.matchOver) {
        this.processFire(f, now, moving, events);
      }
      f.bloom = Math.max(0, f.bloom - BLOOM_DECAY * dt);
    }

    // 5.5 位置历史（延迟补偿 FR-N4，M4）：每 tick 记录，供命中判定按射击者视角回溯
    const histMax = Math.ceil(LAG_COMP_HISTORY / TICK_DT);
    for (const f of all) {
      if (!f.alive) continue;
      f.hist.push({ t: now, x: f.x, y: f.y });
      if (f.hist.length > histMax) f.hist.shift();
    }

    // 6. 对局结束判定（FR-M1/L7：先到 killTarget 杀或时限，均可配置）
    if (!this.matchOver) {
      const timeUp = now - this.matchStart >= this.timeLimitSec;
      const killTarget = [...this.fighters.values()].some((f) => f.kills >= this.killTarget);
      if (timeUp || killTarget) this.endMatch(killTarget ? 'kills' : 'time', events);
    }
  }

  /** 结束对局（FR-M1/M4）：冻结开火与重生，广播排名；冲锋枪彩蛋模式回合结束自动失效（FR-E1） */
  private endMatch(reason: 'kills' | 'time', events: GameEvent[]): void {
    this.matchOver = true;
    for (const f of this.fighters.values()) f.inv.revokeRush();
    const standings: StandingRow[] = [...this.fighters.values()]
      .map((f) => ({ id: f.id, name: f.name, bot: f.bot, kills: f.kills, deaths: f.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const endEvent: GameEvent = { type: 'matchEnd', reason, standings, killTarget: this.killTarget };
    this.lastMatchEnd = endEvent; // 缓存：供中途加入已结束房间的玩家经 welcome 补发（FR-M1/L7）
    events.push(endEvent);
  }

  /** 快照广播：全量快照 + 事件捎带（频率 = 唤醒频率，落在 SNAPSHOT_RATE_MIN~MAX） */
  private broadcast(events: GameEvent[]): void {
    const snapshot: SnapshotMsg = {
      version: PROTOCOL_VERSION,
      tick: this.tick,
      time: this.time,
      matchTimeLeft: this.matchOver ? null : Math.max(0, this.timeLimitSec - (this.time - this.matchStart)),
      entities: this.snapshotEntities(),
      events,
    };
    this.io.to(this.id).emit('snapshot', snapshot);
  }

  /** 处理一次开火意图：弹药/冷却校验 → 延迟补偿回溯 → 弹丸解算 → 伤害/击杀结算 → 事件 */
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

    // 延迟补偿回溯（FR-N4，M4）：玩家瞄准的是 ~INTERP_DELAY 前的插值影像 + 半程 RTT，
    // 命中判定把目标回溯到射击者视角时刻；Bot 以当前位置索敌（findTarget），回溯为 0
    const rewind = f.bot ? 0 : Math.min(LAG_COMP_MAX_REWIND, INTERP_DELAY + f.pingMs / 2000);
    const rewindT = now - rewind;
    const posAt = (o: SimFighter): { x: number; y: number } => {
      const h = o.hist;
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i]!.t <= rewindT) return h[i]!;
      }
      return h.length > 0 ? h[0]! : o;
    };

    const list: SimFighter[] = [];
    const rewound: Array<{ x: number; y: number }> = [];
    const targets: ShotTarget[] = [];
    for (const o of this.fighters.values()) {
      if (o === f || !o.alive) continue;
      const rp = posAt(o);
      list.push(o);
      rewound.push(rp);
      targets.push({
        hitbox: {
          minX: rp.x - HITBOX_HALF,
          minY: rp.y - HITBOX_HALF,
          maxX: rp.x + HITBOX_HALF,
          maxY: rp.y + HITBOX_HALF,
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
      const rp = rewound[p.hitIndex]!; // 命中反馈位置 = 回溯位置（与射击者所见一致）
      const dmg = damageAtRange(spec, p.dist);
      victim.hp = Math.max(0, victim.hp - dmg);
      const killed = victim.hp <= 0;
      events.push({
        type: 'hit',
        shooterId: f.id,
        targetId: victim.id,
        dmg,
        killed,
        x: rp.x,
        y: rp.y,
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
    if (classId === 'rush') return; // 彩蛋冲锋枪击杀不计入解锁进度（FR-E1）
    f.classKills[classId] = (f.classKills[classId] ?? 0) + 1;
    const tier = tierForKills(classId, f.classKills[classId]!);
    if (tier > (f.tier[classId] ?? 0)) {
      f.tier[classId] = tier;
      const spec = specForTier(classId, tier);
      f.inv.setTierSpec(classId, spec); // 解锁即时生效（FR-W1），当前武器满新弹匣
      events.push({ type: 'unlock', id: f.id, classId, tier, nameKey: spec.nameKey });
    }
  }

  private respawn(f: SimFighter, now: number): void {
    const enemies = [...this.fighters.values()].filter((o) => o !== f && o.alive);
    const s = pickSpawnFarthest(this.map, enemies);
    f.x = s.x;
    f.y = s.y;
    f.hp = PLAYER_HP;
    f.alive = true;
    f.respawnAt = null;
    f.bloom = 0;
    f.firePresses = 0;
    f.dash = null; // 复活取消进行中的滑铲（死亡即中断滑行）
    f.inv.resetAll();
    // 清空位置历史并写入出生点：否则延迟补偿回溯（posAt 取 t <= rewindT 的最近历史）
    // 会在复活后最长 ~400ms 内命中「死亡前的旧坐标」，表现为新出生点打不中/旧位置隔空命中
    f.hist.length = 0;
    f.hist.push({ t: now, x: f.x, y: f.y });
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
      pingMs: 0,
      dashReadyAt: 0,
      dash: null,
      lastInputAt: 0,
      hist: [],
    };
  }

  private addBot(): void {
    this.botSeq++;
    const id = `bot-${this.botSeq}`;
    this.fighters.set(id, this.createFighter(id, `BOT-${this.botSeq}`, true));
  }

  /** Bot 填充（FR-B1/L8）：保持 bots = min(botCount, 房容量 - 玩家数)；等待开局态与无人房间
   *  不加 Bot（等待期 Bot 不加入，开局 start() 时才按房主设置的 botCount 补齐；空房省 CPU） */
  private adjustBots(): void {
    const want =
      this.state === 'waiting' || this.playerCount === 0
        ? 0
        : Math.min(this.botCount, ROOM_CAPACITY - this.playerCount);
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