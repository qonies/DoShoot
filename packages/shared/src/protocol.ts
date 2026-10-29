/** 网络协议消息定义（M2 落地；集中定义于 shared，见 systemPatterns「协议」与 FR-N2/N7。
 *  v3（FR-L8 等待房间）：新增 C2S createRoom/updateRoom/startMatch、S2C roomUpdate，
 *  JoinMsg 增量 roomCode?，WelcomeMsg 增量 room?，JoinRejectReason 增量 'noRoom'） */

import type { BotDifficulty } from './constants';
import type { WeaponId } from './weapons';

// ---------- C2S ----------
// 注：`rematch`（再来一局，FR-M4）与 `leave`（主动离开/返回大厅）为无载荷消息，不定义 interface，
//     直接 socket.emit('rematch') / socket.emit('leave')。leave 语义（2026-10-24）：
//     服务端立即移除实体（不走 FR-N5 的 30s 断线宽限），与「意外断线可重连」明确区分。

/** 冲锋枪彩蛋模式口令上报（FR-E1）：客户端在对局中输入 4 位数字 + Enter 后发送，
 *  服务端校验 CHEAT_RUSH_CODE 后授予；仅当局有效 */
export interface RushModeMsg {
  code: string;
}

/** 新建游戏（FR-L8 等待房间房主）：建房进入「等待开局」态并分配房间号，
 *  房主可在等待界面调整参数（updateRoom），人齐后 startMatch 开局 */
export interface CreateRoomMsg {
  version: number;
  nickname: string;
  /** 期望地图 id（MAPS 键）；缺省/非法 = 随机地图 */
  mapId?: string;
  /** Bot 难度（FR-B3；缺省 = normal） */
  difficulty?: BotDifficulty;
  /** 武器解锁进度上报（FR-A1） */
  progress?: Partial<Record<WeaponId, number>>;
  /** 对局生命周期（FR-L7）：击杀目标（缺省/非法 = MATCH_KILL_TARGET） */
  killTarget?: number;
  /** 对局时限秒（FR-L7；缺省/非法 = MATCH_TIME_LIMIT） */
  timeLimitSec?: number;
  /** 房内 Bot 数量（FR-L8，BOT_COUNT_OPTIONS 之一；缺省/非法 = BOT_COUNT_DEFAULT） */
  botCount?: number;
}

/** 房间号加入（FR-L8）：JoinMsg 增量可选字段 */
export interface JoinMsg {
  version: number;
  nickname: string;
  /** 期望地图 id（MAPS 键）；缺省/非法 = 快速加入（FR-L4，服务端分配人最多的非满房间） */
  mapId?: string;
  /** 房间号（FR-L8，4 位数字，normalizeRoomCode 规范化）：存在则按号进房（等待态或对局中均可），
   *  缺省 = 快速加入；非法/不存在 → joinRejected 'noRoom' */
  roomCode?: string;
  /** Bot 难度（FR-B3，仅影响新创建房间的 Bot；缺省 = normal） */
  difficulty?: 'easy' | 'normal' | 'hard';
  /** 断线重连（FR-N5）：上次对局的 playerId，30s 宽限内可回原状态；不可重连时按新进房处理 */
  rejoinId?: string | null;
  /** 武器解锁进度上报（FR-A1：localStorage 基线，键 = 武器类 id，值 = 该类累计击杀数） */
  progress?: Partial<Record<WeaponId, number>>;
  /** 对局生命周期（FR-L7）：击杀目标（KILL_TARGET_OPTIONS 之一；缺省/非法 = MATCH_KILL_TARGET） */
  killTarget?: number;
  /** 对局时限秒（TIME_LIMIT_OPTIONS 之一；缺省/非法 = MATCH_TIME_LIMIT）。先到击杀目标或时限即结束 */
  timeLimitSec?: number;
  /** 房内 Bot 数量（FR-L8，BOT_COUNT_OPTIONS 之一；缺省/非法 = BOT_COUNT_DEFAULT，仅影响新建房间） */
  botCount?: number;
}

/** 进房被拒原因 */
export type JoinRejectReason = 'version' | 'full' | 'noRoom';

/** 房主在等待界面调整房间参数（FR-L8，C2S 'updateRoom'）：仅房主且等待态生效；
 *  只携带要修改的字段，全部字段经服务端白名单校验 */
export interface RoomSettingsMsg {
  mapId?: string;
  difficulty?: BotDifficulty;
  killTarget?: number;
  timeLimitSec?: number;
  botCount?: number;
}

/** 房间状态（FR-L8）：waiting = 等待开局（房主可调参数）；running = 对局中 */
export type RoomState = 'waiting' | 'running';

/** 等待界面玩家行（FR-L8） */
export interface RoomPlayerInfo {
  id: string;
  name: string;
  host: boolean;
}

/** 房间信息（FR-L8）：S2C 'roomUpdate' 载荷 + WelcomeMsg.room 增量字段；
 *  等待态任何变化（加入/离开/改参数/换房主/开局）都会广播 */
export interface RoomInfoMsg {
  /** 房间号（4 位数字） */
  code: string;
  hostId: string;
  state: RoomState;
  mapId: string;
  difficulty: BotDifficulty;
  killTarget: number;
  timeLimitSec: number;
  botCount: number;
  /** 房间人数上限（ROOM_CAPACITY） */
  capacity: number;
  players: RoomPlayerInfo[];
}

