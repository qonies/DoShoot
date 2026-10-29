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
- **协议**：消息类型集中定义于 shared（C2S: join/createRoom/updateRoom/startMatch/input/ping/rush/rematch/leave；S2C: welcome/joinRejected/roomUpdate/snapshot/pong；对局事件随快照捎带：shot/hit/kill/unlock/matchEnd/matchReset）。
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
├─ collision.ts  # 圆-网格碰撞解算 / DDA 射线 / rayVsAABB（含零分量加固）
├─ roomCode.ts   # 房间号（FR-L8，v0.3.5）：ROOM_CODE_LENGTH + normalizeRoomCode 前后端同源校验
└─ protocol.ts   # join/welcome(+room?(v3)/matchEnd 结算补发)/input/snapshot + ping/pong + C2S createRoom/updateRoom/startMatch/rush/leave + shot/hit/kill/unlock/matchEnd/matchReset 事件（协议 v3，FR-N2/N7/E1/L7/L8）

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
├─ (src/settings.ts) # 设置持久化（FR-L5，M4）：音量/BGM/画质/语言 → localStorage + Esc 面板
├─ (src/game/touch.ts)        # 触屏控制器·stick 模式（可选）：双虚拟摇杆 + 开火/换弹/切枪/设置按钮（仅 pointerType==='touch'）；定义 TouchController 统一契约（consume/getAim/destroy）与 TouchAim（dir|client|none）
├─ (src/game/touchpad.ts)     # 触屏控制器·pad 模式（v0.3.8 默认）：左下 D-pad 四向（多点触控斜向合成）+ 点击/按住屏幕瞄准射击（无开火键）
├─ (src/game/gestures.ts)     # iOS 手势加固（v0.3.8 双模式共用）：对局中 window 层双指/gesture 拦截（修「双指误缩放」；配合 body.in-game #game touch-action:none）
├─ (src/game/touchmath.ts)    # 摇杆/方向纯函数（stickVector 钳制/归一化/死区/平滑 + dpadVector 四向合成 + clientToNdc + isTouchDevice 判定，零依赖可单测）
├─ (src/waitroom.ts)        # 等待房间界面（FR-L8，v0.3.5）：房间号/玩家列表/房主调参/开局
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
