# DoShoot Web

浏览器多人在线俯视角射击游戏。打开网页、输入昵称、10 秒内进入对局——免注册、免安装，现代桌面浏览器即玩。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

## 特性

- **开箱即玩的多人对战**：Socket.IO 权威服务端 + WebSocket 实时同步，房间制 FFA（每房 10 人、人满自动开新房）
- **流畅的网络同步**：30Hz 固定步长权威模拟、快照插值 + 本地预测与和解、服务端延迟补偿回溯命中
- **6 类武器 + 逐级解锁**：伤害/射速/弹匣/散布/射程衰减全套数值前后端同源，按击杀数升级 T1→T3（**每次新游戏从 T1 重新升级**，浏览器不记忆历史层级）
- **双击方向键滑铲**：快速连按两次 WASD/方向键（触屏 D-pad 同样支持）触发 **0.4s 分阶段滑行**（助跑加速 → 匀速滑行 → 减速到停，峰值速度约 2× 走路），带冷却与滑铲音效（FR-C7）
- **快速加入**：刚退出不久的房间在大厅一键直回（免输房间号，3 分钟内有效；无记录则不显示）
- **隐藏彩蛋**：对局中输入特定 4 位口令 + Enter 切换「狂暴冲锋枪」（高射速/远射程/无限弹药），仅当局有效（见 `docs/requirements.md` FR-E1）
- **Bot 假人**：巡逻/追击/低血躲避状态机 + BFS 寻路 + 三档难度，房间自动填充，与真人同一管线
- **双地图 + 完整对局生命周期**：靶场/狭巷两张掩体图，**击杀目标（30/50/100）与时限（5/8/10 分钟）大厅可选**（默认 30 杀 / 5 分钟，先到即结束）、再来一局、断线 30s 内重连回原状态（主动「返回大厅」则彻底退出，新开一局不再回到原对局）
- **完整游戏体验**：HUD/计分板/小地图/命中反馈、WebAudio 合成音效与 BGM、画质三档可调、中英双语 i18n
- **触屏操作（iPad/iPhone）**：Safari 等移动浏览器双虚拟摇杆（左移动/右瞄准）+ 开火/换弹/切枪/设置按钮，与桌面端同服同协议（FR-U6）
- **免 Vite 局域网联机**：Node 服务端同源托管构建产物，`http://<本机IP>:3000` 即可多设备开黑

技术路线详见 `docs/requirements.md`。

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
4. **多设备加入**：其他设备浏览器访问 `http://<本机IP>:3000`，输入昵称即可；每房 10 人、人满自动开新房，Bot 自动填充。**iPad/iPhone 直接用 Safari 访问同一地址即可**（自动启用触屏双摇杆 + 按钮，建议横屏）。
5. **开黑推荐流程（等待房间）**：房主点「**新建游戏**」→ 获得 4 位**房间号**并进入等待界面（可调整地图 / Bot 难度 / 击杀目标 / 时限 / Bot 数量）→ 其他玩家在大厅输入房间号点「**加入房间**」→ 人齐后房主点「**开始游戏**」全员进入对局。刚退出的玩家可在 3 分钟内点「**快速加入**」一键回房。
6. **排错**：
   - 无法访问 → 确认服务端窗口显示 `listening on http://localhost:3000`；确认第 3 步防火墙规则；确认设备与主机同一网段。
   - 卡「正在连接服务器」→ 多为端口未放行或 IP 输错；`http://<IP>:3000/health` 返回 OK 即链路正常。
   - 版本提示 → 客户端与服务端代码不一致，重新 `build` 后强刷页面（Ctrl+F5）。

### 质量检查与压测命令

```bash
corepack pnpm typecheck    # 全量 TS 检查
corepack pnpm unit         # 零依赖单测（碰撞/滑铲位移/双击检测/开火解算/数值衰减/库存状态机/解锁链/滚轮顺序/服务端房间状态机）
corepack pnpm check:i18n   # i18n 中英键集 + 代码引用键校对（NFR-9）
corepack pnpm loadtest     # 内部压测：50 客户端 × 30s 打真实服务端（NFR-3 ≥50 同时在线）
                           # 可调参：corepack pnpm loadtest -- --clients=80 --seconds=60
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 客户端 | TypeScript + Vite + Three.js（WebGL2 俯视角）+ socket.io-client |
| 服务端 | Node.js + Socket.IO（websocket-only 权威服务端） |
| 共享包 | pnpm monorepo，`packages/shared`（协议/武器数值/地图/碰撞，前后端同源 TS） |
| 碰撞 | 自研 AABB + 圆形碰撞 + DDA 射线检测 |
| i18n | 自研轻量方案，中 / 英双语 |

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。欢迎自部署、二次开发与交流。

