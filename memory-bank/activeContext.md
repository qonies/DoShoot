# 活动上下文（Active Context）

## 当前焦点
**v0.4.0 首页精简与帮助菜单已落地（2026-10-30）**：大厅仅昵称+两个入口按钮（新建游戏→等待房间调参；加入游戏→房间号弹窗）；快速加入 UI 移除、断线重连改「回到上一局」条件按钮；操作提示移入 Esc 设置面板帮助区块 + 新增「返回首页」按钮——**浏览器手测（新建/加入弹窗/Esc 帮助与返回首页/重连按钮）与局域网多设备实测仍待验收**。

## 最近变更（2026-10-30 · 首页精简与帮助菜单，v0.4.0）
- **大厅精简**：`index.html` 删除 `#mode/#map/#difficulty/#killTarget/#timeLimit/#roomCode/#quickJoin`；「新建游戏」→ `createRoom({version,nickname,progress})` 参数全缺省（服务端默认 DEFAULT_MAP/normal/30杀/5min/BOT_COUNT_DEFAULT），房主在等待界面调参（FR-L8 成为参数唯一配置入口）
- **加入房间弹窗 `#joinDialog`**（嵌在 #lobby 内复用 .panel 视觉，z-index 2）：`#joinCode` 输入 + `#joinError` 内联错误（本地 `join.codeInvalid` / 服务端 `net.roomNotFound`，不再走屏幕中央 #netmsg 避免压住弹窗）；Enter 提交、Esc/遮罩取消、打开自动聚焦
- **断线重连改造（FR-N5）**：原「30s 内点快速加入回对局」路径随快速加入移除而消失 → 新增大厅条件按钮 `#rejoinBtn`（`lobby.rejoin`）：仅对局中断线 `offerRejoin()`（`RECONNECT_GRACE` 30s 定时 `clearRejoin()`）；等待房断线/主动离开立即 `clearRejoin()`（服务端等待态无宽限，不给虚假入口）；`net.disconnected` 文案更新
- **main.ts 结构**：`startGame(kind: 'create'|'join'|'rejoin', roomCode?)` 收敛三分支；新增模块级 `activeNet: Net | null`（onRejected/onDisconnected/onConnectError/waitroom onLeave/WebGL 失败均置空，`===` 判等防旧 net 误清新 net）；`leaveMatchToLobby()` 统一「主动离开」（inGame=false → stopGameLoop → sendLeave/close → clearRejoin → backToLobby），结算面板 `onLeave` 与设置面板 `#setHome` 共用
- **操作提示迁移（v0.3.9 重叠修复）**：HUD 删除 `#hint` 元素与 3 处 CSS 规则；设置面板新增 `.helpBlock`（`#helpHint`，`hint`/`hint.pad`/`hint.touch` 按设备与触屏模式），`hintElRef` 模块级指向 `#helpHint`（refreshLangUi/recreateTouchControls 刷新）；**顺带把 pad HUD 避让选择器 `body.pad` 收紧为 `body.touch.pad`**（桌面端血条回左下角，不再命中底部中央避让）
- **设置面板**：底部按钮改 `#setHome`（返回首页，次要样式）+ `#setClose` 并排
- **i18n 106→108 键**：+`join.confirm/join.cancel/join.codeInvalid/lobby.rejoin/set.controls/set.home`，−`quickJoin/mode/modeTdm/modeHardpoint`；`net.disconnected` 文案改指「回到上一局」
- **边界**：服务端与协议零改动（JoinMsg 规则字段保留、服务端快速加入能力保留供 smoke:net）；版本号四处同步 0.3.9→**0.4.0**
- 验证：typecheck / unit 145 / check:i18n（108 键）/ smoke:net ALL PASS / smoke:server / build（gzip 155.90KB）全过；**手测待做**（新建→等待房调参开局、弹窗错号/正确号、Esc 帮助提示+返回首页、断线 30s 内重连按钮、触屏设置按钮可达性）
- ⚠️ 已知既有问题（未修）：结算面板（z-index 15）打开时 Esc 设置面板（z-index 14）被压在其下；服务端 join 的 rejoinId 失败会静默回落快速加入建房（客户端 30s 定时隐藏按钮使该窗口极小）

