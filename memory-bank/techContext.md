# 技术上下文（Tech Context）

## 已确认技术路线（v0.2 定稿，2026-10-17 全面对齐）
- **渲染**：Three.js（WebGL2，正交/小透视俯视角相机）
- **语言**：TypeScript（全栈）
- **构建**：Vite
- **服务端**：Node.js + Socket.IO（已定稿，不使用 Colyseus，房间管理自研）；客户端强制 websocket-only transport（禁轮询回退）；服务端未强制禁 polling/消息缓冲（内网可信环境，非浏览器客户端可协商 transport）
- **多语言**：自研轻量 i18n（JSON 资源文件），中/英双语，默认跟随浏览器语言
- **Bot 假人**：正式功能——状态机 AI（巡逻/追击/躲避）+ 网格寻路，三档难度，与真人同管线
- **网络模型**：权威服务端；**固定步长模拟 30Hz，快照下发 20~30Hz**；远端玩家缓冲插值 + 本地预测 + 服务端和解
- **快照协议**：V1 为每 tick 全量快照（JSON、20~30Hz）；增量/定点数/字节布局编码后置至 M4 优化（决策 #8）
- **碰撞**：自研 AABB + 圆形碰撞 + 射线检测（不引入重型物理引擎）
- **部署**：**局域网 Node 直跑（内部测试）**，无需域名/HTTPS/备案/云服务器；公网上线时再引入 Docker/Nginx（V2+，非当前范围）

## 依赖清单（M2 更新，2026-10-18）
- 运行时环境：Node v24.13.0；pnpm 12.14.0（**pnpm 不在 PATH，用 `corepack pnpm <cmd>` 调用**）
- 客户端：three 0.180.0、vite 7.3.7、typescript ^5.6、@types/three ^0.180、**socket.io-client 4.8.4**
- 服务端：socket.io 4.8.4、tsx ^4.19（dev 直跑 TS）
- workspace 根 devDeps：socket.io-client 4.8.4（供 `scripts/net-smoke.ts` 集成冒烟）
- 共享包：`packages/shared`（TS 源码形式被两端直接引用，main/types 指向 src/index.ts）
- pnpm 12 注意：esbuild 的 postinstall 需显式许可，**pnpm 12 用 `pnpm-workspace.yaml` 的 `allowBuilds`（包名→布尔映射），旧字段 `onlyBuiltDependencies` 已失效**（否则 install 报 ERR_PNPM_IGNORED_BUILDS 退出码 1）

## 仓库与凭据（2026-10-18）
- GitHub：`qonies/DoShoot`（**public**，2026-10-18 由 private 改为 public），remote origin 已配置，主分支 main
- Release：**v0.3.1 已发布**（tag v0.3.1 + release notes，无构建产物 assets，内容覆盖 M3 系统完整 + M4 打磨完善）；历史 v0.2.5
- **版本同步（2026-10-30）**：根与三个子包 package.json 同步至 **0.4.1**（快速加入回归/滑铲/武器层级按局重置）；v0.3.2~v0.4.1 尚未发布 GitHub Release
- 客户端构建 gzip ≈ 157.5KB（v0.4.1 含画面平滑 + 滑铲分阶段滑行实测 157.54KB；v0.4.0 155.90KB、v0.3.9 155.76KB、v0.3.8 155.37KB、v0.3.7 154.07KB、v0.3.6 153.9KB、M4 148.9KB）
- **开源协议：MIT**（2026-10-18 落地：根 LICENSE 文件 + 根 package.json `license: MIT` + README 协议章节与徽章；commit 269c9d9 已推送）
- **GitHub 简介**（gh repo edit 已设置；2026-10-21 移除对标字眼）：浏览器多人在线俯视角射击游戏：TypeScript + Three.js + Socket.IO 权威服务端，快照插值/预测与和解/延迟补偿，武器解锁、Bot AI、中英双语。MIT 开源。另附 topics：game/multiplayer/threejs/socketio/typescript/websocket/shooter
- 凭据助手配置在**仓库本地**：`git config credential.helper "!gh auth git-credential"`（gh CLI 已登录 qonies；本机 HOME 指向自定义目录导致 gh 无法写全局 .gitconfig，故用仓库级配置）

