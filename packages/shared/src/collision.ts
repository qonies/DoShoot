/** 自研碰撞：圆形玩家 vs 网格墙体 + 射线检测（AABB / 网格 DDA），见技术路线「碰撞」 */

import type { GameMap } from './map';
import { isWall } from './map';

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ResolveResult {
  x: number;
  y: number;
}

/**
 * 圆形玩家 vs 网格墙体碰撞解算：对玩家包围盒覆盖到的每个墙格做圆-AABB 推出。
 * 返回修正后的位置（原位不变式：不跨墙传送）。
 */
export function resolveCircleWalls(map: GameMap, x: number, y: number, r: number): ResolveResult {
  let nx = x;
  let ny = y;
  const cx0 = Math.floor(x - r);
  const cx1 = Math.floor(x + r);
  const cy0 = Math.floor(y - r);
  const cy1 = Math.floor(y + r);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      if (!isWall(map, cx, cy)) continue;
      const minX = cx;
      const minY = cy;
      const maxX = cx + 1;
      const maxY = cy + 1;
      // 圆心到 AABB 的最近点
      const px = Math.max(minX, Math.min(nx, maxX));
      const py = Math.max(minY, Math.min(ny, maxY));
      const dx = nx - px;
      const dy = ny - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = px + (dx / d) * r;
        ny = py + (dy / d) * r;
      } else {
        // 圆心已在 AABB 内部：沿最浅方向推出
        const left = nx - minX;
        const right = maxX - nx;
        const top = ny - minY;
        const bottom = maxY - ny;
        const m = Math.min(left, right, top, bottom);
        if (m === left) nx = minX - r;
        else if (m === right) nx = maxX + r;
        else if (m === top) ny = minY - r;
        else ny = maxY + r;
      }
    }
  }
  return { x: nx, y: ny };
}

/**
 * 射线 vs 网格墙体（DDA 网格遍历）。
 * (ox, oy) 射线起点；(dx, dy) 单位方向；maxDist 最远距离。
 * 命中返回距离，未命中返回 null。
 */
export function raycastWalls(
  map: GameMap,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxDist: number,
): number | null {
  let cx = Math.floor(ox);
  let cy = Math.floor(oy);
  if (isWall(map, cx, cy)) return 0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - ox : ox - cx) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? cy + 1 - oy : oy - cy) * tDeltaY : Infinity;
  let t = 0;
  for (let i = 0; i < 512; i++) {
    if (tMaxX < tMaxY) {
      t = tMaxX;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      t = tMaxY;
      cy += stepY;
      tMaxY += tDeltaY;
    }
    if (t > maxDist) return null;
    if (isWall(map, cx, cy)) return t;
  }
  return null;
}

/** 射线 vs AABB（slab 法），返回进入距离 t（>=0）；未命中返回 null */
export function rayVsAABB(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  box: AABB,
): number | null {
  // 分量为 0 时显式做平行判定，避免 0 * Infinity = NaN 导致漏检
  let t0: number;
  let t1: number;
  if (dx === 0) {
    if (ox < box.minX || ox > box.maxX) return null;
    t0 = -Infinity;
    t1 = Infinity;
  } else {
    t0 = (box.minX - ox) / dx;
    t1 = (box.maxX - ox) / dx;
    if (t0 > t1) [t0, t1] = [t1, t0];
  }
  let s0: number;
  let s1: number;
  if (dy === 0) {
    if (oy < box.minY || oy > box.maxY) return null;
    s0 = -Infinity;
    s1 = Infinity;
  } else {
    s0 = (box.minY - oy) / dy;
    s1 = (box.maxY - oy) / dy;
    if (s0 > s1) [s0, s1] = [s1, s0];
  }
  const enter = Math.max(t0, s0);
  const exit = Math.min(t1, s1);
  if (enter > exit || exit < 0) return null;
  return Math.max(enter, 0);
}
