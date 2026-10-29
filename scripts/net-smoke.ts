/** 网络集成冒烟（M2 验收辅助）：起临时服务器 + 2 个模拟客户端，验证进房/快照/移动结算/版本校验。
 *  运行：corepack pnpm smoke:net（自动退出，退出码 0 = 通过） */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import {
  CHEAT_RUSH_CODE,
  MAPS,
  PROTOCOL_VERSION,
  SNAPSHOT_RATE_MAX,
  SNAPSHOT_RATE_MIN,
  normalizeRoomCode,
  type InputMsg,
  type RoomInfoMsg,
  type SnapshotMsg,
  type WelcomeMsg,
} from '@DoShoot/shared';
import type { Room } from '../apps/server/src/room';
import { RoomManager, sanitizeRule, sanitizeSettings } from '../apps/server/src/rooms';

/** 端口由系统分配（listen(0)，回调内赋值）——防并行运行或残留进程占用固定端口导致 EADDRINUSE */
let PORT = 0;
const httpServer = createServer(() => {});
const io = new Server(httpServer, { cors: { origin: true } });
/** 房间管理：与 index.ts 同源复用真实 RoomManager + 载荷白名单校验（体检修复批次 3）。
 *  此前冒烟用「与 index.ts 同语义的最小子集」复制路由，选房/房间号/校验的漂移不会被检出 */
const roomManager = new RoomManager(io);
const sessions = new Map<string, Room>();

io.on('connection', (socket) => {
  let joined = false;
  socket.on('join', (raw: { version: number; nickname: string; mapId?: string; rejoinId?: string; killTarget?: number; timeLimitSec?: number; roomCode?: string }) => {
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    // FR-N5 断线重连（与 index.ts 同源语义）：宽限期内凭原 playerId 恢复
    const rejoinId = typeof raw.rejoinId === 'string' ? raw.rejoinId : null;
    if (rejoinId) {
      const room = roomManager.findRejoinable(rejoinId);
      if (room && room.tryRejoin(rejoinId)) {
        joined = true;
        sessions.set(socket.id, room);
        socket.join(room.id);
        socket.emit('welcome', room.welcome(rejoinId));
        return;
      }
    }
    // 房间号进房（FR-L8，与 index.ts 同源语义）：非法/不存在 → noRoom，满 → full
    const rawCode = typeof raw.roomCode === 'string' ? raw.roomCode : '';
    if (rawCode !== '') {
      const code = normalizeRoomCode(rawCode);
      const room = code ? roomManager.findByCode(code) : null;
      if (!room) {
        socket.emit('joinRejected', { reason: 'noRoom' });
        return;
      }
      if (!room.hasCapacity) {
        socket.emit('joinRejected', { reason: 'full' });
        return;
      }
      room.addPlayer(socket.id, raw.nickname || 'P');
      joined = true;
      sessions.set(socket.id, room);
      socket.join(room.id);
      socket.emit('welcome', room.welcome(socket.id));
      return;
    }
    // 快速加入/选图进房（FR-L3/L4/L7，与 index.ts 同源）：真实 RoomManager 选房 + 白名单校验
    const difficulty = 'normal' as const;
    const room = roomManager.pick(
      typeof raw.mapId === 'string' && MAPS[raw.mapId] ? raw.mapId : undefined,
      difficulty,
      sanitizeRule(raw),
    );
    if (!room.hasCapacity) {
      socket.emit('joinRejected', { reason: 'full' });
      return;
    }
    room.addPlayer(socket.id, raw.nickname || 'P');
    joined = true;
    sessions.set(socket.id, room);
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
  });
  // 等待房间（FR-L8，与 index.ts 同源）：建房 / 房主调参 / 房主开局
  socket.on('createRoom', (raw: { version: number; nickname: string; mapId?: string; killTarget?: number; timeLimitSec?: number }) => {
    if (joined) return;
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    const room = roomManager.createRoom(
      typeof raw.mapId === 'string' && MAPS[raw.mapId] ? raw.mapId : undefined,
      'normal',
      sanitizeRule(raw),
    );
    room.addPlayer(socket.id, raw.nickname || 'P', undefined, true);
    joined = true;
    sessions.set(socket.id, room);
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
  });
  socket.on('updateRoom', (raw: { mapId?: string; killTarget?: number; timeLimitSec?: number }) => {
    if (!joined) return;
    const room = sessions.get(socket.id);
    if (!room) return;
    room.updateSettings(socket.id, sanitizeSettings(raw));
  });
  socket.on('startMatch', () => {
    if (!joined) return;
    const room = sessions.get(socket.id);
    if (!room || !room.start(socket.id)) return; // 仅房主且等待态
    for (const [sid, r] of sessions) {
      if (r === room) io.to(sid).emit('welcome', room.welcome(sid));
    }
  });
  socket.on('input', (m: InputMsg) => {
    if (joined) sessions.get(socket.id)?.enqueueInput(socket.id, m);
  });
  // 冲锋枪彩蛋模式（FR-E1，与 index.ts 同语义）：口令上报转发给房间验证
  socket.on('rush', (raw: unknown) => {
    if (!joined) return;
    const code = raw !== null && typeof raw === 'object' ? (raw as { code?: unknown }).code : null;
    sessions.get(socket.id)?.requestRush(socket.id, code);
  });
  // 主动离开（与 index.ts 同语义，FR-N5/N6）：立即移除实体，不走断线 30s 宽限
  socket.on('leave', () => {
    if (!joined) return;
    const r = sessions.get(socket.id);
    if (r) {
      r.removePlayer(socket.id);
      sessions.delete(socket.id);
      socket.leave(r.id);
    }
  });
  socket.on('disconnect', () => {
    sessions.get(socket.id)?.markDisconnected(socket.id); // FR-N5：宽限期内保留实体
    sessions.delete(socket.id);
  });
});