## 最近变更（2026-10-29 · 头顶血条，v0.3.9）
- **实现**：`game/entities.ts`——新增 `HealthBar`（底板 1.1×0.16 深色 + 填充板 1.02×0.10，`PlaneGeometry.translate` 左端锚定 → `scale.x = hp%`；俯仰角 `HP_BAR_TILT = -atan2(22,12)` 与 GameScene 相机（y=22/z+12）匹配正对视角）；`syncHealthBar()` 宽度/颜色仅在变化时改写（阈值 0.004 / 分段 >55 绿 0x4caf50、26~55 橙 0xffb74d、≤25 红 0xe57373）
- **悬浮高度 1.8**（反馈调整：1.45 会视觉压到角色）——明显高于身体顶部 ~1.32 不遮挡玩家；也高于墙高 1.6 → 掩体后血板浮现在墙顶上方（顶视角惯例，墙后不再遮挡血板）
- **倒计时移位（反馈调整）**：`#matchTimer` 顶部中央 → **右上角**（原与击杀数 topbar/头顶血板重叠）；`#killfeed` 移至其下方（top 42px）；触屏端倒计时左移避让右上角设置按钮（`right: 64px + safe-area`）、击杀流 `top: 58px + safe-area`
- **数据源**：本地玩家 = `LocalPlayer.hp`（快照和解写入，`sync()` 每帧刷新位置+血条）；远端/Bot = `RemoteEntity.hp`（`applySnapshot` ~28Hz 刷新，`render()` 插值位置随动）；死亡隐藏（`alive && hp>0`）；`RemoteEntity.dispose` 深度释放血板（`disposeHealthBar`）；对局结束时 `GameScene.dispose` 全场景兜底释放
- **边界**：服务端与协议零改动（血量已在 EntitySnapshot）；本地满血也显示（不做满血隐藏）；`scale.x` 钳 0.0001 防零缩放退化矩阵
- 验证：typecheck / unit 145 / check:i18n（106 键）/ smoke:net ALL PASS / build（gzip 155.76KB）全过；**视觉效果待浏览器实测**

## 最近变更（2026-10-29 · FR-U6 双操作模式，v0.3.8）
- **pad 模式（默认）**：新 `game/touchpad.ts`（`PadControls`）——左下 D-pad 四向键（`Map<pointerId, dir>` 多点触控，相邻两键同按=斜向，滑出键位不换向）+ 点击/按住屏幕瞄准射击（轻点 1 发 / 按住连发 / 拖动微调；瞄准点 = 点击位置 sticky）+ 换弹/切枪/设置按钮（无开火键）；D-pad 区域空隙点击不误射（`closest('button, #dpad, …')`）
- **stick 模式（可选）**：`game/touch.ts` 类更名 `StickControls` 并实现统一契约 `TouchController`（`consume()/getAim(): TouchAim(dir|client|none)/destroy()`）；`createTouchButton` 按钮构建双模式共用
- **模式切换**：`settings.touchMode: 'pad'|'stick'`（默认 pad，localStorage 持久化）；设置面板新增下拉（`#setTouchMode`，仅触屏显示）；`main.ts recreateTouchControls()` 局内热切换（销毁重建控制器，`body.pad` 驱动 HUD 避让布局）；hint 文案按模式选择（`hint.pad`/`hint.touch`）
- **iOS 手势加固（修「双指误缩放」，两模式共用）**：新 `game/gestures.ts` `installGestureGuards()`——window 层双指及以上 touchstart/touchmove 非被动拦截 + gesturestart/change/end 全拦；CSS 对局中（`body.in-game`）`#game` 加 `touch-action:none`（**不加 body/html**，防祖先链交集禁用面板滚动）；`user-scalable=no` 在 iOS 10+ 被忽略是根因
- **main.ts 接线**：`activeTouch` 模块级控制器引用；frame 内 `getAim()` 三分支（client→NDC→screenToGround / dir→自身+方向×8 / none→保持上一帧）；准星统一 `worldToScreen(aim)`；aim 初始为自身上方 8 单位
- **HUD 避让（pad）**：血条移底部中央、换弹/切枪右缘竖排、D-pad 左下安全区适配 + 小屏缩小（CSS 追加段）
- **i18n**：+8 键（`set.touchMode`/`touch.modePad`/`touch.modeStick`/`hint.pad`/`touch.up|down|left|right`），98→106 键
- **测试**：unit 132→**145**（`dpadVector` 四向/斜向 1/√2/对向抵消/零输入、`clientToNdc` 中心/四角/零尺寸）；服务端与协议零改动（pad 输入经既有 InputMsg 管线）
- 验证：typecheck / unit 145 / check:i18n（106 键）/ smoke:net ALL PASS / build（gzip 155.37KB）全过；**待 iOS Safari 真机实测**（双指不缩放、D-pad 手感、点击射击方向与按住连发、模式热切换、面板滚动不受手势加固影响）
- ⚠️ 教训：PowerShell 5.1 `Set-Content` 默认 ANSI 编码会把 UTF-8 中文写坏（root package.json description 曾乱码，已用 `[IO.File]::WriteAllText + UTF8Encoding(false)` 修复）——后续脚本写含中文文件必须显式 UTF-8

