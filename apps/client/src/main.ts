/** 入口：i18n + 大厅（v0.4.0 精简：昵称 + 新建/加入/重连入口，参数配置全部下移至等待房间 FR-L8）
 *  + 联机对局主循环（连接 → 进房 → 预测/插值渲染；权威在服务端 room.ts） */

import './style.css';
import * as THREE from 'three';
import {
  CHEAT_RUSH_CODE,
  DEFAULT_MAP,
  PROTOCOL_VERSION,
  RECONNECT_GRACE,
  getMap,
  nextWeaponId,
  normalizeRoomCode,
  type SnapshotMsg,
  type WelcomeMsg,
  type WeaponId,
} from '@DoShoot/shared';
import { applyDom, getLang, setLang, t, toggleLang } from './i18n';
import { GameScene } from './game/scene';
import { NetWorld } from './game/world';
import { Input } from './game/input';
import { Hud } from './game/hud';
import { Net } from './game/net';
import { sfx } from './game/audio';
import { Minimap } from './game/minimap';
import { WaitRoom } from './waitroom';
import { StickControls, type TouchController } from './game/touch';
import { PadControls } from './game/touchpad';
import { clientToNdc, isTouchDevice } from './game/touchmath';
import { applyAudioSettings, loadSettings, saveSettings, type GameSettings } from './settings';

const NICKNAME_KEY = 'DoShoot.nickname';
const PROGRESS_KEY = 'DoShoot.progress';
const PLAYER_ID_KEY = 'DoShoot.playerId';
/** 上行输入发送频率（FR-N1/N2 配套） */
const INPUT_SEND_RATE = 30;
/** 触屏设备（FR-U6）：粗指针（手机/平板）或存在触摸面；决定摇杆/按钮与提示文案 */
const TOUCH = isTouchDevice();
/** 触屏瞄准距离（世界单位）：stick 模式右摇杆方向 → 玩家前方固定距离的瞄准点 */
const TOUCH_AIM_DIST = 8;
/** 当前触屏控制器（FR-U6 双模式，v0.3.8）：进局创建、模式切换/对局销毁时重建释放 */
let activeTouch: TouchController | null = null;

// ---------- i18n 与大厅 ----------
applyDom();

// 设置（FR-L5，M4）：音量/BGM 即时应用（AudioContext 未建时由 sfx 暂存）；画质需场景，进对局时应用
const settings = loadSettings();
applyAudioSettings(settings);

const langBtn = document.querySelector<HTMLButtonElement>('#langBtn')!;
/** 不走 data-i18n 的动态语言 UI：大厅切换按钮标签 + 设置面板操作提示（v0.4.0 起 #hint 移入 Esc 面板） */
let hintElRef: HTMLElement | null = null;
// 操作提示（v0.4.0）：原 HUD 底部 #hint 与 pad 模式底部中央血条重叠 → 移入设置面板帮助区块；
// 文案随语言与触屏模式刷新（refreshLangUi / recreateTouchControls），初始内容在此处赋值
hintElRef = document.querySelector<HTMLElement>('#helpHint')!;
function refreshLangUi(): void {
  langBtn.textContent = getLang() === 'zh' ? 'EN' : '中文';
  // 触屏端按当前操作模式显示提示（pad=D-pad+点击射击 / stick=双摇杆），桌面端显示键位提示
  if (hintElRef) hintElRef.textContent = TOUCH ? touchHintText() : t('hint');
}

/** 触屏操作提示文案按当前模式选择（FR-U6 双模式） */
function touchHintText(): string {
  return settings.touchMode === 'stick' ? t('hint.touch') : t('hint.pad');
}
refreshLangUi();
langBtn.addEventListener('click', () => {
  toggleLang();
  refreshLangUi();
  activeWaitroom?.refresh(); // 等待界面动态文案（房间号分享语/玩家列表/参数下拉）随语言刷新
});

const nicknameInput = document.querySelector<HTMLInputElement>('#nickname')!;
function randomName(): string {
  return `${t('randomName')}-${Math.floor(1000 + Math.random() * 9000)}`;
}
nicknameInput.value = localStorage.getItem(NICKNAME_KEY) ?? randomName();

