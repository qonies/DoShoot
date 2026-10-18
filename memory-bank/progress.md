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
- [x] **M2 联机 FFA（2026-10-18）**：快照/事件协议入 shared、服务端权威房间（30Hz 固定步长 + 输入校验 + 伤害/击杀/重生 + Bot 填充）、客户端插值/预测/和解、进房流程与版本校验、socket.io-client 接入
  - 验收：`smoke:net` 集成冒烟 ALL PASS（版本拒绝/进房/移动/快照 20~30Hz/Bot 活跃/断线移除）/ typecheck 全过 / build gzip 143KB；局域网双机实测待用户验证
- [x] **客户端连接链路修复（2026-10-18）**：修复「点开始卡在连接服务器」——Vite 加 /socket.io ws 代理（开发态 5173→3000）、服务端同源托管 dist + /health（局域网设备直接访问 http://<IP>:3000）、connect_error 可见化（停重试+回大厅+i18n 提示）；smoke 退出 libuv 断言修复
- [x] **代码体检修复（2026-10-18）**：P0 服务端换弹永不完成（room.ts step 补 `inv.update`）+ smoke:net 新增开火/换弹回归断言；P1 switchTo 白名单校验与 firePresses 积压封顶（防崩服/超射速）；P2 输入队列改「丢最旧保最新」（防停火/切枪状态消息被丢）、大厅按钮 i18n、weaponId 和解（250ms 去抖）、断线停 rAF + Input/Scene/Net 资源清理；P3 地面尺寸改 map.width/height、RemoteEntity 深度释放、FR-B1 措辞对齐 BOT_FILL_MAX=5、smoke 移动断言去出生点抖动；遗留：setInterval 非 accumulator，Windows 下 tick ≈22/s 模拟变慢（M4）
- [x] **服务端 tick/预测和解/资源释放修复（2026-10-18，v0.2.5）**：room.ts accumulator 固定步长（修复 Windows tick≈22/s、模拟 0.73× 变慢，快照改每唤醒聚合广播、实测 28/s）；FR-N4 和解接通 seq（EntitySnapshot.lastSeq + 客户端未确认输入重放，替代朴素 lerp）；瞄准坐标 `Number.isFinite` 修复；scene dispose 深度释放 + forceContextLoss；smoke 退出改自然排空（去 win32 libuv 断言）；死代码清理（CELL_SIZE/PROTOCOL 删除，MAP_*/SNAPSHOT_RATE_* 启用）与文档同步

## 未开始
- [ ] **M3 系统完整**（武器解锁成长、第二张地图、Bot AI 完善、计分板/结算、音效、断线重连）——下一步
- [ ] M4 打磨完善（优化、平衡、局域网部署说明、内部压测）

## 当前状态
**M2 已完成**，联机 FFA 可玩（`corepack pnpm dev:server` + `dev:client`，Bot 自动填充）。M3 待启动。

