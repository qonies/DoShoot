# 活动上下文（Active Context）

## 当前焦点
**M2 联机 FFA 已完成并通过验收** — 下一步进入 M3 系统完整。

## 最近变更（2026-10-18 · M2）
- **M2 联机 FFA 实现完成**：
  - shared：`protocol.ts` 落地完整协议（join/welcome/input/snapshot + shot/hit/kill 事件捎带，FR-N2/N7）；新增 `combat.ts`（`resolveShot` 纯函数开火解算，服务端权威与客户端预测共用）；`inventory.ts`（WeaponInventory 从客户端上移 shared，两端同源，新增 `reloadProgress`/`resyncAmmo`）；constants 新增 `ROOM_CAPACITY=10`/`BOT_FILL_MAX=5`
  - 服务端：`room.ts` 权威房间（30Hz setInterval 固定步长、输入队列限频 8 条/连接 + clampUnit 校验 NFR-5、伤害/击杀/重生结算、Bot 填充 adjustBots 保持 bots=min(5, 10-玩家)）；`bot.ts` 服务端占位 AI（合成输入走与玩家同一管线）；`index.ts` 进房流程（版本校验 FR-N7、昵称清洗 NFR-5、joinRejected、断线移除）
  - 客户端：`net.ts`（socket.io-client 4.8.4，websocket-only）；`entities.ts`（RemoteEntity 快照缓冲插值 ~100ms FR-N3 + LocalPlayer 预测表现）；`world.ts` 重写为 NetWorld（本地移动/开火预测 + 和解：误差>2 吸附/否则 0.2 渐进、弹药漂移≥2 校正、hit/kill/shot 事件分发）；删除 M1 本地权威的 bot/combat/weapons/fighter
  - 进房 UI：`#netmsg` 连接中/版本不一致/房间满/断线提示（i18n 中英）
  - 验证：`corepack pnpm smoke:net`（新增 `scripts/net-smoke.ts` 集成冒烟：版本拒绝/进房/移动结算/实体数/快照 20~30Hz/Bot 活跃/断线移除 → ALL PASS）；typecheck 全过；build gzip 143KB；smoke:server 200 OK
- **遗留到 M3**：延迟补偿回溯（决策 #10 允许后置）；快照仅全量（增量编码待优化）；断线重连 FR-N5 未做（当前断线即移除）；房间回收 FR-N6（当前单固定房间）

## 最近变更（2026-10-18 · M1）
- M1 单机战斗核心完成：shared 武器数值表、客户端战斗层（fighter/weapons/combat/bot/world/hud）、HP/死亡/重生、完整 HUD、基础 Bot；FR-W4 M1 约定（携带全部 6 类）已升 v0.2.3

## 下一步：M3 系统完整（~2 周）
1. 武器解锁成长（FR-W1：按类击杀数升级链 + localStorage 持久化 + 全屏解锁提示）
2. 第二张地图（FR-MP2：狭巷近战型）+ 大厅地图选择接入
3. Bot AI 完善（FR-B2~B5：巡逻/追击/躲避状态机 + 网格寻路 + 三档难度）
4. 计分板（Tab）/结算面板/再来一局（FR-U1/M4）
5. 音效（射击/命中/击杀/换弹；首次交互后初始化 AudioContext）
6. 断线重连（FR-N5，30s 内回原状态）；延迟补偿回溯（若 M2 末未做）

## 重要决策记录
- 2026-10-17：渲染路线用户拍板选 Three.js（非 Canvas 2D）。
- 2026-10-17：全部开放问题确认完毕——Socket.IO 定稿；局域网内部测试部署；Bot 为正式功能（含房间填充）；美术用几何体+免费素材；每房 10 人；中英双语 i18n。
- 2026-10-17：技术澄清 4 项（决策 #7~#10）：兴趣区域 V1 不做 / 快照 schema 入 shared / 武器进度 localStorage 默认开启 / M2 上调 3 周。