// ---------- 加入房间弹窗（v0.4.0）：大厅「加入游戏」→ 输入 4 位房间号加入 ----------
// Enter 提交 / Esc 或遮罩点击取消；本地校验（normalizeRoomCode）与服务端拒绝（noRoom）均内联提示，
// 不再走屏幕中央的 #netmsg（会压在弹窗上方且语义不符）
const joinDialogEl = document.querySelector<HTMLDivElement>('#joinDialog')!;
const joinCodeInput = document.querySelector<HTMLInputElement>('#joinCode')!;
const joinErrorEl = document.querySelector<HTMLDivElement>('#joinError')!;

function openJoinDialog(): void {
  joinCodeInput.value = '';
  joinErrorEl.classList.add('hidden');
  joinDialogEl.classList.remove('hidden');
  joinCodeInput.focus();
}

function closeJoinDialog(): void {
  joinDialogEl.classList.add('hidden');
}

function showJoinError(key: string): void {
  joinErrorEl.textContent = t(key);
  joinErrorEl.classList.remove('hidden');
}

function submitJoinCode(): void {
  const raw = nicknameInput.value.trim();
  const nickname = raw || randomName();
  if (nickname.length < 2 || nickname.length > 16) {
    showJoinError('lobby.nameInvalid');
    return;
  }
  // 房间号加入（FR-L8）：客户端先行规范化校验（服务端再权威校验）
  const code = normalizeRoomCode(joinCodeInput.value);
  if (!code) {
    showJoinError('join.codeInvalid');
    return;
  }
  closeJoinDialog();
  startGame('join', code);
}

// ---------- 断线重连（FR-N5，v0.4.0）：对局中断线 → 30s 宽限内大厅显示「回到上一局」 ----------
// 等待房间断线 / 主动离开无宽限（服务端立即移除实体）→ 立即清除凭据并隐藏按钮，不给虚假重连入口。
// 服务端 join 不带 roomCode 时先走 tryRejoin 分支（apps/server/src/index.ts），超时/已回收则按新进房处理。
const rejoinBtn = document.querySelector<HTMLButtonElement>('#rejoinBtn')!;
let rejoinTimer: ReturnType<typeof setTimeout> | null = null;

/** 仅收起按钮/停表（保留凭据）：进入对局或等待房间后调用（后续断线仍可重连） */
function cancelRejoinUi(): void {
  if (rejoinTimer !== null) {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
  }
  rejoinBtn.classList.add('hidden');
}

/** 彻底清除：收起按钮 + 丢弃重连凭据（主动离开 / 新开局 / 宽限到期） */
function clearRejoin(): void {
  cancelRejoinUi();
  sessionStorage.removeItem(PLAYER_ID_KEY);
}

function offerRejoin(): void {
  if (!sessionStorage.getItem(PLAYER_ID_KEY)) return;
  rejoinBtn.classList.remove('hidden');
  if (rejoinTimer === null) {
    rejoinTimer = setTimeout(clearRejoin, RECONNECT_GRACE * 1000);
  }
}

rejoinBtn.addEventListener('click', () => startGame('rejoin'));

// 加入弹窗交互：Enter 提交、Esc / 遮罩点击关闭（与设置面板遮罩关闭同交互惯例）
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitJoinCode();
});
joinDialogEl.addEventListener('pointerdown', (e) => {
  if (e.target === joinDialogEl) closeJoinDialog();
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || joinDialogEl.classList.contains('hidden')) return;
  closeJoinDialog();
});

// 武器解锁进度（FR-A1：localStorage 本地持久层，跨局保留成长）
function loadProgress(): Partial<Record<WeaponId, number>> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? '{}') as Partial<Record<WeaponId, number>>;
  } catch {
    return {};
  }
}
function saveProgress(p: Partial<Record<WeaponId, number>>): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

const netmsgEl = document.querySelector<HTMLElement>('#netmsg')!;
function showNetMsg(key: string): void {
  netmsgEl.textContent = t(key);
  netmsgEl.classList.remove('hidden');
}
function hideNetMsg(): void {
  netmsgEl.classList.add('hidden');
}

