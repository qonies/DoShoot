# 活动上下文（Active Context）

## 当前焦点
**M1 单机战斗核心已完成并通过验收** — 下一步进入 M2 联机 FFA。

## 最近变更（2026-10-18 · M1）
- **M1 单机战斗核心实现完成**：
  - shared 新增 `weapons.ts`：6 类武器数值表（伤害/弹丸数/开火模式 semi-auto-pump/rpm/弹匣/换弹/备弹/散布/移动散布/射程衰减/后坐力）+ `damageAtRange` 衰减函数 + `fireIntervalSec`；`constants.ts` 移除 M0 遗留 `FIRE_INTERVAL`/`MAX_RAY_DIST`，新增 `PLAYER_HP`/`RESPAWN_DELAY`/`HITBOX_HALF`；`map.ts` 新增 `pickSpawnFarthest`（FR-MP3 距敌最远出生点）
  - 客户端战斗层重写：`fighter.ts`（战斗实体：HP/受击/死亡/重生/命中盒）、`weapons.ts`（弹匣备弹状态机、换弹进度、切枪打断换弹+0.25s 硬直）、`combat.ts`（散布/霰弹 8 弹丸/墙体与实体射线判定/射程衰减伤害/曳光池）、`bot.ts`（占位 AI：随机游走+视线内最近敌人点射，M3 完善状态机）、`world.ts`（对局编排：玩家移动/瞄准/开火/切枪/换弹/弹尽自动换弹、击杀记录、2.5s 重生调度、后坐力准星扩散+镜头震动）、`hud.ts`（血条/弹药/换弹条/击杀流/动态准星/命中标记/伤害飘字/受击泛红/重生界面）
  - 删除 M0 的 `shooting.ts`/`player.ts`；`scene.ts` 移除射击盒子、新增 `screenToGround`/`worldToScreen`/`addShake`；`input.ts` 新增 R 换弹、数字键 1~6、滚轮切枪、开火按下沿（semi/pump 用）；`main.ts` 改为消费 InputCommand 驱动 World
  - FR-W4 M1 约定：单机携带全部 6 类武器（正式规则 M2 随解锁系统定），requirements.md 升 v0.2.3
  - i18n 补武器名（weapon.*）与 HUD 文案（hud.*）；hint 更新
  - 验收：typecheck 全过、build 成功（gzip 129KB < 5MB）、服务端冒烟 200 OK；60 FPS 与手感待浏览器实测
- **注意**：`world.ts` 的 M1 权威在客户端（单机无服务端），M2 联机时此层逻辑迁移至服务端模拟，客户端改预测+和解

## 最近变更（2026-10-18 · 体检修复 v0.2.2）
- 根 `package.json` 脚本改用 `corepack pnpm` 前缀（原裸 `pnpm` 不在 PATH）；README 同步
- Git 仓库初始化并首次提交；FR-A1 措辞统一；i18n 收口；`rayVsAABB` 零分量加固（M2 服务端复用）

## 下一步：M2 联机 FFA（~3 周）
1. Socket.IO 权威服务端：房间管理器 + 每房 30Hz 固定步长模拟（accumulator），迁移 world 战斗逻辑
2. 快照协议落地（shared/protocol.ts 扩展）：20~30Hz 快照、JSON 起步
3. 客户端：远端玩家 ~100ms 缓冲插值 → 先跑「无预测纯插值」再叠加本地预测 + 服务端和解（FR-N3/N4）
4. 大厅进房流程（快速加入/房间分配/协议版本校验 FR-N7）
5. 服务端 Bot 填充（沿用 bot.ts 占位 AI）

## 重要决策记录
- 2026-10-17：渲染路线用户拍板选 Three.js（非 Canvas 2D）。
- 2026-10-17：全部开放问题确认完毕——Socket.IO 定稿；局域网内部测试部署；Bot 为正式功能（含房间填充）；美术用几何体+免费素材；每房 10 人；中英双语 i18n。
- 2026-10-17：技术澄清 4 项（决策 #7~#10）：兴趣区域 V1 不做 / 快照 schema 入 shared / 武器进度 localStorage 默认开启 / M2 上调 3 周。
