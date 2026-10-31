/** 触屏虚拟控制·模式 B（FR-U6 pad 模式，v0.3.8 起为默认）：屏幕 D-pad 移动 + 点击/按住屏幕瞄准射击。
 *  - 左下 D-pad：4 个方向键（相邻两键同按 = 斜向），多点触控，pointerId → 方向映射；
 *    手指滑出键位不换向（需抬起再按），pointercancel/失焦全清
 *  - 点击屏幕：瞄准点 = 点击位置（世界地面点，screenToGround 精度等同鼠标）；
 *    轻点 = 1 发（semi/pump 按下沿），按住 = 持续开火（全自动），按住后拖动 = 持续微调瞄准；
 *    瞄准点保持到下一次点击（准星常驻点击处，方向随自身位移自然变化）
 *  - 按钮：换弹 / 切枪 / 设置（开火即点击屏幕，无独立开火键）
 *  输入合并与瞄准换算在 main.ts 完成（控制器只负责采集与可视化）；桌面端完全不受影响
 *  （仅响应 pointerType === 'touch'）。面板（设置/结算/等待房间）打开期间不产生游戏输入。 */

import { t } from '../i18n';
import { Input } from './input';
import { installGestureGuards } from './gestures';
import { createTouchButton, type TouchAim, type TouchCallbacks, type TouchCommand, type TouchController } from './touch';
import { dpadVector, isTouchDevice } from './touchmath';
import { DoubleTapTracker } from './dashtap';

/** D-pad 方向键标识 */
type Dir = 'up' | 'down' | 'left' | 'right';

const DIR_KEYS: Record<Dir, string> = { up: 'touch.up', down: 'touch.down', left: 'touch.left', right: 'touch.right' };
const DIR_GLYPH: Record<Dir, string> = { up: '▲', down: '▼', left: '◀', right: '▶' };

export class PadControls implements TouchController {
  private readonly root: HTMLDivElement;
  private readonly dpad: HTMLDivElement;
  private readonly reloadBtn: HTMLButtonElement;
  private readonly switchBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;
  /** 已按下的方向键：pointerId → 方向（多点触控，相邻两键同按 = 斜向） */
  private readonly pressedDirs = new Map<number, Dir>();
  /** 瞄准/开火触点 pointerId；null = 当前无射击触点 */
  private aimPointerId: number | null = null;
  /** 最近一次点击/拖动的屏幕坐标（sticky：松手后保持，作为持续瞄准点） */
  private aimClient: { x: number; y: number } | null = null;
  private firing = false;
  private firePressedEdge = false;
  private reloadEdge = false;
  private switchEdge = false;
  /** 双击方向键滑铲检测（FR-C7，v0.4.1）：D-pad 同一方向 250ms 内两次按下触发 */
  private readonly dashTaps = new DoubleTapTracker();
  private dashEdge: { x: number; y: number } | null = null;

