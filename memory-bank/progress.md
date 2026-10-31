# 进度（Progress）

## 已完成
- [x] **滑铲分阶段滑行（2026-10-30，v0.4.1 追加②，版本号/协议不变）**：滑铲由「瞬时位移」改为 **0.40s 三段速度曲线**（助跑加速 0.10s → 匀速滑行 0.16s → 减速到停 0.14s，总位移 3.5、峰值 12.5 u/s ≈ 2.08× 走路）——新增 shared `dash.ts`（`dashProgress` 解析积分剖面 + `dashSpeed`，与步长无关，两端确定一致）；服务端权威滑铲状态机（`SimFighter.dash` 方向锁定 + 逐 tick dashProgress 推进差量 + dashMove 碰撞；滑铲期屏蔽常规移动；死亡/重生/断线取消）；客户端同曲线预测（`localDash` + `advanceLocalDash`）并在滑铲期跳过权威位置对齐（上行输入移动量记 0 与服务端屏蔽一致，结束差值由视觉平滑吸收）。验证：unit 175→187（剖面/单调/边界/步长无关性）/ smoke:net（中间滑行状态 + 全程位移断言，方向自动选无墙正向）ALL PASS / typecheck / check:i18n / smoke:server / build（gzip 157.54KB）全过；**滑铲手感手测待验收**
- [x] **画面平滑优化（2026-10-30，v0.4.1 追加，版本号不变）**：修复移动中画面轻微抖动——根因是快照和解（~28Hz）把「服务端 30Hz 定步 vs 客户端连续预测」相位差阶跃修正（模拟实测平均 4px/最大 16px）。①新纯函数模块 `game/smoothing.ts`（`isSmoothableCorrection`/`decayFactor`，CORRECTION_SMOOTH_MAX=1.5 瞬移阈值）+ `reconcileLocal` 修正量走 `LocalPlayer` 衰减视觉偏移（τ=0.05s，总量钳 1.0，复活/换图瞬时对齐，物理/命中不变）；②镜头震动改双正弦平滑噪声（去逐帧随机、lookAt 不随机转向）；③输入上行节流改恒定 30Hz 扣减节奏。模拟复测渲染偏差 max 15.7→2.9px、RMS 4.2→0.7px；unit 164→175；typecheck/check:i18n/smoke:net/smoke:server/build（gzip 157.34KB）全过；服务端与协议零改动；**手测待验收**
- [x] **快速加入回归 / 双击滑铲 / 武器层级按局重置（2026-10-30，v0.4.1）**：①大厅条件显示「快速加入 · 房间 {code}」（localStorage `DoShoot.recentRoom` 记最近离开房间，TTL 3 分钟，无记录/过期/房间回收不显示，与「回到上一局」互斥且重连优先；服务端零改动）；②新增 FR-C7 滑铲——双击方向键（WASD/方向键/pad 模式 D-pad）沿当前移动向量瞬时位移 3.5 单位、冷却 1.5s（shared `dashMove()` 确定性 + `InputMsg.dash?` + 发送点预测/和解重放 + 本地视觉 ~0.12s 平滑 + 滑铲音效/轻震）；③FR-A1/W1/W4 武器解锁进度改按局计——删 localStorage 持久化与进房基线上报，服务端 `resetProgression()`（开局/空房复用/再来一局），shared `resetTiers()`，每次新游戏全员回 T1、浏览器不记忆历史层级；协议 v3→**v4**；i18n 108→109 键；版本 0.4.1。验证：typecheck / unit 164 / check:i18n / smoke:net（+滑铲位移、进房进度全 0 断言）/ smoke:server（protocol v4）/ build（gzip 155.90KB→157.15KB）全过；**浏览器手测与局域网实测待验收**
- [x] **首页精简与帮助菜单（2026-10-30，v0.4.0）**：大厅仅昵称 + 新建游戏/加入游戏 + 语言切换——新建游戏直接建房进等待房间（参数缺省走服务端默认，房主在等待界面调参，FR-L8 成为参数唯一配置入口）；加入游戏弹房间号输入弹窗（内联校验/Enter/Esc/遮罩）；快速加入 UI 入口移除（服务端能力保留），断线重连改大厅条件按钮「回到上一局」（仅对局中断线出现、30s 自动隐藏）；HUD #hint 移入 Esc 设置面板帮助区块（修 v0.3.9 提示与 pad 血条重叠，pad 避让选择器收紧 `body.touch.pad`）+ 面板新增「返回首页」按钮（与结算「返回大厅」共用 leaveMatchToLobby）。服务端与协议零改动；i18n 106→108 键；版本 0.3.9→0.4.0。验证：typecheck / unit 145 / check:i18n / smoke:net / smoke:server / build（gzip 155.90KB）全过
- [x] 对标同类 .io 射击游戏的玩法拆解
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