// ---------- 连接与进房 ----------
let connecting = false;
let inGame = false;
/** 当前对局循环的停止函数（断线/被拒时停止 rAF 并释放资源，防止旧循环泄漏） */
let stopGameLoop: (() => void) | null = null;
/** 当前等待房间界面（FR-L8）：非空 = 正在等待开局（非 connecting/inGame 的第三种状态） */
let activeWaitroom: WaitRoom | null = null;

/** 当前活跃连接（v0.4.0）：设置面板「返回首页」等模块级离开逻辑需要访问（net 原为 startGame 局部变量） */
let activeNet: Net | null = null;

function startGame(kind: 'create' | 'join' | 'rejoin', roomCode?: string): void {
  if (connecting || inGame || activeWaitroom) return;
  // 昵称校验（FR-L1：2~16 字符，与服务端 sanitizeNickname 一致）；非法则提示并中止，
  // 避免「被服务端静默改名为 P-xxxx」的无感知体验。空输入回退随机名（默认名规则）。
  // 重连（rejoin）沿用原实体名（服务端 tryRejoin 忽略昵称），无需校验/持久化昵称。
  let nickname = '';
  if (kind !== 'rejoin') {
    const raw = nicknameInput.value.trim();
    nickname = raw || randomName();
    if (nickname.length < 2 || nickname.length > 16) {
      showNetMsg('lobby.nameInvalid');
      return;
    }
  } else if (!sessionStorage.getItem(PLAYER_ID_KEY)) {
    return; // 凭据缺失（按钮此时应已隐藏，防御性兜底）
  }
  if (kind === 'create' || kind === 'join') {
    clearRejoin(); // 新开局丢弃旧重连凭据（旧对局状态不再可恢复）
  }
  connecting = true;
  if (kind !== 'rejoin') {
    try {
      localStorage.setItem(NICKNAME_KEY, nickname);
    } catch {
      /* localStorage 不可用时忽略（与进度/设置/i18n 写入点同等保护） */
    }
  }
  document.querySelector('#lobby')!.classList.add('hidden');
  showNetMsg('net.connecting');
  sfx.ensure(); // 首次用户交互初始化音频（浏览器自动播放策略，FR-S1）

  const net = new Net({
    onWelcome: (welcome) => {
      // FR-N7 防御：welcome 版本不匹配（join 已被服务端校验，此处兜底）按版本不一致处理
      if (welcome.version !== PROTOCOL_VERSION) {
        connecting = false;
        net.close();
        backToLobby();
        showNetMsg('net.versionMismatch');
        return;
      }
      cancelRejoinUi(); // 已进入房间/对局：收起重连入口（凭据保留，供本次对局断线重连）
      // 等待房间（FR-L8）：建房/按房间号加入后先进入等待界面，开局时服务端重发
      // welcome(room.state='running') 再走下方进局分支（复用全部既有进局链路）
      if (welcome.room?.state === 'waiting') {
        connecting = false;
        hideNetMsg();
        enterWaitRoom(net, welcome);
        return;
      }
      connecting = false;
      inGame = true;
      hideNetMsg();
      exitWaitRoom();
      document.querySelector('#hud')!.classList.remove('hidden');
      sessionStorage.setItem(PLAYER_ID_KEY, welcome.playerId); // FR-N5 断线重连凭据
      // 防御（体检修复批次 3）：重复 welcome 会创建第二个对局循环并覆盖 stopGameLoop，
      // 旧 rAF/Input/TouchControls/GameScene 全部泄漏 → 进局前先停掉可能存在的旧循环
      stopGameLoop?.();
      stopGameLoop = null;
      stopGameLoop = runGameLoop(net, welcome);
    },
    onRoomUpdate: (info) => {
      // 等待界面实时同步（FR-L8）；开局切换由 welcome 承接，此处忽略 running 态
      if (activeWaitroom && info.state === 'waiting') activeWaitroom.update(info);
    },
    onRejected: (reason) => {
      connecting = false;
      net.close(); // 被拒后关闭连接，避免空闲 socket 泄漏（重试会新建 Net）
      if (activeNet === net) activeNet = null;
      backToLobby();
      showNetMsg(
        reason === 'full'
          ? 'net.roomFull'
          : reason === 'noRoom'
            ? 'net.roomNotFound'
            : 'net.versionMismatch',
      );
    },
    onDisconnected: () => {
      if (activeNet === net) activeNet = null;
      if (inGame) {
        inGame = false;
        stopGameLoop?.();
        stopGameLoop = null;
        net.close(); // 阻止 socket.io 自动重连产生孤儿连接
        backToLobby(); // 修复断线死路：回大厅后 30s 宽限内可经「回到上一局」凭 rejoinId 回原对局（FR-N5）
        offerRejoin();
        showNetMsg('net.disconnected');
      } else if (activeWaitroom) {
        // 等待房间中断线（FR-L8）：等待态服务端立即移除实体，无对局状态可恢复 → 不提供重连入口
        clearRejoin();
        exitWaitRoom();
        net.close();
        backToLobby();
        showNetMsg('wait.disconnected');
      } else if (connecting) {
        // 建连后、welcome 前断开（如服务端恰在进房握手时重启）：socket.io 会自动重连
        // 但 join 不会重发 → 不处理会永久卡在「正在连接服务器」。按连接失败收场。
        connecting = false;
        net.close();
        backToLobby();
        showNetMsg('net.connectFailed');
      }
    },
    onConnectError: () => {
      if (inGame) return; // 对局中断线由 onDisconnected 处理
      if (activeNet === net) activeNet = null;
      exitWaitRoom();
      connecting = false;
      net.close(); // 停止无限重试，允许用户修正后重试
      backToLobby();
      showNetMsg('net.connectFailed');
    },
  });
  activeNet = net;
  // 进房（FR-L8/N5/A1，v0.4.0）：新建游戏 → createRoom 进等待房间（地图/难度/规则/Bot 数缺省走
  // 服务端默认，等待界面内由房主调整）；加入游戏 → join + roomCode；回到上一局 → join + rejoinId
  //（服务端 tryRejoin 分支恢复原实体；规则字段仅在服务端需要建房时生效，此处一律不传）
  if (kind === 'create') {
    net.createRoom({ version: PROTOCOL_VERSION, nickname, progress: loadProgress() });
  } else {
    net.join({
      version: PROTOCOL_VERSION,
      nickname,
      progress: loadProgress(),
      rejoinId: sessionStorage.getItem(PLAYER_ID_KEY),
      ...(roomCode !== undefined ? { roomCode } : {}),
    });
  }
}

