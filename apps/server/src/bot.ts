/** 服务端 Bot AI（M3，FR-B2~B4）：巡逻/追击/躲避状态机 + BFS 网格寻路 + 三档难度。
 *  与玩家完全同一结算管线（FR-B4）：本模块仅合成输入意图（移动/瞄准/开火沿），权威结算在 room.ts。 */

import { isWall, raycastWalls, type BotDifficulty, type GameMap, type Vec2 } from '@DoShoot/shared';
import type { SimFighter } from './room';

export const BOT_EXTRA_SPREAD = 6;
const WANDER_TIMEOUT = 6;
/** 超过该时长仍未接近游走点则换点（卡墙兜底） */
const STUCK_TIMEOUT = 2.5;
/** 追击记忆：丢失视线后继续追向最后目击点的时长（秒） */
const CHASE_MEMORY = 4;
/** 低血量躲避阈值与持续时间（FR-B2） */
const DODGE_HP = 35;
const DODGE_TIME = 1.6;
/** 寻路重算最小间隔（秒，控制 CPU） */
const REPATH_INTERVAL = 0.4;

/** 难度画像（FR-B3：瞄准误差 / 反应延迟 / 移动激进度三档） */
interface DiffProfile {
  /** 移速系数（PLAYER_SPEED 乘数） */
  speed: number;
  /** 瞄准误差（度，作用于瞄准角） */
  aimErrorDeg: number;
  /** 发现目标到首次开火的反应延迟区间（秒） */
  reactSec: [number, number];
  /** 开火间隔区间（秒） */
  fireGapSec: [number, number];
  /** 索敌/交战距离 */
  engage: number;
  /** 移动激进度：近距离接战时是否侧向走位 */
  strafe: boolean;
}

const PROFILES: Record<BotDifficulty, DiffProfile> = {
  easy: { speed: 0.5, aimErrorDeg: 7, reactSec: [0.5, 0.9], fireGapSec: [1.6, 3.0], engage: 16, strafe: false },
  normal: { speed: 0.65, aimErrorDeg: 4, reactSec: [0.3, 0.6], fireGapSec: [1.1, 2.3], engage: 22, strafe: true },
  hard: { speed: 0.8, aimErrorDeg: 1.8, reactSec: [0.15, 0.35], fireGapSec: [0.7, 1.4], engage: 28, strafe: true },
};

type BotStateName = 'patrol' | 'chase' | 'dodge';

interface BotState {
  diff: DiffProfile;
  state: BotStateName;
  targetId: string | null;
  lastSeen: Vec2 | null;
  lastSeenAt: number;
  /** 发现目标后需等到该时刻才允许开火（反应延迟） */
  reactAt: number;
  nextFireAt: number;
  /** BFS 寻路结果（格子中心序列）与进度 */
  path: Vec2[];
  pathIdx: number;
  repathAt: number;
  dest: Vec2 | null;
  strafeDir: 1 | -1;
  strafeFlipAt: number;
  dodgeUntil: number;
  /** 卡墙检测 */
  lastX: number;
  lastY: number;
  stuckCheckAt: number;
}

const botStates = new WeakMap<SimFighter, BotState>();

/** Bot 移速系数（room.ts 移动结算用；非 Bot/未初始化回落 normal） */
export function botSpeedOf(f: SimFighter): number {
  return botStates.get(f)?.diff.speed ?? 0.65;
}

function getState(f: SimFighter, difficulty: BotDifficulty): BotState {
  let st = botStates.get(f);
  if (!st) {
    st = {
      diff: PROFILES[difficulty],
      state: 'patrol',
      targetId: null,
      lastSeen: null,
      lastSeenAt: -Infinity,
      reactAt: 0,
      nextFireAt: 0,
      path: [],
      pathIdx: 0,
      repathAt: 0,
      dest: null,
      strafeDir: 1,
      strafeFlipAt: 0,
      dodgeUntil: 0,
      lastX: f.x,
      lastY: f.y,
      stuckCheckAt: 0,
    };
    botStates.set(f, st);
  }
  return st;
}

/** 视线是否通畅（无墙阻挡） */
function losClear(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (d < 1e-6) return true;
  return raycastWalls(map, x0, y0, (x1 - x0) / d, (y1 - y0) / d, d) === null;
}