## 环境与命令（2026-10-18 实测可用）
- Windows + PowerShell；Node v24.13.0；pnpm 经 corepack 调用：`corepack pnpm <cmd>`（pnpm 不在 PATH）
- **网络协议 v4（v0.4.1，2026-10-30）**：`InputMsg.dash?: {x,y}`（滑铲意图，增量可选字段）+ 移除 `JoinMsg/CreateRoomMsg.progress?`（武器层级按局重置，浏览器不持久化；`WelcomeMsg.progress?` = 本局各类击杀数，重连/中途加入同步层级用）；`PROTOCOL_VERSION` 3→**4**（旧页面收到明确版本不一致提示——其 localStorage 残留层级显示会与服务端不一致，故升版强制刷新）
- **网络协议 v3（v0.3.5，2026-10-29）**：等待房间生命周期（FR-L8）——C2S `createRoom`（CreateRoomMsg）/`updateRoom`（RoomSettingsMsg，房主调参）/`startMatch`（无载荷，房主开局）+ S2C `roomUpdate`（RoomInfoMsg：code/hostId/state/mapId/difficulty/killTarget/timeLimitSec/botCount/capacity/players）；增量字段 `JoinMsg.roomCode?`/`botCount?`、`WelcomeMsg.room?`、`JoinRejectReason+'noRoom'`；`PROTOCOL_VERSION` 2→**3**（旧客户端收到明确版本不一致提示而非静默卡死）；shared `roomCode.ts` `normalizeRoomCode` 前后端同源校验（4 位数字）
- **滑铲常量（FR-C7）**：shared `DASH_DISTANCE`=3.5 / `DASH_RAMP_TIME`=0.10 / `DASH_GLIDE_TIME`=0.16 / `DASH_DECEL_TIME`=0.14（`DASH_TOTAL_TIME`=0.40）/ `DASH_COOLDOWN`=1.5 / `DASH_SUBSTEP`=0.2；客户端 `DASH_DOUBLE_TAP_MS`=250（game/dashtap.ts）
- **协议 v2 历史增量（v0.3.4，2026-10-24，v3 内已包含）**：`WelcomeMsg.matchEnd?`（中途加入已结束房间补发最近一次结算）+ C2S `leave`（主动离开立即移除实体，不走断线宽限）
- **M4 延迟补偿**：ping/pong RTT 测量 + `InputMsg.pingMs`（增量可选字段，v2 前后端互相兼容）；服务端 ~1s 位置历史回溯命中（shared 常量 INTERP_DELAY/LAG_COMP_HISTORY/LAG_COMP_MAX_REWIND）
- 根目录脚本已内置 `corepack pnpm` 前缀，可直接使用：
  - `corepack pnpm dev:client` → http://localhost:5173
  - `corepack pnpm dev:server` → http://localhost:3000
  - `corepack pnpm typecheck` / `corepack pnpm build`
  - `corepack pnpm smoke:server`（服务端自检后自动退出）
  - `corepack pnpm smoke:net`（网络集成冒烟：起临时服务器 + 2 模拟客户端，全过自动退出）
  - `corepack pnpm check:i18n`（i18n 中英键集/代码引用校对，NFR-9）
  - `corepack pnpm loadtest`（内部压测：默认 50 客户端 × 30s 打真实服务端，NFR-3；可 `-- --clients=80 --seconds=60` 调参）

## 约束
- 浏览器目标：Chrome/Edge/Firefox/Safari 最新两个大版本，需支持 WebGL2；最低基线 Safari ≥ 15（含 **iOS Safari：v0.3.6 起支持 iPad/iPhone 触屏操作**，FR-U6 双摇杆 + 按钮，Pointer Events + `(pointer: coarse)` 判定）
- V1 单服目标并发：≥ 50 人同时在线（多房间）
