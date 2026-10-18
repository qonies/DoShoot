/** 网络协议消息定义（M2 落地；集中定义于 shared，见 systemPatterns「协议」与 FR-N2/N7） */

import type { WeaponId } from './weapons';

// ---------- C2S ----------

/** 进房请求（FR-N7：版本不匹配拒绝进入） */
export interface JoinMsg {
  version: number;
  nickname: string;
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
}

// ---------- S2C ----------

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
  /** 服务端已消费的该实体最后一条输入 seq（客户端预测和解 ack，FR-N4；非本地玩家恒 0） */
  lastSeq: number;
}

/** 对局事件（随快照捎带，替代逐事件单独推送） */
export type GameEvent =
  /** 一次开火（含全部弹丸弹道段，客户端画曳光；本地玩家的开火由客户端预测表现，忽略此事件） */
  | { type: 'shot'; id: string; weaponId: WeaponId; segments: Array<[number, number, number, number]> }
  /** 命中结算（权威伤害；客户端用于命中标记/飘字/受击泛红） */
  | { type: 'hit'; shooterId: string; targetId: string; dmg: number; killed: boolean; x: number; y: number }
  /** 击杀（击杀流 + 死亡界面数据） */
  | { type: 'kill'; killerName: string; victimId: string; victimName: string; weaponId: WeaponId };

/** 房间快照（全量广播，V1 不做兴趣区域过滤，见 FR-N2/决策 #7） */
export interface SnapshotMsg {
  version: number;
  tick: number;
  /** 服务端模拟时间（秒），远端插值时钟基准 */
  time: number;
  entities: EntitySnapshot[];
  events: GameEvent[];
}

/** 进房成功（随后 snapshot 持续下发） */
export interface WelcomeMsg {
  version: number;
  playerId: string;
  tick: number;
  time: number;
  entities: EntitySnapshot[];
}

/** 进房被拒（FR-N7） */
export interface JoinRejectedMsg {
  reason: JoinRejectReason;
}
