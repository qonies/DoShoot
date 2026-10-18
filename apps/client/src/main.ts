/** M3 入口：i18n + 大厅（地图/Bot 难度选择）+ 联机对局主循环（连接 → 进房 → 预测/插值渲染；权威在服务端 room.ts） */

import './style.css';
import * as THREE from 'three';
import {
  DEFAULT_MAP,
  MAPS,
  PROTOCOL_VERSION,
  getMap,
  type SnapshotMsg,
  type WelcomeMsg,
  type WeaponId,
} from '@DoShoot/shared';
import { applyDom, getLang, t, toggleLang } from './i18n';
import { GameScene } from './game/scene';
import { NetWorld } from './game/world';
import { Input } from './game/input';
import { Hud } from './game/hud';
import { Net } from './game/net';
import { sfx } from './game/audio';

const NICKNAME_KEY = 'DoShoot.nickname';
const PROGRESS_KEY = 'DoShoot.progress';
const PLAYER_ID_KEY = 'DoShoot.playerId';
/** 上行输入发送频率（FR-N1/N2 配套） */
const INPUT_SEND_RATE = 30;

// ---------- i18n 与大厅 ----------
applyDom();

const langBtn = document.querySelector<HTMLButtonElement>('#langBtn')!;
langBtn.textContent = getLang() === 'zh' ? 'EN' : '中文';
langBtn.addEventListener('click', () => {
  const l = toggleLang();
  langBtn.textContent = l === 'zh' ? 'EN' : '中文';
});

const nicknameInput = document.querySelector<HTMLInputElement>('#nickname')!;
function randomName(): string {
  return `${t('randomName')}-${Math.floor(1000 + Math.random() * 9000)}`;
}
nicknameInput.value = localStorage.getItem(NICKNAME_KEY) ?? randomName();

// 地图下拉（FR-L3/MP2：数据驱动，从 shared MAPS 注册表填充）
const mapSelect = document.querySelector<HTMLSelectElement>('#map')!;
mapSelect.replaceChildren(
  ...Object.values(MAPS).map((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = t(m.nameKey);
    return opt;
  }),
);
const difficultySelect = document.querySelector<HTMLSelectElement>('#difficulty')!;

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

function startGame(kind: 'quick' | 'map'): void {
  if (connecting || inGame) return;
  // 昵称校验（FR-L1：2~16 字符，与服务端 sanitizeNickname 一致）；非法则提示并中止，
  // 避免「被服务端静默改名为 P-xxxx」的无感知体验。空输入回退随机名（默认名规则）。
  const raw = nicknameInput.value.trim();
  const nickname = raw || randomName();
  if (nickname.length < 2 || nickname.length > 16) {
    showNetMsg('lobby.nameInvalid');
    return;
  }
  connecting = true;
  localStorage.setItem(NICKNAME_KEY, nickname);
  document.querySelector('#lobby')!.classList.add('hidden');
  showNetMsg('net.connecting');
  sfx.ensure(); // 首次用户交互初始化音频（浏览器自动播放策略，FR-S1）

  const net = new Net({
    onWelcome: (welcome) => {
      connecting = false;
      inGame = true;
      hideNetMsg();
      document.querySelector('#hud')!.classList.remove('hidden');
      sessionStorage.setItem(PLAYER_ID_KEY, welcome.playerId); // FR-N5 断线重连凭据
      stopGameLoop = runGameLoop(net, welcome);
    },
    onRejected: (reason) => {
      connecting = false;
      net.close(); // 被拒后关闭连接，避免空闲 socket 泄漏（重试会新建 Net）
      backToLobby();
      showNetMsg(reason === 'full' ? 'net.roomFull' : 'net.versionMismatch');
    },
    onDisconnected: () => {
      if (inGame) {
        inGame = false;
        stopGameLoop?.();
        stopGameLoop = null;
        net.close(); // 阻止 socket.io 自动重连产生孤儿连接（FR-N5 重连留 M3）
        showNetMsg('net.disconnected');
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
      connecting = false;
      net.close(); // 停止无限重试，允许用户修正后重试
      backToLobby();
      showNetMsg('net.connectFailed');
    },
  });
  // 进房（FR-L3/L4/B3/N5/A1）：地图选择 / Bot 难度 / 断线重连凭据 / 武器进度基线
  net.join({
    version: PROTOCOL_VERSION,
    nickname,
    mapId: kind === 'quick' ? undefined : mapSelect.value || 'range',
    difficulty: difficultySelect.value as 'easy' | 'normal' | 'hard',
    rejoinId: sessionStorage.getItem(PLAYER_ID_KEY),
    progress: loadProgress(),
  });
}

function backToLobby(): void {
  document.querySelector('#lobby')!.classList.remove('hidden');
  document.querySelector('#hud')!.classList.add('hidden');
}

document.querySelector('#start')!.addEventListener('click', () => startGame('map'));
document.querySelector('#quickJoin')!.addEventListener('click', () => startGame('quick'));
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame('map');
});

// ---------- 联机对局主循环 ----------
function runGameLoop(net: Net, welcome: WelcomeMsg): () => void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const map = getMap(welcome.mapId) ?? DEFAULT_MAP;
  const gameScene = new GameScene(canvas, map);
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
    // FR-A1：本人击杀 → localStorage 进度累计（跨局保留成长）
    onOwnKill: (classId) => {
      const p = loadProgress();
      p[classId] = (p[classId] ?? 0) + 1;
      saveProgress(p);
    },
    // FR-M4：结算面板 + 再来一局/返回大厅
    onMatchEnd: (reason, standings) => hud.showSettlement(reason, standings, world.selfId),
    onMatchReset: () => hud.hideSettlement(),
  }, welcome);
  const input = new Input(canvas);
  const aim = new THREE.Vector2();

  const hintEl = document.querySelector<HTMLElement>('#hint')!;
  hintEl.textContent = t('hint');
  const fpsEl = document.querySelector<HTMLElement>('#fps')!;

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
    net.sendRematch();
  };
  const onLeave = (): void => {
    hud.hideSettlement();
    hud.hideScoreboard();
    net.close(); // 服务端按断线处理（FR-N5 宽限期内重连可回原状态）
    backToLobby();
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
    gameScene.screenToGround(input.mouseNdcX, input.mouseNdcY, aim);
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
    hud.setWeapon(
      t(spec.nameKey),
      world.inv.state.ammo,
      world.inv.state.reserve,
      world.reloadProgress(),
    );
    hud.setKills(world.local.kills);
    hud.setMatchTimer(world.matchTimeLeft);
    if (hudTabDown()) hud.showScoreboard(world.lastEntities, world.selfId);
    const moving = cmd.moveX !== 0 || cmd.moveY !== 0;
    hud.setCrosshair(
      input.mouseClientX,
      input.mouseClientY,
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

  /** 按住 Tab 期间持续刷新计分板数据（keydown 只在可见性切换时重建） */
  function hudTabDown(): boolean {
    return document.querySelector<HTMLDivElement>('#scoreboard')!.classList.contains('hidden') === false;
  }

  /** 停止循环并释放本局资源（断线/销毁时调用） */
  return () => {
    running = false;
    input.destroy();
    gameScene.dispose();
    window.removeEventListener('keydown', onTabDown);
    window.removeEventListener('keyup', onTabUp);
    document.querySelector('#rematchBtn')!.removeEventListener('click', onRematch);
    document.querySelector('#leaveBtn')!.removeEventListener('click', onLeave);
  };
}