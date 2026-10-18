/** M1 入口：i18n 初始化 + 大厅交互 + 单机对局主循环（rAF 渲染；战斗权威逻辑见 game/world.ts，M2 联机时迁移至服务端） */

import './style.css';
import * as THREE from 'three';
import { DEFAULT_MAP } from '@deadshot/shared';
import { applyDom, getLang, t, toggleLang } from './i18n';
import { GameScene } from './game/scene';
import { World } from './game/world';
import { Input } from './game/input';
import { Hud } from './game/hud';

const NICKNAME_KEY = 'deadshot.nickname';

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

let started = false;
function startGame(): void {
  if (started) return;
  started = true;
  const nickname = nicknameInput.value.trim() || 'Player';
  localStorage.setItem(NICKNAME_KEY, nickname);
  document.querySelector('#lobby')!.classList.add('hidden');
  document.querySelector('#hud')!.classList.remove('hidden');
  runGameLoop(nickname);
}
document.querySelector('#start')!.addEventListener('click', startGame);
document.querySelector('#quickJoin')!.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

// ---------- 单机对局主循环 ----------
function runGameLoop(nickname: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const map = DEFAULT_MAP;
  const gameScene = new GameScene(canvas, map);
  const hud = new Hud();
  const world = new World(gameScene, map, nickname, {
    onKill: (killer, victim, weaponId) => hud.addKillFeed(killer, victim, weaponId),
    onPlayerDamaged: (dmg) => hud.addVignette((dmg / 100) * 1.4),
    onPlayerDeath: () => undefined, // 重生界面按帧刷新（setRespawn）
    onPlayerRespawn: () => undefined,
    onPlayerHitEnemy: (dmg, killed, wx, wy) => {
      hud.hitMarker(killed);
      hud.addFloater(killed ? t('hud.eliminated') : `-${Math.round(dmg)}`, wx, wy, killed ? 'kill' : 'dmg', gameScene);
    },
  });
  const input = new Input(canvas);
  const aim = new THREE.Vector2();

  const hintEl = document.querySelector<HTMLElement>('#hint')!;
  hintEl.textContent = t('hint');
  const fpsEl = document.querySelector<HTMLElement>('#fps')!;

  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    const cmd = input.consumeCommands();
    gameScene.screenToGround(input.mouseNdcX, input.mouseNdcY, aim);
    world.update(dt, cmd, aim.x, aim.y);

    // HUD 刷新（FR-U1/C3/C4）
    hud.setHealth(world.player.hp);
    const spec = world.inv.spec;
    const st = world.inv.state;
    const reloadProgress =
      st.reloadEnd !== null ? 1 - (st.reloadEnd - world.time) / spec.reloadTime : null;
    hud.setWeapon(t(spec.nameKey), st.ammo, st.reserve, reloadProgress);
    hud.setKills(world.playerKills);
    const moving = cmd.moveX !== 0 || cmd.moveY !== 0;
    hud.setCrosshair(
      input.mouseClientX,
      input.mouseClientY,
      5 + world.recoilBloom * 1.8 + (moving ? spec.moveSpreadDeg * 1.2 : 0),
      world.player.alive,
    );
    hud.setRespawn(
      world.player.alive
        ? null
        : { killer: world.playerKillerName ?? '', seconds: world.playerRespawnIn },
    );
    hud.update(dt);

    gameScene.update(dt);
    gameScene.follow(world.player.x, world.player.y);
    gameScene.render();

    // FPS 计数（NFR-1：≥ 60 FPS）
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