## 最近变更（2026-10-29 · 体检修复批次 3，v0.3.7）
- **P1 冒烟假失败修复**：`smoke:net` 彩蛋断言此前用 `waitForAlive`（每轮「先活后死」检查先于谓词），测试角色被 Bot 击杀时把「已授予但恰好死亡」误判为失败（实测 3 跑 1 败）→ 改用新增的不感知死亡 `waitFor`（彩蛋跨重生保留，死亡不影响断言）
- **P1 触屏小屏适配（FR-U6 验收前必修）**：`#settings/#settlement .panel` 纳入小屏媒体查询（≤640px 宽或 ≤620px 高：`width:min(420px,100vw-20px)` + `max-height:calc(100dvh-20px)` + `overflow-y:auto`，面板自身允许滚动）——此前 iPhone 横屏下面板溢出、`#setClose`/结算按钮可能被裁出屏幕；设置面板新增**遮罩点击关闭**（触屏始终可用的关闭路径）；面板打开期间经 `body.ui-open`（main.ts `syncTouchUiVisibility`，随 toggleSettingsPanel/setClose/遮罩/onMatchEnd/onRematch/onLeave/backToLobby 同步）隐藏 `#touchControls`（其 z-index 8 在 #hud 5 之外，否则压在面板上并吞角落点击）
- **P2 服务端**：① `RoomManager.newCode()` 兜底由「5 位序号」改为**确定性 4 位扫描**并接入 `ROOM_CODE_LENGTH`（原兜底号会被 `normalizeRoomCode` 拒绝=无法加入）；② `Room.requestRush` 增加 `state==='running'` 守卫（原等待房间可提前激活彩蛋 → 开局自带无限弹药，NFR-5）；③ join 处理顺序调整：**显式 `roomCode` 优先于 `rejoinId`**（主动输入房间号不再被 30s 残留凭据拉回上一局）
- **P3 客户端**：① rush 放弃防闪烁改「服务端确认窗口」——`switchAckPending/switchAckAt`（上报后 1s 内旧快照 rush=true 不回授，确认/死亡/复活/matchReset 即解除），替代原先仅 ~33ms 的 `pendingSwitch` 门控（消除重复横幅/音效闪烁）；② `onWelcome` 进局前先 `stopGameLoop?.()`（重复 welcome 不再泄漏双 rAF/Input/TouchControls/Scene）；③ 右摇杆旋钮视觉钳制到基座半径（与左摇杆同规则）；④ `isTouchDevice()` 收紧：`ontouchstart` 回退分支需 `maxTouchPoints>0` 且**非** `hover:hover + pointer:fine`（触屏笔记本不再误显示虚拟按钮）；⑤ `#roomCode` maxlength 4→7（允许 `48-21` 等可规范化输入）；⑥ HUD 计分板帧判读改 `hud.scoreboardVisible` getter（去每帧 querySelector）
- **测试体系重构**：`RoomManager` + `sanitizeRule/sanitizeSettings` 从 `index.ts` 抽出至 **`apps/server/src/rooms.ts`**，`index.ts` 与 `scripts/net-smoke.ts` **同源复用**——冒烟不再用「同语义最小子集」复制路由，选房/房间号/容量/白名单校验的漂移从此可被检出（smoke 的 roomFor/hostedRooms/createWaitingRoom 已删除，改用真实 pick/findByCode/createRoom/findRejoinable/destroyAll）
- 新增单测 2 项（130→**132**）：等待态彩蛋口令被拒 / 开局后可授予；验证：typecheck / unit 132 / check:i18n（98 键）/ **smoke:net×3 ALL PASS（真实 RoomManager）** / smoke:server / build（gzip 154.07KB）全过

## 最近变更（2026-10-29 · FR-U6 触屏操作，v0.3.6）
- **控制方案**：浮动双虚拟摇杆——左半屏触点即移动摇杆圆心（等效 WASD 归一化向量），右半屏拖动 = 瞄准（方向松手保持，等效鼠标）；动作按钮：开火（大圆，按住连发 + 按下沿）/ 换弹 / 切枪（循环 nextWeaponId）/ 设置（等效 Esc，触屏用户原本无法打开仅 Esc 的设置面板）；按钮/摇杆适配刘海安全区 `env(safe-area-inset-*)`
- **新模块**：`game/touchmath.ts`（纯函数 `stickVector`：钳制/归一化/死区 14px/平滑起步 + `isTouchDevice()`：`(pointer: coarse)` 判定——iPadOS 桌面模式 UA 伪装成 macOS 仍可识别；零依赖可单测）+ `game/touch.ts`（TouchControls：window 级 PointerEvent 采集仅 `pointerType==='touch'`、浮动摇杆可视化、按钮 pointerdown/up + stopPropagation 防误触摇杆、面板打开期间经 `Input.isGameInputBlocked()` 屏蔽（该方法由 private 改 public）、destroy 成对移除随对局销毁）
- **main.ts 集成**：TOUCH 常量模块级判定；`runGameLoop` 内触屏创建/销毁；每帧合并 `touch.consume()` → cmd（摇杆覆盖 move、按钮补 firing/firePressed/reload/switchNext）；瞄准分支：触屏 = `world.local + aimDir × 8` 世界单位（跳过 screenToGround），准星改经 `gameScene.worldToScreen(aim)` 投影定位（桌面仍跟随鼠标）；提示文案 `hint.touch`；Esc 开关抽为 `toggleSettingsPanel()` 与触屏设置按钮共用
- **viewport/手势/CSS**：meta `user-scalable=no + viewport-fit=cover` + apple-mobile-web-app 系列；`#hud { touch-action: none }`（大厅/面板保持可滚动）、`gesturestart` preventDefault（iOS 捏合）、`overscroll-behavior: none`、`#game { height: 100dvh }`（@supports 回落 100vh）；`body.touch` 类 + 小屏媒体查询（≤640px 宽或 ≤620px 高：大厅/等待面板限宽限高可滚动、小地图 100px、隐藏 FPS/键位提示、触屏提示置顶）
- **测试**：`unit` 122→**130 项**（stickVector 8 项：满程/斜向钳制/半程平滑/死区/零半径安全/方向约定）；服务端与协议**零改动**（触屏指令经既有 InputMsg 管线）
- **已知限制（FR-U6 明示）**：冲锋枪彩蛋口令（键盘 4 位数字）无触屏入口；HUD 密度按 iPhone 横屏/iPad 优化，手机竖屏可用未深度布局
- 验证：`unit` 130 全过 / `typecheck` 全过 / `check:i18n` OK（98 键）/ `smoke:net` ALL PASS / `smoke:server` 通过 / `build` 成功（gzip 153.9KB，59 modules）；**待 iOS Safari 真机实测**（双摇杆手感、瞄准持续、安全区、Safari 地址栏收展、音频首交互解锁）

