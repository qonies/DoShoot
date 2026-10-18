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
- **权威服务端**：所有移动校验、命中判定、伤害结算在服务端；客户端只做表现与预测。（M1 现状：单机模式权威逻辑暂在客户端 `world.ts`，M2 迁移至服务端模拟）
- **同步策略**：服务端 accumulator 固定步长 30Hz 模拟，快照按唤醒频率 20~30Hz 广播（V1 全量快照、JSON；增量编码后置至 M4，决策 #8）；V1 广播范围为整个房间（10 人全量），**不做兴趣区域过滤**（V2 视规模再引入）。客户端 60fps 渲染，其他玩家用缓冲插值（~100ms），自己用预测 + 服务端和解（seq ack + 未确认输入重放）。
- **帧循环分离**：服务端固定步长模拟（accumulator 模式），客户端 rAF 渲染。
- **协议**：消息类型集中定义于 shared（C2S: input/join/switch/reload；S2C: snapshot/hit/kill/spawn/event）。
- **地图即数据**：JSON tile 地图，一处定义两端使用。
- **武器数值同源**：`packages/shared/src/weapons.ts` 单一数值源（伤害/射速/弹匣/换弹/散布/射程衰减），前后端消费同一份（FR-W5）。

## M2 战斗/网络模块结构（2026-10-18 落地，权威服务端已实现）
```
packages/shared/src/
├─ weapons.ts    # 6 类武器数值（唯一数值源，FR-W5）+ WEAPON_TIERS 解锁链（M3：每类 3 级，T2@8杀/T3@20杀）
├─ inventory.ts  # WeaponInventory 弹匣/备弹/换弹/切枪状态机 + tierSpecs 层级覆盖（服务端权威实例 + 客户端预测实例）
├─ combat.ts     # resolveShot 纯函数开火解算（散布/多弹丸/射线判定；两端共用杜绝分叉）
├─ map.ts        # 地图数据 + MAPS 注册表（M3：range 靶场 + alley 狭巷）+ pickSpawnFarthest
├─ collision.ts  # 圆-网格碰撞解算 / DDA 射线 / rayVsAABB（含零分量加固）
└─ protocol.ts   # join/welcome/input/snapshot + shot/hit/kill/unlock/matchEnd/matchReset 事件（协议 v2，FR-N2/N7）

apps/server/src/
├─ index.ts      # HTTP 健康检查 + Socket.IO RoomManager（M3：按地图多房间/快速加入/空房回收/断线重连会话映射）+ smoke
├─ room.ts       # Room：30Hz accumulator 固定步长权威模拟、输入队列限频、伤害/击杀/重生、Bot 填充、对局生命周期（30杀/5min → rematch）
└─ bot.ts        # 服务端 Bot AI（M3：巡逻/追击/低血躲避状态机 + BFS 网格寻路 + 三档难度画像，WeakMap 状态）

apps/client/src/game/
├─ scene.ts      # Three.js 场景/相机/投影/镜头震动（纯表现）
├─ audio.ts      # WebAudio 合成音效（M3：射击/命中/击杀/换弹/死亡/解锁/结算；首次交互初始化）
├─ net.ts        # socket.io-client 封装（websocket-only + sendRematch）
├─ entities.ts   # RemoteEntity 快照缓冲插值(~100ms, FR-N3) + LocalPlayer 预测表现
├─ world.ts      # NetWorld：本地预测 + 快照和解(seq ack + 输入重放) + 事件分发（unlock/matchEnd/进度持久化回调）
├─ hud.ts        # HUD + 计分板(Tab)/结算面板/解锁横幅/对局倒计时（M3 扩展）
├─ minimap.ts    # 小地图（FR-U2，M4）：墙体预渲染底图 + 自己位置/朝向（不显示敌人）
├─ (src/settings.ts) # 设置持久化（FR-L5，M4）：音量/BGM/画质/语言 → localStorage + Esc 面板
├─ weapons(→shared) / input.ts  # 输入同 M1
scripts/net-smoke.ts  # 集成冒烟：按地图惰性建房模拟服务端 + 模拟客户端验证进房/移动/快照/重连/双地图（corepack pnpm smoke:net）
```
- **同步策略现状**：30Hz accumulator 模拟 + 按唤醒频率 22~30Hz 全量快照广播（JSON）；本地玩家预测 + 和解（seq ack + 未确认输入重放），远端 ~100ms 插值；**延迟补偿回溯（M4）**：服务端 ~1s 位置历史，命中按「插值延迟 + 半程 RTT」回溯（ping/pong 测 RTT，Bot 回溯为 0）；快照 JSON 编码经压测维持（50 客户端 26.8/s、~59KB/s/端，决策 #8）

## 目录结构（已定稿 monorepo）
```
DoShoot/
├─ packages/shared/    # 数值、地图、协议、碰撞
├─ apps/client/        # Vite + Three.js
├─ apps/server/        # Node + Socket.IO
└─ docs/               # 需求与设计文档
```
