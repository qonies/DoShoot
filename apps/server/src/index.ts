/** DoShoot 权威服务端（M2 联机 FFA）：HTTP 静态托管/健康检查 + Socket.IO 进房/输入/快照 + 房间权威模拟 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { DEFAULT_MAP, PROTOCOL_VERSION, type InputMsg, type JoinMsg } from '@DoShoot/shared';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 3000);

/** 客户端构建产物目录（存在则同源托管，局域网设备直接访问 http://<IP>:3000 即可加入） */
const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('DoShoot server OK');
    return;
  }
  // 同源托管客户端构建产物（客户端 io('/') 直连本服务端；路径规范化 + 前缀校验防目录穿越）
  if (existsSync(DIST_DIR)) {
    const file = path.normalize(path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (file.startsWith(DIST_DIR)) {
      try {
        const data = await readFile(file);
        res.writeHead(200, {
          'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        });
        res.end(data);
        return;
      } catch {
        /* 文件不存在 → 落到 404 */
      }
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not Found (dev: corepack pnpm dev:client · prod: corepack pnpm build)');
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

// 冒烟自检：通过 `pnpm -F @DoShoot/server smoke` 触发，启动后自请求并退出
if (process.env.npm_lifecycle_event === 'smoke') {
  setTimeout(async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      const text = await res.text();
      console.log(`[smoke] GET /health -> ${res.status} "${text}"`);
      const ok = res.status === 200 && text.includes('OK');
      const page = await fetch(`http://localhost:${PORT}/`);
      const served = page.status === 200 && (await page.text()).includes('id="game"');
      console.log(`[smoke] GET / -> ${page.status} ${served ? '(client dist served)' : '(dist not built, skipped)'}`);
      room.destroy();
      io.close();
      httpServer.close();
      // 关闭 keep-alive 连接（含本次自检的 fetch），避免 process.exit 时触发 libuv 断言（win32）
      httpServer.closeAllConnections();
      setTimeout(() => process.exit(ok ? 0 : 1), 50);
    } catch (err) {
      console.error('[smoke] failed:', err);
      process.exit(1);
    }
  }, 600);
}