/** BFS 网格寻路（FR-B2：4 邻接，返回从起点格之后沿途的格子中心序列）；不可达返回 null */
function findPath(map: GameMap, from: Vec2, to: Vec2): Vec2[] | null {
  const W = map.width;
  const H = map.height;
  const sx = Math.max(0, Math.min(W - 1, Math.floor(from.x)));
  const sy = Math.max(0, Math.min(H - 1, Math.floor(from.y)));
  let tx = Math.max(0, Math.min(W - 1, Math.floor(to.x)));
  let ty = Math.max(0, Math.min(H - 1, Math.floor(to.y)));
  if (isWall(map, tx, ty)) {
    // 目标格是墙（如目标贴墙）：取目标周围最近的开放格
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || isWall(map, nx, ny)) continue;
        const d = Math.hypot(to.x - (nx + 0.5), to.y - (ny + 0.5));
        if (d < bestD) {
          bestD = d;
          best = [nx, ny];
        }
      }
    }
    if (!best) return null;
    tx = best[0]!;
    ty = best[1]!;
  }
  if (sx === tx && sy === ty) return [];

  const prev = new Int32Array(W * H).fill(-1);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const start = sy * W + sx;
  const goal = ty * W + tx;
  queue[tail++] = start;
  prev[start] = start;
  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === goal) break;
    const cx = cur % W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = Math.floor(cur / W) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (prev[n] !== -1 || isWall(map, nx, ny)) continue;
      prev[n] = cur;
      queue[tail++] = n;
    }
  }
  if (prev[goal] === -1) return null;
  const path: Vec2[] = [];
  let cur = goal;
  while (cur !== start) {
    path.push({ x: (cur % W) + 0.5, y: Math.floor(cur / W) + 0.5 });
    cur = prev[cur]!;
  }
  path.reverse();
  return path;
}

/** 视线内最近敌人（无遮挡） */
function findTarget(f: SimFighter, all: readonly SimFighter[], map: GameMap, engage: number): SimFighter | null {
  let target: SimFighter | null = null;
  let bestD = engage;
  for (const o of all) {
    if (o === f || !o.alive) continue;
    const d = Math.hypot(o.x - f.x, o.y - f.y);
    if (d < 1e-6 || d >= bestD) continue;
    if (losClear(map, f.x, f.y, o.x, o.y)) {
      bestD = d;
      target = o;
    }
  }
  return target;
}

/** 朝目标点瞄准（叠加难度瞄准误差，FR-B3） */
function aimAt(f: SimFighter, tx: number, ty: number, aimErrorDeg: number): void {
  const d = Math.max(Math.hypot(tx - f.x, ty - f.y), 1);
  const a = Math.atan2(tx - f.x, ty - f.y) + ((Math.random() * 2 - 1) * aimErrorDeg * Math.PI) / 180;
  f.input.aimX = f.x + Math.sin(a) * d;
  f.input.aimY = f.y + Math.cos(a) * d;
}

/** 沿寻路路径移动；带 LOS 拐角裁剪与卡墙重算 */
function followPath(f: SimFighter, st: BotState, map: GameMap, now: number): void {
  const path = st.path;
  if (st.pathIdx >= path.length) {
    f.input.moveX = 0;
    f.input.moveY = 0;
    return;
  }
  // 拐角裁剪：能直接看到更远的路点就跳过近处
  while (
    st.pathIdx + 1 < path.length &&
    losClear(map, f.x, f.y, path[st.pathIdx + 1]!.x, path[st.pathIdx + 1]!.y)
  ) {
    st.pathIdx++;
  }
  const wp = path[st.pathIdx]!;
  const dx = wp.x - f.x;
  const dy = wp.y - f.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.45) {
    st.pathIdx++;
    return;
  }
  f.input.moveX = dx / d;
  f.input.moveY = dy / d;
  // 卡墙兜底：有移动意图但位置长期不变 → 立即重算路径
  if (now >= st.stuckCheckAt) {
    if (Math.hypot(f.x - st.lastX, f.y - st.lastY) < 0.15) {
      st.repathAt = 0;
      st.dest = null;
    }
    st.lastX = f.x;
    st.lastY = f.y;
    st.stuckCheckAt = now + 1;
  }
}

function pickWanderDest(f: SimFighter, map: GameMap): Vec2 {
  for (let i = 0; i < 60; i++) {
    const x = 1.5 + Math.random() * (map.width - 3);
    const y = 1.5 + Math.random() * (map.height - 3);
    if (!isWall(map, Math.floor(x), Math.floor(y))) return { x, y };
  }
  return { x: f.x, y: f.y };
}

/** 导航到目标点：按需重算 BFS 路径并跟随 */
function navigateTo(f: SimFighter, st: BotState, map: GameMap, now: number, dest: Vec2): void {
  const destMoved = st.dest === null || Math.hypot(dest.x - st.dest.x, dest.y - st.dest.y) > 2;
  if (destMoved || (st.pathIdx >= st.path.length && now >= st.repathAt)) {
    const path = findPath(map, f, dest);
    st.path = path ?? [];
    st.pathIdx = 0;
    st.dest = { x: dest.x, y: dest.y };
    st.repathAt = now + REPATH_INTERVAL;
  }
  followPath(f, st, map, now);
}

