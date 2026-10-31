# 系统模式（System Patterns）

## 总体架构
```
[浏览器客户端 Three.js + TS]
   │ WebSocket (Socket.IO)
[Node.js 权威服务端] ── 房间管理器 ── Room × N（每房间独立 30tick 模拟循环）
   │
[共享包 packages/shared]：武器数值 / 地图数据 / 协议消息与快照 schema / 碰撞与射线逻辑（前后端同源）
```

## 关键设计决策
- **权威服务端**：所有移动校验、命中判定、伤害结算在服务端；客户端只做表现与预测。（M2 起权威逻辑在服务端 `room.ts`；客户端 `world.ts` 仅承载预测/和解/表现）
- **同步策略**：服务端 accumulator 固定步长 30Hz 模拟，快照按唤醒频率 20~30Hz 广播（V1 全量快照、JSON；增量编码后置至 M4，决策 #8）；V1 广播范围为整个房间（10 人全量），**不做兴趣区域过滤**（V2 视规模再引入）。客户端 60fps 渲染，其他玩家用缓冲插值（~100ms），自己用预测 + 服务端和解（seq ack + 未确认输入重放）。
- **帧循环分离**：服务端固定步长模拟（accumulator 模式），客户端 rAF 渲染。
- **滑铲（FR-C7，v0.4.1 方案 A + 追加：分阶段滑行）**：双击方向键 → 进入 **0.40s 三段滑行**（助跑加速 0.10s → 匀速滑行 0.16s → 减速到停 0.14s，总位移 `DASH_DISTANCE`=3.5、峰值 12.5 u/s ≈ 2.08× 走路）。shared `dash.ts` 速度剖面**解析积分**（`dashProgress`，与步长无关 → 服务端 30Hz tick 与客户端 60fps 同一 elapsed 同一累计距离）；服务端权威滑铲状态机（`SimFighter.dash` 方向锁定，逐 tick 差量经 `dashMove()` 分段碰撞位移，滑铲期屏蔽常规移动，死亡/重生/断线取消）+ 客户端同曲线预测（`localDash`/`advanceLocalDash`，滑铲期**跳过权威位置对齐**、上行输入移动量记 0 与服务端屏蔽一致）；冷却 `DASH_COOLDOWN`=1.5s 自滑铲起算；启动音效 `sfx.dash()` + 轻震。
- **和解修正视觉平滑（v0.4.1 追加，画面平滑）**：快照和解的位置修正量（服务端 30Hz 定步 vs 客户端连续预测的相位差，~28Hz、平均 ~0.075 单位）经 `game/smoothing.ts` 判定后转成 `LocalPlayer` 衰减视觉偏移（τ=0.05s、总量钳 1.0；≥1.5 单位=瞬移直接对齐）——相机/网格连续追上无阶跃抖动；**物理位置、瞄准、命中、延迟补偿全部不变**。配套：镜头震动双正弦平滑噪声（去逐帧随机）、输入上行节流恒定 30Hz 扣减节奏（相位误差减半）。
- **协议**：消息类型集中定义于 shared（C2S: join/createRoom/updateRoom/startMatch/input/ping/rush/rematch/leave；S2C: welcome/joinRejected/roomUpdate/snapshot/pong；对局事件随快照捎带：shot/hit/kill/unlock/matchEnd/matchReset）。**协议 v4（v0.4.1）**：`InputMsg.dash?: {x,y}`（滑铲意图增量可选字段）；移除 `JoinMsg/CreateRoomMsg.progress?`（武器层级按局重置，浏览器不持久化），`WelcomeMsg.progress?` = 本局各类击杀数（重连/中途加入同步层级用）
- **地图即数据**：JSON tile 地图，一处定义两端使用。
- **武器数值同源**：`packages/shared/src/weapons.ts` 单一数值源（伤害/射速/弹匣/换弹/散布/射程衰减），前后端消费同一份（FR-W5）。
- **对局与房间生命周期语义（v0.3.5 定稿）**：房间两态 `waiting | running`（FR-L8）——「新建游戏」建房进 waiting（4 位数字房间号唯一，等待界面房主可调地图/难度/killTarget/timeLimitSec/botCount，S2C `roomUpdate` 广播），房主 `startMatch` 转 running 并**向全员重发 `welcome(room.state='running')`**（客户端复用既有进局链路，等待→对局切换零新增协议）；waiting 态不步进不广播、`enqueueInput` 丢弃、Bot 不加入（开局按 `botCount` 补齐）、断线即移除（模拟时钟冻结使宽限失效）；房主离开/断线移交下一位真人；按房间号进房（`JoinMsg.roomCode?` → `findByCode`）waiting/running 均可，非法/不存在 → `noRoom`；快速加入建房 autoStart=true 保持秒进对局。对局属性（killTarget/timeLimitSec）为建房时确定的房间属性（waiting 态可由房主改），选房只匹配「地图 + 规则」相同者；空房被复用（回收等待期 ≤60s）时先重置对局再迎新（`Room.resetMatch`）；中途加入已结束房间经 `WelcomeMsg.matchEnd?` 补发最近一次结算；断线 30s 宽限仅适用于意外断线（running 态），主动离开走 C2S `leave` 立即移除实体；`rematch` 不改变断线状态。切枪意图（数字键/滚轮）由客户端统一折算为 `switchTo` 上报（shared `nextWeaponId`）

