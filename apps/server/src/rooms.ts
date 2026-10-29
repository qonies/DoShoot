/** 房间管理与进房载荷校验（从 index.ts 抽出，2026-10-29 体检修复批次 3）：
 *  真实服务端（index.ts）与集成冒烟（scripts/net-smoke.ts）同源复用同一份实现，
 *  消除「冒烟复制路由语义」造成的覆盖盲区（选房/房间号/白名单校验漂移不会再漏检）。 */

import {
  BOT_COUNT_OPTIONS,
  DEFAULT_MAP,
  KILL_TARGET_OPTIONS,
  MAPS,
  MATCH_KILL_TARGET,
  MATCH_TIME_LIMIT,
  ROOM_CODE_LENGTH,
  ROOM_RECYCLE_MS,
  TIME_LIMIT_OPTIONS,
  getMap,
  type BotDifficulty,
  type CreateRoomMsg,
  type JoinMsg,
  type RoomSettingsMsg,
} from '@DoShoot/shared';
import type { Server } from 'socket.io';
import { Room } from './room';

/** 房间规则校验（FR-L7/L8/NFR-5）：仅接受白名单值，非法回退默认。
 *  join/createRoom 共用（两者载荷字段一致）；botCount 非法/缺省时为 undefined（透传 Room 构造默认值） */
export function sanitizeRule(raw: JoinMsg | CreateRoomMsg): {
  killTarget: number;
  timeLimitSec: number;
  botCount?: number;
} {
  const killTarget =
    typeof raw.killTarget === 'number' && KILL_TARGET_OPTIONS.includes(raw.killTarget)
      ? raw.killTarget
      : MATCH_KILL_TARGET;
  const timeLimitSec =
    typeof raw.timeLimitSec === 'number' && TIME_LIMIT_OPTIONS.includes(raw.timeLimitSec)
      ? raw.timeLimitSec
      : MATCH_TIME_LIMIT;
  const botCount =
    typeof raw.botCount === 'number' && BOT_COUNT_OPTIONS.includes(raw.botCount)
      ? raw.botCount
      : undefined;
  return { killTarget, timeLimitSec, botCount };
}

/** 等待界面参数修改校验（FR-L8/NFR-5）：白名单过滤，缺省字段不修改房间现值 */
export function sanitizeSettings(raw: RoomSettingsMsg): RoomSettingsMsg {
  const out: RoomSettingsMsg = {};
  if (raw === null || typeof raw !== 'object') return out;
  if (typeof raw.mapId === 'string' && getMap(raw.mapId)) out.mapId = raw.mapId;
  if (raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard') {
    out.difficulty = raw.difficulty;
  }
  if (typeof raw.killTarget === 'number' && KILL_TARGET_OPTIONS.includes(raw.killTarget)) {
    out.killTarget = raw.killTarget;
  }
  if (typeof raw.timeLimitSec === 'number' && TIME_LIMIT_OPTIONS.includes(raw.timeLimitSec)) {
    out.timeLimitSec = raw.timeLimitSec;
  }
  if (typeof raw.botCount === 'number' && BOT_COUNT_OPTIONS.includes(raw.botCount)) {
    out.botCount = raw.botCount;
  }
  return out;
}

/** 房间管理器（FR-L3/L4/L7/L8/N6）：按地图选房、快速加入人最多的非满房间、
 *  房间号建房/按号进房、空房 60s 回收 */
export class RoomManager {
  private readonly rooms: Room[] = [];
  private seq = 0;

  constructor(private readonly io: Server) {}

  /** 生成唯一房间号（FR-L8）：4 位数字随机，撞号重试；极端耗尽时确定性扫描 4 位区间兜底。
   *  兜底必须与 normalizeRoomCode / ROOM_CODE_LENGTH 的「恰好 4 位」约束一致——
   *  否则会生成出客户端/服务端都无法加入的房间号（此前 5 位兜底即此缺陷，已修复） */
  private newCode(): string {
    const lo = 10 ** (ROOM_CODE_LENGTH - 1);
    const hi = 10 ** ROOM_CODE_LENGTH - 1;
    for (let i = 0; i < 50; i++) {
      const code = String(lo + Math.floor(Math.random() * (hi - lo + 1)));
      if (!this.rooms.some((r) => r.code === code)) return code;
    }
    for (let c = lo; c <= hi; c++) {
      const code = String(c);
      if (!this.rooms.some((r) => r.code === code)) return code;
    }
    // 理论不可达：4 位空间共 9000 个号，远超单进程可承载房间数
    return String(lo);
  }

