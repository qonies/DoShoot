/** 网络集成冒烟（M2 验收辅助）：起临时服务器 + 2 个模拟客户端，验证进房/快照/移动结算/版本校验。
 *  运行：corepack pnpm smoke:net（自动退出，退出码 0 = 通过） */

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as Client, type Socket } from 'socket.io-client';
import { DEFAULT_MAP, PROTOCOL_VERSION, type InputMsg, type SnapshotMsg, type WelcomeMsg } from '@deadshot/shared';
import { Room } from '../apps/server/src/room';

const PORT = 3100;
const httpServer = createServer(() => {});
const io = new Server(httpServer, { cors: { origin: true } });
const room = new Room(io, DEFAULT_MAP, 'smoke');

io.on('connection', (socket) => {
  socket.on('join', (raw: { version: number; nickname: string }) => {
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    room.addPlayer(socket.id, raw.nickname || 'P');
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
  });
  socket.on('input', (m: InputMsg) => room.enqueueInput(socket.id, m));
  socket.on('disconnect', () => room.removePlayer(socket.id));
});

interface ClientState {
  socket: Socket;
  welcome: WelcomeMsg | null;
  snapshots: SnapshotMsg[];
  inputTimer: ReturnType<typeof setInterval> | null;
  seq: number;
}

function makeClient(nickname: string): Promise<ClientState> {
  const state: ClientState = { socket: Client(`http://localhost:${PORT}`, { transports: ['websocket'] }), welcome: null, snapshots: [], inputTimer: null, seq: 0 };
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`${nickname}: welcome timeout`)), 3000);
    state.socket.on('welcome', (w: WelcomeMsg) => {
      state.welcome = w;
      clearTimeout(to);
      // 持续发送移动 + 瞄准输入（30Hz）
      state.inputTimer = setInterval(() => {
        const me = state.snapshots.at(-1)?.entities.find((e) => e.id === w.playerId);
        const x = me?.x ?? w.entities[0]?.x ?? 20;
        const y = me?.y ?? w.entities[0]?.y ?? 20;
        state.socket.emit('input', {
          seq: ++state.seq,
          moveX: 1, moveY: 0,
          aimX: x + 5, aimY: y,
          firing: false, firePressed: 0, reload: false, switchTo: null,
        } satisfies InputMsg);
      }, 33);
      resolve(state);
    });
    state.socket.on('snapshot', (s: SnapshotMsg) => state.snapshots.push(s));
    state.socket.connect();
    state.socket.emit('join', { version: PROTOCOL_VERSION, nickname });
  });
}

function fail(msg: string): never {
  console.error(`[smoke:net] FAIL: ${msg}`);
  cleanup();
  process.exit(1);
}

function cleanup(): void {
  room.destroy();
  io.close();
  httpServer.close();
}

httpServer.listen(PORT, () => {
  console.log(`[smoke:net] server on :${PORT}`);
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

    // 2) 移动结算：持续向右输入 2s 后位置应显著变化且不穿墙
    await sleep(2000);
    const me1 = c1.snapshots.at(-1)!.entities.find((e) => e.id === c1.welcome!.playerId)!;
    const start1 = c1.welcome!.entities.find((e) => e.id === c1.welcome!.playerId)!;
    const moved = Math.hypot(me1.x - start1.x, me1.y - start1.y);
    if (moved < 3) fail(`player should move with input, moved=${moved.toFixed(2)}`);
    if (me1.x < 1 || me1.x > DEFAULT_MAP.width - 1 || me1.y < 1 || me1.y > DEFAULT_MAP.height - 1) {
      fail(`player escaped map bounds: (${me1.x}, ${me1.y})`);
    }
    console.log(`[smoke:net] movement OK (moved ${moved.toFixed(1)} units, pos ${me1.x.toFixed(1)},${me1.y.toFixed(1)})`);

    // 2b) 两名玩家都在场（Bot 自动填充随人数调整，FR-B1）
    const total = c1.snapshots.at(-1)!.entities.length;
    if (total < 7) fail(`expected >=7 entities after both players joined, got ${total}`);
    console.log(`[smoke:net] entity count after 2 players: ${total} OK`);

    // 3) 快照频率（30Hz 模拟）
    const n1 = c1.snapshots.length;
    const rate = (n1 / 2000) * 1000;
    if (rate < 20 || rate > 35) fail(`snapshot rate ${rate.toFixed(0)}/s out of 20~30Hz range (${n1} in 2s)`);
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

    // 5) 断线移除
    c1.socket.disconnect();
    await sleep(800);
    const after = c2.snapshots.at(-1)!.entities.some((e) => e.id === c1.welcome!.playerId);
    if (after) fail('disconnected player still in snapshot');
    console.log('[smoke:net] disconnect removal OK');

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