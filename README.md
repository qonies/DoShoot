# DeadShot Web

浏览器多人在线俯视角射击游戏（对标 deadshot.io）。技术路线见 `docs/requirements.md`。

## 结构（pnpm monorepo）

```
packages/shared/   # 武器数值 / 地图数据 / 协议与快照 schema / 碰撞逻辑（前后端同源 TS）
apps/client/       # Vite + Three.js 客户端
apps/server/       # Node + Socket.IO 权威服务端
docs/              # 需求文档
memory-bank/       # 项目记忆
```

## 常用命令

> 注意：本机 `pnpm` 不在 PATH，统一通过 `corepack pnpm` 调用；根目录脚本已内置 `corepack pnpm` 前缀，直接运行即可。

```bash
corepack pnpm install     # 安装依赖
corepack pnpm dev:client  # 客户端开发服务器 (http://localhost:5173，socket.io 经 Vite 代理连 3000)
corepack pnpm dev:server  # 服务端 (http://localhost:3000)
corepack pnpm typecheck   # 全量 TS 检查
corepack pnpm build       # 全量构建
```

## 局域网联机（免 Vite）

```bash
corepack pnpm build       # 构建客户端到 apps/client/dist
corepack pnpm dev:server  # 服务端同源托管构建产物
```

同一局域网设备浏览器访问 `http://<本机IP>:3000` 即可加入对局（客户端与游戏服务端同源，无需代理）。