  /** 按房间号查房（FR-L8）：等待态与对局中均可加入；容量由调用方校验拒绝 */
  findByCode(code: string): Room | null {
    return this.rooms.find((r) => r.code === code) ?? null;
  }

  /** 选房（FR-L3/L4/L7/L8/N6）：优先「地图 + 对局生命周期规则」都相同且未满的房间；无则新建。
   *  mapId 无效（快速加入）时全局选人最多者，但优先与请求规则相同的房间（避免偏好被稀释）；
   *  规则不一致的房间不混入——对局生命周期是建房时确定的房间属性。
   *  快速加入新建的房间立即开局（FR-L1 保持秒进对局）；等待房间只能由「新建游戏」创建 */
  pick(
    mapId: string | undefined,
    difficulty: BotDifficulty,
    rule: { killTarget: number; timeLimitSec: number; botCount?: number },
  ): Room {
    const sameRule = (r: Room): boolean =>
      r.killTarget === rule.killTarget && r.timeLimitSec === rule.timeLimitSec;
    const map = getMap(mapId);
    if (map) {
      const candidates = this.rooms.filter(
        (r) => r.mapId === map.id && sameRule(r) && r.hasCapacity,
      );
      if (candidates.length > 0) {
        return candidates.reduce((a, b) => (b.playerCount > a.playerCount ? b : a));
      }
      return this.create(map.id, difficulty, rule, true);
    }
    // 快速加入（FR-L4/L7）：优先同规则中人最多的非满房间；无则随机地图新建。
    // 规则不一致的房间不混入（对局生命周期是建房时确定的房间属性，FR-L7「避免不同偏好玩家混房」）
    const openSameRule = this.rooms.filter((r) => sameRule(r) && r.hasCapacity);
    if (openSameRule.length > 0) {
      return openSameRule.reduce((a, b) => (b.playerCount > a.playerCount ? b : a));
    }
    const ids = Object.keys(MAPS);
    return this.create(ids[Math.floor(Math.random() * ids.length)]!, difficulty, rule, true);
  }

  /** 房主建房（FR-L8）：进入等待开局态并分配房间号，等人齐后由房主 startMatch */
  createRoom(
    mapId: string | undefined,
    difficulty: BotDifficulty,
    rule: { killTarget: number; timeLimitSec: number; botCount?: number },
  ): Room {
    const map = getMap(mapId);
    if (map) return this.create(map.id, difficulty, rule, false);
    const ids = Object.keys(MAPS);
    return this.create(ids[Math.floor(Math.random() * ids.length)]!, difficulty, rule, false);
  }

  /** 断线重连（FR-N5）：在任意房间中查找宽限期内的断线实体 */
  findRejoinable(fighterId: string): Room | null {
    return this.rooms.find((r) => r.hasFighter(fighterId) && r.isDisconnected(fighterId)) ?? null;
  }

  /** 空房间回收（FR-N6）：空置超过 ROOM_RECYCLE_MS 则销毁（计时基准 = 最后一名真人移除时刻；断线宽限期内的玩家仍计入） */
  sweep(): void {
    const now = Date.now();
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const r = this.rooms[i]!;
      if (r.emptySince !== null && now - r.emptySince > ROOM_RECYCLE_MS) {
        r.destroy();
        this.rooms.splice(i, 1);
        console.log(`[server] room recycled: ${r.id} (${r.mapId})`);
      }
    }
  }

  /** 全部销毁（smoke 退出路径用） */
  destroyAll(): void {
    for (const r of this.rooms) r.destroy();
    this.rooms.length = 0;
  }

  private create(
    mapId: string,
    difficulty: BotDifficulty,
    rule: { killTarget: number; timeLimitSec: number; botCount?: number },
    autoStart: boolean,
  ): Room {
    const room = new Room(
      this.io,
      getMap(mapId) ?? DEFAULT_MAP,
      `ffa-${++this.seq}`,
      difficulty,
      rule.killTarget,
      rule.timeLimitSec,
      rule.botCount, // undefined → Room 构造默认 BOT_COUNT_DEFAULT
      this.newCode(),
      autoStart,
    );
    this.rooms.push(room);
    console.log(
      `[server] room created: ${room.id} (code=${room.code}, map=${room.mapId}, bots=${difficulty}×${room.botCount}, ` +
        `rule=${room.killTarget}kills/${room.timeLimitSec}s, state=${room.state})`,
    );
    return room;
  }
}
