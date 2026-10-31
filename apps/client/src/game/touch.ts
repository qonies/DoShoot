/** 触屏虚拟控制（FR-U6）：两种操作模式（v0.3.8 起可选，默认 pad 见 touchpad.ts）。
 *  本文件为「双虚拟摇杆」模式（stick）：左半屏移动摇杆 + 右半屏瞄准摇杆 + 动作按钮。
 *  - 左半屏按下 → 移动摇杆（浮现在触点，WASD 等效八方向归一化向量）
 *  - 右半屏拖动 → 瞄准摇杆（方向持久保持，等效鼠标瞄准；世界坐标 y 向下与屏幕一致）
 *  - 按钮：开火（按住连发/按下沿）/ 换弹 / 切枪（循环）/ 设置（等效 Esc）
 *  输入合并与瞄准换算在 main.ts 完成（控制器只负责采集与可视化）；桌面端完全不受影响
 *  （仅响应 pointerType === 'touch'）。面板（设置/结算/等待房间）打开期间不产生游戏输入。 */

import { t } from '../i18n';
import { Input } from './input';
import { installGestureGuards } from './gestures';
import { isTouchDevice, stickVector } from './touchmath';

/** 摇杆基座半径 / 死区（像素，与 CSS 视觉一致） */
export const STICK_RADIUS = 64;
export const STICK_DEADZONE = 14;

/** 一帧内触屏指令（消费型；与 InputCommand 字段对齐，由 main 合并） */
export interface TouchCommand {
  moveX: number;
  moveY: number;
  /** 开火按钮按住状态（全自动武器） */
  firing: boolean;
  /** 开火按钮按下沿（semi/pump 武器用） */
  firePressed: boolean;
  reload: boolean;
  /** 切枪按钮按下沿（main 换算为 nextWeaponId 循环切换） */
  switchNext: boolean;
  /** 双击方向触发的滑铲意图（FR-C7，v0.4.1 边缘触发；方向 = 当前 D-pad 合成向量，pad 模式专用） */
  dash: { x: number; y: number } | null;
}

/** 本帧触屏瞄准输入（main.ts 换算为世界瞄准点）：
 *  - dir：相对自身位置的方向（stick 模式右摇杆，长度 1；世界坐标 y 向下为正）
 *  - client：屏幕客户端像素坐标（pad 模式点击/拖动位置，main 换算 NDC → 地面世界点）
 *  - none：本帧无触屏瞄准输入（main 保持上一帧瞄准点） */
export type TouchAim =
  | { kind: 'dir'; x: number; y: number }
  | { kind: 'client'; x: number; y: number }
  | { kind: 'none' };

/** 触屏控制器统一契约（stick / pad 双模式，main.ts 按设置创建/热切换/销毁） */
export interface TouchController {
  /** 取走本帧触屏指令（边缘标志一次性复位；moveX/moveY/firing 为持续状态） */
  consume(): TouchCommand;
  /** 本帧触屏瞄准输入 */
  getAim(): TouchAim;
  /** 释放事件监听并移除 DOM（对局销毁/热切换时调用，防重复进局叠加） */
  destroy(): void;
}

export interface TouchCallbacks {
  /** 点击设置按钮（等效 Esc：打开/关闭设置面板） */
  onSettings(): void;
}

/** 构建触屏动作按钮（双模式共用；事件绑定由各控制器自行完成） */
export function createTouchButton(kind: string, labelKey: string, glyph: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = `tbtn-${kind}`;
  btn.className = 'tbtn';
  btn.type = 'button';
  btn.setAttribute('aria-label', t(labelKey)); // 无障碍标签（图标为字形符号，语义走 aria/title）
  btn.title = t(labelKey);
  btn.textContent = glyph;
  return btn;
}

export class StickControls implements TouchController {
  private readonly root: HTMLDivElement;
  private readonly stickLBase: HTMLDivElement;
  private readonly stickLKnob: HTMLDivElement;
  private readonly stickRBase: HTMLDivElement;
  private readonly stickRKnob: HTMLDivElement;
  private readonly fireBtn: HTMLButtonElement;
  private readonly reloadBtn: HTMLButtonElement;
  private readonly switchBtn: HTMLButtonElement;
  private readonly settingsBtn: HTMLButtonElement;