## M2 战斗/网络模块结构（2026-10-18 落地，权威服务端已实现）
```
packages/shared/src/
├─ weapons.ts    # 6 类武器数值（唯一数值源，FR-W5）+ WEAPON_TIERS 解锁链（M3：每类 3 级，T2@8杀/T3@20杀）
├─ inventory.ts  # WeaponInventory 弹匣/备弹/换弹/切枪状态机 + tierSpecs 层级覆盖（服务端权威实例 + 客户端预测实例）
├─ combat.ts     # resolveShot 纯函数开火解算（散布/多弹丸/射线判定；两端共用杜绝分叉）
├─ map.ts        # 地图数据 + MAPS 注册表（M3：range 靶场 + alley 狭巷）+ pickSpawnFarthest
├─ collision.ts  # 圆-网格碰撞解算 / DDA 射线 / rayVsAABB（含零分量加固）/ dashMove（FR-C7 滑铲位移：确定性分段碰撞，两端同源不穿墙）
├─ dash.ts       # 滑铲分阶段速度剖面（FR-C7 追加）：dashProgress 解析积分（助跑/滑行/减速三段，与步长无关）+ dashSpeed 速度倍率
├─ roomCode.ts   # 房间号（FR-L8，v0.3.5）：ROOM_CODE_LENGTH + normalizeRoomCode 前后端同源校验
└─ protocol.ts   # join/welcome(+room?(v3)/matchEnd 结算补发)/input(+dash? v4 滑铲)/snapshot + ping/pong + C2S createRoom/updateRoom/startMatch/rush/leave + shot/hit/kill/unlock/matchEnd/matchReset 事件（协议 v4，FR-N2/N7/E1/L7/L8/C7）

apps/server/src/
├─ index.ts      # HTTP 健康检查/静态托管 + Socket.IO 路由（join/createRoom/updateRoom/startMatch/input/rush/rematch/leave/disconnect）
├─ rooms.ts      # RoomManager（v0.3.7 从 index.ts 抽出：选房/建房/房间号/断线重连查找/空房回收）+ sanitizeRule/sanitizeSettings 白名单校验——index.ts 与 scripts/net-smoke.ts 同源复用，消除冒烟复制路由的覆盖盲区
├─ room.ts       # Room：30Hz accumulator 固定步长权威模拟、输入队列限频、伤害/击杀/重生、Bot 填充、等待房间生命周期（FR-L8）、对局生命周期（FR-M1/L7）
└─ bot.ts        # 服务端 Bot AI（M3：巡逻/追击/低血躲避状态机 + BFS 网格寻路 + 三档难度画像，WeakMap 状态）

apps/client/src/game/
├─ scene.ts      # Three.js 场景/相机/投影/镜头震动（纯表现）
├─ audio.ts      # WebAudio 合成音效（M3：射击/命中/击杀/换弹/死亡/解锁/结算；首次交互初始化）
├─ net.ts        # socket.io-client 封装（websocket-only + sendRematch）
├─ entities.ts   # RemoteEntity 快照缓冲插值(~100ms, FR-N3) + LocalPlayer 预测表现 + 头顶悬浮血条（FR-C3/U1，v0.3.9：本地预测血量/远端快照血量，分段变色，墙后遮挡）
├─ world.ts      # NetWorld：本地预测 + 快照和解(seq ack + 输入重放) + 事件分发（unlock/matchEnd/进度持久化回调）
├─ hud.ts        # HUD + 计分板(Tab)/结算面板/解锁横幅/对局倒计时（M3 扩展）
├─ minimap.ts    # 小地图（FR-U2，M4）：墙体预渲染底图 + 自己位置/朝向（不显示敌人）
├─ (src/settings.ts) # 设置持久化（FR-L5，M4）：音量/BGM/画质/语言 → localStorage + Esc 面板（v0.4.0 增加操作提示帮助区块 #helpHint + 返回首页按钮 #setHome）
├─ (src/game/touch.ts)        # 触屏控制器·stick 模式（可选）：双虚拟摇杆 + 开火/换弹/切枪/设置按钮（仅 pointerType==='touch'）；定义 TouchController 统一契约（consume/getAim/destroy）与 TouchAim（dir|client|none）
├─ (src/game/touchpad.ts)     # 触屏控制器·pad 模式（v0.3.8 默认）：左下 D-pad 四向（多点触控斜向合成）+ 点击/按住屏幕瞄准射击（无开火键）
├─ (src/game/gestures.ts)     # iOS 手势加固（v0.3.8 双模式共用）：对局中 window 层双指/gesture 拦截（修「双指误缩放」；配合 body.in-game #game touch-action:none）
├─ (src/game/touchmath.ts)    # 摇杆/方向纯函数（stickVector 钳制/归一化/死区/平滑 + dpadVector 四向合成 + clientToNdc + isTouchDevice 判定，零依赖可单测）
├─ (src/waitroom.ts)        # 等待房间界面（FR-L8，v0.3.5）：房间号/玩家列表/房主调参/开局（v0.4.0 起为参数唯一配置入口）
├─ (src/main.ts 大厅段)      # 大厅（v0.4.1）：昵称 + 新建游戏（createRoom 缺省参数进等待房）/ 加入游戏弹窗（#joinDialog 内联校验）/ 快速加入（#quickJoin 条件显示：最近离开房间 localStorage `DoShoot.recentRoom` TTL 3 分钟，v0.4.1 恢复 FR-L4）/ 回到上一局（#rejoinBtn 条件显示，FR-N5）
├─ (src/game/dashtap.ts)     # 双击方向键检测纯函数（FR-C7，v0.4.1）：DoubleTapTracker 250ms 窗口、忽略 OS 自动重复；键盘 input.ts 与触屏 touchpad.ts 共用
├─ (src/game/smoothing.ts)   # 表现层平滑纯函数（v0.4.1 追加·画面平滑）：isSmoothableCorrection（和解修正阈值判定，≥1.5 单位=瞬移不平滑）+ decayFactor（帧率无关指数衰减）；world.ts 和解修正与 entities.ts 视觉偏移共用
├─ weapons(→shared) / input.ts  # 输入同 M1
scripts/net-smoke.ts  # 集成冒烟：起临时服务器 + 模拟客户端验证进房/移动/快照/重连/双地图/等待房间（v0.3.7 起复用真实 RoomManager/sanitize*，corepack pnpm smoke:net）
```
- **同步策略现状**：30Hz accumulator 模拟 + 按唤醒频率 20~30Hz 全量快照广播（JSON，实测 26.8/s）；本地玩家预测 + 和解（seq ack + 未确认输入重放），远端 ~100ms 插值；**延迟补偿回溯（M4）**：服务端 ~1s 位置历史，命中按「插值延迟 + 半程 RTT」回溯（ping/pong 测 RTT，Bot 回溯为 0）；快照 JSON 编码经压测维持（50 客户端 26.8/s、~59KB/s/端，决策 #8）

## 目录结构（已定稿 monorepo）
```
DoShoot/
├─ packages/shared/    # 数值、地图、协议、碰撞
├─ apps/client/        # Vite + Three.js
├─ apps/server/        # Node + Socket.IO
└─ docs/               # 需求与设计文档
```