## 最近变更（2026-10-29 · FR-L8 等待房间与房间号，v0.3.5）
- **玩法**：大厅「开始游戏」改为「**新建游戏**」（createRoom）→ 服务端建房 `state='waiting'` + 随机 4 位数字房间号（RoomManager `newCode()`，1000~9999 撞号重试）→ 等待界面（`#waitroom`，新 `waitroom.ts`）：大字房间号（局域网 http 非安全上下文无 clipboard API，仅展示可选中）、玩家列表（房主徽章 + 你标记）、人数 n/10；**房主可调参数**：地图/Bot 难度/击杀目标/时限/Bot 数量（`BOT_COUNT_OPTIONS=[0,3,5]`），非房主下拉禁用只读；大厅新增「房间号输入 + 加入房间」（回车可触发）。房主「开始游戏」（startMatch）→ 服务端转 running、按 botCount 补 Bot、**向房内每 socket 重发 `welcome(room.state='running')`** → 客户端 onWelcome 复用全部既有进局链路（零新进局代码）
- **shared**：新 `roomCode.ts`（`ROOM_CODE_LENGTH=4` + `normalizeRoomCode` 前后端同源校验）；`PROTOCOL_VERSION` 2→**3**（升版原因：房间生命周期语义变更，旧客户端会卡在无快照的房间，v3 让其收到明确版本不一致提示）；协议新增 C2S `CreateRoomMsg`/`RoomSettingsMsg`（updateRoom）/`startMatch`（无载荷）+ S2C `roomUpdate`（`RoomInfoMsg`：code/hostId/state/mapId/difficulty/killTarget/timeLimitSec/botCount/capacity/players）+ `JoinMsg.roomCode?`/`botCount?` + `WelcomeMsg.room?` + `JoinRejectReason+'noRoom'`；constants 新增 `BOT_COUNT_OPTIONS`/`BOT_COUNT_DEFAULT`
- **服务端**：`Room` 新增 `code/hostId/state`、可变 `map`（getter mapId）与 `difficulty/killTarget/timeLimitSec/botCount`；`roomInfo()/broadcastRoomInfo()/updateSettings()/start()`；**waiting 态不步进不广播**（runFrame 早退，同空房省 CPU）、`enqueueInput` 丢弃、断线即移除（模拟时钟冻结使 30s 宽限失效）、`adjustBots` waiting 恒 0 / running 按 `min(botCount, 余量)`；换地图时全员按新图 `pickSpawnFarthest` 重置出生点并清位置历史（防延迟补偿按旧图坐标回溯）；房主离开/断线 `removePlayer` 移交下一位真人；`rematch` 加 `state==='running'` 守卫。`RoomManager` 新增 `newCode()/findByCode()/createRoom()`，`pick()` 建房 autoStart=true（快速加入保持秒进对局）；`index.ts` 新增 `createRoom/updateRoom/startMatch` 路由（白名单 `sanitizeSettings`，非房主/非等待态静默忽略，NFR-5）
- **客户端**：新 `waitroom.ts`（WaitRoom 类：show/update/refresh/hide/dispose，事件成对绑定防叠加，下拉与大厅同源常量数据驱动）；`main.ts` `startGame(kind: 'quick'|'map'|'code')` 三入口 + `onWelcome` 按 `welcome.room.state` 分流（waiting→enterWaitRoom / running→进局）+ `onRoomUpdate` 同步 + `onRejected 'noRoom'`；等待态断线提示 `wait.disconnected`；`backToLobby` 统一 `exitWaitRoom()`；`net.ts` 新增 `createRoom/updateRoom/startMatch/onRoomUpdate`
- **i18n**：新增 15 键（`createRoom/joinRoom/roomCode/botCount/bots.0|3|5/wait.title|code|share|players|host|you|start|leave|readonly|disconnected/net.roomNotFound`，76→93 键）；`#start` 文案键 `start`→`createRoom`
- **测试**：`unit` 98→**122 项**（normalizeRoomCode 6 + 等待房间状态机 16：waiting 冻结/房主权限/白名单过滤/换图重置出生点/开局补 Bot/房主移交）；`smoke:net` 新增 5 步（8 等待房无快照无 Bot / 9 房间号加入 / 10 非房主调参被拒+房主改图广播 / 11 开局重发 welcome+快照恢复 / 12 非法房间号 noRoom）
- **注意**：既有 Room 单测/冒烟建房全部需传 `autoStart=true`（第 9 参），否则房间停在 waiting 态不步进（本次已同步修正 unit-check/net-smoke/load-test 走 join 自动开局不受影响）
- 验证：`unit` 122 全过 / `typecheck` 全过 / `check:i18n` OK（93 键）/ `smoke:net` ALL PASS（含新 5 步）/ `smoke:server` 通过（protocol v3）/ `build` 成功（gzip 152.1KB）/ `loadtest`（10 客户端×10s）PASS（快照 28.6/s，0 断线）