  private moveId: number | null = null;
  private aimId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private aimOrigin = { x: 0, y: 0 };
  private moveVec = { x: 0, y: 0 };
  /** 瞄准方向（屏幕坐标，y 向下为正 = 世界坐标同向）；松开右摇杆后保持，供持续瞄准 */
  private aimDir = { x: 0, y: -1 };
  private firing = false;
  private firePressedEdge = false;
  private reloadEdge = false;
  private switchEdge = false;

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return; // 桌面鼠标/触控板不受影响
    if (Input.isGameInputBlocked()) return;
    const target = e.target;
    if (target instanceof Element && target.closest('button, #settings, #settlement, #waitroom, #lobby')) {
      return; // 按钮与 UI 自行处理（按钮不触发摇杆）
    }
    e.preventDefault(); // 阻止 iOS 双击缩放/长按选择等兼容行为
    const half = window.innerWidth * 0.45;
    if (e.clientX <= half && this.moveId === null) {
      this.moveId = e.pointerId;
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.showStick(this.stickLBase, this.stickLKnob, e.clientX, e.clientY, 0, 0);
    } else if (e.clientX > half && this.aimId === null) {
      this.aimId = e.pointerId;
      this.aimOrigin = { x: e.clientX, y: e.clientY };
      this.showStick(this.stickRBase, this.stickRKnob, e.clientX, e.clientY, 0, 0);
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      const v = stickVector(e.clientX - this.moveOrigin.x, e.clientY - this.moveOrigin.y, STICK_RADIUS, STICK_DEADZONE);
      this.moveVec = v;
      this.moveKnob(v);
    } else if (e.pointerId === this.aimId) {
      const dx = e.clientX - this.aimOrigin.x;
      const dy = e.clientY - this.aimOrigin.y;
      const v = stickVector(dx, dy, STICK_RADIUS, STICK_DEADZONE);
      // 旋钮视觉与左摇杆同规则：钳制到基座半径内（此前用原始位移会画出基座外，体检修复批次 3）
      this.moveKnobV(this.stickRKnob, v.x * STICK_RADIUS, v.y * STICK_RADIUS);
      if (v.x !== 0 || v.y !== 0) this.aimDir = { x: dx, y: dy }; // 方向取原始位移（含幅度无关归一化在消费端做）
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.moveVec = { x: 0, y: 0 };
      this.stickLBase.classList.add('hidden');
    } else if (e.pointerId === this.aimId) {
      this.aimId = null;
      this.stickRBase.classList.add('hidden'); // aimDir 保持，松手继续瞄准原方向
    }
  };

  private readonly onBlur = (): void => {
    this.moveId = null;
    this.aimId = null;
    this.moveVec = { x: 0, y: 0 };
    this.firing = false;
    this.stickLBase.classList.add('hidden');
    this.stickRBase.classList.add('hidden');
  };

  /** iOS 手势加固（双指缩放/捏合拦截），destroy 时成对移除 */
  private readonly uninstallGuards: () => void;

  constructor(private readonly callbacks: TouchCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'touchControls';
    this.stickLBase = this.makeStick('stickL');
    this.stickLKnob = this.stickLBase.querySelector('.knob')!;
    this.stickRBase = this.makeStick('stickR');
    this.stickRKnob = this.stickRBase.querySelector('.knob')!;
    this.fireBtn = this.makeButton('fire', 'touch.fire', '●');
    this.reloadBtn = this.makeButton('reload', 'touch.reload', '↻');
    this.switchBtn = this.makeButton('switch', 'touch.switch', '⇄');
    this.settingsBtn = this.makeButton('settings', 'touch.settings', '⚙');
    this.root.append(this.stickLBase, this.stickRBase, this.fireBtn, this.reloadBtn, this.switchBtn, this.settingsBtn);
    document.body.appendChild(this.root);
    if (isTouchDevice()) document.body.classList.add('touch');
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('blur', this.onBlur);
    this.uninstallGuards = installGestureGuards();
  }

  /** 取走本帧触屏指令（边缘标志一次性复位；moveX/moveY/firing 为持续状态）。
   *  stick 模式无方向键，不做双击滑铲（dash 恒 null，FR-C7 仅 pad 模式支持） */
  consume(): TouchCommand {
    const cmd: TouchCommand = {
      moveX: this.moveVec.x,
      moveY: this.moveVec.y,
      firing: this.firing,
      firePressed: this.firePressedEdge,
      reload: this.reloadEdge,
      switchNext: this.switchEdge,
      dash: null,
    };
    this.firePressedEdge = false;
    this.reloadEdge = false;
    this.switchEdge = false;
    return cmd;
  }

  /** 本帧触屏瞄准：右摇杆方向（长度 1，世界坐标 y 向下为正；默认朝上） */
  getAim(): TouchAim {
    const dir = this.getAimDir();
    return { kind: 'dir', x: dir.x, y: dir.y };
  }

  /** 当前瞄准方向（世界坐标同向，y 向下为正）；恒非 null（默认朝上） */
  getAimDir(): { x: number; y: number } {
    const len = Math.hypot(this.aimDir.x, this.aimDir.y);
    return len > 0 ? { x: this.aimDir.x / len, y: this.aimDir.y / len } : { x: 0, y: -1 };
  }

  /** 释放事件监听并移除 DOM（对局销毁时调用，防重复进局叠加） */
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

  // ---------- DOM 构建 ----------

  private makeStick(kind: 'stickL' | 'stickR'): HTMLDivElement {
    const base = document.createElement('div');
    base.id = kind;
    base.className = 'stickBase hidden';
    const knob = document.createElement('div');
    knob.className = 'knob';
    base.appendChild(knob);
    return base;
  }

  private makeButton(kind: string, labelKey: string, glyph: string): HTMLButtonElement {
    const btn = createTouchButton(kind, labelKey, glyph);
    this.bindButton(btn, kind);
    return btn;
  }

  /** 按钮：pointerdown 置位（开火还产生按下沿），pointerup/leave 复位；面板打开期间忽略 */
  private bindButton(btn: HTMLButtonElement, kind: string): void {
    const blocked = (): boolean => Input.isGameInputBlocked();
    const down = (e: PointerEvent): void => {
      if (blocked()) return;
      e.preventDefault();
      e.stopPropagation(); // 不触发窗口级摇杆逻辑
      btn.classList.add('active');
      if (kind === 'fire') {
        this.firing = true;
        this.firePressedEdge = true;
      } else if (kind === 'reload') this.reloadEdge = true;
      else if (kind === 'switch') this.switchEdge = true;
      else if (kind === 'settings') this.callbacks.onSettings();
    };
    const up = (): void => {
      btn.classList.remove('active');
      if (kind === 'fire') this.firing = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
  }

  private showStick(base: HTMLDivElement, knob: HTMLDivElement, x: number, y: number, kx: number, ky: number): void {
    base.style.left = `${x}px`;
    base.style.top = `${y}px`;
    knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    base.classList.remove('hidden');
  }

  private moveKnob(v: { x: number; y: number }): void {
    this.moveKnobV(this.stickLKnob, v.x * STICK_RADIUS, v.y * STICK_RADIUS);
  }

  private moveKnobV(knob: HTMLDivElement, dx: number, dy: number): void {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}

