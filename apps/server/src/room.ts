/** 权威房间模拟（FR-N1/N2）：30Hz 固定步长、输入校验与结算、伤害/击杀/重生、Bot 填充、快照广播 */

import {
  BOT_FILL_MAX,
  HITBOX_HALF,
  PLAYER_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PROTOCOL_VERSION,
  RESPAWN_DELAY,
  ROOM_CAPACITY,
  SIM_TICK_RATE,
  WEAPON_ORDER,
  WEAPONS,
  WeaponInventory,
  damageAtRange,
  pickSpawnFarthest,
  resolveCircleWalls,
  resolveShot,
  type EntitySnapshot,
  type GameEvent,
  type GameMap,
  type InputMsg,
  type ShotTarget,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@DoShoot/shared';
import type { Server } from 'socket.io';
import { BOT_EXTRA_SPREAD, BOT_SPEED_FACTOR, updateBotAI } from './bot';

const TICK_DT = 1 / SIM_TICK_RATE;
/** 后坐力准星扩散（与客户端表现参数一致） */
const BLOOM_PER_RECOIL = 0.6;
const BLOOM_DECAY = 14;
const MAX_BLOOM = 9;
/** 单连接输入队列上限（限频保护，NFR-5） */
const MAX_QUEUED_INPUTS = 8;
/** 单条输入消息累积按下沿上限 */
const MAX_PRESS_PER_MSG = 3;
/** 半自动/泵动累计待发射按下沿上限（防超射速积压连发，NFR-5） */
const MAX_PENDING_PRESSES = 3;

/** 房间内模拟实体（玩家与 Bot 同结构，Bot 由 AI 合成输入） */
export interface SimFighter {
  id: string;
  name: string;
  bot: boolean;
  x: number;
  y: number;
  angle: number;
  hp: number;
  alive: boolean;
  kills: number;
  respawnAt: number | null;
  inv: WeaponInventory;
  bloom: number;
  /** 待处理的半自动/泵动开火沿 */
  firePresses: number;
  /** 最新输入意图（玩家来自 InputMsg，Bot 来自 AI） */
  input: { moveX: number; moveY: number; aimX: number; aimY: number; firing: boolean };
  /** Bot 专用状态 */
  wander: { x: number; y: number };
  wanderUntil: number;
  wanderSince: number;
  nextFireAt: number;
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}

export class Room {
  readonly id: string;
  private readonly fighters = new Map<string, SimFighter>();
  private readonly inputs = new Map<string, InputMsg[]>();
  private botSeq = 0;
  private time = 0;
  private tick = 0;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly io: Server,
    private readonly map: GameMap,
    roomId: string,
  ) {
    this.id = roomId;
    for (let i = 0; i < BOT_FILL_MAX; i++) this.addBot();
    this.timer = setInterval(() => this.step(), Math.round(1000 / SIM_TICK_RATE));
  }

  destroy(): void {
    clearInterval(this.timer);
  }

  get playerCount(): number {
    let n = 0;
    for (const f of this.fighters.values()) if (!f.bot) n++;
    return n;
  }

  get hasCapacity(): boolean {
    return this.playerCount < ROOM_CAPACITY;
  }

  addPlayer(id: string, name: string): void {
    this.fighters.set(id, this.createFighter(id, name, false));
    this.inputs.set(id, []);
    this.adjustBots();
  }

  removePlayer(id: string): void {
    this.fighters.delete(id);
    this.inputs.delete(id);
    this.adjustBots();
  }

  /** 入队玩家输入（非阻塞；队列满时丢弃最旧一条——最新输入携带当前状态，不可丢弃，NFR-5 限频基线） */
  enqueueInput(id: string, msg: InputMsg): void {
    const q = this.inputs.get(id);
    if (!q) return;
    if (q.length >= MAX_QUEUED_INPUTS) q.shift();
    q.push(msg);
  }

  /** 进房首帧全量状态 */
  welcome(playerId: string): WelcomeMsg {
    return {
      version: PROTOCOL_VERSION,
      playerId,
      tick: this.tick,
      time: this.time,
      entities: this.snapshotEntities(),
    };
  }

  private snapshotEntities(): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    for (const f of this.fighters.values()) {
      out.push({
        id: f.id,
        name: f.name,
        bot: f.bot,
        x: Math.round(f.x * 100) / 100,
        y: Math.round(f.y * 100) / 100,
        angle: Math.round(f.angle * 1000) / 1000,
        hp: Math.round(f.hp),
        alive: f.alive,
        weaponId: f.inv.current,
        ammo: f.inv.state.ammo,
        reserve: f.inv.state.reserve,
        reloadProgress: f.inv.reloadProgress(this.time),
        kills: f.kills,
      });
    }
    return out;
  }

  // ---------- 模拟主循环 ----------

  private step(): void {
    const dt = TICK_DT;
    this.time += dt;
    const now = this.time;
    this.tick++;
    const events: GameEvent[] = [];

    // 1. 消费玩家输入（校验 + 应用动作）
    for (const [id, q] of this.inputs) {
      const f = this.fighters.get(id);
      if (!f || !f.alive) {
        q.length = 0;
        continue;
      }
      for (const msg of q) {
        f.input.moveX = clampUnit(msg.moveX);
        f.input.moveY = clampUnit(msg.moveY);
        f.input.aimX = Number(msg.aimX) || f.x;
        f.input.aimY = Number(msg.aimY) || f.y;
        f.input.firing = msg.firing === true;
        f.firePresses = Math.min(
          MAX_PENDING_PRESSES,
          f.firePresses + Math.min(MAX_PRESS_PER_MSG, Math.max(0, Math.floor(msg.firePressed) || 0)),
        );
        if (msg.reload === true) f.inv.startReload(now);
        // switchTo 白名单校验（NFR-5）：非法 id 会让 WEAPONS[id]/inv.state 取值 undefined 而崩溃
        if (msg.switchTo !== null && msg.switchTo !== undefined && WEAPON_ORDER.includes(msg.switchTo)) {
          f.inv.switchTo(msg.switchTo, now);
        }
      }
      q.length = 0;
    }

    // 2. 推进换弹完成（权威库存状态机；漏调会导致 reloadEnd 永不清除、弹尽后无法再开火）
    for (const f of this.fighters.values()) {
      f.inv.update(now);
    }

    // 3. 重生（距敌最远出生点，FR-MP3/C4）
    for (const f of this.fighters.values()) {
      if (!f.alive && f.respawnAt !== null && now >= f.respawnAt) this.respawn(f);
    }

    // 4. Bot AI（合成输入，走与玩家同一管线）
    const all = [...this.fighters.values()];
    for (const f of all) {
      if (f.bot && f.alive) updateBotAI(f, now, all, this.map);
    }

    // 5. 移动 / 瞄准 / 开火
    for (const f of all) {
      if (!f.alive) continue;
      const adx = f.input.aimX - f.x;
      const ady = f.input.aimY - f.y;
      if (Math.hypot(adx, ady) > 0.1) f.angle = Math.atan2(adx, ady);

      let moving = false;
      const len = Math.hypot(f.input.moveX, f.input.moveY);
      if (len > 0.01) {
        moving = true;
        const speed = PLAYER_SPEED * (f.bot ? BOT_SPEED_FACTOR : 1);
        const r = resolveCircleWalls(
          this.map,
          f.x + (f.input.moveX / len) * speed * dt,
          f.y + (f.input.moveY / len) * speed * dt,
          PLAYER_RADIUS,
        );
        f.x = r.x;
        f.y = r.y;
      }

      this.processFire(f, now, moving, events);
      f.bloom = Math.max(0, f.bloom - BLOOM_DECAY * dt);
    }

    // 6. 快照广播（30Hz，规格 20~30Hz 内；全量 + 事件捎带）
    const snapshot: SnapshotMsg = {
      version: PROTOCOL_VERSION,
      tick: this.tick,
      time: this.time,
      entities: this.snapshotEntities(),
      events,
    };
    this.io.to(this.id).emit('snapshot', snapshot);
  }

  /** 处理一次开火意图：弹药/冷却校验 → 弹丸解算 → 伤害/击杀结算 → 事件 */
  private processFire(f: SimFighter, now: number, moving: boolean, events: GameEvent[]): void {
    const spec = WEAPONS[f.inv.current];
    const wantFire = spec.fireMode === 'auto' ? f.input.firing : f.firePresses > 0;
    if (!wantFire) return;

    if (!f.inv.canFire(now)) {
      // 弹尽自动换弹（FR-W3）
      if (f.inv.state.ammo === 0 && f.inv.state.reloadEnd === null) f.inv.startReload(now);
      return;
    }
    f.inv.consumeAmmo();
    f.inv.markFired(now);
    if (spec.fireMode !== 'auto') f.firePresses--;

    const spread =
      spec.spreadDeg +
      (moving ? spec.moveSpreadDeg : 0) +
      f.bloom +
      (f.bot ? BOT_EXTRA_SPREAD : 0);

    const list: SimFighter[] = [];
    const targets: ShotTarget[] = [];
    for (const o of this.fighters.values()) {
      if (o === f || !o.alive) continue;
      list.push(o);
      targets.push({
        hitbox: {
          minX: o.x - HITBOX_HALF,
          minY: o.y - HITBOX_HALF,
          maxX: o.x + HITBOX_HALF,
          maxY: o.y + HITBOX_HALF,
        },
        alive: true,
      });
    }

    const pellets = resolveShot(this.map, f.x, f.y, f.angle, spread, spec, targets);
    const segments = pellets.map(
      (p) => [p.segment.ox, p.segment.oy, p.segment.ex, p.segment.ey] as [number, number, number, number],
    );
    events.push({ type: 'shot', id: f.id, weaponId: spec.id, segments });

    for (const p of pellets) {
      if (p.hitIndex === null) continue;
      const victim = list[p.hitIndex]!;
      if (!victim.alive) continue; // 同次开火先前弹丸已击杀
      const dmg = damageAtRange(spec, p.dist);
      victim.hp = Math.max(0, victim.hp - dmg);
      const killed = victim.hp <= 0;
      events.push({
        type: 'hit',
        shooterId: f.id,
        targetId: victim.id,
        dmg,
        killed,
        x: victim.x,
        y: victim.y,
      });
      if (killed) {
        victim.alive = false;
        victim.respawnAt = now + RESPAWN_DELAY;
        if (!f.bot) f.kills++;
        events.push({
          type: 'kill',
          killerName: f.name,
          victimId: victim.id,
          victimName: victim.name,
          weaponId: spec.id,
        });
      }
    }

    f.bloom = Math.min(MAX_BLOOM, f.bloom + spec.recoil * BLOOM_PER_RECOIL);
    if (f.inv.state.ammo === 0) f.inv.startReload(now);
  }

  private respawn(f: SimFighter): void {
    const enemies = [...this.fighters.values()].filter((o) => o !== f && o.alive);
    const s = pickSpawnFarthest(this.map, enemies);
    f.x = s.x;
    f.y = s.y;
    f.hp = PLAYER_HP;
    f.alive = true;
    f.respawnAt = null;
    f.bloom = 0;
    f.firePresses = 0;
    f.inv.resetAll();
  }

  private createFighter(id: string, name: string, bot: boolean): SimFighter {
    const enemies = [...this.fighters.values()].filter((o) => o.alive);
    const s = pickSpawnFarthest(this.map, enemies);
    return {
      id,
      name,
      bot,
      x: s.x,
      y: s.y,
      angle: 0,
      hp: PLAYER_HP,
      alive: true,
      kills: 0,
      respawnAt: null,
      inv: new WeaponInventory(),
      bloom: 0,
      firePresses: 0,
      input: { moveX: 0, moveY: 0, aimX: s.x, aimY: s.y - 1, firing: false },
      wander: { x: s.x, y: s.y },
      wanderUntil: 0,
      wanderSince: 0,
      nextFireAt: 0,
    };
  }

  private addBot(): void {
    this.botSeq++;
    const id = `bot-${this.botSeq}`;
    this.fighters.set(id, this.createFighter(id, `BOT-${this.botSeq}`, true));
  }

  /** Bot 填充（FR-B1）：保持 bots = min(BOT_FILL_MAX, 房容量 - 玩家数) */
  private adjustBots(): void {
    const want = Math.min(BOT_FILL_MAX, ROOM_CAPACITY - this.playerCount);
    const bots = [...this.fighters.values()].filter((f) => f.bot);
    let have = bots.length;
    for (let i = bots.length - 1; i >= 0 && have > want; i--) {
      this.fighters.delete(bots[i]!.id);
      have--;
    }
    while (have < want) {
      this.addBot();
      have++;
    }
  }
}