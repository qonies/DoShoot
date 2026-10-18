/** DeadShot 权威服务端（M2 联机 FFA）：HTTP 健康检查 + Socket.IO 进房/输入/快照 + 房间权威模拟 */

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { DEFAULT_MAP, PROTOCOL_VERSION, type InputMsg, type JoinMsg } from '@deadshot/shared';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 3000);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('DeadShot server OK');
});

// 局域网内部测试：cors 反射任意来源；强制 websocket-only（techContext）
const io = new Server(httpServer, { cors: { origin: true } });

const room = new Room(io, DEFAULT_MAP, 'ffa-1');

io.on('connection', (socket) => {
  console.log(`[server] connected: ${socket.id}`);
  let joined = false;

  socket.on('join', (raw: JoinMsg) => {
    if (joined) return;
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    if (!room.hasCapacity) {
      socket.emit('joinRejected', { reason: 'full' });
      return;
    }
    joined = true;
    const name = sanitizeNickname(raw.nickname, socket.id);
    room.addPlayer(socket.id, name);
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
    console.log(`[server] joined: ${socket.id} as "${name}" (${room.playerCount} players)`);
  });

  socket.on('input', (msg: InputMsg) => {
    if (joined && msg && typeof msg === 'object') room.enqueueInput(socket.id, msg);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[server] disconnected: ${socket.id} (${reason})`);
    if (joined) room.removePlayer(socket.id);
  });
});

/** 昵称校验（FR-L1/NFR-5 基线）：trim、长度 2~16、剔除控制字符，非法回退随机名 */
function sanitizeNickname(raw: unknown, socketId: string): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (s.length >= 2 && s.length <= 16) return s;
  return `P-${socketId.slice(0, 4)}`;
}

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (protocol v${PROTOCOL_VERSION})`);
});

// 冒烟自检：通过 `pnpm -F @deadshot/server smoke` 触发，启动后自请求并退出
if (process.env.npm_lifecycle_event === 'smoke') {
  setTimeout(async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      const text = await res.text();
      console.log(`[smoke] GET / -> ${res.status} "${text}"`);
      const ok = res.status === 200 && text.includes('OK');
      room.destroy();
      io.close();
      httpServer.close();
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error('[smoke] failed:', err);
      process.exit(1);
    }
  }, 600);
}
