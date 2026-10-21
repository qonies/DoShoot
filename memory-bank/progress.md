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

- [x] **全量体检 + 冒烟竞态修复（2026-10-18）**：typecheck/build/smoke:server/smoke:net 全过；修复 smoke:net fire/reload 断言竞态盲区（站桩换弹期间被 Bot 击杀重生会被误判为回归失败 → waitForAlive 死亡感知中断 + 3 次重试）；修复客户端连接握手期断线死锁（卡「正在连接服务器」→ 按 connectFailed 收场）；清理死代码 waitFor
- [x] **小修收尾（2026-10-18）**：smoke:net 端口改系统分配临时端口（并行双跑实测不冲突）；昵称 2~16 字符客户端前置校验 + lobby.nameInvalid 中英文案（空输入回退随机名）
- [x] **M3 系统完整（2026-10-18）**：武器解锁成长（每类 3 级链 T2@8/T3@20 杀 + localStorage 持久化 + 全屏提示，协议 v2）+ 第二张地图「狭巷」与 RoomManager 多房间（大厅地图/难度选择、快速加入、空房 60s 回收）+ Bot AI 状态机（巡逻/追击/低血躲避 + BFS 寻路 + 三档难度）+ FFA 对局生命周期（30 杀/5 分钟 → 结算面板 → 再来一局）+ 断线重连（30s 宽限 + rejoinId 回原状态）+ WebAudio 合成音效
  - 验收：typecheck 全过 / build gzip 147KB / smoke:server 通过（protocol v2）/ smoke:net 连续 2 轮 ALL PASS（新增 FR-N5 宽限+重连、第二地图房间、协议 v2 字段断言）；双机实测与 60 FPS 待用户验证

- [x] **体检问题修复落地（2026-10-18）**：M3 全量工作补提交（此前 24 个文件未提交，HEAD 停在 v0.2.5）；客户端断线死路修复（onDisconnected 补 backToLobby + 文案提示重连，FR-N5 内页可用）；冒烟 waitForAlive 重试盲区修复（等待复活被自身死亡检测误杀、被击杀一次即必败 → 改「先活后死」判定，连续 3 轮 ALL PASS）；空房回收改按 emptySince 起算（对齐 FR-N6「变空后 60s」）；FR-N4 延迟补偿在需求中明确「后置 M4、尚未实现」；地图下拉 i18n 切换修复（option 补 data-i18n）；子包版本号同步 0.3.0；README 补冒烟命令；删除遗留 sv_out.log

- [x] **M4 打磨完善（2026-10-18，代码落地）**：FR-N4 延迟补偿回溯（~1s 位置历史 + 插值延迟/半程 RTT 回溯命中，ping/pong 测 RTT，协议 v2 增量兼容）+ FR-U2 小地图（墙体预渲染）+ FR-L5 设置界面（音量/BGM/画质三档/语言，Esc 面板 localStorage 持久化）+ FR-S2 方位声像 + FR-S3 合成 BGM（独立音量）+ 画质分档性能优化 + 压测脚本 `loadtest`（实测 50 客户端 PASS：快照 26.8/s、单端下行 ~59KB/s、0 断线）+ i18n 校对脚本 `check:i18n`（OK）+ README 局域网部署详细步骤；验证 typecheck/build/smoke:server/smoke:net×2 全过（gzip 148.9KB）；待用户局域网多设备实测（60FPS/开黑/平衡性反馈）

- [x] **体检问题修复落地（2026-10-21）**：P1 渲染（移除 `forceContextLoss`，规避二次进局黑屏风险）、昵称校验 i18n 键修正（`lobby.nameInvalid`）+ check:i18n 包装函数键扫描、设置/结算面板点击误触开火修复、复活清延迟补偿位置历史（幽灵命中盒）、死亡血条清零；P2 服务端输入超时 250ms / 空房 Bot 归零 / 进度单类上限 999 / DIST_DIR 严格前缀、客户端快照版本校验 / 返回大厅残留 UI 复位 / 主动离开不再误报断线；P3 CSS 重复块合并、net-smoke 死代码、net.ts 未用回调清理、地图下拉补「随机」（FR-L3）、对局中切语言刷新；新增零依赖单测 `corepack pnpm unit`（64 断言）。验证：unit / typecheck / check:i18n / smoke:net×2 / smoke:server 全过；**待浏览器实测**二次进局渲染回归

## 未开始
- [ ] **局域网多设备实测验收（M4 验收项）**：60 FPS 实测、双机开黑体验、平衡性反馈与数值调参
- [ ] **V2**（TDM/Hardpoint、账号与战绩、反作弊加固、更多地图武器，见需求 §1.2）

## 当前状态
**M4 代码已落地 + 体检修复（2026-10-21）**：完整可玩 FFA 产品 + 延迟补偿/小地图/设置界面/音频增强/压测与部署文档 + 体检修复批次（渲染/输入/延迟补偿/服务端加固/单测）；协议 v2 增量兼容。待用户局域网多设备实测验收（重点：进局→返回大厅→再进局渲染回归、面板点击不开枪）。

