/** DoShoot 权威服务端（M2 联机 FFA）：HTTP 静态托管/健康检查 + Socket.IO 进房/输入/快照 + 房间权威模拟 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  PROTOCOL_VERSION,
  getMap,
  normalizeRoomCode,
  type BotDifficulty,
  type CreateRoomMsg,
  type InputMsg,
  type JoinMsg,
  type RoomSettingsMsg,
} from '@DoShoot/shared';
import { Room } from './room';
import { RoomManager, sanitizeRule, sanitizeSettings } from './rooms';

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
    // 严格前缀（含路径分隔符）：裸 startsWith(DIST_DIR) 会放行 dist-xxx 等兄弟目录
    if (file === DIST_DIR || file.startsWith(DIST_DIR + path.sep)) {
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

const io = new Server(httpServer, { cors: { origin: true } });
const rooms = new RoomManager(io);
/** socket → 对局会话（fighterId 与 socket.id 分离：断线重连后 fighterId 保持不变） */
const sessions = new Map<string, { room: Room; fighterId: string }>();

// 空房间回收巡检（FR-N6）
const recycler = setInterval(() => rooms.sweep(), 5000);
recycler.unref();

io.on('connection', (socket) => {
  console.log(`[server] connected: ${socket.id}`);
  let joined = false;

  socket.on('join', (raw: JoinMsg) => {
    if (joined) return;
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    const name = sanitizeNickname(raw.nickname, socket.id);
    // 房间号进房（FR-L8）：等待态与对局中均可；号非法/不存在 → noRoom，满 → full
    const rawCode = typeof raw.roomCode === 'string' ? raw.roomCode : '';
    if (rawCode !== '') {
      const code = normalizeRoomCode(rawCode);
      const room = code ? rooms.findByCode(code) : null;
      if (!room) {
        socket.emit('joinRejected', { reason: 'noRoom' });
        return;
      }
      if (!room.hasCapacity) {
        socket.emit('joinRejected', { reason: 'full' });
        return;
      }
      joined = true;
      room.addPlayer(socket.id, name, raw.progress);
      sessions.set(socket.id, { room, fighterId: socket.id });
      socket.join(room.id);
      socket.emit('welcome', room.welcome(socket.id));
      console.log(
        `[server] joined by code ${room.code}: ${socket.id} as "${name}" (${room.playerCount} players)`,
      );
      return;
    }
    // 断线重连（FR-N5）：宽限期内的原实体直接恢复。放在房间号分支之后——
    // 显式「加入房间」优先于重连（体检修复批次 3）：玩家主动输入房间号表达的是「进这个房间」，
    // 不应被 30s 内残留的 rejoinId 拉回上一个对局；rejoinId 仅在未携带 roomCode 时生效。
    const rejoinId = typeof raw.rejoinId === 'string' ? raw.rejoinId : null;
    if (rejoinId) {
      const room = rooms.findRejoinable(rejoinId);
      if (room && room.tryRejoin(rejoinId)) {
        joined = true;
        sessions.set(socket.id, { room, fighterId: rejoinId });
        socket.join(room.id);
        socket.emit('welcome', room.welcome(rejoinId));
        console.log(`[server] rejoined: ${socket.id} -> ${rejoinId} (${room.playerCount} players)`);
        return;
      }
      // 不可重连（超时/房间已回收）→ 按新进房处理
    }
    const mapId = typeof raw.mapId === 'string' && getMap(raw.mapId) ? raw.mapId : undefined;
    const difficulty: BotDifficulty =
      raw.difficulty === 'easy' || raw.difficulty === 'hard' ? raw.difficulty : 'normal';
    const room = rooms.pick(mapId, difficulty, sanitizeRule(raw));
    // 防御性检查：pick() 的契约为「只返回有容量的房间或新建房间」，full 当前不可达；
    // 保留该分支以约束契约回归（协议 JoinRejectReason='full' 已与客户端约定）
    if (!room.hasCapacity) {
      socket.emit('joinRejected', { reason: 'full' });
      return;
    }
    joined = true;
    room.addPlayer(socket.id, name, raw.progress);
    sessions.set(socket.id, { room, fighterId: socket.id });
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
    console.log(`[server] joined: ${socket.id} as "${name}" (${room.playerCount} players)`);
  });

  // 房主建房（FR-L8 等待房间）：建房进入等待态，房主在等待界面调参、人齐后 startMatch
  socket.on('createRoom', (raw: CreateRoomMsg) => {
    if (joined) return;
    if (!raw || raw.version !== PROTOCOL_VERSION) {
      socket.emit('joinRejected', { reason: 'version' });
      return;
    }
    const name = sanitizeNickname(raw.nickname, socket.id);
    const mapId = typeof raw.mapId === 'string' && getMap(raw.mapId) ? raw.mapId : undefined;
    const difficulty: BotDifficulty =
      raw.difficulty === 'easy' || raw.difficulty === 'hard' ? raw.difficulty : 'normal';
    const room = rooms.createRoom(mapId, difficulty, sanitizeRule(raw));
    joined = true;
    room.addPlayer(socket.id, name, raw.progress, true); // 建房者 = 房主
    sessions.set(socket.id, { room, fighterId: socket.id });
    socket.join(room.id);
    socket.emit('welcome', room.welcome(socket.id));
    console.log(
      `[server] room hosted: ${socket.id} as "${name}" -> ${room.id} (code=${room.code})`,
    );
  });

  // 房主调整等待房间参数（FR-L8）：非房主/非等待态/全部字段非法 → 静默忽略（NFR-5 防伪造）
  socket.on('updateRoom', (raw: RoomSettingsMsg) => {
    if (!joined) return;
    const s = sessions.get(socket.id);
    if (!s) return;
    const ok = s.room.updateSettings(s.fighterId, sanitizeSettings(raw));
    if (!ok) console.log(`[server] updateRoom ignored: ${socket.id} (${s.room.id})`);
  });

  // 房主开局（FR-L8）：等待态 → 对局态；向房内全部成员重发 welcome（room.state='running'），
  // 客户端复用既有进局链路从等待界面切换进对局（含当前地图/实体快照）
  socket.on('startMatch', () => {
    if (!joined) return;
    const s = sessions.get(socket.id);
    if (!s || !s.room.start(s.fighterId)) return; // 仅房主且等待态（NFR-5 防伪造，静默忽略）
    console.log(
      `[server] match started: room ${s.room.id} (code=${s.room.code}, ${s.room.playerCount} players, bots=${s.room.botCount})`,
    );
    for (const [sid, sess] of sessions) {
      if (sess.room === s.room) io.to(sid).emit('welcome', sess.room.welcome(sess.fighterId));
    }
  });

  // 延迟测量（FR-N4，M4）：客户端定期 ping，服务端原样回 pong 供其计算 RTT（随输入上报 pingMs）
  socket.on('ping', (t: number) => socket.emit('pong', t));

  socket.on('input', (msg: InputMsg) => {
    if (!joined || !msg || typeof msg !== 'object') return;
    const s = sessions.get(socket.id);
    if (s) s.room.enqueueInput(s.fighterId, msg);
  });

  // 冲锋枪彩蛋模式（FR-E1）：客户端输入口令后上报，服务端校验授予（仅当局有效）
  socket.on('rush', (raw: unknown) => {
    if (!joined) return;
    const code = raw !== null && typeof raw === 'object' ? (raw as { code?: unknown }).code : null;
    const s = sessions.get(socket.id);
    if (s) s.room.requestRush(s.fighterId, code);
  });

  socket.on('rematch', () => {
    if (!joined) return;
    const s = sessions.get(socket.id);
    if (s) s.room.rematch();
  });

  // 主动离开（返回大厅）：立即移除实体，不走断线 30s 宽限（FR-N5/N6 语义区分：
  // 意外断线才保留残影供重连；主动离开即彻底退出，避免残影占位与「再进房被重连回原局」）
  socket.on('leave', () => {
    if (!joined) return;
    const s = sessions.get(socket.id);
    if (s) {
      s.room.removePlayer(s.fighterId);
      sessions.delete(socket.id);
      socket.leave(s.room.id);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[server] disconnected: ${socket.id} (${reason})`);
    const s = sessions.get(socket.id);
    if (s) {
      s.room.markDisconnected(s.fighterId); // FR-N5：保留实体 30s 供重连
      sessions.delete(socket.id);
    }
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
  const shutdownAndExit = (code: number): void => {
    rooms.destroyAll();
    io.close();
    httpServer.close();
    // 关闭 keep-alive 连接（含本次自检的 fetch）。不直接 process.exit——win32 下句柄关闭
    // 未完成时调用 exit 会触发 libuv 断言（win/async.c UV_HANDLE_CLOSING）。
    // 设置 exitCode 让事件循环自然排空退出；unref 定时器仅在句柄悬挂时兜底强退。
    httpServer.closeAllConnections();
    setTimeout(() => {
      process.exitCode = code;
      setTimeout(() => process.exit(process.exitCode ?? code), 300).unref();
    }, 50);
  };
  setTimeout(async () => {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      const text = await res.text();
      console.log(`[smoke] GET /health -> ${res.status} "${text}"`);
      const ok = res.status === 200 && text.includes('OK');
      const page = await fetch(`http://localhost:${PORT}/`);
      const served = page.status === 200 && (await page.text()).includes('id="game"');
      console.log(`[smoke] GET / -> ${page.status} ${served ? '(client dist served)' : '(dist not built, skipped)'}`);
      shutdownAndExit(ok ? 0 : 1);
    } catch (err) {
      console.error('[smoke] failed:', err);
      shutdownAndExit(1);
    }
  }, 600);
}