## 最近变更（2026-10-24 · v0.3.4 体检修复批次 2）
- **P1 滚轮切枪从不同步服务端（已修复）**：`world.ts` 的 buildInput 只上报数字键的 switchTo，滚轮仅本地 `inv.cycle` → ~250ms 后被权威 weaponId 和解「切回」（rush 模式还会出现授予/撤销闪烁）。shared 新增 `nextWeaponId(current, delta)`（`WeaponInventory.cycle` 同源复用），`handleSwitchAndReload` 把滚轮/数字键统一折算为 `pendingSwitch` 持有至下次 buildInput 上报（顺带修复帧率高于上行 30Hz 时切枪指令丢失）；`syncRush` 在 pendingSwitch 非空时不回授 rush
- **P1 加入「已结束 / 复用空房」卡死（已修复）**：`addPlayer` 原本不重置 matchOver/matchStart，而 `pick` 会复用空房（回收等待期 ≤60s）或未满的已结束房间 → 新玩家无法开火、无倒计时、收不到 matchEnd 且无任何出口（只能刷新）。`Room.resetMatch()`（空房复用时调用）+ `endMatch` 缓存 `lastMatchEnd` + `WelcomeMsg.matchEnd?`（可选增量字段，v2 兼容）→ 中途加入已结束房间的玩家弹出结算面板可再来一局；客户端 `NetWorld.adoptMatchEnd` 承接
- **P1 主动「返回大厅」30s 内再进房回到原对局（已修复）**：新增 C2S `leave`（无载荷），服务端立即 `removePlayer`（不走 FR-N5 宽限）；`main.ts onLeave` 发 leave + 清 sessionStorage `DoShoot.playerId`——语义定为「意外断线才宽限重连，主动离开即彻底退出」
- **P1 rematch 复活断线者为永久幽灵（已修复）**：`rematch()` 移除 `f.disconnectAt = null`——宽限中玩家保持断线（可被清扫/可 rejoin），K/D 照常清零，重连即以 0 杀随新局重生
- **P2/P3**：`RoomManager.pick` 移除「任意非满房」回退（快速加入不混规则，对齐 FR-L7）；`input.ts` 设置/结算面板打开期间屏蔽键盘（keyup 放行清键）；设置面板监听器提升到 main.ts 模块级一次性绑定（`activeScene` 引用当前场景，修复重复进局叠加监听器 + 旧 scene 闭包泄漏）；onWelcome 校验 `welcome.version`（FR-N7 防御）；`runFrame` 空房（fighters 为空）跳过步进与广播；GameScene 构造 try/catch → `net.webglFailed`（i18n 新增 1 键，76 键）；删除死代码 Room.createdAt / LocalPlayer.weaponId / entities 的 INTERP_DELAY 重复导出；`isDisconnected` 改显式判空
- **协议**：仍 v2；增量 `WelcomeMsg.matchEnd?` + C2S `leave`（均向后兼容）
- **测试**：`unit` 86→98 项（+`nextWeaponId` 5 项 + Room 状态机 9 项：空房复用重置 / 已结束房间补发结算 / rematch 不复活断线者，1s 时限房间实时推进）；`smoke:net` 新增 7b 步（leave 立即停快照 + 旧 rejoinId 进房为新实体）
- 验证：`unit` 98 全过 / `typecheck` 全过 / `check:i18n` OK（76 键）/ `smoke:net` ALL PASS / `build` 成功（gzip 150.3KB）

## 最近变更（2026-10-23 · FR-L7 对局生命周期选择）
- **玩法**：大厅新增「击杀目标」（30/50/100 杀）+「对局时限」（5/8/10 分钟）两个下拉框（`#killTarget`/`#timeLimit`），先到即结束（FR-M1 语义不变），默认 30 杀 / 5 分钟 = 原行为
- **shared**：`KILL_TARGET_OPTIONS`/`TIME_LIMIT_OPTIONS` 白名单常量；`JoinMsg` 增量可选字段 `killTarget?`/`timeLimitSec?`；`matchEnd` 事件携带 `killTarget?`
- **服务端**：`index.ts sanitizeRule` 白名单校验（非法回退默认 30/300）；`Room` 构造器新增 `killTarget`/`timeLimitSec` 参数，结束判定/快照倒计时/事件全部消费实例值；`RoomManager.pick` 按「地图 + 规则」选房（快速加入优先同规则房间，不混房）
- **客户端**：`hud.showSettlement` 新增 killTarget 参数，`settle.reachTarget` 文案参数化「{name} 达到 {n} 杀！」；i18n 新增 8 键（67→75）
- **测试**：`smoke:net` 新增步骤 7（自定义规则 50 杀/600s 独立建房，断言 matchTimeLeft≈600s，与默认 300s 房间不混房）
- 验证：`unit` 86 全过 / `typecheck` 全过 / `check:i18n` OK（75 键）/ `smoke:net` ALL PASS / `build` 成功（gzip 150KB）

