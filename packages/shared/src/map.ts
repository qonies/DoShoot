/** 地图数据类型与默认测试地图（见 FR-MP1/MP2/MP4：地图即数据，两端同源） */

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
  const W = 40;
  const H = 40;
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

/** 判断格 (cx, cy) 是否为墙体；越界视为墙 */
export function isWall(map: GameMap, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= map.width || cy >= map.height) return true;
  return map.grid[cy][cx] === 1;
}