interface ClientState {
  socket: Socket;
  welcome: WelcomeMsg | null;
  snapshots: SnapshotMsg[];
  inputTimer: ReturnType<typeof setInterval> | null;
  seq: number;
}

function makeClient(
  nickname: string,
  mapId?: string,
  killTarget?: number,
  timeLimitSec?: number,
): Promise<ClientState> {
  const state: ClientState = { socket: Client(`http://localhost:${PORT}`, { transports: ['websocket'] }), welcome: null, snapshots: [], inputTimer: null, seq: 0 };
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${nickname}: welcome timeout`)), 3000);
    state.socket.on('welcome', (w: WelcomeMsg) => {
      state.welcome = w;
      clearTimeout(to);
      // 持续发送移动 + 瞄准输入（30Hz）；朝地图中心按主导轴移动——
      // 任意出生点到中心沿主导轴均有 ≥2.1 单位的无遮挡路径，避免贴边出生点导致位移断言抖动
      const cx = 20; // 地图中心（range 40×40；移动断言仅在 range 房间执行）
      state.inputTimer = setInterval(() => {
        const me = state.snapshots.at(-1)?.entities.find((e) => e.id === w.playerId);
        const x = me?.x ?? w.entities[0]?.x ?? 20;
        const y = me?.y ?? w.entities[0]?.y ?? 20;
        const dx = cx - x;
        const dy = cx - y;
        const moveX = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
        const moveY = Math.abs(dx) >= Math.abs(dy) ? 0 : Math.sign(dy);
        state.socket.emit('input', {
          seq: ++state.seq,
          moveX, moveY,
          aimX: x + 5, aimY: y,
          firing: false, firePressed: 0, reload: false, switchTo: null,
        } satisfies InputMsg);
      }, 33);
      resolve(state);
    });
    state.socket.on('snapshot', (s: SnapshotMsg) => state.snapshots.push(s));
    state.socket.connect();
    const joinMsg: Record<string, unknown> = mapId
      ? { version: PROTOCOL_VERSION, nickname, mapId }
      : { version: PROTOCOL_VERSION, nickname };
    if (killTarget !== undefined) joinMsg.killTarget = killTarget;
    if (timeLimitSec !== undefined) joinMsg.timeLimitSec = timeLimitSec;
    state.socket.emit('join', joinMsg);
  });
}

function fail(msg: string): never {
  console.error(`[smoke:net] FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function cleanup(): void {
  roomManager.destroyAll();
  sessions.clear();
  io.close();
  httpServer.close();
}

httpServer.listen(PORT, () => {
  PORT = (httpServer.address() as AddressInfo).port;
  console.log(`[smoke:net] server on :${PORT} (ephemeral)`);
  run();
});

async function run(): Promise<void> {
  try {
    // 0) 版本校验（FR-N7）
    const bad = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const rejected = await new Promise<string>((resolve) => {
      bad.on('joinRejected', (m: { reason: string }) => resolve(m.reason));
      bad.emit('join', { version: PROTOCOL_VERSION + 99, nickname: 'bad' });
      setTimeout(() => resolve('none'), 2000);
    });
    bad.close();
    if (rejected !== 'version') fail(`version rejection expected, got "${rejected}"`);
    console.log('[smoke:net] version rejection OK');

    // 1) 两个客户端进房
    const [c1, c2] = await Promise.all([makeClient('Tester-1'), makeClient('Tester-2')]);
    console.log(`[smoke:net] joined: p1=${c1.welcome!.playerId.slice(0, 5)} p2=${c2.welcome!.playerId.slice(0, 5)}`);

    const entCount = c1.welcome!.entities.length;
    if (entCount < 6) fail(`expected >=6 entities (player + 5 bots), got ${entCount}`);
    console.log(`[smoke:net] entities on join: ${entCount} OK`);

    // 2) 移动结算：持续向中心输入 2s 后位置应显著变化且不穿墙
    //    （阈值 1.5：贴边出生点最近遮挡 ~2.1 单位，留裕量；正常出生点可移动 ~8 单位）
    await sleep(2000);
    const me1 = c1.snapshots.at(-1)!.entities.find((e) => e.id === c1.welcome!.playerId)!;
    const start1 = c1.welcome!.entities.find((e) => e.id === c1.welcome!.playerId)!;
    const moved = Math.hypot(me1.x - start1.x, me1.y - start1.y);
    if (moved < 1.5) fail(`player should move with input, moved=${moved.toFixed(2)}`);
    if (me1.x < 1 || me1.x > MAPS['range']!.width - 1 || me1.y < 1 || me1.y > MAPS['range']!.height - 1) {
      fail(`player escaped map bounds: (${me1.x}, ${me1.y})`);
    }
    console.log(`[smoke:net] movement OK (moved ${moved.toFixed(1)} units, pos ${me1.x.toFixed(1)},${me1.y.toFixed(1)})`);

    // 2b) 两名玩家都在场（Bot 自动填充随人数调整，FR-B1）
    const total = c1.snapshots.at(-1)!.entities.length;
    if (total < 7) fail(`expected >=7 entities after both players joined, got ${total}`);
    console.log(`[smoke:net] entity count after 2 players: ${total} OK`);

    // 3) 快照频率（广播频率 = 唤醒频率，落在 SNAPSHOT_RATE_MIN~MAX；窗口/启动误差留裕量）
    const n1 = c1.snapshots.length;
    const rate = (n1 / 2000) * 1000;
    const lo = SNAPSHOT_RATE_MIN - 2;
    const hi = SNAPSHOT_RATE_MAX + 5;
    if (rate < lo || rate > hi) fail(`snapshot rate ${rate.toFixed(0)}/s out of ${lo}~${hi} range (${n1} in window)`);
    console.log(`[smoke:net] snapshot rate OK (${rate.toFixed(0)}/s)`);

    // 4) Bot 活跃（快照中有实体发生位移）
    const bots = c2.snapshots.at(-1)!.entities.filter((e) => e.bot);
    const first = c2.welcome!.entities;
    const movingBots = bots.filter((b) => {
      const f = first.find((e) => e.id === b.id)!;
      return Math.hypot(b.x - f.x, b.y - f.y) > 0.5;
    }).length;
    if (movingBots === 0) fail('no bots moving');
    console.log(`[smoke:net] bots active OK (${movingBots}/${bots.length} moving)`);

    // 4b) 开火 + 换弹结算（回归：服务端权威换弹必须能完成；断言基于快照状态等待，对 tick 速率鲁棒）
    // 站桩换弹期间可能被 Bot 击杀并重生（重置为满弹手枪）——每次尝试死亡感知中断，最多重试 3 次
    if (c1.inputTimer) clearInterval(c1.inputTimer);
    c1.inputTimer = null;
    const p1 = c1.welcome!.playerId;
    const meAt = () => c1.snapshots.at(-1)?.entities.find((e) => e.id === p1);
    const fireInput = (firing: boolean, switchTo: InputMsg['switchTo'] = null): void => {
      c1.socket.emit('input', {
        seq: ++c1.seq,
        moveX: 0, moveY: 0,
        aimX: 30, aimY: 30,
        firing,
        firePressed: 0,
        reload: false,
        switchTo,
      } satisfies InputMsg);
    };
    const died = (): boolean => meAt()?.alive === false;
    /** 轮询等待 pred（不感知死亡）：用于「跨重生保留」的状态断言（FR-E1 彩蛋模式） */
    const waitFor = async (pred: () => boolean, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (pred()) return true;
        await sleep(50);
      }
      return pred();
    };
    /** 轮询等待 pred，等待期间被击杀立即以 'dead' 中断（区别于超时，供上层重试）。
     *  「先活后死」才视为被击杀——等待复活的等待（起始即死亡）不被误判，否则重试永远等不到重生。 */
    const waitForAlive = async (pred: () => boolean, timeoutMs: number): Promise<'ok' | 'dead' | 'timeout'> => {
      const deadline = Date.now() + timeoutMs;
      let wasAlive = false;
      while (Date.now() < deadline) {
        if (meAt()?.alive === true) wasAlive = true;
        if (wasAlive && died()) return 'dead';
        if (pred()) return 'ok';
        await sleep(50);
      }
      return pred() ? 'ok' : 'timeout';
    };

    let fireReloadOk = false;
    for (let attempt = 0; attempt < 3 && !fireReloadOk; attempt++) {
      if (attempt > 0) console.log('[smoke:net] fire/reload check interrupted (killed by bot), retrying after respawn');
      // 等待复活满状态（首尝试立即通过）
      if ((await waitForAlive(() => meAt()?.alive === true, 6000)) !== 'ok') break;
      // 切到 SMG（全自动，900rpm 弹匣 30）并按住开火，直到快照观察到弹匣打空
      let switchCount = 0;
      const fireTimer = setInterval(() => {
        switchCount++;
        fireInput(true, switchCount <= 30 ? 'smg' : null);
      }, 33);
      const emptied = await waitForAlive(
        () => meAt()?.weaponId === 'smg' && meAt()?.ammo === 0,
        8000,
      );
      clearInterval(fireTimer);
      fireInput(false); // 停火（服务端丢最旧保最新，该消息必然生效）
      if (emptied !== 'ok') continue; // 中途死亡或超时 → 重试
      // 等待弹尽自动换弹完成（弹匣回满 30）
      const reloaded = await waitForAlive(
        () => meAt()?.weaponId === 'smg' && meAt()?.ammo === 30,
        8000,
      );
      if (reloaded === 'ok') fireReloadOk = true;
    }
    if (!fireReloadOk) {
      fail(`fire/reload regression after retries: last=${JSON.stringify(meAt())}`);
    } else {
      console.log('[smoke:net] fire+reload OK (mag emptied → auto-reload completed)');
    }

    // 4c) 冲锋枪彩蛋模式（FR-E1）：错误口令无效；正确口令 → 快照 weaponId='rush' 且 rush=true；
    //     持续开火弹药不消耗（无限弹药）。彩蛋模式跨重生保留（FR-E1），等待期间被 Bot 击杀
    //     不影响授予断言 → 用不感知死亡的 waitFor（waitForAlive 的「先活后死」中断会把
    //     「已授予但恰好死亡」误判为失败，属冒烟假失败，体检修复批次 3 修正）
    c1.socket.emit('rush', { code: '0000' });
    await sleep(300);
    if (meAt()?.rush === true) fail('wrong code must not grant rush mode (FR-E1)');
    c1.socket.emit('rush', { code: CHEAT_RUSH_CODE });
    const rushed = await waitFor(
      () => meAt()?.weaponId === 'rush' && meAt()?.rush === true,
      4000,
    );
    if (!rushed) fail(`rush mode not granted after correct code: last=${JSON.stringify(meAt())}`);
    const rushFireTimer = setInterval(() => fireInput(true), 33);
    await sleep(2000);
    clearInterval(rushFireTimer);
    fireInput(false);
    const meRush = meAt();
    if (!meRush || meRush.weaponId !== 'rush' || meRush.rush !== true) {
      fail(`rush mode lost while firing: last=${JSON.stringify(meRush)}`);
    }
    if (meRush.ammo !== 60) fail(`rush ammo must stay full (infinite), got ${meRush.ammo}`);
    console.log('[smoke:net] rush cheat mode OK (correct code grants, infinite ammo while firing)');

    // 5) 断线移除（FR-N5 语义由服务端宽限期承接；此处断开后 30s 内仍可见，故直接校验「最终移除」窗口）
    //    为保持冒烟快速，这里断开 c1 并等待其进入宽限期后仍存在 → 跳过旧的「立即移除」断言，
    //    改为验证重连凭据流程：c2 断开后以 rejoinId 重进应成功。
    c1.socket.disconnect();
    await sleep(300);
    // 宽限期内：c1 实体仍在快照中（残影，FR-N5）
    const duringGrace = c2.snapshots.at(-1)!.entities.some((e) => e.id === c1.welcome!.playerId);
    if (!duringGrace) fail('disconnected player should stay in snapshot during reconnect grace (FR-N5)');
    console.log('[smoke:net] disconnect grace-period retention OK (FR-N5)');

    // FR-N5 重连：以 rejoinId 回到原状态（应恢复原 playerId）
    const rejoined = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const rejoinOk = await new Promise<boolean>((resolve) => {
      const to = setTimeout(() => resolve(false), 3000);
      rejoined.on('welcome', (w: WelcomeMsg) => {
        clearTimeout(to);
        resolve(w.playerId === c1.welcome!.playerId);
        rejoined.close();
      });
      rejoined.connect();
      rejoined.emit('join', {
        version: PROTOCOL_VERSION,
        nickname: 'Tester-1',
        rejoinId: c1.welcome!.playerId,
      });
    });
    if (!rejoinOk) fail('rejoin with original playerId failed (FR-N5)');
    console.log('[smoke:net] rejoin restores original player id OK (FR-N5)');

    // 6) 第二张地图房间（FR-MP2/L3）：mapId=alley 进房独立房间，协议 v2 新字段校验
    const c3 = await makeClient('Tester-3', 'alley');
    await sleep(300); // 等待至少若干帧快照
    if (c3.welcome!.mapId !== 'alley') fail(`expected alley map, got ${c3.welcome!.mapId}`);
    if (c3.welcome!.progress === undefined) fail('welcome.progress missing (FR-W1/A1)');
    const c3snap = c3.snapshots.at(-1);
    if (!c3snap || c3snap.matchTimeLeft == null) fail('snapshot.matchTimeLeft missing (FR-U5/M1)');
    if (c3snap.entities.some((e) => e.deaths === undefined)) fail('EntitySnapshot.deaths missing (FR-M4)');
    console.log(`[smoke:net] second map room OK (mapId=${c3.welcome!.mapId}, matchTimeLeft=${Math.round(c3snap.matchTimeLeft!)}s)`);
    c3.socket.close();

    // 7) 对局生命周期（FR-L7）：自定义规则（50 杀 / 10 分钟）独立建房，倒计时按 600s 基准；
    //    默认规则房间（上方 c3）仍为 300s，两种规则互不混房
    const c4 = await makeClient('Tester-4', 'range', 50, 600);
    await sleep(300);
    const c4snap = c4.snapshots.at(-1);
    if (!c4snap || c4snap.matchTimeLeft == null || c4snap.matchTimeLeft < 580) {
      fail(`custom rule room should use 600s time limit, got matchTimeLeft=${c4snap?.matchTimeLeft}`);
    }
    console.log(`[smoke:net] custom match rule OK (50 kills / 600s, matchTimeLeft=${Math.round(c4snap.matchTimeLeft!)}s)`);

    // 7b) 主动离开（FR-N5/N6 修复回归）：leave 立即移除实体（停止快照下发）；
    //     随后凭旧 rejoinId 进房被视为新玩家（不再被重连回原对局）。
    //     注意两段式基线：leave 处理前已在途的最后一帧快照仍会送达，先排空再断言「不再有新快照」
    c4.socket.emit('leave');
    await sleep(200); // 排空在途快照（leave 处理前的最后一次广播）
    const snapsAfterLeave = c4.snapshots.length;
    await sleep(400);
    if (c4.snapshots.length > snapsAfterLeave) {
      fail('leave must remove the fighter immediately (snapshots must stop)');
    }
    const afterLeave = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const freshId = await new Promise<string>((resolve) => {
      const to = setTimeout(() => resolve(''), 3000);
      afterLeave.on('welcome', (w: WelcomeMsg) => {
        clearTimeout(to);
        resolve(w.playerId);
        afterLeave.close();
      });
      afterLeave.connect();
      afterLeave.emit('join', {
        version: PROTOCOL_VERSION,
        nickname: 'Tester-4',
        rejoinId: c4.welcome!.playerId,
      });
    });
    if (freshId === '' || freshId === c4.welcome!.playerId) {
      fail(`fresh join expected after active leave (got ${freshId || 'timeout'})`);
    }
    console.log('[smoke:net] active leave OK (entity removed immediately, rejoin id invalidated)');
    c4.socket.close();

    // 8) 等待房间（FR-L8）：createRoom → waiting 态（无 Bot、无快照下发、4 位数字房间号）
    const hostSock = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const hostWelcomes: WelcomeMsg[] = [];
    const hostRoomUpdates: RoomInfoMsg[] = [];
    let hostSnaps = 0;
    hostSock.on('welcome', (w: WelcomeMsg) => hostWelcomes.push(w));
    hostSock.on('roomUpdate', (m: RoomInfoMsg) => hostRoomUpdates.push(m));
    hostSock.on('snapshot', () => hostSnaps++);
    const hostReady = new Promise<WelcomeMsg>((resolve) => {
      const h = (w: WelcomeMsg): void => {
        if (w.room?.state === 'waiting') {
          hostSock.off('welcome', h);
          resolve(w);
        }
      };
      hostSock.on('welcome', h);
    });
    hostSock.connect();
    hostSock.emit('createRoom', {
      version: PROTOCOL_VERSION,
      nickname: 'Host',
      mapId: 'range',
      killTarget: 50,
      timeLimitSec: 600,
    });
    const hw = await hostReady;
    if (!/^\d{4}$/.test(hw.room!.code)) fail(`expected 4-digit room code, got ${hw.room!.code}`);
    if (hw.room!.killTarget !== 50) fail(`host room rule should be 50 kills, got ${hw.room!.killTarget}`);
    if (hw.entities.length !== 1) fail(`waiting room must have no bots, got ${hw.entities.length} entities`);
    if (hw.room!.hostId !== hw.playerId) fail('room creator must be the host');
    await sleep(800);
    if (hostSnaps !== 0) fail(`waiting room must not broadcast snapshots, got ${hostSnaps}`);
    console.log(`[smoke:net] waiting room OK (code=${hw.room!.code}, no bots, no snapshots)`);

    // 9) 房间号加入（FR-L8）：按号进等待房，双方 roomUpdate 同步玩家列表与房主
    const joinSock = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const jWelcomes: WelcomeMsg[] = [];
    let joinSnaps = 0;
    joinSock.on('welcome', (w: WelcomeMsg) => jWelcomes.push(w));
    joinSock.on('snapshot', () => joinSnaps++);
    const joinReady = new Promise<WelcomeMsg>((resolve) => {
      const h = (w: WelcomeMsg): void => {
        if (w.room?.state === 'waiting') {
          joinSock.off('welcome', h);
          resolve(w);
        }
      };
      joinSock.on('welcome', h);
    });
    joinSock.connect();
    joinSock.emit('join', { version: PROTOCOL_VERSION, nickname: 'Guest', roomCode: hw.room!.code });
    const jw = await joinReady;
    if (jw.playerId === hw.playerId) fail('guest must get its own player id');
    if (hostRoomUpdates.at(-1)!.players.length !== 2) fail('host roomUpdate must list 2 players');
    if (hostRoomUpdates.at(-1)!.hostId !== hw.playerId) fail('hostId must stay on creator');
    console.log('[smoke:net] join by room code OK (2 players, host preserved)');

    // 10) 房主权限（FR-L8）：非房主改参数被忽略；房主改参数广播生效
    joinSock.emit('updateRoom', { killTarget: 30 });
    await sleep(300);
    if (hostRoomUpdates.at(-1)!.killTarget !== 50) fail('non-host updateRoom must be ignored');
    hostSock.emit('updateRoom', { mapId: 'alley' });
    await sleep(300);
    if (hostRoomUpdates.at(-1)!.mapId !== 'alley') fail('host updateRoom must broadcast new map');
    console.log('[smoke:net] host-only settings OK (guest ignored, host map change broadcast)');

    // 11) 房主开局（FR-L8）：全员收到重发 welcome(state=running) + 当前地图 + Bot 按量加入 + 快照恢复
    hostWelcomes.length = 0;
    jWelcomes.length = 0;
    hostSock.emit('startMatch');
    await sleep(600);
    const runningH = hostWelcomes.at(-1);
    const runningJ = jWelcomes.at(-1);
    if (runningH?.room?.state !== 'running' || runningJ?.room?.state !== 'running') {
      fail('startMatch must re-emit welcome(state=running) to all members');
    }
    if (runningH!.mapId !== 'alley' || runningJ!.mapId !== 'alley') {
      fail(`match must use host-selected map alley, got ${runningH!.mapId}/${runningJ!.mapId}`);
    }
    if (!runningH!.entities.some((e) => e.bot)) fail('bots must join on match start (default botCount)');
    if (hostSnaps === 0 || joinSnaps === 0) fail('snapshots must flow after match start');
    console.log(`[smoke:net] host startMatch OK (map=${runningH!.mapId}, running, snapshots flowing)`);
    hostSock.close();
    joinSock.close();
    await sleep(200); // 排空断线事件，避免影响后续断言

    // 12) 非法房间号（FR-L8）：不存在 → joinRejected 'noRoom'（房间号段 1000~9999，0000 必不存在）
    const badSock = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
    const noRoom = await new Promise<string>((resolve) => {
      badSock.on('joinRejected', (m: { reason: string }) => resolve(m.reason));
      badSock.connect();
      badSock.emit('join', { version: PROTOCOL_VERSION, nickname: 'X', roomCode: '0000' });
      setTimeout(() => resolve('none'), 2000);
    });
    badSock.close();
    if (noRoom !== 'noRoom') fail(`invalid room code rejection expected, got "${noRoom}"`);
    console.log('[smoke:net] invalid room code rejection OK (noRoom)');

    c2.socket.close();
    if (c1.inputTimer) clearInterval(c1.inputTimer);
    if (c2.inputTimer) clearInterval(c2.inputTimer);
    console.log('[smoke:net] ALL PASS');
    cleanup();
    process.exit(0);
  } catch (err) {
    fail(String(err));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}