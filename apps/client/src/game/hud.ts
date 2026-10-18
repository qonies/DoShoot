/** 基础 HUD（FR-U1/C3/C4）：血条、弹药/换弹、击杀流、动态准星、命中标记、伤害飘字、受击泛红、重生界面 */

import { t } from '../i18n';
import type { EntitySnapshot, StandingRow, WeaponId } from '@DoShoot/shared';
import type { GameScene } from './scene';

export interface RespawnInfo {
  killer: string;
  seconds: number;
}

const KILLFEED_TTL_MS = 4200;
const KILLFEED_MAX = 5;
const FLOATER_TTL_MS = 900;
const VIGNETTE_DECAY = 0.9;
const UNLOCK_BANNER_TTL_MS = 2600;
/** 计分板内容重建节流（按住 Tab 时避免每帧重建 DOM） */
const SCOREBOARD_REFRESH_MS = 200;

export class Hud {
  private readonly healthFill = document.querySelector<HTMLDivElement>('#healthfill')!;
  private readonly hpText = document.querySelector<HTMLElement>('#hptext')!;
  private readonly weaponName = document.querySelector<HTMLElement>('#weaponname')!;
  private readonly ammoMag = document.querySelector<HTMLElement>('#ammoMag')!;
  private readonly ammoReserve = document.querySelector<HTMLElement>('#ammoReserve')!;
  private readonly reloadBar = document.querySelector<HTMLDivElement>('#reloadbar')!;
  private readonly reloadFill = document.querySelector<HTMLDivElement>('#reloadfill')!;
  private readonly reloadText = document.querySelector<HTMLElement>('#reloadtext')!;
  private readonly killCount = document.querySelector<HTMLElement>('#killCount')!;
  private readonly killfeed = document.querySelector<HTMLDivElement>('#killfeed')!;
  private readonly crosshair = document.querySelector<HTMLDivElement>('#crosshair')!;
  private readonly hitmarker = document.querySelector<HTMLDivElement>('#hitmarker')!;
  private readonly floaters = document.querySelector<HTMLDivElement>('#floaters')!;
  private readonly respawnEl = document.querySelector<HTMLDivElement>('#respawn')!;
  private readonly respawnKiller = document.querySelector<HTMLElement>('#respawnKiller')!;
  private readonly respawnTimer = document.querySelector<HTMLElement>('#respawnTimer')!;
  private readonly vignette = document.querySelector<HTMLDivElement>('#vignette')!;
  private readonly matchTimer = document.querySelector<HTMLElement>('#matchTimer')!;
  private readonly scoreboard = document.querySelector<HTMLDivElement>('#scoreboard')!;
  private readonly sbBody = document.querySelector<HTMLTableSectionElement>('#sbBody')!;
  private readonly unlockBanner = document.querySelector<HTMLDivElement>('#unlockBanner')!;
  private readonly unlockText = document.querySelector<HTMLElement>('#unlockText')!;
  private readonly settlement = document.querySelector<HTMLDivElement>('#settlement')!;
  private readonly settleReason = document.querySelector<HTMLElement>('#settleReason')!;
  private readonly settleBody = document.querySelector<HTMLTableSectionElement>('#settleBody')!;

  private vignetteLevel = 0;
  private unlockTimer = 0;
  private sbLastBuild = 0;
  private sbVisible = false;

  setHealth(hp: number): void {
    const pct = Math.max(0, Math.min(100, hp));
    this.healthFill.style.width = `${pct}%`;
    this.healthFill.classList.toggle('low', pct <= 30);
    this.hpText.textContent = `${Math.ceil(pct)}`;
  }

  setWeapon(name: string, ammo: number, reserve: number, reloadProgress: number | null): void {
    this.weaponName.textContent = name;
    this.ammoMag.textContent = `${ammo}`;
    this.ammoReserve.textContent = ` / ${reserve}`;
    this.ammoMag.classList.toggle('empty', ammo === 0 && reloadProgress === null);
    if (reloadProgress !== null) {
      this.reloadBar.classList.remove('hidden');
      this.reloadText.classList.remove('hidden');
      this.reloadFill.style.width = `${Math.round(reloadProgress * 100)}%`;
    } else {
      this.reloadBar.classList.add('hidden');
      this.reloadText.classList.add('hidden');
    }
  }

  setKills(n: number): void {
    this.killCount.textContent = `${n}`;
  }

  /** 动态准星：跟随鼠标，间隙随散布/后坐力扩散（FR-U1） */
  setCrosshair(x: number, y: number, gapPx: number, visible: boolean): void {
    this.crosshair.style.display = visible ? 'block' : 'none';
    this.crosshair.style.transform = `translate(${x}px, ${y}px)`;
    this.crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
  }

