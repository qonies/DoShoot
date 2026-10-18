/** 对局世界（M1 单机权威）：实体管理、玩家武器流程、Bot、伤害/击杀/重生（FR-C3/C4；M2 联机时此层迁移至服务端） */

import {
  PLAYER_RADIUS,
  PLAYER_SPEED,
  RESPAWN_DELAY,
  pickSpawnFarthest,
  resolveCircleWalls,
  type GameMap,
  type WeaponId,
} from '@deadshot/shared';
import { Fighter } from './fighter';
import { Bot, type BotHandlers } from './bot';
import { WeaponInventory } from './weapons';
import { TracerPool, fireWeapon } from './combat';
import type { GameScene } from './scene';
import type { InputCommand } from './input';

export interface WorldCallbacks {
  onKill(killerName: string, victimName: string, weaponId: WeaponId): void;
  onPlayerDamaged(dmg: number): void;
  onPlayerDeath(): void;
  onPlayerRespawn(): void;
  onPlayerHitEnemy(dmg: number, killed: boolean, wx: number, wy: number): void;
}

/** 每点后坐力系数带来的准星扩散（度） */
const BLOOM_PER_RECOIL = 0.6;
/** 扩散每秒回落（度/秒） */
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
/** 每点后坐力系数带来的镜头震动 */
const SHAKE_PER_RECOIL = 0.05;
const BOT_COUNT = 5;
const BOT_COLORS = [0xe57373, 0xffb74d, 0xba68c8, 0x4db6ac, 0xaed581];

export class World {
  /** 对局累计时间（秒），作为全实体统一时钟 */
  time = 0;
  readonly player: Fighter;
  readonly bots: Bot[] = [];
  readonly fighters: Fighter[] = [];
  readonly inv = new WeaponInventory();
  playerKills = 0;
  /** 玩家连续开火累积的准星扩散（度） */
  recoilBloom = 0;
  /** 玩家最近一次被谁击杀（重生界面显示用） */
  playerKillerName: string | null = null;

  private readonly map: GameMap;
  private readonly scene: GameScene;
  private readonly cb: WorldCallbacks;
  private readonly tracers: TracerPool;

  constructor(scene: GameScene, map: GameMap, playerName: string, cb: WorldCallbacks) {
    this.scene = scene;
    this.map = map;
    this.cb = cb;
    this.tracers = new TracerPool(scene.scene);

    const spawn = map.spawns[0]!;
    this.player = new Fighter('player', playerName, true, scene.scene, spawn.x, spawn.y, 0x4fc3f7);
    this.fighters.push(this.player);

    for (let i = 0; i < BOT_COUNT; i++) {
      const s = map.spawns[(i + 1) % map.spawns.length]!;
      const color = BOT_COLORS[i % BOT_COLORS.length]!;
      const f = new Fighter(`bot-${i + 1}`, `BOT-${i + 1}`, false, scene.scene, s.x, s.y, color);
      this.fighters.push(f);
      this.bots.push(new Bot(f, map, this.tracers));
    }
  }

  /** 玩家距重生的剩余秒数（存活时为 0） */
  get playerRespawnIn(): number {
    return this.player.respawnAt === null ? 0 : Math.max(0, this.player.respawnAt - this.time);
  }

  update(dt: number, cmd: InputCommand, aimX: number, aimY: number): void {
    this.time += dt;
    const now = this.time;
    this.inv.update(now);
    this.recoilBloom = Math.max(0, this.recoilBloom - BLOOM_DECAY * dt);

    this.updateRespawns(now);

    if (this.player.alive) {
      this.updatePlayerMovement(cmd, dt);
      this.updatePlayerAim(aimX, aimY);
      this.handleSwitchAndReload(cmd, now);
      this.updatePlayerFire(cmd, now);
    }

    const botHandlers: BotHandlers = {
      onKill: (killer, victim, weaponId) => this.registerKill(killer, victim, weaponId),
      onPlayerDamaged: (dmg) => this.cb.onPlayerDamaged(dmg),
    };
    for (const bot of this.bots) {
      bot.update(dt, now, this.fighters, botHandlers);
      bot.fighter.sync();
    }

    this.player.sync();
    this.tracers.update(dt);
  }