/** 进入等待房间界面（FR-L8）：每次进入新建 WaitRoom 实例，退出时 dispose（防监听器叠加） */
function enterWaitRoom(net: Net, welcome: WelcomeMsg): void {
  exitWaitRoom();
  activeWaitroom = new WaitRoom({
    onStart: () => net.startMatch(),
    onLeave: () => {
      // 主动离开等待房间：与对局内「返回首页」同语义（服务端立即移除，不走断线宽限）
      exitWaitRoom();
      net.sendLeave();
      net.close();
      if (activeNet === net) activeNet = null;
      clearRejoin();
      backToLobby();
    },
    onSettingsChange: (patch) => net.updateRoom(patch), // 服务端白名单 + 房主校验后广播回流
  });
  activeWaitroom.show(welcome.room!, welcome.playerId);
}

/** 退出等待房间界面（释放事件监听；backToLobby 前调用） */
function exitWaitRoom(): void {
  activeWaitroom?.dispose();
  activeWaitroom = null;
}

function backToLobby(): void {
  // 关闭/复位全部对局内覆盖层：断线时可能正打开结算/计分板/重生遮罩/解锁横幅，
  // 不复位会随 #hud 一起被隐藏，但下一局 showGameLoop 后残留显示（stopGameLoop 已移除 keyup 监听无法再收起）
  for (const id of ['settings', 'scoreboard', 'settlement', 'respawn', 'unlockBanner']) {
    document.querySelector(`#${id}`)!.classList.add('hidden');
  }
  syncTouchUiVisibility(); // 面板全关 → 恢复触屏按钮（body.ui-open 复位）
  document.body.classList.remove('in-game', 'pad'); // 对局手势作用域与 pad 模式布局复位
  exitWaitRoom(); // 等待房间界面（FR-L8）：释放事件监听并隐藏
  closeJoinDialog(); // 加入房间弹窗（v0.4.0）：残留时复位（重连凭据/按钮状态由调用方管理）
  document.querySelector('#lobby')!.classList.remove('hidden');
  document.querySelector('#hud')!.classList.add('hidden');
}

