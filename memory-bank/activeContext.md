# 活动上下文（Active Context）

## 当前焦点
**M3 系统完整已完成并通过冒烟验收** — 下一步进入 M4 打磨完善。

## 最近变更（2026-10-18 · M3 系统完整）
- **武器解锁成长（FR-W1/W4/A1/B5）**：`weapons.ts` 新增 `WEAPON_TIERS`（每类 3 级链：T1→T2@8杀→T3@20杀，id 保持类 id、仅数值/名称升级，含 T3 自动霰弹枪等 12 个新数值变体）+ `tierForKills`/`specForTier`；`inventory.ts` 支持 `tierSpecs` 覆盖（`setTierSpec` 对当前武器奖励满新弹匣、`resetAll` 保留层级）；服务端 `registerKill` 按类计数并跨阈值广播 `unlock` 事件（Bot 击杀同计入 FR-B5）；进房 `progress` 基线（localStorage `DoShoot.progress`）在 `applyProgress` 中恢复层级；客户端 `world.ts` 收 unlock 事件同步层级 + 全屏解锁横幅 + 琶音音效
- **第二张地图 + 多房间（FR-MP2/L3/L4/N6）**：`map.ts` 新增「狭巷」32×32（四角建筑群+中央广场+十字巷道）与 `MAPS` 注册表 + `getMap`；服务端 `index.ts` RoomManager（按地图选房人最多者、quick join 全局人最多非满房、空房 60s 回收巡检）；大厅地图/Bot 难度下拉（数据驱动填充）；WelcomeMsg 新增 `mapId`（客户端按其渲染场景）
- **Bot AI 重写（FR-B2/B3/B4）**：`bot.ts` 巡逻/追击/低血躲避状态机 + BFS 网格寻路（Int32Array 队列、LOS 拐角裁剪、卡墙重算）+ 三档难度画像（easy/normal/hard：移速 0.5/0.65/0.8、瞄准误差 7/4/1.8°、反应延迟、开火间隔、交战距离、走位激进度）；`botSpeedOf` 供 room 移动结算；WeakMap 存状态不污染 SimFighter
- **对局生命周期（FR-M1/M4/U5）**：Room `matchStart/matchOver`——30 杀或 300s 结束 → `matchEnd` 事件（standings 按 kills 降序/deaths 升序）；结束后冻结开火与重生；`rematch()` 重置 kills/deaths 并全员重生（生涯解锁进度保留）；结算面板（再来一局=发 rematch 消息 / 返回大厅=断线）；HUD 顶部对局倒计时（`SnapshotMsg.matchTimeLeft`）
- **断线重连（FR-N5）**：`markDisconnected` 保留实体 30s（输入清零、宽限内不消费输入不参与 AI）；step 开头清扫超时者；`tryRejoin` 恢复原 fighterId；客户端 sessionStorage `DoShoot.playerId` + join 带 `rejoinId`；fighterId 与 socket.id 解耦（`sessions` 映射）
- **音效（FR-S1 子集）**：新增 `audio.ts`（WebAudio 合成免素材：噪声+低通+包络的枪声按武器音色/距离衰减、命中 tick、击杀双音、换弹咔哒、死亡滑音、解锁琶音、结算旋律）；`sfx.ensure()` 在 startGame 首次交互时初始化
- **协议 v2（FR-N7）**：PROTOCOL_VERSION=2；EntitySnapshot+deaths、Snapshot+matchTimeLeft、WelcomeMsg+mapId/progress、JoinMsg+mapId/difficulty/rejoinId/progress、kill 事件+killerId、新事件 unlock/matchEnd/matchReset（StandingRow 类型）
- **冒烟加固（smoke:net）**：冒烟服务器改按地图惰性建房（与 RoomManager 同语义子集）+ sessions 映射；新增断言：FR-N5 宽限保留 + rejoin 恢复原 playerId、第二地图房间（mapId=alley）、welcome.progress/deaths/matchTimeLeft 字段存在；旧「断线立即移除」断言按新语义替换
- **验证**：typecheck 三包全过 / build 成功（gzip 147KB）/ smoke:server 通过（protocol v2）/ smoke:net 连续 2 轮 ALL PASS
- **简化与后置（M4）**：FR-M4 武器统计简化为 K/D；FR-U2 小地图、FR-S2 空间音频、FR-S3 BGM、FR-L5 设置界面后置；60 FPS 浏览器实测仍待用户验证

