/** 地图数据类型与默认测试地图（见 FR-MP1/MP2/MP4：地图即数据，两端同源） */

import { MAP_HEIGHT, MAP_WIDTH } from './constants';

export interface Vec2 {
  x: number;
  y: number;
}

export interface GameMap {
  id: string;
  /** 默认英文名（i18n 回退值） */
  name: string;
  /** 显示名称的 i18n key（客户端经 t(nameKey) 本地化；服务端不使用） */
  nameKey: string;
  width: number;
  height: number;
  /** grid[y][x] === 1 表示墙体格，坐标系：x 向右、y 向下（对应世界 x/z） */
  grid: number[][];
  /** 出生点（世界坐标，格中心对齐 .5），见 FR-MP3 */
  spawns: Vec2[];
}

/** M0 测试地图「靶场」：40×40，边框墙 + 四象限 L 形掩体 + 中央高台 + 散点单箱 */
function createTestMap(): GameMap {
  const W = MAP_WIDTH;
  const H = MAP_HEIGHT;
  const grid: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 1 : 0);
    }
    grid.push(row);
  }
  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) grid[y][x] = 1;
    }
  };

  // 四象限 L 形掩体（对称）
  fill(8, 8, 12, 8); fill(8, 9, 8, 12);
  fill(27, 8, 31, 8); fill(31, 9, 31, 12);
  fill(8, 31, 12, 31); fill(8, 27, 8, 30);
  fill(27, 31, 31, 31); fill(31, 27, 31, 30);
  // 中央高台
  fill(18, 18, 21, 21);
  // 散点单箱
  fill(5, 20, 5, 20); fill(34, 19, 34, 19);
  fill(20, 5, 20, 5); fill(19, 34, 19, 34);
  fill(14, 14, 14, 14); fill(25, 25, 25, 25);
  fill(25, 14, 25, 14); fill(14, 25, 14, 25);

  return {
    id: 'range',
    name: 'Range',
    nameKey: 'map.range',
    width: W,
    height: H,
    grid,
    spawns: [
      { x: 2.5, y: 2.5 },
      { x: 37.5, y: 2.5 },
      { x: 2.5, y: 37.5 },
      { x: 37.5, y: 37.5 },
      { x: 20.0, y: 2.5 },
      { x: 20.0, y: 37.5 },
      { x: 2.5, y: 20.0 },
      { x: 37.5, y: 20.0 },
    ],
  };
}

export const DEFAULT_MAP: GameMap = createTestMap();

/** M3 第二张地图「狭巷」（FR-MP2 狭巷近战型）：32×32，四角建筑群 + 中央广场 + 十字巷道，交战距离短 */
function createAlleyMap(): GameMap {
  const W = 32;
  const H = 32;
  const grid: number[][] = [];
  for (let y = 0; y < H; y++) {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 1 : 0);
    }
    grid.push(row);
  }
  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) grid[y]![x] = 1;
    }
  };

  // 四角建筑群（5×5，其间留 2~4 格宽巷道）
  fill(4, 4, 9, 9);
  fill(22, 4, 27, 9);
  fill(4, 22, 9, 27);
  fill(22, 22, 27, 27);
  // 中央广场四角掩体（广场 12..19 开阔）
  fill(12, 12, 13, 13); fill(18, 12, 19, 13);
  fill(12, 18, 13, 19); fill(18, 18, 19, 19);
  // 通往广场的狭巷口短墙（巷道 2 格宽）
  fill(14, 8, 17, 9);
  fill(14, 22, 17, 23);
  fill(8, 14, 9, 17);
  fill(22, 14, 23, 17);
  // 巷内散箱
  fill(6, 15, 6, 16); fill(25, 15, 25, 16);
  fill(15, 6, 16, 6); fill(15, 25, 16, 25);

  return {
    id: 'alley',
    name: 'Alley',
    nameKey: 'map.alley',
    width: W,
    height: H,
    grid,
    spawns: [
      { x: 2.5, y: 2.5 },
      { x: 29.5, y: 2.5 },
      { x: 2.5, y: 29.5 },
      { x: 29.5, y: 29.5 },
      { x: 16.0, y: 2.5 },
      { x: 16.0, y: 29.5 },
      { x: 2.5, y: 16.0 },
      { x: 29.5, y: 16.0 },
    ],
  };
}

/** 地图注册表（FR-MP4：一处定义两端使用；服务端按 mapId 建房，客户端大厅选择） */
export const MAPS: Record<string, GameMap> = {
  range: DEFAULT_MAP,
  alley: createAlleyMap(),
};

/** 按 id 取地图；未知 id 返回 null（由调用方回退默认图） */
export function getMap(id: string | null | undefined): GameMap | null {
  if (!id) return null;
  return MAPS[id] ?? null;
}

/** 判断格 (cx, cy) 是否为墙体；越界视为墙 */
export function isWall(map: GameMap, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return true;
  return map.grid[cy][cx] === 1;
}

/**
 * 出生点选择（FR-MP3）：返回距所有敌人最远的出生点；无敌人时随机。
 */
export function pickSpawnFarthest(map: GameMap, enemies: readonly Vec2[]): Vec2 {
  if (map.spawns.length === 0) return { x: map.width / 2, y: map.height / 2 };
  if (enemies.length === 0) {
    return map.spawns[Math.floor(Math.random() * map.spawns.length)]!;
  }
  let best = map.spawns[0]!;
  let bestScore = -1;
  for (const s of map.spawns) {
    let minD = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(s.x - e.x, s.y - e.y);
      if (d < minD) minD = d;
    }
    if (minD > bestScore) {
      bestScore = minD;
      best = s;
    }
  }
  return best;
}