/** 设置/结算面板开关状态 → body.ui-open（体检修复批次 3）：
 *  #touchControls（z-index 8）在 #hud（z-index 5，面板是其子元素）之外，不隐藏会压在面板上
 *  并吞掉角落点击；面板打开期间隐藏触屏按钮，关闭路径由 #setClose 与设置面板遮罩点击承接 */
function syncTouchUiVisibility(): void {
  document.body.classList.toggle('ui-open', Input.isGameInputBlocked());
}

// 大厅入口（v0.4.0）：新建游戏 → 等待房间（房主在等待界面调参）；加入游戏 → 房间号弹窗；
// 回到上一局 → 断线宽限内凭 rejoinId 重连（条件显示，见 offerRejoin）
document.querySelector('#start')!.addEventListener('click', () => startGame('create'));
document.querySelector('#joinGame')!.addEventListener('click', openJoinDialog);
document.querySelector('#joinConfirm')!.addEventListener('click', submitJoinCode);
document.querySelector('#joinCancel')!.addEventListener('click', closeJoinDialog);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame('create');
});

// ---------- 设置面板（FR-L5，M4）：模块级一次性绑定 ----------
// 修复：此前每局 runGameLoop 都重新注册一遍（音量/BGM/画质/语言/关闭/Esc），重复进局会叠加
// 监听器并让旧 GameScene 被闭包持有——现在只绑定一次，画质切换经 activeScene 作用于当前对局。
const settingsEl = document.querySelector<HTMLDivElement>('#settings')!;
const volumeSlider = document.querySelector<HTMLInputElement>('#setVolume')!;
const bgmSlider = document.querySelector<HTMLInputElement>('#setBgm')!;
const qualitySel = document.querySelector<HTMLSelectElement>('#setQuality')!;
const langSel = document.querySelector<HTMLSelectElement>('#setLang')!;
/** 触屏操作模式（FR-U6 双模式，v0.3.8）：仅触屏设备显示（CSS body:not(.touch) 隐藏） */
const touchModeSel = document.querySelector<HTMLSelectElement>('#setTouchMode')!;
/** 当前对局的场景引用：进局赋值、退出置空（画质分档即时生效用） */
let activeScene: GameScene | null = null;
function syncSettingsUi(): void {
  volumeSlider.value = `${Math.round(settings.volume * 100)}`;
  bgmSlider.value = `${Math.round(settings.bgm * 100)}`;
  qualitySel.value = settings.quality;
  langSel.value = getLang();
  touchModeSel.value = settings.touchMode;
}
syncSettingsUi();
/** 打开/关闭设置面板（Esc 与触屏「设置」按钮共用，FR-U6） */
function toggleSettingsPanel(): void {
  syncSettingsUi();
  settingsEl.classList.toggle('hidden');
  syncTouchUiVisibility(); // 面板打开期间隐藏触屏按钮（body.ui-open）
}
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !inGame) return;
  toggleSettingsPanel();
});
/** 对局内「返回首页」（v0.4.0，设置面板按钮）：与结算面板「返回大厅」同语义——主动离开：
 *  先停本地循环再关连接（服务端 sendLeave 立即移除实体，不走 30s 宽限），并清除重连凭据。
 *  hoisted 函数：结算面板 onLeave（runGameLoop 内）复用同一实现，避免两套离开逻辑分叉 */