## 最近变更（2026-10-18 · 全量体检 + 冒烟竞态修复）
- **体检结论**：typecheck 三包全过 / build 成功（gzip 143KB）/ smoke:server 通过 / smoke:net 通过；文档与代码一致性良好（需求 v0.2.5 ↔ 实现对齐；M3 未做项均有记录）
- **P2 smoke:net fire/reload 竞态盲区（已修复）**：原断言的死亡豁免检查只在 8s 等待超时后执行一次——测试者站桩等换弹期间被 Bot 击杀并重生（重置为满弹手枪、回到出生点）时，快照呈 alive:true + pistol 满弹，误判为换弹回归失败（实测复现一次）。改为 `waitForAlive`（等待中检测死亡立即以 'dead' 中断，区别于超时）+ 最多 3 次重试（每次先等复活满状态）；顺手删除失去引用的旧 `waitFor`
- **P3 客户端连接握手期断线死锁（已修复）**：`main.ts` onDisconnected 只处理 inGame 分支——建连后、welcome 前断开（如服务端恰在进房握手时重启）会永久卡「正在连接服务器」（socket.io 自动重连但 join 不重发）。补 `else if (connecting)` 分支按 connectFailed 收场
- **P3 冒烟端口防冲突（已修复）**：`net-smoke.ts` 固定 `:3100` 改为 `listen(0)` 系统分配临时端口（回调内取 `address().port`），并行/残留进程占用不再 EADDRINUSE——实测并行双跑分别落 ：57965/:57967 均 ALL PASS
- **P3 昵称客户端校验（已修复，FR-L1）**：`main.ts` startGame 前置 2~16 字符校验（与服务端 sanitizeNickname 一致），非法时 `lobby.nameInvalid` i18n 提示并中止进房（消除「被服务端静默改名 P-xxxx」的无感知体验）；空输入回退随机名（提取 `randomName()` 复用初始默认逻辑）；zh/en 文案同步
- **注意**：`memory-bank/techContext.md` 存在一处先前会话遗留的未提交改动（冒烟端口已改临时分配，原「并行重跑 EADDRINUSE」注意事项不再适用）
- 验证：typecheck 全过 / smoke:net 连续 2 轮 ALL PASS（22/s 快照率在断言区间内）

## 最近变更（2026-10-18 · tick/和解/资源释放体检修复）
- **P1 服务端 accumulator 固定步长（已修复）**：`room.ts` 由裸 `setInterval`（Windows 下实际 tick≈22/s，模拟时间以 0.73× 流逝，移速/射速/换弹全部偏慢）改为 accumulator 循环——interval 仅按 `1000/SNAPSHOT_RATE_MAX` 唤醒，模拟按累积真实时间推进（`dt=1/30` 恒定；停顿 >250ms 丢弃积压、单次唤醒 ≤8 步防追步风暴）；快照改为每次唤醒聚合广播一次（跨步事件合并），实测 28/s 回到规格内
- **P1 预测和解接通 seq（FR-N4 完整落地）**：协议 `EntitySnapshot` 新增 `lastSeq`（服务端对每实体单调记录已消费输入 seq）；客户端 `world.ts` 记录每条上行输入覆盖的真实 dt，快照到达时「丢弃已 ack 输入 → 对齐权威位置 → 重放未消费输入」，替代原朴素 lerp/吸附（消除快照滞后预测造成的稳态拖影/橡皮筋）；死亡/复活时清空待重放队列（死亡期间服务端不 ack），队列上限 120
- **P2 瞄准坐标 falsy 缺陷（已修复）**：`room.ts` 输入校验改 `Number.isFinite` 判定（原 `Number(msg.aimX) || f.x` 把合法坐标 0 误判回退当前位置）
- **P2 GPU 资源释放（已加固）**：`scene.ts dispose()` 遍历场景深度释放全部 Mesh/Line 的 geometry/material（含 InstancedMesh 墙体、地面、实体、曳光），并 `renderer.forceContextLoss()`（同 canvas 重建 renderer 需干净上下文）
- **P2 冒烟退出 libuv 断言（已修复）**：`index.ts` smoke 路径不再直接 `process.exit`（win32 下句柄关闭未完成时触发 `win/async.c UV_HANDLE_CLOSING` 断言，原 50ms 延时仅缓解仍偶发），改为设置 `process.exitCode` 让事件循环自然排空，`unref` 定时器兜底防悬挂
- **死代码清理**：删除未引用的 `CELL_SIZE`、`PROTOCOL`；`MAP_WIDTH/HEIGHT` 接入 `map.ts`（消除与内部硬编码 40 的重复漂移风险）；`SNAPSHOT_RATE_MIN/MAX` 实际启用（广播间隔 / 冒烟断言边界）
- **文档同步**：requirements 升 v0.2.5（FR-N2 与关键技术要点改为「V1 每 tick 全量快照、增量编码后置 M4」）；systemPatterns/techContext 同步
- 验证：typecheck 三包全过 / build 成功（gzip 143KB 持平）/ `smoke:server` 连续 2 次干净退出（200 OK + dist served）/ `smoke:net` ALL PASS——**移动 2s 11.3 单位（≈5.6u/s，实证模拟恢复实时速度）、快照 28/s、开火+换弹回归通过**

