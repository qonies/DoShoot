/** 网络协议消息定义（M2 落地；集中定义于 shared，见 systemPatterns「协议」与 FR-N2/N7） */

import type { WeaponId } from './weapons';

// ---------- C2S ----------

/** 冲锋枪彩蛋模式口令上报（FR-E1）：客户端在对局中输入 4 位数字 + Enter 后发送，
 *  服务端校验 CHEAT_RUSH_CODE 后授予；仅当局有效 */
export interface RushModeMsg {
  code: string;
}

/** 进房请求（FR-N7：版本不匹配拒绝进入；M3 扩展：地图/难度选择、断线重连、武器进度上报） */
export interface JoinMsg {
  version: number;
  nickname: string;
  /** 期望地图 id（MAPS 键）；缺省/非法 = 快速加入（FR-L4，服务端分配人最多的非满房间） */
  mapId?: string;
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
}

/** 进房被拒原因 */
export type JoinRejectReason = 'version' | 'full';

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
}

/** 进房被拒（FR-N7） */
export interface JoinRejectedMsg {
  reason: JoinRejectReason;
}