function leaveMatchToLobby(): void {
  if (!inGame) return;
  inGame = false;
  stopGameLoop?.();
  stopGameLoop = null;
  activeNet?.sendLeave();
  activeNet?.close();
  activeNet = null;
  clearRejoin(); // 主动离开即彻底退出（清除重连凭据，FR-N5 语义区分）
  backToLobby();
}
document.querySelector('#setHome')!.addEventListener('click', leaveMatchToLobby);
document.querySelector('#setClose')!.addEventListener('click', () => {
  settingsEl.classList.add('hidden');
  syncTouchUiVisibility();
});
// 点设置面板遮罩（面板外）关闭（体检修复批次 3）：触屏端小屏下 #setClose 可能被裁切，
// 遮罩点击提供始终可用的关闭路径（桌面端同样生效，与常见面板交互一致）
settingsEl.addEventListener('pointerdown', (e) => {
  if (e.target === settingsEl) {
    settingsEl.classList.add('hidden');
    syncTouchUiVisibility();
  }
});
volumeSlider.addEventListener('input', () => {
  settings.volume = Number(volumeSlider.value) / 100;
  applyAudioSettings(settings);
  saveSettings(settings);
});
bgmSlider.addEventListener('input', () => {
  settings.bgm = Number(bgmSlider.value) / 100;
  applyAudioSettings(settings);
  saveSettings(settings);
});
qualitySel.addEventListener('change', () => {
  settings.quality = qualitySel.value as GameSettings['quality'];
  activeScene?.setQuality(settings.quality);
  saveSettings(settings);
});
langSel.addEventListener('change', () => {
  setLang(langSel.value as 'zh' | 'en'); // i18n 模块持久化 + applyDom（含小地图外的全部 data-i18n）
  refreshLangUi(); // 按钮标签/操作提示不走 data-i18n，需手动刷新
});
touchModeSel.addEventListener('change', () => {
  settings.touchMode = touchModeSel.value === 'stick' ? 'stick' : 'pad';
  saveSettings(settings);
  recreateTouchControls(); // 热切换：销毁旧控制器并按新模式重建（不重建场景，操作提示随之刷新）
});

// ---------- 触屏控制器（FR-U6 双模式，v0.3.8） ----------
/** 按当前设置创建触屏控制器：pad = D-pad + 点击射击（默认）/ stick = 双虚拟摇杆 */
function createTouchController(): TouchController {
  const callbacks = { onSettings: () => toggleSettingsPanel() };
  return settings.touchMode === 'stick' ? new StickControls(callbacks) : new PadControls(callbacks);
}

/** （重）建触屏控制器：进局/模式切换时调用；销毁旧的防监听器与 DOM 叠加。
 *  body.pad 驱动 pad 模式的 HUD 避让布局（血条移至底部中央等）；body.touch 由控制器自管 */
function recreateTouchControls(): void {
  activeTouch?.destroy();
  activeTouch = null;
  document.body.classList.toggle('pad', settings.touchMode !== 'stick');
  if (TOUCH && inGame) activeTouch = createTouchController();
  if (hintElRef) hintElRef.textContent = TOUCH ? touchHintText() : t('hint');
}

