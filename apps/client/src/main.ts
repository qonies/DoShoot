/** M0 入口：i18n 初始化 + 大厅交互 + 游戏主循环（rAF 渲染，见 systemPatterns「帧循环分离」） */

import './style.css';
import * as THREE from 'three';
import { DEFAULT_MAP, PLAYER_SPEED, resolveCircleWalls } from '@deadshot/shared';
import { applyDom, getLang, t, toggleLang } from './i18n';
import { GameScene } from './game/scene';
import { Player } from './game/player';
import { Input } from './game/input';
import { Shooting } from './game/shooting';

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
  runGameLoop();
}
document.querySelector('#start')!.addEventListener('click', startGame);
document.querySelector('#quickJoin')!.addEventListener('click', startGame);
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startGame();
});

// ---------- 游戏主循环 ----------
function runGameLoop(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
  const map = DEFAULT_MAP;
  const gameScene = new GameScene(canvas, map);
  const spawn = map.spawns[0]!;
  const player = new Player(gameScene.scene, spawn.x, spawn.y);
  const input = new Input(canvas);
  const shooting = new Shooting(gameScene.scene, map, gameScene.dummyTargets);

  const hintEl = document.querySelector<HTMLElement>('#hint')!;
  hintEl.textContent = t('hint');
  const fpsEl = document.querySelector<HTMLElement>('#fps')!;

  const aim = new THREE.Vector2();
  let last = performance.now();
  let fpsFrames = 0;
  let fpsTime = 0;

  function frame(now: number): void {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // 移动（WASD 八方向 + 圆形碰撞解算，FR-C1）
    const mv = input.getMoveVector();
    if (mv.x !== 0 || mv.y !== 0) {
      const nx = player.x + mv.x * PLAYER_SPEED * dt;
      const ny = player.y + mv.y * PLAYER_SPEED * dt;
      const resolved = resolveCircleWalls(map, nx, ny, player.radius);
      player.x = resolved.x;
      player.y = resolved.y;
    }

    // 瞄准（鼠标 → 地面世界坐标 → 朝向角）
    shooting.getAimPoint(gameScene.camera, input.mouseNdcX, input.mouseNdcY, aim);
    const aimDx = aim.x - player.x;
    const aimDy = aim.y - player.y;
    if (Math.hypot(aimDx, aimDy) > 0.1) {
      player.aimAngle = Math.atan2(aimDx, aimDy);
    }

    // 射击（按住左键连发，FR-C2）
    shooting.tryFire(dt, player.x, player.y, aim.x, aim.y, input.firing);
    shooting.update(dt);

    player.sync();
    gameScene.updateDummies(now);
    gameScene.follow(player.x, player.y);
    gameScene.render();

    // FPS 计数（M0 验收：≥ 60 FPS）
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
