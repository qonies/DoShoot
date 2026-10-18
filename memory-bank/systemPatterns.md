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

## M1 战斗层模块结构（客户端，M2 迁移服务端时复用 combat/shared）
```
apps/client/src/game/
├─ scene.ts     # Three.js 场景/相机/投影/镜头震动（纯表现）
├─ fighter.ts   # 战斗实体（HP/受击/死亡/重生/命中盒）
├─ weapons.ts   # 武器库存状态机（弹匣/备弹/换弹/切枪打断）
├─ combat.ts    # 开火解算（散布/多弹丸/射线判定/射程衰减/曳光池）→ M2 移入服务端
├─ bot.ts       # 基础 Bot 占位 AI（游走+视线点射，M3 完善状态机）
├─ world.ts     # 对局编排（移动/开火/击杀/重生调度）→ M2 迁移至服务端模拟
├─ hud.ts       # HUD（血条/弹药/击杀流/准星/飘字/泛红/重生界面）
└─ input.ts     # 键鼠输入（含开火按下沿，消费型 InputCommand）
```

## 目录结构（已定稿 monorepo）
```
DeadShot/
├─ packages/shared/    # 数值、地图、协议、碰撞
├─ apps/client/        # Vite + Three.js
├─ apps/server/        # Node + Socket.IO
└─ docs/               # 需求与设计文档
```
