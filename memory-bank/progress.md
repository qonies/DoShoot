# 进度（Progress）

## 已完成
- [x] 对标 deadshot.io 玩法拆解
- [x] 关键技术路线确认（Three.js 伪 3D 俯视角）
- [x] 需求文档 `docs/requirements.md`（v0.1 初稿）
- [x] Memory Bank 初始化
- [x] 需求评审完成（2026-10-17）：6 个待定问题全部确认，文档升级 v0.2 定稿
  - Socket.IO 定稿 / 局域网内部测试 / Bot 正式功能（新增 4.9 节）/ 几何体+免费素材 / 每房 10 人 / 中英双语（新增 FR-L6、NFR-9）
- [x] 技术路线体检与修复（2026-10-17，v0.2.1）：techContext 残留清理与对齐、tick 表述统一、FR-W5 预测边界澄清、快照 schema 入 shared、M2 上调 3 周、武器进度 localStorage 默认开启
- [x] **M0 技术原型（2026-10-17）**：monorepo + shared（地图/碰撞/协议）+ Three.js 客户端（俯视角相机/阴影/移动/瞄准/射击/碰撞）+ 大厅与 i18n 骨架 + Socket.IO 服务端骨架
  - 验收：typecheck 通过 / build 成功（gzip 125KB）/ dev HTTP 200 / 服务端冒烟 200 OK；60 FPS 待浏览器实测
- [x] 项目体检与修复（2026-10-18，v0.2.2）：根脚本改用 `corepack pnpm` 前缀（修复命令失效）、Git 仓库初始化、FR-A1 措辞统一、i18n 收口（TDM/Hardpoint/地图名）、`BULLET_DAMAGE` 移除、`rayVsAABB` 零分量加固
- [x] **M1 单机战斗核心（2026-10-18）**：shared 武器数值表（6 类武器 + 射程衰减）+ 客户端战斗层（fighter/weapons/combat/bot/world/hud）+ HP/死亡/重生（距敌最远出生点）+ 完整 HUD（血条/弹药/换弹条/击杀流/动态准星/命中标记/伤害飘字/受击泛红/重生界面）+ 基础 Bot（游走 + 视线点射）
  - 验收：typecheck 全过 / build 成功（gzip 129KB）/ 服务端冒烟 200 OK；60 FPS 与手感待浏览器实测

## 未开始
- [ ] **M2 联机 FFA**（Socket.IO 权威模拟、快照/插值/预测、Bot 填充）——下一步
- [ ] M3 系统完整（武器解锁、第二张地图、Bot AI 完善、音效、i18n 全覆盖）
- [ ] M4 打磨完善（优化、平衡、局域网部署说明、内部压测）

## 当前状态
**M1 已完成**，单人完整对局可玩（`corepack pnpm dev:client`，含 5 个 Bot）。M2 联机 FFA 待启动。

