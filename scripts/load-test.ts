/** 内部压测（NFR-3，M4）：对真实服务端打 N 个模拟客户端，统计快照率/带宽，验证 ≥50 同时在线。
 *  运行：corepack pnpm loadtest [-- --clients=50 --seconds=30]
 *  通过标准：全部客户端进房、平均快照率 15~45Hz、无意外断线（退出码 0 = 通过） */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { io as Client, type Socket } from 'socket.io-client';
import { MAPS, PROTOCOL_VERSION, type InputMsg, type SnapshotMsg, type WelcomeMsg } from '@DoShoot/shared';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'apps', 'server');
const args = process.argv.slice(2);
const numOpt = (name: string, d: number): number => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const n = a === undefined ? NaN : Number(a.slice(name.length + 3));
  return Number.isFinite(n) && n > 0 ? n : d;
};
const CLIENTS = numOpt('clients', 50);
const SECONDS = numOpt('seconds', 30);
const PORT = 30000 + Math.floor(Math.random() * 20000);

interface Stats {
  welcomed: boolean;
  snaps: number;
  /** 仅前 5 个客户端采样 JSON 字节数（带宽估算） */
  bytes: number;
  disconnects: number;
}

// 1) 启动真实服务端（子进程；直接 node+tsx 不经 pnpm，避免触发服务端 smoke 自检）
const tsxCli = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
if (!existsSync(tsxCli)) {
  console.error(`[loadtest] tsx cli not found: ${tsxCli}`);
  process.exit(1);
}
const server: ChildProcess = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout!.on('data', (d) => { serverLog += String(d); });
server.stderr!.on('data', (d) => { serverLog += String(d); });

function killServer(): void {
  if (process.platform === 'win32' && server.pid) {
    try {
      spawn('taskkill', ['/pid', String(server.pid), '/T', '/F']);
      return;
    } catch { /* 回退 kill */ }
  }
  server.kill('SIGTERM');
}

async function waitHealth(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server health timeout (log:\n${serverLog.slice(-2000)})`);
}

/** 建一个模拟客户端：随机地图进房 + 30Hz 随机移动/瞄准/间歇开火（走真实权威管线） */
function spawnClient(i: number, stats: Stats): Socket {
  const socket = Client(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const mapIds = Object.keys(MAPS);
  socket.on('welcome', (w: WelcomeMsg) => {
    stats.welcomed = true;
    const me = w.entities.find((e) => e.id === w.playerId);
    const x0 = me?.x ?? 20;
    const y0 = me?.y ?? 20;
    let seq = 0;
    const timer = setInterval(() => {
      const msg: InputMsg = {
        seq: ++seq,
        moveX: Math.random() * 2 - 1,
        moveY: Math.random() * 2 - 1,
        aimX: x0 + Math.random() * 10 - 5,
        aimY: y0 + Math.random() * 10 - 5,
        firing: Math.random() < 0.2,
        firePressed: 0,
        reload: false,
        switchTo: null,
        pingMs: 5,
      };
      socket.emit('input', msg);
    }, 33);
    socket.on('disconnect', () => clearInterval(timer));
  });
  socket.on('snapshot', (msg: SnapshotMsg) => {
    stats.snaps++;
    if (i < 5) stats.bytes += JSON.stringify(msg).length;
  });
  socket.on('disconnect', () => stats.disconnects++);
  socket.connect();
  socket.emit('join', {
    version: PROTOCOL_VERSION,
    nickname: `Load-${i}`,
    mapId: mapIds[i % mapIds.length],
  });
  return socket;
}

async function main(): Promise<number> {
  console.log(`[loadtest] server on :${PORT} — ${CLIENTS} clients × ${SECONDS}s`);
  await waitHealth(10_000);
  console.log('[loadtest] server ready');

  const stats: Stats[] = Array.from({ length: CLIENTS }, () => ({ welcomed: false, snaps: 0, bytes: 0, disconnects: 0 }));
  const sockets: Socket[] = [];
  for (let i = 0; i < CLIENTS; i++) {
    sockets[i] = spawnClient(i, stats[i]!);
    await new Promise((r) => setTimeout(r, 50)); // 错峰进房
  }
  await new Promise((r) => setTimeout(r, 3000)); // 等全部 welcome + 输入流稳定

  const base = stats.map((s) => s.snaps);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));

  const rates = stats.map((s, i) => (s.snaps - base[i]!) / SECONDS);
  const welcomed = stats.filter((s) => s.welcomed).length;
  const disconnects = stats.reduce((n, s) => n + s.disconnects, 0);
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const minRate = Math.min(...rates);
  const sampled = stats.slice(0, 5);
  const avgBytes = sampled.reduce((n, s) => n + s.bytes, 0) / Math.max(1, sampled.reduce((n, s) => n + s.snaps - 0, 0) || 1);
  const perClientKbps = ((avgBytes * avgRate) / 1024).toFixed(1);

  console.log('[loadtest] ---- 结果 ----');
  console.log(`[loadtest] welcomed: ${welcomed}/${CLIENTS}`);
  console.log(`[loadtest] snapshot rate: avg ${avgRate.toFixed(1)}/s, min ${minRate.toFixed(1)}/s`);
  console.log(`[loadtest] avg snapshot size (sampled): ${avgBytes.toFixed(0)} B → 下行 ~${perClientKbps} KB/s/客户端（全服 ~${((avgBytes * avgRate * CLIENTS) / 1024).toFixed(0)} KB/s）`);
  console.log(`[loadtest] unexpected disconnects: ${disconnects}`);

  for (const s of sockets) s.close();
  killServer();

  const pass = welcomed === CLIENTS && avgRate >= 15 && avgRate <= 45 && minRate >= 10 && disconnects === 0;
  console.log(`[loadtest] ${pass ? 'PASS (NFR-3: ≥50 同时在线)' : 'FAIL'}`);
  if (!pass && serverLog.length > 0) console.error(`[loadtest] server log tail:\n${serverLog.slice(-2000)}`);
  return pass ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
    setTimeout(() => process.exit(process.exitCode), 500); // 留出句柄排空，防 win32 libuv 断言
  })
  .catch((err) => {
    console.error('[loadtest] failed:', err);
    killServer();
    setTimeout(() => process.exit(1), 500);
  });