## 最近变更（2026-10-23 · FR-E1 冲锋枪彩蛋模式）
- **玩法**：对局中依次输入 4 位口令 **`7890`** + Enter → 切换「狂暴冲锋枪」（1200rpm / 满伤 40·最大射程 60 / 无限弹药不消耗不换弹）；当局跨重生保留，**回合结束（matchEnd）自动撤销，不带到下一局**；断线重连回原状态保留
- **口令选型**：`CHEAT_RUSH_CODE = '7890'`（shared constants）——刻意不含 1~6，输入过程不误触切枪热键；改口令只动这一处
- **shared**：`WeaponId` 增加 `'rush'`（不入 `WEAPON_ORDER`，切枪白名单运行时拒绝）+ `WEAPONS.rush` 数值 + `WEAPON_TIERS.rush` 占位（tierForKills 恒 0）；`WeaponInventory` 新增 `rushActive` 标志 + `grantRush/revokeRush`（canFire 跳过弹药校验 / consumeAmmo no-op / startReload 禁用 / resetAll 跨重生保留 rush）；协议增量：`EntitySnapshot.rush?` 可选字段 + C2S `RushModeMsg`（v2 前后端互相兼容）
- **服务端**：`room.ts requestRush(id, code)` 口令验证（matchOver 拒绝）→ `inv.grantRush`；快照带 `rush`；`endMatch` 全员 `revokeRush`；`registerKill` 跳过 'rush'（不计解锁进度）；`index.ts` 新增 `rush` 消息路由
- **客户端**：`input.ts` 数字口令缓冲（Digit/Numpad 均可，3s 超时/Enter/失焦清空，命中口令置 `cheatRush` 边沿）→ `main.ts` `net.sendRush`；`world.ts` 快照 rush 字段权威同步（`syncRush`，激活回调 `onRushActivated` → 全屏横幅 + unlock 音效）；HUD 弹药位 rush 时显示 ∞（`hud.setWeapon` 参数放宽为 number|string）；i18n 新增 `weapon.rush` / `rush.on`（67 键）
- **测试**：`unit` 64→86 项（新增库存彩蛋模式 22 断言：授予/无限弹药/白名单/跨重生保留/撤销/切枪放弃）；`smoke:net` 新增 4c 步（错误口令无效 → 正确口令授予 → 持续开火 2s 弹药恒满）
- **边界行为**：彩蛋模式中手动切枪 = 主动放弃（`switchTo` 复位 rushActive，可重新输口令激活），避免无限弹药泄漏到切过去的常规武器
- 验证：`unit` 81 全过 / `typecheck` 全过 / `check:i18n` OK（67 键）/ `smoke:net` ALL PASS / `build` 成功（gzip 149.7KB）

## 最近变更（2026-10-21 · 体检修复落地）
- **P1 渲染**：`scene.ts` 移除 `renderer.forceContextLoss()`——同 canvas 重建 renderer 时 getContext 返回已丢失上下文（无 restoreContext 不恢复），二次进局有黑屏风险；`dispose()` 已足够释放资源
- **P1 i18n**：昵称校验键统一为 `lobby.nameInvalid`（zh/en 同步）；`scripts/i18n-check.ts` 增加 `showNetMsg('…')` 包装函数键扫描（修复缺键漏检，该键此前实际显示原始 key）
- **P1 输入**：`input.ts` mousedown/wheel 判 `e.target` 是否在 `#settings/#settlement` 内——设置/结算面板上点击与滚动不再误触开火/切枪
- **P1 延迟补偿**：`room.ts` `respawn(f, now)` 清空并重写 `hist`（修复复活后最长 ~400ms 按「死亡前旧坐标」回溯命中的幽灵命中盒）
- **P1 HUD**：`world.ts` 死亡分支补 `local.hp = e.hp`（血条按权威值清零）
- **P2 服务端**（`room.ts`/`index.ts`）：输入超时 250ms 清空最后意图（`SimFighter.lastInputAt`，防停发输入持续移动/开火，NFR-5）；空房 `adjustBots` 清零 Bot（省 CPU）；`applyProgress` 单类击杀钳制 ≤999（防伪造满级）；静态托管 DIST_DIR 严格前缀校验（含 `path.sep`）；`full` 拒绝分支保留并注明契约
- **P2 客户端**：`world.applySnapshot` 丢弃版本不匹配快照（FR-N7）；`backToLobby` 复位 scoreboard/settlement/respawn/unlockBanner 残留；`onLeave` 先落 `inGame=false` + `stopGameLoop` 再关连接（主动离开不再误报「连接已断开」）；`localStorage` 昵称写入加 try/catch；对局中切语言同步刷新 `#hint` 与大厅语言按钮（`refreshLangUi`）
- **P3**：`style.css` 合并重复的 `#hud`/`#fps` 定义（保留 inset:0 版本并补 line-height/text-shadow）；`net.ts` 删除从未使用的 `onSnapshot` 回调；`net-smoke.ts` 去掉恒真三元
- **FR-L3 补齐**：地图下拉新增「随机」项（`map.random` 中英文案；随机 = mapId 缺省，服务端任意分配）
- **新增单测**：`scripts/unit-check.ts`（零依赖，`corepack pnpm unit`，根脚本 `unit`）——64 项断言覆盖 rayVsAABB/raycastWalls/resolveCircleWalls/damageAtRange/WeaponInventory/tierForKills/resolveShot/pickSpawnFarthest
- **文档对齐**：requirements 头部补 2026-10-21 修订说明 + FR-U3/FR-S1/FR-C4 标注实现现状；techContext 修正 websocket-only 表述；systemPatterns 快照频率改 20~30Hz
- 验证：`unit` 64 项全过 / `typecheck` 全过 / `check:i18n` OK（65 键、42 静态引用）/ `smoke:net` ×2 ALL PASS / `smoke:server` 通过；**待浏览器实测**：进局→返回大厅→再进局渲染、面板点击不开枪、对局中切语言

