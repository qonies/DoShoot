/** M2 入口：i18n + 大厅 + 联机对局主循环（连接 → 进房 → 预测/插值渲染；权威在服务端 room.ts） */

import './style.css';
import * as THREE from 'three';
import { DEFAULT_MAP, PROTOCOL_VERSION, type SnapshotMsg, type WelcomeMsg } from '@deadshot/shared';
import { applyDom, getLang, t, toggleLang } from './i18n';
import { GameScene } from './game/scene';
import { NetWorld } from './game/world';
import { Input } from './game/input';
import { Hud } from './game/hud';
import { Net } from './game/net';

const NICKNAME_KEY = 'deadshot.nickname';
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
nicknameInput.value =
  localStorage.getItem(NICKNAME_KEY) ??
  `${t('randomName')}-${Math.floor(1000 + Math.random() * 9000)}`;

const mapSelect = document.querySelector<HTMLSelectElement>('#map')!;
mapSelect.options[0]!.textContent = t(DEFAULT_MAP.nameKey);

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

function startGame(): void {
  if (connecting || inGame) return;
  connecting = true;
  const nickname = nicknameInput.value.trim() || 'Player';
  localStorage.setItem(NICKNAME_KEY, nickname);
  document.querySelector('#lobby')!.classList.add('hidden');
  showNetMsg('net.connecting');

  const net = new Net({
    onWelcome: (welcome) => {
      connecting = false;
      inGame = true;
      hideNetMsg();
      document.querySelector('#hud')!.classList.remove('hidden');
      runGameLoop(net, welcome);
    },
    onRejected: (reason) => {
      connecting = false;
      backToLobby();
      showNetMsg(reason === 'full' ? 'net.roomFull' : 'net.versionMismatch');
    },
    onDisconnected: () => {
      if (inGame) {
        inGame = false;
        showNetMsg('net.disconnected');
      }
    },
  });
  net.join({ version: PROTOCOL_VERSION, nickname });
}

function backToLobby(): void {
  document.querySelector('#lobby')!.classList.remove('hidden');
  document.querySelector('#hud')!.classList.add('hidden');
}

document.querySelector('#start')!.addEventListener('click', startGame);
document.querySelector('#quickJoin')!.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

// ---------- 联机对局主循环 ----------
function runGameLoop(net: Net, welcome: WelcomeMsg): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const map = DEFAULT_MAP;
  const gameScene = new GameScene(canvas, map);
  const hud = new Hud();
  const world = new NetWorld(gameScene, map, {
    onKill: (killer, victim, weaponId) => hud.addKillFeed(killer, victim, weaponId),
    onPlayerDamaged: (dmg) => hud.addVignette((dmg / 100) * 1.4),
    onPlayerHitEnemy: (dmg, killed, wx, wy) => {
      hud.hitMarker(killed);
      hud.addFloater(killed ? t('hud.eliminated') : `-${Math.round(dmg)}`, wx, wy, killed ? 'kill' : 'dmg', gameScene);
    },
  }, welcome);
  const input = new Input(canvas);
  const aim = new THREE.Vector2();

  const hintEl = document.querySelector<HTMLElement>('#hint')!;
  hintEl.textContent = t('hint');
  const fpsEl = document.querySelector<HTMLElement>('#fps')!;

  net.socket.on('snapshot', (msg: SnapshotMsg) => world.applySnapshot(msg));

  let last = performance.now();
  let inputAcc = 0;
  let fpsFrames = 0;
  let fpsTime = 0;

  function frame(now: number): void {
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

    // HUD 刷新（FR-U1/C3/C4）
    hud.setHealth(world.local.hp);
    const spec = world.inv.spec;
    hud.setWeapon(
      t(spec.nameKey),
      world.inv.state.ammo,
      world.inv.state.reserve,
      world.reloadProgress(),
    );
    hud.setKills(world.local.kills);
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
}