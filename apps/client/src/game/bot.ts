/** 基础 Bot 假人（M1 占位 AI：随机游走 + 视线内最近敌人点射；巡逻/追击/躲避状态机与网格寻路在 M3，见 FR-B1~B5） */

import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WEAPONS,
  isWall,
  raycastWalls,
  resolveCircleWalls,
  type GameMap,
  type WeaponId,
} from '@deadshot/shared';
import { fireWeapon, type TracerPool } from './combat';
import type { Fighter } from './fighter';

const BOT_SPEED_FACTOR = 0.65;
const BOT_ENGAGE_RANGE = 24;
const BOT_EXTRA_SPREAD = 6;
const BOT_FIRE_GAP_MIN = 1.2;
const BOT_FIRE_GAP_MAX = 2.4;
const WANDER_TIMEOUT = 6;

export interface BotHandlers {
  onKill(killer: Fighter, victim: Fighter, weaponId: WeaponId): void;
  onPlayerDamaged(dmg: number): void;
}

export class Bot {
  private wander = { x: 0, y: 0 };
  private wanderUntil = 0;
  private nextFireAt = 0;

  constructor(
    readonly fighter: Fighter,
    private readonly map: GameMap,
    private readonly tracers: TracerPool,
  ) {
    this.pickWander(0);
  }

  update(dt: number, now: number, fighters: readonly Fighter[], h: BotHandlers): void {
    const f = this.fighter;
    if (!f.alive) return;

    // 索敌：视线内最近的其他存活实体
    let target: Fighter | null = null;
    let bestD = BOT_ENGAGE_RANGE;
    for (const o of fighters) {
      if (o === f || !o.alive) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < 1e-6 || d >= bestD) continue;
      const blocked = raycastWalls(this.map, f.x, f.y, (o.x - f.x) / d, (o.y - f.y) / d, d);
      if (blocked === null) {
        bestD = d;
        target = o;
      }
    }

    if (target !== null) {
      f.aimAngle = Math.atan2(target.x - f.x, target.y - f.y);
      if (now >= this.nextFireAt) {
        this.nextFireAt = now + BOT_FIRE_GAP_MIN + Math.random() * (BOT_FIRE_GAP_MAX - BOT_FIRE_GAP_MIN);
        const spec = WEAPONS.ar;
        fireWeapon({
          pool: this.tracers,
          map: this.map,
          shooter: f,
          targets: fighters.filter((o) => o !== f && o.alive),
          spec,
          ox: f.x,
          oy: f.y,
          aimAngle: f.aimAngle,
          spreadDeg: spec.spreadDeg + BOT_EXTRA_SPREAD,
          onHit: (t, dmg, _dist, killed) => {
            if (t.isPlayer) h.onPlayerDamaged(dmg);
            if (killed) h.onKill(f, t, spec.id);
          },
        });
      }
    }

    // 占位移动：向随机游走点前进（卡住自动换点）
    const dx = this.wander.x - f.x;
    const dy = this.wander.y - f.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.6 || now >= this.wanderUntil) {
      this.pickWander(now);
      return;
    }
    const step = PLAYER_SPEED * BOT_SPEED_FACTOR * dt;
    const bx = f.x;
    const by = f.y;
    const r = resolveCircleWalls(this.map, f.x + (dx / d) * step, f.y + (dy / d) * step, PLAYER_RADIUS);
    f.x = r.x;
    f.y = r.y;
    if (Math.hypot(f.x - bx, f.y - by) < step * 0.25) this.pickWander(now);
  }

  private pickWander(now: number): void {
    for (let i = 0; i < 60; i++) {
      const x = 1.5 + Math.random() * (this.map.width - 3);
      const y = 1.5 + Math.random() * (this.map.height - 3);
      if (!isWall(this.map, Math.floor(x), Math.floor(y))) {
        this.wander = { x, y };
        this.wanderUntil = now + WANDER_TIMEOUT;
        return;
      }
    }
    this.wanderUntil = now + 1;
  }
}