/** 更新 Bot 输入意图（状态机：patrol → chase → dodge，FR-B2），实际结算由房间统一执行 */
export function updateBotAI(
  f: SimFighter,
  now: number,
  all: readonly SimFighter[],
  map: GameMap,
  difficulty: BotDifficulty,
): void {
  const st = getState(f, difficulty);
  const target = findTarget(f, all, map, st.diff.engage);

  if (target !== null) {
    st.targetId = target.id;
    st.lastSeen = { x: target.x, y: target.y };
    st.lastSeenAt = now;
    if (st.state === 'patrol') {
      st.state = 'chase';
      st.reactAt = now + st.diff.reactSec[0]! + Math.random() * (st.diff.reactSec[1]! - st.diff.reactSec[0]!);
    }
  } else if (st.state === 'chase' && now - st.lastSeenAt > CHASE_MEMORY) {
    st.state = 'patrol';
    st.targetId = null;
    st.lastSeen = null;
    st.dest = null;
  }

  // 低血量躲避（FR-B2）：横向撤出交火，结束后回到追击/巡逻
  if (st.state !== 'dodge' && f.hp <= DODGE_HP && (target !== null || now - st.lastSeenAt < 1)) {
    st.state = 'dodge';
    st.dodgeUntil = now + DODGE_TIME;
    st.strafeDir = Math.random() < 0.5 ? 1 : -1;
  }
  if (st.state === 'dodge' && now >= st.dodgeUntil) {
    st.state = target !== null ? 'chase' : 'patrol';
  }

  // 开火（可见且有目标时；反应延迟 + 开火间隔，FR-B3）
  if (target !== null && st.state !== 'patrol' && now >= st.reactAt && now >= st.nextFireAt) {
    st.nextFireAt = now + st.diff.fireGapSec[0]! + Math.random() * (st.diff.fireGapSec[1]! - st.diff.fireGapSec[0]!);
    f.firePresses = 1; // 走与玩家相同的开火管线（FR-B4）
    aimAt(f, target.x, target.y, st.diff.aimErrorDeg);
  } else if (st.lastSeen !== null) {
    aimAt(f, st.lastSeen.x, st.lastSeen.y, st.diff.aimErrorDeg);
  }

  // 移动：躲避 → 追击 → 巡逻
  if (st.state === 'dodge' && st.lastSeen !== null) {
    const ax = f.x - st.lastSeen.x;
    const ay = f.y - st.lastSeen.y;
    const len = Math.hypot(ax, ay) || 1;
    f.input.moveX = (ax / len) * 0.7 + (-ay / len) * st.strafeDir * 0.7;
    f.input.moveY = (ay / len) * 0.7 + (ax / len) * st.strafeDir * 0.7;
    return;
  }

  if (st.state === 'chase' && st.lastSeen !== null) {
    navigateTo(f, st, map, now, st.lastSeen);
    // 近距离激进度（FR-B3）：交火时侧向走位，周期换向
    if (st.diff.strafe && target !== null && st.pathIdx < st.path.length) {
      if (now >= st.strafeFlipAt) {
        st.strafeDir = st.strafeDir === 1 ? -1 : 1;
        st.strafeFlipAt = now + 0.8 + Math.random() * 0.7;
      }
      const mx = f.input.moveX;
      const my = f.input.moveY;
      f.input.moveX = mx * 0.6 - my * st.strafeDir * 0.55;
      f.input.moveY = my * 0.6 + mx * st.strafeDir * 0.55;
      const len = Math.hypot(f.input.moveX, f.input.moveY);
      if (len > 0.01) {
        f.input.moveX /= len;
        f.input.moveY /= len;
      }
    }
    return;
  }

  // patrol：随机游走点 + 寻路
  if (st.dest === null || now >= f.wanderUntil || now - f.wanderSince > STUCK_TIMEOUT) {
    st.dest = pickWanderDest(f, map);
    f.wanderUntil = now + WANDER_TIMEOUT;
    f.wanderSince = now;
    st.path = [];
    st.pathIdx = 0;
    st.repathAt = 0;
  }
  if (st.dest !== null) {
    const dest = st.dest;
    navigateTo(f, st, map, now, dest);
    // navigateTo 内卡墙兜底可能已把 dest 置空（等待下轮重选），需再判空
    if (st.dest !== null && Math.hypot(f.x - st.dest.x, f.y - st.dest.y) < 0.6) st.dest = null;
  }
}