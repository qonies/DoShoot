# 活动上下文（Active Context）

## 当前焦点
**M0 技术原型已完成并通过验收** — 下一步进入 M1 单机战斗核心。

## 最近变更（2026-10-18）
- **项目体检与修复（v0.2.2）**：
  - 根 `package.json` 脚本改用 `corepack pnpm` 前缀（原裸 `pnpm` 不在 PATH，导致 `corepack pnpm typecheck/build/dev:*` 实际全部失败）；README 命令同步更新
  - **初始化 Git 仓库**并完成首次提交
  - requirements.md 升 v0.2.2：FR-A1 措辞统一为「localStorage 为 V1 唯一持久层（决策 #9）」；文档状态更新为「M0 已完成，进入 M1」
  - i18n 收口：TDM/Hardpoint 置灰项与地图名接入 i18n（GameMap 新增 `nameKey`，客户端经 `t(nameKey)` 显示），移除未使用的 `lang` 键
  - shared 清理：移除无消费方的 `BULLET_DAMAGE`；`rayVsAABB` 加固零分量边界（避免 0×Infinity=NaN 漏检，M2 服务端权威判定将复用此函数）
  - 验证：typecheck 全过、build 成功（gzip 125KB）、smoke 200 OK

## 最近变更（2026-10-17）
- **M0 技术原型实现完成**：
  - pnpm monorepo（`apps/client` / `apps/server` / `packages/shared`）搭建完毕，依赖安装锁定（three 0.180.0 / vite 7.3.7 / socket.io 4.8.4）
  - shared 包：常量、40×40 测试地图「靶场」（程序化生成、两端同源）、圆形-vs-网格碰撞解算、DDA 射线检测、rayVsAABB、协议占位类型
  - 客户端：正交俯视角相机跟随、地面/InstancedMesh 墙体、平行光阴影、胶囊玩家 WASD 八方向移动 + 圆形碰撞、鼠标瞄准（射线-地面平面）、按住左键射线射击 + 曳光淡出 + 4 个射击盒子命中闪红、FPS 计数
  - 大厅页：昵称（随机默认 + localStorage 记忆）、模式/地图选择（TDM/Hardpoint 置灰）、快速加入、中英 i18n（JSON 资源 + 浏览器语言检测 + localStorage）
  - 服务端：Socket.IO 最小可运行骨架（HTTP 健康检查 + ping/pong + 连接日志）+ 冒烟自检模式
  - 验收：typecheck 全通过、vite build 成功（gzip 125KB < 5MB）、dev 服务器 HTTP 200、服务端冒烟 200 OK；**60 FPS 需用户浏览器实测确认**
  - 环境注意：pnpm 不在 PATH，统一用 `corepack pnpm <cmd>`；pnpm 12 构建许可配置在 pnpm-workspace.yaml
- **技术路线体检 + 修复（v0.2.1）**：techContext 清理残留、tick 表述统一、FR-W5 预测边界澄清、快照 schema 入 shared、M2 上调 3 周、武器进度 localStorage 默认开启

## 下一步：M1 单机战斗核心
1. 6 类武器数值配置入 shared（伤害/射速/弹匣/换弹/散布/射程衰减）
2. 武器手感：半自动/连发/泵动差异、换弹进度条、切枪、后坐力表现
3. HP/死亡/重生（距敌最远出生点）、基础 HUD（血条/弹药/击杀流）
4. 基础 Bot 假人（占位移动，完整状态机在 M3）

## 重要决策记录
- 2026-10-17：渲染路线用户拍板选 Three.js（非 Canvas 2D）。
- 2026-10-17：全部开放问题确认完毕——Socket.IO 定稿；局域网内部测试部署；Bot 为正式功能（含房间填充）；美术用几何体+免费素材；每房 10 人；中英双语 i18n。
- 2026-10-17：技术澄清 4 项（决策 #7~#10）：兴趣区域 V1 不做 / 快照 schema 入 shared / 武器进度 localStorage 默认开启 / M2 上调 3 周。