- [x] **FR-E1 冲锋枪彩蛋模式落地（2026-10-23，v0.3.2）**：对局中输入 4 位口令 `7890` + Enter 切换狂暴冲锋枪（1200rpm/满伤 40·射程 60/无限弹药），当局跨重生保留、回合结束自动失效不带到下一局；服务端权威授予（shared `CHEAT_RUSH_CODE`，口令不含 1~6 防误触切枪），协议 v2 增量字段 `EntitySnapshot.rush?` + C2S `rush`；rush 击杀不计解锁进度；彩蛋模式中手动切枪=主动放弃（可重输口令再激活）；HUD 弹药显示 ∞；单测 64→86 项、smoke:net 新增彩蛋断言。验证：unit/typecheck/check:i18n/smoke:net/build 全过（gzip 149.7KB）

- [x] **FR-L7 对局生命周期选择落地（2026-10-23，v0.3.3）**：大厅可选击杀目标（30/50/100 杀）与对局时限（5/8/10 分钟），先到即结束（默认 30杀/5分钟 = 原行为）；JoinMsg 增量字段 killTarget?/timeLimitSec?（白名单校验），选房按「地图+规则」匹配不混房，matchEnd 携带实际 killTarget、结算文案参数化；smoke:net 新增自定义规则建房断言。验证：unit 86 / typecheck / check:i18n（75 键）/ smoke:net / build 全过

- [x] **体检修复批次 2（2026-10-24，v0.3.4）**：P1 滚轮切枪同步服务端（shared `nextWeaponId` + `pendingSwitch` 上报，rush 放弃闪烁消除）/ P1 加入已结束或复用空房卡死（`Room.resetMatch` + `WelcomeMsg.matchEnd?` 补发结算）/ P1 主动离开语义（C2S `leave` 立即移除 + 清 sessionStorage 重连凭据）/ P1 rematch 不复活断线者；P2 快速加入不混规则房间、面板打开屏蔽键盘、设置监听器模块级一次性绑定、welcome 版本校验、空房跳过模拟与广播；P3 WebGL 失败可见报错、死代码清理。协议仍 v2（增量 `WelcomeMsg.matchEnd?` + C2S `leave`）。单测 86→98 项；smoke:net 新增 leave 回归断言。验证：unit 98 / typecheck / check:i18n（76 键）/ smoke:net / build（gzip 150.3KB）全过

- [x] **等待房间与房间号落地（2026-10-29，v0.3.5）**：「新建游戏」→ 等待开局界面（4 位房间号、房主可调地图/Bot 难度/击杀目标/时限/Bot 数量），大厅房间号输入「加入房间」，房主「开始游戏」全员进对局（服务端重发 welcome 复用进局链路）；等待态不步进不广播、Bot 开局按量加入、等待态断线即移除、房主离开移交；协议 v2→**v3**（C2S createRoom/updateRoom/startMatch + S2C roomUpdate + JoinMsg.roomCode?/WelcomeMsg.room?/noRoom）。单测 98→122 项、smoke:net 新增 5 步。验证：unit 122 / typecheck / check:i18n（93 键）/ smoke:net / smoke:server（protocol v3）/ build（gzip 152.1KB）/ loadtest 全过

- [x] **头顶血条（2026-10-29，v0.3.9）**：每个玩家/Bot 头顶悬浮实时血板——本地=预测血量（每帧 sync）、远端/Bot=快照血量（~28Hz applySnapshot）；Three.js 双板实现（底板+左端锚定填充板 `scale.x=hp%`，俯仰角匹配俯视相机正对视角）；血量分段变色（>55 绿/26~55 橙/≤25 红）、死亡隐藏、变化时才改写、实体消失深度释放；悬浮高度 1.8（反馈：1.45 压角色，且高于墙顶→掩体后血板浮现墙顶上方）；**倒计时移右上角**（反馈：原顶部中央与击杀数/血板重叠；触屏端左移避让设置按钮，击杀流下移）。服务端与协议零改动。验证：typecheck / unit 145 / check:i18n / smoke:net / build（gzip 155.76KB）全过；视觉效果待浏览器实测

