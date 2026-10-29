/** 等待房间界面（FR-L8）：「新建游戏」后等待局域网玩家加入的中间界面。
 *  房主可调参数（地图 / Bot 难度 / 击杀目标 / 对局时限 / Bot 数量），非房主只读同步；
 *  玩家经大厅输入房间号加入（服务端 roomUpdate 广播实时刷新本界面）；
 *  开局由房主触发（startMatch），「等待 → 对局」切换由 main.ts 的
 *  onWelcome(room.state='running') 承接（服务端开局时向全员重发 welcome）。
 *  DOM 分层遵循 FR-U4：界面用 DOM，进对局后的世界用 Three.js。 */

import {
  BOT_COUNT_OPTIONS,
  KILL_TARGET_OPTIONS,
  MAPS,
  TIME_LIMIT_OPTIONS,
  type RoomInfoMsg,
  type RoomSettingsMsg,
} from '@DoShoot/shared';
import { t } from './i18n';

export interface WaitRoomCallbacks {
  /** 房主点击「开始游戏」 */
  onStart(): void;
  /** 点击「离开房间」（主动离开：服务端立即移除，不走断线宽限） */
  onLeave(): void;
  /** 房主修改参数（服务端白名单校验后广播 roomUpdate 回流） */
  onSettingsChange(patch: RoomSettingsMsg): void;
}

export class WaitRoom {
  private readonly root = document.querySelector<HTMLDivElement>('#waitroom')!;
  private readonly codeEl = document.querySelector<HTMLElement>('#waitCode')!;
  private readonly shareEl = document.querySelector<HTMLElement>('#waitShare')!;
  private readonly countEl = document.querySelector<HTMLElement>('#waitCount')!;
  private readonly playersEl = document.querySelector<HTMLDivElement>('#waitPlayers')!;
  private readonly mapSel = document.querySelector<HTMLSelectElement>('#waitMap')!;
  private readonly diffSel = document.querySelector<HTMLSelectElement>('#waitDifficulty')!;
  private readonly killSel = document.querySelector<HTMLSelectElement>('#waitKillTarget')!;
  private readonly timeSel = document.querySelector<HTMLSelectElement>('#waitTimeLimit')!;
  private readonly botsSel = document.querySelector<HTMLSelectElement>('#waitBotCount')!;
  private readonly startBtn = document.querySelector<HTMLButtonElement>('#waitStart')!;
  private readonly leaveBtn = document.querySelector<HTMLButtonElement>('#waitLeave')!;
  private readonly hostHintEl = document.querySelector<HTMLElement>('#waitHostHint')!;
  /** 已绑定的事件（dispose 时成对移除，防重复进入等待界面叠加监听器） */
  private readonly bound: Array<[EventTarget, string, EventListener]> = [];
  /** 最近一次房间信息缓存（语言切换 refresh 复用） */
  private info: RoomInfoMsg | null = null;
  private selfId = '';

  constructor(private readonly cb: WaitRoomCallbacks) {
    this.bind(this.startBtn, 'click', () => this.cb.onStart());
    this.bind(this.leaveBtn, 'click', () => this.cb.onLeave());
    // 参数变更 → 上报服务端（服务端权威校验，回流 roomUpdate 后回填本界面）
    this.bind(this.mapSel, 'change', () => this.report({ mapId: this.mapSel.value }));
    this.bind(this.diffSel, 'change', () =>
      this.report({ difficulty: this.diffSel.value as RoomSettingsMsg['difficulty'] }),
    );
    this.bind(this.killSel, 'change', () => this.report({ killTarget: Number(this.killSel.value) }));
    this.bind(this.timeSel, 'change', () => this.report({ timeLimitSec: Number(this.timeSel.value) }));
    this.bind(this.botsSel, 'change', () => this.report({ botCount: Number(this.botsSel.value) }));
  }


