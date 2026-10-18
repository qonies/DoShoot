/** 服务端 Bot 占位 AI（与 M1 同策略：随机游走 + 视线内最近敌人点射；巡逻/追击/躲避状态机与网格寻路在 M3，见 FR-B1~B5） */

import { isWall, raycastWalls, type GameMap } from '@deadshot/shared';
import type { SimFighter } from './room';

export const BOT_SPEED_FACTOR = 0.65;
export const BOT_ENGAGE_RANGE = 24;
export const BOT_EXTRA_SPREAD = 6;
const BOT_FIRE_GAP_MIN = 1.2;
const BOT_FIRE_GAP_MAX = 2.4;
const WANDER_TIMEOUT = 6;
/** 超过该时长仍未接近游走点则换点（卡墙兜底） */
const STUCK_TIMEOUT = 2.5;

/** 更新 Bot 输入意图（移动/瞄准/开火沿），实际结算由房间统一执行 */
export function updateBotAI(
  f: SimFighter,
  now: number,
  all: readonly SimFighter[],
  map: GameMap,
): void {
  // 索敌：视线内最近的其他存活实体
  let target: SimFighter | null = null;
  let bestD = BOT_ENGAGE_RANGE;
  for (const o of all) {
    if (o === f || !o.alive) continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < 1e-6 || d >= bestD) continue;
    const blocked = raycastWalls(map, f.x, f.y, (o.x - f.x) / d, (o.y - f.y) / d, d);
    if (blocked === null) {
      bestD = d;
      target = o;
    }
  }

  if (target !== null) {
    f.input.aimX = target.x;
    f.input.aimY = target.y;
    if (now >= f.nextFireAt) {
      f.nextFireAt = now + BOT_FIRE_GAP_MIN + Math.random() * (BOT_FIRE_GAP_MAX - BOT_FIRE_GAP_MIN);
      f.firePresses = 1; // 走与玩家相同的开火管线
    }
  }

  // 游走移动
  const dx = f.wander.x - f.x;
  const dy = f.wander.y - f.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.6 || now >= f.wanderUntil || now - f.wanderSince > STUCK_TIMEOUT) {
    pickWander(f, map, now);
    return;
  }
  f.input.moveX = dx / d;
  f.input.moveY = dy / d;
}

function pickWander(f: SimFighter, map: GameMap, now: number): void {
  f.input.moveX = 0;
  f.input.moveY = 0;
  for (let i = 0; i < 60; i++) {
    const x = 1.5 + Math.random() * (map.width - 3);
    const y = 1.5 + Math.random() * (map.height - 3);
    if (!isWall(map, Math.floor(x), Math.floor(y))) {
      f.wander = { x, y };
      f.wanderUntil = now + WANDER_TIMEOUT;
      f.wanderSince = now;
      return;
    }
  }
  f.wanderUntil = now + 1;
  f.wanderSince = now;
}