  private readonly uninstallGuards: () => void;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return; // 桌面鼠标/触控板不受影响
    if (Input.isGameInputBlocked()) return;
    const target = e.target;
    if (target instanceof Element && target.closest('button, #dpad, #settings, #settlement, #waitroom, #lobby')) {
      return; // 按钮与 UI（含 D-pad 区域空隙）自行处理，不触发瞄准/射击
    }
    e.preventDefault(); // 阻止 iOS 双击缩放/长按选择等兼容行为
    if (this.aimPointerId !== null) return; // 已有射击触点（第二根手指忽略）
    this.aimPointerId = e.pointerId;
    this.aimClient = { x: e.clientX, y: e.clientY };
    this.firing = true; // 按住 = 持续开火（全自动）；轻点时仅数帧，等效 1 发
    this.firePressedEdge = true; // semi/pump 按下沿
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.aimPointerId) {
      this.aimClient = { x: e.clientX, y: e.clientY }; // 按住拖动 = 持续微调瞄准点
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.aimPointerId) {
      this.aimPointerId = null;
      this.firing = false; // aimClient 保持：松手后继续瞄准原点击处
    }
  };

  private readonly onBlur = (): void => {
    this.pressedDirs.clear();
    this.aimPointerId = null;
    this.firing = false;
    this.dashTaps.reset();
    this.dashEdge = null;
    for (const btn of this.dpad.querySelectorAll('button')) btn.classList.remove('active');
  };

  constructor(private readonly callbacks: TouchCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'touchControls';
    this.dpad = document.createElement('div');
    this.dpad.id = 'dpad';
    for (const dir of ['up', 'left', 'right', 'down'] as const) {
      const btn = document.createElement('button');
      btn.id = `dpad${dir[0]!.toUpperCase()}${dir.slice(1)}`; // dpadUp/dpadDown/dpadLeft/dpadRight
      btn.className = 'dpadBtn';
      btn.type = 'button';
      btn.setAttribute('aria-label', t(DIR_KEYS[dir]));
      btn.title = t(DIR_KEYS[dir]);
      btn.textContent = DIR_GLYPH[dir];
      this.bindDpadButton(btn, dir);
      this.dpad.appendChild(btn);
    }
    this.reloadBtn = createTouchButton('reload', 'touch.reload', '↻');
    this.switchBtn = createTouchButton('switch', 'touch.switch', '⇄');
    this.settingsBtn = createTouchButton('settings', 'touch.settings', '⚙');
    this.bindActionButton(this.reloadBtn, () => (this.reloadEdge = true));
    this.bindActionButton(this.switchBtn, () => (this.switchEdge = true));
    this.bindActionButton(this.settingsBtn, () => this.callbacks.onSettings());
    this.root.append(this.dpad, this.reloadBtn, this.switchBtn, this.settingsBtn);
    document.body.appendChild(this.root);
    if (isTouchDevice()) document.body.classList.add('touch');
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
    this.uninstallGuards = installGestureGuards();
  }

  /** 取走本帧触屏指令（边缘标志一次性复位；moveX/moveY/firing 为持续状态） */
  consume(): TouchCommand {
    let up = false;
    let down = false;
    let left = false;
    let right = false;
    for (const dir of this.pressedDirs.values()) {
      if (dir === 'up') up = true;
      else if (dir === 'down') down = true;
      else if (dir === 'left') left = true;
      else right = true;
    }
    const mv = dpadVector(up, down, left, right);
    const cmd: TouchCommand = {
      moveX: mv.x,
      moveY: mv.y,
      firing: this.firing,
      firePressed: this.firePressedEdge,
      reload: this.reloadEdge,
      switchNext: this.switchEdge,
      dash: this.dashEdge,
    };
    this.firePressedEdge = false;
    this.reloadEdge = false;
    this.switchEdge = false;
    this.dashEdge = null;
    return cmd;
  }

  /** 本帧触屏瞄准：最近一次点击/拖动的屏幕坐标（sticky；首次点击前无输入，main 保持默认朝向） */
  getAim(): TouchAim {
    return this.aimClient ? { kind: 'client', x: this.aimClient.x, y: this.aimClient.y } : { kind: 'none' };
  }

  /** 释放事件监听并移除 DOM（对局销毁/热切换时调用，防重复叠加） */
  destroy(): void {
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('blur', this.onBlur);
    this.uninstallGuards();
    this.root.remove();
    document.body.classList.remove('touch');
  }

  // ---------- 事件绑定 ----------

  /** D-pad 方向键：pointerdown 置位方向、up/cancel/leave 复位；stopPropagation 防触发瞄准射击。
   *  双击同一方向（FR-C7，v0.4.1）→ 滑铲意图（方向 = 当前全部按下方向合成，支持斜向） */
  private bindDpadButton(btn: HTMLButtonElement, dir: Dir): void {
    const down = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch') return;
      if (Input.isGameInputBlocked()) return;
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('active');
      this.pressedDirs.set(e.pointerId, dir);
      if (this.dashTaps.press(dir, performance.now())) {
        let up = false;
        let dn = false;
        let lf = false;
        let rt = false;
        for (const d of this.pressedDirs.values()) {
          if (d === 'up') up = true;
          else if (d === 'down') dn = true;
          else if (d === 'left') lf = true;
          else rt = true;
        }
        const mv = dpadVector(up, dn, lf, rt);
        this.dashEdge = mv.x !== 0 || mv.y !== 0 ? { x: mv.x, y: mv.y } : null;
      }
    };
    const up = (e: PointerEvent): void => {
      this.pressedDirs.delete(e.pointerId);
      btn.classList.remove('active');
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  /** 动作按钮（换弹/切枪/设置）：pointerdown 触发一次；面板打开期间忽略 */
  private bindActionButton(btn: HTMLButtonElement, onDown: () => void): void {
    const down = (e: PointerEvent): void => {
      if (Input.isGameInputBlocked()) return;
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('active');
      onDown();
    };
    const up = (): void => btn.classList.remove('active');
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }
}