  hitMarker(killed: boolean): void {
    this.hitmarker.classList.remove('show', 'kill');
    void this.hitmarker.offsetWidth; // 重启动画
    this.hitmarker.classList.add('show');
    if (killed) this.hitmarker.classList.add('kill');
  }

  addVignette(v: number): void {
    this.vignetteLevel = Math.min(0.85, this.vignetteLevel + v);
  }

  addKillFeed(killer: string, victim: string, weaponId: WeaponId): void {
    const el = document.createElement('div');
    el.className = 'kf';
    const k = document.createElement('b');
    k.textContent = killer;
    const w = document.createElement('i');
    w.textContent = t(`weapon.${weaponId}`);
    const v = document.createElement('span');
    v.textContent = victim;
    el.append(k, w, v);
    this.killfeed.prepend(el);
    while (this.killfeed.children.length > KILLFEED_MAX) {
      this.killfeed.lastElementChild?.remove();
    }
    window.setTimeout(() => el.remove(), KILLFEED_TTL_MS);
  }

  /** 世界坐标伤害飘字（捕获瞬时屏幕位置，CSS 动画上浮淡出） */
  addFloater(text: string, wx: number, wy: number, cls: string, scene: GameScene): void {
    const s = scene.worldToScreen(wx, wy);
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    this.floaters.appendChild(el);
    window.setTimeout(() => el.remove(), FLOATER_TTL_MS);
  }

  setRespawn(info: RespawnInfo | null): void {
    if (info === null) {
      this.respawnEl.classList.add('hidden');
      return;
    }
    this.respawnEl.classList.remove('hidden');
    this.respawnKiller.textContent = t('hud.killedBy').replace('{name}', info.killer);
    this.respawnTimer.textContent = t('hud.respawnIn').replace('{s}', info.seconds.toFixed(1));
  }

  /** 每帧推进：受击泛红衰减 */
  update(dt: number): void {
    if (this.vignetteLevel > 0) {
      this.vignetteLevel = Math.max(0, this.vignetteLevel - VIGNETTE_DECAY * dt);
      this.vignette.style.opacity = `${this.vignetteLevel}`;
    }
  }

  /** 对局倒计时（FR-U5）：null = 对局已结束，隐藏 */
  setMatchTimer(seconds: number | null): void {
    if (seconds === null) {
      this.matchTimer.classList.add('hidden');
      return;
    }
    this.matchTimer.classList.remove('hidden');
    const s = Math.max(0, Math.ceil(seconds));
    this.matchTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /** Tab 计分板（FR-U1）：按击杀降序 / 死亡升序，本人行高亮 */
  showScoreboard(entities: readonly EntitySnapshot[], localId: string): void {
    if (!this.sbVisible) {
      this.sbVisible = true;
      this.scoreboard.classList.remove('hidden');
    }
    const now = performance.now();
    if (now - this.sbLastBuild < SCOREBOARD_REFRESH_MS) return;
    this.sbLastBuild = now;
    this.fillStandings(this.sbBody, entities, localId);
  }

  hideScoreboard(): void {
    this.sbVisible = false;
    this.scoreboard.classList.add('hidden');
  }

  /** 武器解锁全屏提示（FR-W1） */
  showUnlock(text: string): void {
    this.unlockText.textContent = text;
    this.unlockBanner.classList.remove('hidden');
    window.clearTimeout(this.unlockTimer);
    this.unlockTimer = window.setTimeout(() => {
      this.unlockBanner.classList.add('hidden');
    }, UNLOCK_BANNER_TTL_MS);
  }

  /** 结算面板（FR-M4）：原因 + 排名（K/D） */
  showSettlement(reason: 'kills' | 'time', standings: readonly StandingRow[], localId: string): void {
    this.settleReason.textContent =
      reason === 'time' ? t('settle.timeUp') : t('settle.reachTarget').replace('{name}', standings[0]?.name ?? '?');
    this.fillStandings(this.settleBody, standings, localId);
    this.settlement.classList.remove('hidden');
  }

  hideSettlement(): void {
    this.settlement.classList.add('hidden');
  }

  /** 排名表填充（计分板/结算共用；输入为快照实体或排名行，统一为 {id,name,bot,kills,deaths}） */
  private fillStandings(
    body: HTMLTableSectionElement,
    rows: readonly { id: string; name: string; bot: boolean; kills: number; deaths: number }[],
    localId: string,
  ): void {
    const sorted = [...rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    body.replaceChildren(
      ...sorted.map((r) => {
        const tr = document.createElement('tr');
        if (r.id === localId) tr.classList.add('me');
        const name = document.createElement('td');
        name.textContent = r.bot ? `${r.name} [BOT]` : r.name;
        const kills = document.createElement('td');
        kills.textContent = `${r.kills}`;
        const deaths = document.createElement('td');
        deaths.textContent = `${r.deaths}`;
        tr.append(name, kills, deaths);
        return tr;
      }),
    );
  }
}