  private updateRespawns(now: number): void {
    for (const f of this.fighters) {
      if (f.alive || f.respawnAt === null || now < f.respawnAt) continue;
      const enemies = this.fighters.filter((o) => o !== f && o.alive);
      const s = pickSpawnFarthest(this.map, enemies);
      f.respawn(s.x, s.y);
      if (f === this.player) {
        this.inv.resetAll();
        this.playerKillerName = null;
        this.cb.onPlayerRespawn();
      }
    }
  }

  private updatePlayerMovement(cmd: InputCommand, dt: number): void {
    const len = Math.hypot(cmd.moveX, cmd.moveY);
    if (len <= 0) return;
    const nx = this.player.x + (cmd.moveX / len) * PLAYER_SPEED * dt;
    const ny = this.player.y + (cmd.moveY / len) * PLAYER_SPEED * dt;
    const r = resolveCircleWalls(this.map, nx, ny, PLAYER_RADIUS);
    this.player.x = r.x;
    this.player.y = r.y;
  }

  private updatePlayerAim(aimX: number, aimY: number): void {
    const adx = aimX - this.player.x;
    const ady = aimY - this.player.y;
    if (Math.hypot(adx, ady) > 0.1) {
      this.player.aimAngle = Math.atan2(adx, ady);
    }
  }

  private handleSwitchAndReload(cmd: InputCommand, now: number): void {
    if (cmd.switchTo !== null) this.inv.switchTo(cmd.switchTo, now);
    else if (cmd.wheel !== 0) this.inv.cycle(cmd.wheel > 0 ? 1 : -1, now);
    if (cmd.reload) this.inv.startReload(now);
  }

  private updatePlayerFire(cmd: InputCommand, now: number): void {
    const spec = this.inv.spec;
    const wantFire = spec.fireMode === 'auto' ? cmd.firing : cmd.firePressed;
    if (!wantFire) return;

    if (!this.inv.canFire(now)) {
      // 弹尽自动换弹（FR-W3）
      if (this.inv.state.ammo === 0 && this.inv.state.reloadEnd === null) {
        this.inv.startReload(now);
      }
      return;
    }

    const moving = Math.hypot(cmd.moveX, cmd.moveY) > 0;
    const spread = spec.spreadDeg + (moving ? spec.moveSpreadDeg : 0) + this.recoilBloom;
    this.inv.consumeAmmo();
    this.inv.markFired(now);

    fireWeapon({
      pool: this.tracers,
      map: this.map,
      shooter: this.player,
      targets: this.fighters.filter((f) => f !== this.player && f.alive),
      spec,
      ox: this.player.x,
      oy: this.player.y,
      aimAngle: this.player.aimAngle,
      spreadDeg: spread,
      onHit: (target, dmg, _dist, killed) => this.handleHit(this.player, target, dmg, killed, spec.id),
    });

    this.recoilBloom = Math.min(MAX_BLOOM, this.recoilBloom + spec.recoil * BLOOM_PER_RECOIL);
    this.scene.addShake(spec.recoil * SHAKE_PER_RECOIL);
    if (this.inv.state.ammo === 0) this.inv.startReload(now);
  }

  private handleHit(shooter: Fighter, target: Fighter, dmg: number, killed: boolean, weaponId: WeaponId): void {
    if (target.isPlayer) this.cb.onPlayerDamaged(dmg);
    else if (shooter.isPlayer) this.cb.onPlayerHitEnemy(dmg, killed, target.x, target.y);
    if (killed) this.registerKill(shooter, target, weaponId);
  }

  private registerKill(killer: Fighter, victim: Fighter, weaponId: WeaponId): void {
    if (killer === this.player) this.playerKills++;
    victim.respawnAt = this.time + RESPAWN_DELAY;
    this.cb.onKill(killer.name, victim.name, weaponId);
    if (victim === this.player) {
      this.playerKillerName = killer.name;
      this.cb.onPlayerDeath();
    }
  }
}