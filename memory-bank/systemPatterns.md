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
- **同步策略**：服务端固定步长 30Hz 模拟、20~30Hz 下发快照；V1 广播范围为整个房间（10 人全量），**不做兴趣区域过滤**（V2 视规模再引入）；增量快照 schema 定义于 shared。客户端 60fps 渲染，其他玩家用缓冲插值（~100ms），自己用预测+服务端和解（reconciliation）。
- **帧循环分离**：服务端固定步长模拟（accumulator 模式），客户端 rAF 渲染。
- **协议**：消息类型集中定义于 shared（C2S: input/join/switch/reload；S2C: snapshot/hit/kill/spawn/event）。
- **地图即数据**：JSON tile 地图，一处定义两端使用。
- **武器数值同源**：`packages/shared/src/weapons.ts` 单一数值源（伤害/射速/弹匣/换弹/散布/射程衰减），前后端消费同一份（FR-W5）。

## M2 战斗/网络模块结构（2026-10-18 落地，权威服务端已实现）
```
packages/shared/src/
├─ weapons.ts    # 6 类武器数值（唯一数值源，FR-W5）
├─ inventory.ts  # WeaponInventory 弹匣/备弹/换弹/切枪状态机（服务端权威实例 + 客户端预测实例）
├─ combat.ts     # resolveShot 纯函数开火解算（散布/多弹丸/射线判定；两端共用杜绝分叉）
├─ map.ts        # 地图数据 + pickSpawnFarthest（距敌最远出生点）
├─ collision.ts  # 圆-网格碰撞解算 / DDA 射线 / rayVsAABB（含零分量加固）
└─ protocol.ts   # join/welcome/input/snapshot + shot/hit/kill 事件（FR-N2/N7）

apps/server/src/
├─ index.ts      # HTTP 健康检查 + Socket.IO 进房（版本校验/昵称清洗/断线移除）+ smoke
├─ room.ts       # Room：30Hz 固定步长权威模拟、输入队列限频、伤害/击杀/重生、Bot 填充
└─ bot.ts        # 服务端 Bot 占位 AI（合成输入，与玩家同一结算管线）

apps/client/src/game/
├─ scene.ts      # Three.js 场景/相机/投影/镜头震动（纯表现）
├─ net.ts        # socket.io-client 封装（websocket-only）
├─ entities.ts   # RemoteEntity 快照缓冲插值(~100ms, FR-N3) + LocalPlayer 预测表现
├─ world.ts      # NetWorld：本地移动/开火预测 + 快照和解(吸附/渐进) + 事件分发
├─ weapons(→shared) / hud.ts / input.ts  # HUD 与输入同 M1
scripts/net-smoke.ts  # 集成冒烟：2 模拟客户端验证进房/移动/快照/断线（corepack pnpm smoke:net）
```
- **同步策略现状**：30Hz 模拟 + 30Hz 全量快照广播（JSON，规格 20~30Hz 内）；本地玩家预测+和解，远端 ~100ms 插值；延迟补偿回溯按决策 #10 后置

## 目录结构（已定稿 monorepo）
```
DeadShot/
├─ packages/shared/    # 数值、地图、协议、碰撞
├─ apps/client/        # Vite + Three.js
├─ apps/server/        # Node + Socket.IO
└─ docs/               # 需求与设计文档
```