## 最近变更（2026-10-18 · 客户端连接链路修复）
- **根因**：客户端 `io('/')` 连的是页面自身来源——开发态是 Vite 5173，游戏服务端在 3000，而 vite.config 无代理；socket.io 握手永无响应且无 `connect_error` 处理 → 点开始后「正在连接服务器…」永久卡住（M2 此前仅 smoke:net 直连 3000 验证过，浏览器真实链路未走通）
- **修复**：① vite.config 加 `/socket.io` 代理（ws:true → localhost:3000）；② 服务端同源托管 `apps/client/dist`（含 /health 健康检查、路径规范化防目录穿越；smoke 自检改用 /health 并验证 GET / 托管），实现 README/FR 的「局域网 Node 直跑」：`build` + `dev:server` 后局域网设备访问 `http://<IP>:3000` 即可加入；③ net.ts 新增 `onConnectError`（main.ts 失败后 close socket 停止无限重试、回大厅、i18n 提示 net.connectFailed 中英）
- **顺手修**：smoke 自检因 fetch keep-alive 在 process.exit 时触发 libuv 断言（win32）→ 退出前 `httpServer.closeAllConnections()` + 50ms 延迟退出
- 验证：typecheck 全过 / build 成功 / smoke:server（PORT=3101 实测 exit 0，client dist served）/ smoke:net ALL PASS / :3000 同源 socket.io 握手实测返回 `upgrades:["websocket"]`

## 最近变更（2026-10-18 · 代码体检修复）
- **P0 服务端换弹永不完成（已修复）**：`room.ts step()` 补调 `f.inv.update(now)`（此前服务端从不推进库存状态机，`reloadEnd` 永不清除 → 弹尽后 `canFire` 恒 false，每把武器一命只能打一个弹匣）；`smoke:net` 原本未覆盖开火/换弹所以漏检
- **P1 switchTo 非法输入可崩服（已修复）**：服务端按 `WEAPON_ORDER` 白名单校验 + `inventory.switchTo` 双重加固；同时半自动/泵动累计 `firePresses` 封顶 3（防超射速积压连发，NFR-5）
- **P2 客户端修复**：大厅 `#quickJoin`/`#start` 补 `data-i18n`（此前渲染为空按钮）；`reconcileLocal` 按 ~250ms 去抖校正权威 `weaponId`（防切枪输入丢失后两端分叉，去抖容忍快照滞后的瞬时不一致）；断线/被拒时停 rAF 循环 + `Input.destroy()`/`GameScene.dispose()`/`net.close()` 清理（新增 destroy/dispose；防监听器叠加与孤儿重连）
- **P3**：`scene.ts` 地面改用 `map.width/height`（原硬编码 40×40 常量，第二张地图会错位）；`RemoteEntity.dispose` 释放 geometry/material；requirements FR-B1 措辞统一为「默认最多 5 个 Bot」（对齐 `BOT_FILL_MAX=5`）
- **P2（追加）输入队列丢消息导致状态卡死（已修复）**：`enqueueInput` 队列满时由「丢弃新消息」改为「丢最旧、保最新」——最新输入携带当前状态（如停火/切枪），被丢会造成永久卡开火；冒烟中实测触发（停火消息被丢 → 持续开火）
- **冒烟测试加固**：移动断言改为「朝地图中心按主导轴移动」+ 阈值降至 1.5（原「向右移 ≥3」在贴边出生点（如 37.5,·）仅能移动 ~1.1~2.1 单位，结果随出生点抖动）；开火/换弹断言改为基于快照状态轮询等待（waitFor），对 tick 速率波动鲁棒
- **遗留发现（M4 待办）**：服务端用裸 `setInterval` 而非 systemPatterns 记录的 accumulator 模式，Windows 下定时器粒度使实际 tick ≈22/s（快照频率实测 22/s），模拟时间以 0.73× 实时速度流逝（移速/射速/换弹时间全部偏慢）。建议 M4 改 accumulator 循环并对快照广播做合帧
- 验证：typecheck 全过 / build 成功 / `smoke:server` 200 OK / `smoke:net` ALL PASS（新增 4b 开火+换弹回归断言，P0 修复实测生效）

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
