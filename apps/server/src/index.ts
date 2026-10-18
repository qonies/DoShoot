/** DeadShot 权威服务端骨架（M0：最小可运行 + 连接管理占位；M2 接入 30Hz 权威模拟与快照） */

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { PROTOCOL_VERSION } from '@deadshot/shared';

const PORT = Number(process.env.PORT ?? 3000);

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('DeadShot server OK');
});

const io = new Server(httpServer, { cors: { origin: true } });

io.on('connection', (socket) => {
  console.log(`[server] connected: ${socket.id}`);
  socket.on('ping', (cb: (v: string) => void) => cb('pong'));
  socket.on('disconnect', (reason) => {
    console.log(`[server] disconnected: ${socket.id} (${reason})`);
  });
});

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
      io.close();
      httpServer.close();
      process.exit(ok ? 0 : 1);
    } catch (err) {
      console.error('[smoke] failed:', err);
      process.exit(1);
    }
  }, 600);
}
