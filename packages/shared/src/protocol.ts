/** 网络协议消息定义（M0 占位，M2 联机时启用；集中定义于 shared，见 systemPatterns「协议」） */

import { PROTOCOL_VERSION } from './constants';

export const PROTOCOL = { version: PROTOCOL_VERSION } as const;

/** C2S：玩家输入意图（FR-N1：客户端输入仅作为意图上报） */
export interface InputMsg {
  seq: number;
  /** 移动意图，各分量 -1..1 */
  moveX: number;
  moveY: number;
  /** 瞄准点（世界坐标） */
  aimX: number;
  aimY: number;
  firing: boolean;
  /** 客户端时间戳（服务端延迟补偿回溯用，见 FR-N4） */
  timestamp: number;
}

/** S2C：快照中的单个实体状态 */
export interface EntitySnapshot {
  id: string;
  x: number;
  y: number;
  angle: number;
}

/** S2C：房间快照（增量 schema 于 M2 在此扩展；编码布局见决策记录 #8） */
export interface SnapshotMsg {
  version: number;
  tick: number;
  entities: EntitySnapshot[];
}