## 最近变更（2026-10-18 · 开源化收尾）
- **MIT 协议落地**：根 `LICENSE`（Copyright (c) 2026 qonies）+ 根 package.json `license: MIT`（子包 private 无需）+ README 新增「开源协议」章节与 License 徽章
- **README 开源化完善**：头部扩充一句话简介 + 特性亮点 7 条（多人同步/武器解锁/Bot/双地图/i18n/局域网联机）+ 末尾新增「技术栈」表格
- **GitHub 简介**：`gh repo edit` 设置 description（含技术要点）+ 7 个 topics（game/multiplayer/threejs/socketio/typescript/websocket/shooter），已验证生效
- 提交：`269c9d9 docs: 添加 MIT 开源协议…` 已推送 origin/main

## 最近变更（2026-10-18 · M4 打磨完善）
- **FR-N4 延迟补偿回溯（M4 旗舰项）**：`room.ts` SimFighter 新增 `hist`（每 tick 位置记录，容量 ≈LAG_COMP_HISTORY=1s）与 `pingMs`（输入消费时钳制更新 ≤500）；`processFire` 命中判定按「插值延迟 100ms + 半程 RTT」回溯（上限 LAG_COMP_MAX_REWIND=400ms；Bot 索敌用现位置故回溯为 0），hit 事件坐标 = 回溯位置（与射击者所见一致）；`net.ts` 建连后 ping/pong 每 2s 测 RTT（EWMA 0.7/0.3 平滑）随输入上报；协议仅增量可选字段（`InputMsg.pingMs` + PingMsg/PongMsg），PROTOCOL_VERSION 保持 2，新旧前后端互相兼容
- **FR-U2 小地图**：新增 `game/minimap.ts`（150×150 canvas，墙体预渲染底图每局一张，每帧只画自己三角朝向；世界观 y 向下与 canvas 一致）；`index.html` #minimap + style.css；不显示敌人（同类产品惯例）
- **FR-L5 设置界面**：新增 `settings.ts`（音量/BGM/画质/语言，localStorage `DoShoot.settings`）+ Esc 开关面板（#settings，pointer-events 局部恢复交互）；画质三档 `scene.setQuality`（高=原生 DPR≤2+阴影 / 中=DPR1+阴影 / 低=DPR1 无阴影，切换时材质 needsUpdate 重编译）；鼠标灵敏度项因 V1 绝对指针瞄准不适用（需求 v0.3.1 说明）；backToLobby 时关面板防残留
- **FR-S2/S3 音频增强**：`audio.ts` `shoot` 增加方位声像 pan（StereoPanner，不支持时静默降级；`world.ts` 按 (sx-lx)/dist 计算，正交俯视相机下屏幕右≈世界 +x）；新增合成 BGM（A 小调 pad 4 音轻微失谐 + 低通 0.05Hz 慢扫，独立 bgmGain 通道，ensure() 首次交互启动，音量 0..1×0.25 刻度）
- **内部压测（NFR-3）**：新增 `scripts/load-test.ts`（子进程起真实服务端 [node+tsx 直接跑绕过 pnpm 生命周期，不触发 smoke 自检] + N 模拟客户端 30Hz 随机输入/20% 开火，统计进房/快照率/带宽/断线，win32 用 taskkill /T /F 收尾）；实测 **PASS**——50/50 进房、快照 avg/min 均 26.8/s、单快照 ~2.2KB、单客户端下行 ~59KB/s（全服 ~2.9MB/s）、0 意外断线；决策 #8 据此维持 JSON 编码
- **i18n 校对（NFR-9）**：新增 `scripts/i18n-check.ts`（zh/en 键集一致 + 代码 t()/data-i18n 静态引用覆盖 + weapon.*/map.* 动态键核对）；根脚本 `check:i18n`，实测 OK（64 键一致 / 37 静态引用全覆盖）
- **部署文档**：README 局域网部署详细步骤（build/启动、ipconfig、netsh 防火墙放行 3000、多设备加入、排错）+ 质量检查命令（typecheck/check:i18n/loadtest）
- **平衡性**：数值未盲调（无实测数据），待局域网开黑反馈后调参——需求 v0.3.1 已注明
- 验证：typecheck 全过 / build 成功（gzip 148.9KB）/ smoke:server 通过 / smoke:net 连续 2 轮 ALL PASS / check:i18n OK / loadtest PASS（50 客户端 × 30s）

