# DoShoot Web

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
corepack pnpm smoke:server # 服务端自检（启动 → /health 自检 → 自动退出）
corepack pnpm smoke:net    # 网络集成冒烟（临时服务器 + 2 模拟客户端，ALL PASS 自动退出）
```

## 局域网联机（免 Vite）

```bash
corepack pnpm build       # 构建客户端到 apps/client/dist
corepack pnpm dev:server  # 服务端同源托管构建产物
```

同一局域网设备浏览器访问 `http://<本机IP>:3000` 即可加入对局（客户端与游戏服务端同源，无需代理）。

### 局域网部署详细步骤（M4）

1. **构建并启动**：`corepack pnpm build` → `corepack pnpm dev:server`（保持窗口开启；生产常驻可用 `corepack pnpm -F @DoShoot/server start`）。
2. **查本机 IP**：`ipconfig` → 「无线局域网适配器/以太网适配器」的 IPv4 地址（如 `192.168.1.100`）。
3. **放行防火墙（Windows，管理员 PowerShell，仅首次）**：
   ```powershell
   netsh advfirewall firewall add rule name="DoShoot 3000" dir=in action=allow protocol=TCP localport=3000
   ```
4. **多设备加入**：其他设备浏览器访问 `http://<本机IP>:3000`，输入昵称即可；每房 10 人、人满自动开新房，Bot 自动填充。
5. **排错**：
   - 无法访问 → 确认服务端窗口显示 `listening on http://localhost:3000`；确认第 3 步防火墙规则；确认设备与主机同一网段。
   - 卡「正在连接服务器」→ 多为端口未放行或 IP 输错；`http://<IP>:3000/health` 返回 OK 即链路正常。
   - 版本提示 → 客户端与服务端代码不一致，重新 `build` 后强刷页面（Ctrl+F5）。

### 质量检查与压测命令

```bash
corepack pnpm typecheck    # 全量 TS 检查
corepack pnpm check:i18n   # i18n 中英键集 + 代码引用键校对（NFR-9）
corepack pnpm loadtest     # 内部压测：50 客户端 × 30s 打真实服务端（NFR-3 ≥50 同时在线）
                           # 可调参：corepack pnpm loadtest -- --clients=80 --seconds=60
```