// ---------- 联机对局主循环 ----------
function runGameLoop(net: Net, welcome: WelcomeMsg): () => void {
  document.body.classList.add('in-game'); // 对局手势作用域（#game touch-action:none，iOS 手势加固）
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const map = getMap(welcome.mapId) ?? DEFAULT_MAP;
  let gameScene: GameScene;
  try {
    gameScene = new GameScene(canvas, map);
  } catch {
    // WebGL 初始化失败（NFR-6 基线外的环境）：可见失败并回大厅，而非黑屏挂起
    inGame = false;
    net.close();
    if (activeNet === net) activeNet = null;
    backToLobby();
    showNetMsg('net.webglFailed');
    return () => {};
  }
  gameScene.setQuality(settings.quality); // 画质分档（FR-L5，M4）
  activeScene = gameScene; // 供模块级设置面板切换画质
  const minimap = new Minimap(document.querySelector<HTMLCanvasElement>('#minimap')!, map);
  const hud = new Hud();
  const world = new NetWorld(gameScene, map, {
    onKill: (killer, victim, weaponId) => hud.addKillFeed(killer, victim, weaponId),
    onPlayerDamaged: (dmg) => hud.addVignette((dmg / 100) * 1.4),
    onPlayerHitEnemy: (dmg, killed, wx, wy) => {
      hud.hitMarker(killed);
      hud.addFloater(killed ? t('hud.eliminated') : `-${Math.round(dmg)}`, wx, wy, killed ? 'kill' : 'dmg', gameScene);
    },
    // FR-W1：本人解锁 → 全屏提示
    onUnlock: (nameKey) => hud.showUnlock(`${t('unlock.prefix')}${t(nameKey)}`),
    // FR-A1：本人击杀 → localStorage 进度累计（跨局保留成长）；彩蛋冲锋枪不计入（FR-E1）
    onOwnKill: (classId) => {
      if (classId === 'rush') return;
      const p = loadProgress();
      p[classId] = (p[classId] ?? 0) + 1;
      saveProgress(p);
    },
    // FR-M4/L7：结算面板 + 再来一局/返回大厅（killTarget 供「达到 X 杀」文案）
    onMatchEnd: (reason, standings, kt) => {
      hud.showSettlement(reason, standings, world.selfId, kt);
      syncTouchUiVisibility(); // 结算面板打开期间隐藏触屏按钮
    },
    onMatchReset: () => hud.hideSettlement(),
    // FR-E1：冲锋枪彩蛋模式激活 → 全屏提示（服务端口令验证通过后的快照回调）
    onRushActivated: () => {
      hud.showUnlock(t('rush.on'));
      sfx.unlock();
    },
  }, welcome);
  // 中途加入已结束对局（FR-M1/L7 修复）：服务端经 welcome.matchEnd 补发结算面板
  if (welcome.matchEnd) world.adoptMatchEnd(welcome.matchEnd);
  const input = new Input(canvas);
  // 触屏虚拟控制（FR-U6 双模式）：按设置创建（默认 pad = D-pad+点击射击）；随对局销毁/热切换重建
  recreateTouchControls();
  const aim = new THREE.Vector2();
  aim.set(world.local.x, world.local.y - TOUCH_AIM_DIST); // 默认朝上；pad 模式首次点击前保持

  const fpsEl = document.querySelector<HTMLElement>('#fps')!;
  // 操作提示（v0.4.0）已移入设置面板帮助区块（#helpHint），随语言/触屏模式由
  // refreshLangUi() 与 recreateTouchControls() 刷新，此处不再写 HUD 内的 #hint

  net.socket.on('snapshot', (msg: SnapshotMsg) => world.applySnapshot(msg));

  // Tab 计分板（FR-U1）：按住显示，松开隐藏
  const onTabDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    hud.showScoreboard(world.lastEntities, world.selfId);
  };
  const onTabUp = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') hud.hideScoreboard();
  };
  window.addEventListener('keydown', onTabDown);
  window.addEventListener('keyup', onTabUp);

  // 结算面板按钮（FR-M4）
  const onRematch = (): void => {
    hud.hideSettlement();
    syncTouchUiVisibility(); // 面板关闭 → 恢复触屏按钮
    net.sendRematch();
  };
  const onLeave = (): void => {
    hud.hideSettlement();
    hud.hideScoreboard();
    syncTouchUiVisibility();
    // 主动离开与设置面板「返回首页」共用同一实现（leaveMatchToLobby）：
    // 先落本地状态再关连接，避免 disconnect 回调误报「连接已断开」并重复清理；
    // 服务端 sendLeave 立即移除实体（不走 30s 断线宽限，FR-N5/N6），重连凭据一并清除
    leaveMatchToLobby();
  };
  document.querySelector('#rematchBtn')!.addEventListener('click', onRematch);
  document.querySelector('#leaveBtn')!.addEventListener('click', onLeave);

  let last = performance.now();
  let inputAcc = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let running = true;

  function frame(now: number): void {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const cmd = input.consumeCommands();
    // 触屏指令合并（FR-U6 双模式）：方向/摇杆覆盖移动、开火沿/换弹/切枪补充（键盘在触屏端不存在，直接覆盖安全）
    const tcmd = activeTouch?.consume() ?? null;
    if (tcmd) {
      cmd.moveX = tcmd.moveX;
      cmd.moveY = tcmd.moveY;
      cmd.firing = cmd.firing || tcmd.firing;
      if (tcmd.firePressed) cmd.firePressed = true;
      if (tcmd.reload) cmd.reload = true;
      if (tcmd.switchNext) cmd.switchTo = nextWeaponId(world.inv.current, 1); // 循环切换（与滚轮同源）
    }
    // 瞄准（FR-U6 双模式）：stick = 玩家位置 + 摇杆方向 × 固定距离；pad = 点击/拖动的屏幕位置
    // 投影到地面世界点（精度等同鼠标）；none = 本帧无触屏瞄准输入（保持上一帧瞄准点）；
    // 桌面 = 鼠标 NDC 投影到地面
    const taim = activeTouch?.getAim() ?? null;
    if (taim?.kind === 'client') {
      const ndc = clientToNdc(taim.x, taim.y, window.innerWidth, window.innerHeight);
      gameScene.screenToGround(ndc.x, ndc.y, aim);
    } else if (taim?.kind === 'dir') {
      aim.set(world.local.x + taim.x * TOUCH_AIM_DIST, world.local.y + taim.y * TOUCH_AIM_DIST);
    } else if (taim === null) {
      gameScene.screenToGround(input.mouseNdcX, input.mouseNdcY, aim);
    }
    // 冲锋枪彩蛋模式口令上报（FR-E1）：客户端校验通过后由服务端权威授予
    if (cmd.cheatRush) net.sendRush(CHEAT_RUSH_CODE);
    world.update(dt, cmd, aim.x, aim.y);

    // 上行输入节流（~30Hz，FR-N1）
    inputAcc += dt;
    if (inputAcc >= 1 / INPUT_SEND_RATE) {
      inputAcc = 0;
      net.sendInput(world.buildInput(cmd, aim.x, aim.y));
    }

    // HUD 刷新（FR-U1/C3/C4/U5）
    hud.setHealth(world.local.hp);
    const spec = world.inv.spec;
    // 彩蛋模式无限弹药：弹药位显示 ∞（FR-E1）
    const rush = world.inv.rushActive;
    hud.setWeapon(
      t(spec.nameKey),
      rush ? '∞' : world.inv.state.ammo,
      rush ? '' : world.inv.state.reserve,
      world.reloadProgress(),
    );
    hud.setKills(world.local.kills);
    hud.setMatchTimer(world.matchTimeLeft);
    if (hud.scoreboardVisible) hud.showScoreboard(world.lastEntities, world.selfId);
    const moving = cmd.moveX !== 0 || cmd.moveY !== 0;
    // 准星定位：触屏 = 瞄准点投影到屏幕（stick=摇杆方向点 / pad=点击处）；桌面 = 跟随鼠标（FR-U1/U6）
    const cross = activeTouch
      ? gameScene.worldToScreen(aim.x, aim.y)
      : { x: input.mouseClientX, y: input.mouseClientY };
    hud.setCrosshair(
      cross.x,
      cross.y,
      5 + world.recoilBloom * 1.8 + (moving ? spec.moveSpreadDeg * 1.2 : 0),
      world.local.alive,
    );
    hud.setRespawn(
      world.local.alive
        ? null
        : { killer: world.playerKillerName ?? '', seconds: world.playerRespawnIn },
    );
    hud.update(dt);

    gameScene.update(dt);
    gameScene.follow(world.local.x, world.local.y);
    minimap.update(world.local.x, world.local.y, world.local.angle); // 小地图（FR-U2，M4）
    gameScene.render();

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} FPS`;
      fpsFrames = 0;
      fpsTime = 0;
    }
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  /** 停止循环并释放本局资源（断线/销毁时调用） */
  return () => {
    running = false;
    activeScene = null;
    input.destroy();
    activeTouch?.destroy(); // 触屏控制器随对局销毁（FR-U6 双模式）
    activeTouch = null;
    document.body.classList.remove('in-game');
    gameScene.dispose();
    window.removeEventListener('keydown', onTabDown);
    window.removeEventListener('keyup', onTabUp);
    document.querySelector('#rematchBtn')!.removeEventListener('click', onRematch);
    document.querySelector('#leaveBtn')!.removeEventListener('click', onLeave);
  };
}