  /** 进入等待界面并渲染房间信息 */
  show(info: RoomInfoMsg, selfId: string): void {
    this.selfId = selfId;
    this.root.classList.remove('hidden');
    this.update(info);
  }

  /** 房间信息变化（roomUpdate / welcome.room）→ 全量重渲染（元素极少，不做 diff） */
  update(info: RoomInfoMsg): void {
    this.info = info;
    const isHost = this.isHost();
    this.codeEl.textContent = info.code;
    this.shareEl.textContent = t('wait.share').replace('{code}', info.code);
    this.countEl.textContent = `${info.players.length} / ${info.capacity}`;
    // 玩家列表（房主徽章 + 「你」标记）
    const rows: HTMLDivElement[] = [];
    for (const p of info.players) {
      const row = document.createElement('div');
      row.className = 'waitPlayer';
      const name = document.createElement('span');
      name.textContent = p.id === this.selfId ? `${p.name} (${t('wait.you')})` : p.name;
      row.appendChild(name);
      if (p.host) {
        const badge = document.createElement('span');
        badge.className = 'hostBadge';
        badge.textContent = t('wait.host');
        row.appendChild(badge);
      }
      rows.push(row);
    }
    this.playersEl.replaceChildren(...rows);
    this.renderSelects(info, isHost);
    this.startBtn.classList.toggle('hidden', !isHost);
    this.hostHintEl.classList.toggle('hidden', isHost);
  }

  /** 参数下拉：数据驱动（与大厅同源常量），房主可编辑、其余人禁用只读 */
  private renderSelects(info: RoomInfoMsg, isHost: boolean): void {
    this.fillSelect(
      this.mapSel,
      Object.values(MAPS).map((m) => ({ value: m.id, label: t(m.nameKey) })),
      info.mapId,
    );
    this.fillSelect(
      this.diffSel,
      (['easy', 'normal', 'hard'] as const).map((d) => ({ value: d, label: t(`diff.${d}`) })),
      info.difficulty,
    );
    this.fillSelect(
      this.killSel,
      KILL_TARGET_OPTIONS.map((n) => ({ value: String(n), label: t(`rule.kills${n}`) })),
      String(info.killTarget),
    );
    this.fillSelect(
      this.timeSel,
      TIME_LIMIT_OPTIONS.map((n) => ({ value: String(n), label: t(`rule.time${n / 60}`) })),
      String(info.timeLimitSec),
    );
    this.fillSelect(
      this.botsSel,
      BOT_COUNT_OPTIONS.map((n) => ({ value: String(n), label: t(`bots.${n}`) })),
      String(info.botCount),
    );
    for (const sel of [this.mapSel, this.diffSel, this.killSel, this.timeSel, this.botsSel]) {
      sel.disabled = !isHost;
    }
  }

  /** 语言切换后用缓存重渲染（动态文案不走 data-i18n） */
  refresh(): void {
    if (this.info) this.update(this.info);
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** 释放事件监听（回大厅/断线时调用，防泄漏） */
  dispose(): void {
    for (const [target, type, fn] of this.bound) target.removeEventListener(type, fn);
    this.bound.length = 0;
    this.info = null;
    this.hide();
  }

  private isHost(): boolean {
    return this.info?.hostId === this.selfId;
  }

  private report(patch: RoomSettingsMsg): void {
    if (this.isHost()) this.cb.onSettingsChange(patch);
  }

  private bind(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.bound.push([target, type, fn]);
  }

  private fillSelect(
    sel: HTMLSelectElement,
    options: Array<{ value: string; label: string }>,
    current: string,
  ): void {
    // 内容未变时不重建，避免打断用户正在展开的下拉
    if (
      sel.options.length === options.length &&
      [...sel.options].every(
        (o, i) => o.value === options[i]!.value && o.textContent === options[i]!.label,
      )
    ) {
      sel.value = current;
      return;
    }
    sel.replaceChildren(
      ...options.map((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        return opt;
      }),
    );
    sel.value = current;
  }
}

