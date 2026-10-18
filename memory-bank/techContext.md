# 技术上下文（Tech Context）

## 已确认技术路线（v0.2 定稿，2026-10-17 全面对齐）
- **渲染**：Three.js（WebGL2，正交/小透视俯视角相机）
- **语言**：TypeScript（全栈）
- **构建**：Vite
- **服务端**：Node.js + Socket.IO（已定稿，不使用 Colyseus，房间管理自研）；强制 websocket-only transport，禁用轮询回退与消息缓冲
- **多语言**：自研轻量 i18n（JSON 资源文件），中/英双语，默认跟随浏览器语言
- **Bot 假人**：正式功能——状态机 AI（巡逻/追击/躲避）+ 网格寻路，三档难度，与真人同管线
- **网络模型**：权威服务端；**固定步长模拟 30Hz，快照下发 20~30Hz**；远端玩家缓冲插值 + 本地预测 + 服务端和解
- **快照协议**：增量快照 schema（定点数/字节布局）显式定义于 `packages/shared`；JSON 编码起步，必要时切二进制
- **碰撞**：自研 AABB + 圆形碰撞 + 射线检测（不引入重型物理引擎）
- **部署**：**局域网 Node 直跑（内部测试）**，无需域名/HTTPS/备案/云服务器；公网上线时再引入 Docker/Nginx（V2+，非当前范围）

## 依赖清单（M0 已锁定实际版本）
- 运行时环境：Node v24.13.0；pnpm 12.14.0（**pnpm 不在 PATH，用 `corepack pnpm <cmd>` 调用**）
- 客户端：three 0.180.0、vite 7.3.7、typescript ^5.6、@types/three ^0.180
- 服务端：socket.io 4.8.4、tsx ^4.19（dev 直跑 TS）
- 共享包：`packages/shared`（TS 源码形式被两端直接引用，main/types 指向 src/index.ts）
- pnpm 12 注意：esbuild 的 postinstall 脚本需在 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 中显式许可（当前唯一许可项为 esbuild）

## 环境与命令（2026-10-18 修复后实测可用）
- Windows + PowerShell；Node v24.13.0；pnpm 经 corepack 调用：`corepack pnpm <cmd>`（pnpm 不在 PATH）
- 根目录脚本已内置 `corepack pnpm` 前缀，可直接使用：
  - `corepack pnpm dev:client` → http://localhost:5173
  - `corepack pnpm dev:server` → http://localhost:3000
  - `corepack pnpm typecheck` / `corepack pnpm build`
  - `corepack pnpm smoke:server`（服务端自检后自动退出）

## 约束
- 浏览器目标：Chrome/Edge/Firefox/Safari 最新两个大版本，需支持 WebGL2；最低基线 Safari ≥ 15
- V1 单服目标并发：≥ 50 人同时在线（多房间）
