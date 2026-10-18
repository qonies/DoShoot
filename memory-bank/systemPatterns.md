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
- **权威服务端**：所有移动校验、命中判定、伤害结算在服务端；客户端只做表现与预测。
- **同步策略**：服务端固定步长 30Hz 模拟、20~30Hz 下发快照；V1 广播范围为整个房间（10 人全量），**不做兴趣区域过滤**（V2 视规模再引入）；增量快照 schema 定义于 shared。客户端 60fps 渲染，其他玩家用缓冲插值（~100ms），自己用预测+服务端和解（reconciliation）。
- **帧循环分离**：服务端固定步长模拟（accumulator 模式），客户端 rAF 渲染。
- **协议**：消息类型集中定义于 shared（C2S: input/join/switch/reload；S2C: snapshot/hit/kill/spawn/event）。
- **地图即数据**：JSON tile 地图，一处定义两端使用。

## 目录结构（已定稿 monorepo）
```
DeadShot/
├─ packages/shared/    # 数值、地图、协议、碰撞
├─ apps/client/        # Vite + Three.js
├─ apps/server/        # Node + Socket.IO
└─ docs/               # 需求与设计文档
```
