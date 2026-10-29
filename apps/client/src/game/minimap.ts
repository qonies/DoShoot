/** 小地图（FR-U2，M4）：左上角 canvas——墙体轮廓预渲染 + 自己位置/朝向；V1 不显示敌人（同类产品惯例） */

import { isWall, type GameMap } from '@DoShoot/shared';

const SIZE = 150;
const PAD = 8;

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  /** 墙体预渲染底图（每局一张，避免每帧重绘全部格子） */
  private readonly base: HTMLCanvasElement;
  private readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(canvas: HTMLCanvasElement, map: GameMap) {
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.scale = Math.min((SIZE - PAD * 2) / map.width, (SIZE - PAD * 2) / map.height);
    this.ox = (SIZE - map.width * this.scale) / 2;
    this.oy = (SIZE - map.height * this.scale) / 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context unavailable');
    this.ctx = ctx;

    const base = document.createElement('canvas');
    base.width = SIZE;
    base.height = SIZE;
    const b = base.getContext('2d')!;
    b.fillStyle = 'rgba(13, 17, 22, 0.78)';
    b.fillRect(0, 0, SIZE, SIZE);
    b.strokeStyle = '#2c3440';
    b.strokeRect(this.ox, this.oy, map.width * this.scale, map.height * this.scale);
    b.fillStyle = '#55606c';
    const cell = Math.ceil(this.scale);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isWall(map, x, y)) {
          b.fillRect(this.ox + x * this.scale, this.oy + y * this.scale, cell, cell);
        }
      }
    }
    this.base = base;
  }

  /** 每帧：底图 + 自己（三角朝向，与世界观 y 向下一致） */
  update(x: number, y: number, angle: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, SIZE, SIZE);
    c.drawImage(this.base, 0, 0);
    const px = this.ox + x * this.scale;
    const py = this.oy + y * this.scale;
    const r = 5;
    const dx = Math.sin(angle);
    const dy = Math.cos(angle);
    const bx = dy; // 垂直于朝向
    const by = -dx;
    c.fillStyle = '#4fc3f7';
    c.beginPath();
    c.moveTo(px + dx * r, py + dy * r);
    c.lineTo(px - bx * r * 0.7 - dx * r * 0.5, py - by * r * 0.7 - dy * r * 0.5);
    c.lineTo(px + bx * r * 0.7 - dx * r * 0.5, py + by * r * 0.7 - dy * r * 0.5);
    c.closePath();
    c.fill();
  }
}