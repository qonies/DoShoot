# 技术上下文（Tech Context）

## 已确认技术路线（v0.2 定稿，2026-10-17 全面对齐）
- **渲染**：Three.js（WebGL2，正交/小透视俯视角相机）
- **语言**：TypeScript（全栈）
- **构建**：Vite
- **服务端**：Node.js + Socket.IO（已定稿，不使用 Colyseus，房间管理自研）；强制 websocket-only transport，禁用轮询回退与消息缓冲
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
- GitHub：`qonies/DoShoot`（私有），remote origin 已配置，主分支 main
- 凭据助手配置在**仓库本地**：`git config credential.helper "!gh auth git-credential"`（gh CLI 已登录 qonies；本机 HOME 指向 `/home/redacted` 导致 gh 无法写全局 .gitconfig，故用仓库级配置）

## 环境与命令（2026-10-18 实测可用）
- Windows + PowerShell；Node v24.13.0；pnpm 经 corepack 调用：`corepack pnpm <cmd>`（pnpm 不在 PATH）
- 根目录脚本已内置 `corepack pnpm` 前缀，可直接使用：
  - `corepack pnpm dev:client` → http://localhost:5173
  - `corepack pnpm dev:server` → http://localhost:3000
  - `corepack pnpm typecheck` / `corepack pnpm build`
  - `corepack pnpm smoke:server`（服务端自检后自动退出）
  - `corepack pnpm smoke:net`（网络集成冒烟：起临时服务器 + 2 模拟客户端，全过自动退出）

## 约束
- 浏览器目标：Chrome/Edge/Firefox/Safari 最新两个大版本，需支持 WebGL2；最低基线 Safari ≥ 15
- V1 单服目标并发：≥ 50 人同时在线（多房间）