## 最近变更（2026-10-18 · 体检问题修复）
- **P1 M3 全部工作补提交**：此前 23 个修改文件 + `audio.ts`（整个 M3）全部未提交、HEAD 停在 v0.2.5——先原样提交为 `feat(M3)`（d33c016），再在其上落修复 commit
- **P2 客户端断线死路（已修复）**：`main.ts` onDisconnected 的 inGame 分支原只停循环 + 关 socket + 提示，不回大厅也无重连路径 → 卡死在冻结画面（rejoinId 只能靠手动刷新触发）。补 `backToLobby()`：回大厅后 30s 宽限内点「开始游戏」即凭 rejoinId 回原对局；`net.disconnected` 中英文案补充重连提示
- **P2 冒烟 waitForAlive 重试盲区（已修复，实测复现）**：fire/reload 重试的「等待复活」复用带死亡检测的 `waitForAlive`，但起始即死亡（等 2.5s 重生）时首轮 `died()` 即真 → 返回 'dead' → break 直接判负——即「断言期间被击杀一次必失败」。改为「先活后死」才中断（wasAlive 标记）；修复前实测失败一次，修复后连续 3 轮 ALL PASS
- **P2 FR-N4 延迟补偿文档/实现不一致（已修复）**：requirements FR-N4 与 §7.3 原描述「服务端保存 ~1s 实体历史回溯判定」，代码无任何 history/rewind 实现（命中按当前位置）——三处改为明确「后置 M4，尚未实现」（决策 #10），v0.3.0 头部简化项同步补充
- **P3 地图下拉 i18n 切换不刷新（已修复）**：`main.ts` 动态填充的地图 `<option>` 只写 textContent 无 `data-i18n`，切语言后 applyDom 不覆盖 → 补 `opt.dataset.i18n = m.nameKey`（FR-L6/NFR-9）
- **P4 空房回收语义对齐 FR-N6（已修复）**：`sweep()` 原用 `now - createdAt > 60s`（创建 60s 后一旦空即回收），改为 Room 新增 `emptySince`（addPlayer 清空 / removePlayer 且 playerCount=0 时置位），以「变空时刻」起算
- **P4 收尾**：子包版本号 0.2.5 → 0.3.0（对齐根 package.json 与 requirements v0.3.0）；README 补 smoke:server / smoke:net 命令；删除遗留 `sv_out.log`
- 验证：typecheck 全过 / build 成功（gzip 147.27KB）/ smoke:server 通过（protocol v2 + dist served）/ smoke:net 连续 3 轮 ALL PASS

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

## 下一步
1. 局域网多设备实测验收（M4 + v0.3.4/v0.3.5/v0.3.6 验收项）：60 FPS、双机开黑体验、平衡性反馈与数值调参；专项回归：**iOS Safari 真机触屏全流程（大厅→建房/房间号加入→等待房→对局：双摇杆移动瞄准、按钮开火换弹切枪、设置面板、安全区与视口）、桌面端回归（鼠标键盘零影响）、等待房间全流程（新建游戏→房间号加入→房主调参→开局）、房主离开后房主移交、快速加入落入等待房、滚轮切枪（含 rush 模式中放弃）、打完一局后「返回大厅」→ 新开一局、结算弹出期间新玩家加入可见结算面板、设置/结算面板打开期间按键无响应、断线 30s 内重连回原局**
2. 待确认增强（未做）：Bot 切枪与全自动武器开火支持（当前 Bot 恒用手枪；若做需同时改 `bot.ts` 的 `f.input.firing`）
3. V2（TDM/Hardpoint、账号与战绩、反作弊加固、更多地图武器，见需求 §1.2）；rejoinId 冒名接管与玩家间碰撞已记入 V2/决策待定

## 重要决策记录
- 2026-10-17：渲染路线用户拍板选 Three.js（非 Canvas 2D）。
- 2026-10-17：全部开放问题确认完毕——Socket.IO 定稿；局域网内部测试部署；Bot 为正式功能（含房间填充）；美术用几何体+免费素材；每房 10 人；中英双语 i18n。
- 2026-10-17：技术澄清 4 项（决策 #7~#10）：兴趣区域 V1 不做 / 快照 schema 入 shared / 武器进度 localStorage 默认开启 / M2 上调 3 周。