/** 玩家输入意图（FR-N1：客户端输入仅作为意图上报；客户端 ~30Hz 发送） */
export interface InputMsg {
  seq: number;
  /** 移动意图（已归一化，服务端再校验 NFR-5） */
  moveX: number;
  moveY: number;
  /** 瞄准点（世界坐标） */
  aimX: number;
  aimY: number;
  /** 全自动武器：按住状态 */
  firing: boolean;
  /** 半自动/泵动：距上一条 InputMsg 累积的开火按下沿次数 */
  firePressed: number;
  reload: boolean;
  switchTo: WeaponId | null;
  /** 客户端最近平滑 RTT（ms，M4 延迟补偿回溯用；缺省按 0 处理。增量可选字段，协议 v2 兼容） */
  pingMs?: number;
}

// ---------- S2C ----------

/** 延迟测量（M4，FR-N4）：客户端定期发 PingMsg，服务端原样回 PongMsg，客户端据此计算 RTT */
export interface PingMsg {
  t: number;
}
export interface PongMsg {
  t: number;
}

/** 快照中的单个实体状态（JSON 起步，必要时切二进制，见决策 #8） */
export interface EntitySnapshot {
  id: string;
  name: string;
  bot: boolean;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  weaponId: WeaponId;
  ammo: number;
  reserve: number;
  /** 换弹进度 0..1；未在换弹为 null */
  reloadProgress: number | null;
  kills: number;
  /** 本局死亡次数（FR-M4 结算 K/D 与计分板用） */
  deaths: number;
  /** 服务端已消费的该实体最后一条输入 seq（客户端预测和解 ack，FR-N4；非本地玩家恒 0） */
  lastSeq: number;
  /** 冲锋枪彩蛋模式激活中（FR-E1，增量可选字段，协议 v2 前后端互相兼容）；
   *  客户端据此把本地预测库存切到 rush / 撤回手枪 */
  rush?: boolean;
}

/** 结算/计分板排名行（FR-M4：排名、K/D；武器统计简化为按类击杀，见 requirements v0.3.0） */
export interface StandingRow {
  id: string;
  name: string;
  bot: boolean;
  kills: number;
  deaths: number;
}

/** 对局事件（随快照捎带，替代逐事件单独推送） */
export type GameEvent =
  /** 一次开火（含全部弹丸弹道段，客户端画曳光；本地玩家的开火由客户端预测表现，忽略此事件） */
  | { type: 'shot'; id: string; weaponId: WeaponId; segments: Array<[number, number, number, number]> }
  /** 命中结算（权威伤害；客户端用于命中标记/飘字/受击泛红） */
  | { type: 'hit'; shooterId: string; targetId: string; dmg: number; killed: boolean; x: number; y: number }
  /** 击杀（击杀流 + 死亡界面数据 + 本地武器进度持久化 FR-A1） */
  | { type: 'kill'; killerId: string; killerName: string; victimId: string; victimName: string; weaponId: WeaponId }
  /** 武器层级解锁（FR-W1：解锁即时生效；客户端对本人的事件做全屏提示） */
  | { type: 'unlock'; id: string; classId: WeaponId; tier: number; nameKey: string }
  /** 对局结束（FR-M1/M4：先到 MATCH_KILL_TARGET 杀或时限；客户端弹出结算面板；killTarget 供结算文案） */
  | { type: 'matchEnd'; reason: 'kills' | 'time'; standings: StandingRow[]; killTarget?: number }
  /** 再来一局（FR-M4：房间整体重开，kills/deaths 清零、全员重生） */
  | { type: 'matchReset' };

/** 房间快照（全量广播，V1 不做兴趣区域过滤，见 FR-N2/决策 #7） */
export interface SnapshotMsg {
  version: number;
  tick: number;
  /** 服务端模拟时间（秒），远端插值时钟基准 */
  time: number;
  /** 对局剩余秒数（FR-U5 对局倒计时）；对局已结束为 null */
  matchTimeLeft: number | null;
  entities: EntitySnapshot[];
  events: GameEvent[];
}

/** 进房成功（随后 snapshot 持续下发） */
export interface WelcomeMsg {
  version: number;
  playerId: string;
  tick: number;
  time: number;
  /** 所在房间地图 id（客户端按此渲染场景，FR-MP4） */
  mapId: string;
  entities: EntitySnapshot[];
  /** 本人武器解锁进度基线（FR-W1/A1：客户端据此同步本地 HUD 武器层级名称） */
  progress?: Partial<Record<WeaponId, number>>;
  /** 对局已结束补发（FR-M1/L7，可选增量字段，协议 v2 前后端互相兼容）：
   *  中途加入「已结束」的房间时携带最近一次 matchEnd，客户端据此弹出结算面板（可再来一局）；
   *  新开局 / 空房复用重置后的 welcome 不携带 */
  matchEnd?: Extract<GameEvent, { type: 'matchEnd' }>;
  /** 房间信息（FR-L8，v3 增量可选字段）：客户端据此进入等待界面（state=waiting）
   *  或直接进对局（state=running）；开局时服务端重发 welcome（state=running）驱动等待→对局切换 */
  room?: RoomInfoMsg;
}

/** 进房被拒（FR-N7） */
export interface JoinRejectedMsg {
  reason: JoinRejectReason;
}