- [x] **触屏双操作模式（2026-10-29，v0.3.8）**：新增 **pad 模式（默认）**——左下 D-pad 四向键（多点触控、相邻同按=斜向）+ 点击/按住屏幕瞄准射击（screenToGround 世界点投影，轻点 1 发/按住连发/拖动微调，无开火键）；原双摇杆保留为可选（stick），设置面板「操作模式」下拉 + 局内热切换（销毁重建控制器）；**iOS 手势加固修「双指误缩放」**（`user-scalable=no` iOS 被忽略是根因 → `body.in-game #game` touch-action:none + window 层双指/gesture 拦截，单指面板滚动不受影响）；`TouchController` 统一契约 + `gestures.ts` + `touchmath` 新增 `dpadVector`/`clientToNdc`；HUD 避让（pad：血条底部中央/动作键右缘竖排）；服务端与协议零改动。单测 132→145、i18n 98→106 键。验证：typecheck / unit / check:i18n / smoke:net / build（gzip 155.37KB）全过；**iOS 真机实测待验收**（双指不缩放、D-pad 手感、点击射击）

- [x] **体检修复批次 3（2026-10-29，v0.3.7）**：P1 smoke:net 彩蛋断言假失败修复（新增不感知死亡 `waitFor`，替代 `waitForAlive` 的「先活后死」误判，实测 3 跑 1 败）；P1 触屏小屏适配——`#settings/#settlement` 面板纳入小屏媒体查询（限宽限高可滚动）+ 设置面板遮罩点击关闭 + 面板打开期间 `body.ui-open` 隐藏触屏按钮（层级压面板问题）；P2 `newCode()` 兜底改确定性 4 位扫描接入 `ROOM_CODE_LENGTH`（原 5 位兜底号无法加入）、`requestRush` running 态守卫（防等待房间提前激活彩蛋）、显式 `roomCode` 优先于 `rejoinId`；P3 rush 防闪烁改服务端确认窗口（`switchAckPending` 1s）、重复 welcome 先停旧对局循环、右摇杆旋钮钳制、`isTouchDevice` 收紧（触屏笔记本不误判）、`#roomCode` maxlength 放宽、计分板帧判读走 getter；测试体系重构——`RoomManager`+`sanitize*` 抽出至 `apps/server/src/rooms.ts`，index.ts 与 net-smoke.ts 同源复用（消除冒烟「同语义子集」漂移盲区）。单测 130→132；验证 typecheck / unit / check:i18n / smoke:net×3（真实 RoomManager）/ smoke:server / build（gzip 154.07KB）全过

- [x] **触屏操作适配落地（2026-10-29，v0.3.6）**：iPad/iPhone 浏览器（iOS Safari ≥15）双虚拟摇杆（左移动/右瞄准，方向松手保持）+ 开火/换弹/切枪/设置按钮 + 安全区适配；仅响应 pointerType==='touch'（桌面零影响）；`(pointer: coarse)` 判定兼容 iPadOS 桌面模式；stickVector 纯函数单测；触屏瞄准 = 玩家位置+方向×8、准星 worldToScreen 投影；viewport 禁缩放/viewport-fit=cover/touch-action:none/100dvh/禁捏合；小屏媒体查询（大厅/等待面板可滚动）；服务端与协议零改动。单测 122→130 项。验证：unit 130 / typecheck / check:i18n（98 键）/ smoke:net / smoke:server / build（gzip 153.9KB）全过；**iOS Safari 真机实测待验收**

## 未开始
- [ ] **局域网多设备实测验收（M4 验收项）**：60 FPS 实测、双机开黑体验、平衡性反馈与数值调参
- [ ] **V2**（TDM/Hardpoint、账号与战绩、反作弊加固、更多地图武器，见需求 §1.2）

## 当前状态
**v0.4.1（含画面平滑 + 滑铲分阶段滑行两项追加优化）已落地**（协议 **v4**：`InputMsg.dash?` 增量、移除进房 progress 基线；`WelcomeMsg.progress?` = 本局各类击杀数）：快速加入按钮（最近离开房间 TTL 3 分钟）+ **分阶段滑铲（0.40s 助跑/滑行/减速/停止，服务端权威状态机 + 客户端同曲线预测）** + 每次新游戏全员武器回 T1（不落浏览器）+ **移动中画面抖动修复（和解修正表现层平滑 / 平滑震动噪声 / 恒定 30Hz 上行节奏，模拟实测渲染偏差降 ~5.5×）**。完整可玩 FFA + 等待房间（FR-L8）+ 触屏双模式（FR-U6）+ 可配置对局生命周期 + 延迟补偿/小地图/设置界面/音频增强 + 冲锋枪彩蛋 + 滚轮切枪/对局复用/主动离开/重连语义。待浏览器手测（快速加入按钮生命周期 / 滑铲四段手感与冷却 / 每局回 T1 与刷新不残留 / 画面平滑与瞄准手感）与局域网多设备实测验收（重点：**iOS Safari 真机**——双指不缩放、pad 模式 D-pad 手感/双击滑铲与点击射击、stick 回退、模式热切换、面板滚动、桌面端回归）。

