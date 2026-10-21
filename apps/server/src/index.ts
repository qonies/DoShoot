/** DoShoot 权威服务端（M2 联机 FFA）：HTTP 静态托管/健康检查 + Socket.IO 进房/输入/快照 + 房间权威模拟 */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  DEFAULT_MAP,
  MAPS,
  PROTOCOL_VERSION,
  ROOM_RECYCLE_MS,
  getMap,
  type BotDifficulty,
  type InputMsg,
  type JoinMsg,
} from '@DoShoot/shared';
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

/** 房间管理器（FR-L3/L4/N6）：按地图选房、快速加入人最多的非满房间、空房 60s 回收 */
class RoomManager {
  private readonly rooms: Room[] = [];
  private seq = 0;

  constructor(private readonly io: Server) {}

  /** 选房：mapId 有效则在该地图的房间中选人最多者（无则新建）；否则快速加入全局人最多的非满房间 */
  pick(mapId: string | undefined, difficulty: BotDifficulty): Room {
    const map = getMap(mapId);
    if (map) {
      const candidates = this.rooms.filter((r) => r.mapId === map.id && r.hasCapacity);
      if (candidates.length > 0) {
        return candidates.reduce((a, b) => (b.playerCount > a.playerCount ? b : a));
      }
      return this.create(map.id, difficulty);
    }
    // 快速加入（FR-L4）：人最多的非满房间；无可用房间则随机地图新建
    const open = this.rooms.filter((r) => r.hasCapacity);
    if (open.length > 0) return open.reduce((a, b) => (b.playerCount > a.playerCount ? b : a));
    const ids = Object.keys(MAPS);
    return this.create(ids[Math.floor(Math.random() * ids.length)]!, difficulty);
  }

  /** 断线重连（FR-N5）：在任意房间中查找宽限期内的断线实体 */
  findRejoinable(fighterId: string): Room | null {
    return (
      this.rooms.find((r) => r.hasFighter(fighterId) && r.isDisconnected(fighterId)) ?? null
    );
  }

  /** 空房间回收（FR-N6）：空置超过 ROOM_RECYCLE_MS 则销毁（计时基准 = 最后一名真人移除时刻；断线宽限期内的玩家仍计入） */
  sweep(): void {
    const now = Date.now();
    for (let i = this.rooms.length - 1; i >= 0; i--) {
      const r = this.rooms[i]!;
      if (r.emptySince !== null && now - r.emptySince > ROOM_RECYCLE_MS) {
        r.destroy();
        this.rooms.splice(i, 1);
        console.log(`[server] room recycled: ${r.id} (${r.mapId})`);
      }
    }
  }

  /** 全部销毁（smoke 退出路径用） */
  destroyAll(): void {
    for (const r of this.rooms) r.destroy();
    this.rooms.length = 0;
  }

  private create(mapId: string, difficulty: BotDifficulty): Room {
    const room = new Room(this.io, getMap(mapId) ?? DEFAULT_MAP, `ffa-${++this.seq}`, difficulty);
    this.rooms.push(room);
    console.log(`[server] room created: ${room.id} (map=${room.mapId}, bots=${difficulty})`);
    return room;
  }
}

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
    // 断线重连（FR-N5）：宽限期内的原实体直接恢复
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
    const name = sanitizeNickname(raw.nickname, socket.id);
    const mapId = typeof raw.mapId === 'string' && getMap(raw.mapId) ? raw.mapId : undefined;
    const difficulty: BotDifficulty =
      raw.difficulty === 'easy' || raw.difficulty === 'hard' ? raw.difficulty : 'normal';
    const room = rooms.pick(mapId, difficulty);
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

  // 延迟测量（FR-N4，M4）：客户端定期 ping，服务端原样回 pong 供其计算 RTT（随输入上报 pingMs）
  socket.on('ping', (t: number) => socket.emit('pong', t));

  socket.on('input', (msg: InputMsg) => {
    if (!joined || !msg || typeof msg !== 'object') return;
    const s = sessions.get(socket.id);
    if (s) s.room.enqueueInput(s.fighterId, msg);
  });

  socket.on('rematch', () => {
    if (!joined) return;
    const s = sessions.get(socket.id);
    if (s) s.room.rematch();
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
