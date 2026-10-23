/** 键鼠输入：WASD 移动、鼠标瞄准、开火（含按下沿）、换弹/切枪指令（FR-C1/C2、FR-W3、FR-U1 准星跟随）
 *  以及冲锋枪彩蛋口令缓冲（FR-E1：数字键依次输入 + Enter 上报，口令不含 1~6 不与切枪热键冲突） */

import { CHEAT_RUSH_CODE, WEAPON_ORDER, type WeaponId } from '@DoShoot/shared';

/** 一帧内的输入指令（消费型：consumeCommands 读取后一次性标志复位） */
export interface InputCommand {
  moveX: number;
  moveY: number;
  firing: boolean;
  /** 本帧内左键按下沿（semi/pump 武器用） */
  firePressed: boolean;
  reload: boolean;
  switchTo: WeaponId | null;
  /** 滚轮步数（向下为正） */
  wheel: number;
  /** 本帧内输入了正确的冲锋枪彩蛋口令并按下 Enter（FR-E1，边缘触发） */
  cheatRush: boolean;
}

export class Input {
  firing = false;
  mouseNdcX = 0;
  mouseNdcY = 0;
  /** 屏幕像素坐标（动态准星定位用） */
  mouseClientX = window.innerWidth / 2;
  mouseClientY = window.innerHeight / 2;

  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private firePressedEdge = false;
  private reloadEdge = false;
  private switchRequest: WeaponId | null = null;
  private wheelSteps = 0;
  /** 彩蛋口令数字缓冲（FR-E1）：记录最近按下的数字，Enter 时整体比对；超时/回车/失焦清空 */
  private codeBuffer = '';
  private codeBufferAt = 0;
  private cheatRushEdge = false;
  /** 口令输入超时（毫秒）：间隔过久的数字不视为同一次输入 */
  private static CODE_BUFFER_TIMEOUT_MS = 3000;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyR') this.reloadEdge = true;
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= WEAPON_ORDER.length) this.switchRequest = WEAPON_ORDER[n - 1]!;
    }
    // 彩蛋口令缓冲（FR-E1）：主键盘 + 小键盘数字均入缓冲；口令 7890 不含 1~6，不影响上方切枪
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (digit) {
      if (performance.now() - this.codeBufferAt > Input.CODE_BUFFER_TIMEOUT_MS) this.codeBuffer = '';
      this.codeBuffer = (this.codeBuffer + digit[1]).slice(-8);
      this.codeBufferAt = performance.now();
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (this.codeBuffer === CHEAT_RUSH_CODE) this.cheatRushEdge = true;
      this.codeBuffer = '';
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseClientX = e.clientX;
    this.mouseClientY = e.clientY;
    this.mouseNdcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseNdcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
  };

  /** UI 面板（设置/结算）上的点击与滚轮不应触发开火/切枪（面板是 pointer-events:auto 的 DOM 覆盖层） */
  private static isUiTarget(e: Event): boolean {
    return e.target instanceof Element && e.target.closest('#settings, #settlement') !== null;
  }

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (Input.isUiTarget(e)) return;
    if (e.button === 0) {
      this.firing = true;
      this.firePressedEdge = true;
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.firing = false;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (Input.isUiTarget(e)) return;
    this.wheelSteps += e.deltaY > 0 ? 1 : -1;
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.firing = false;
    this.codeBuffer = '';
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  /** 移除全部全局监听（对局销毁时调用，防止重复进局后监听器叠加） */
  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
  }

  /** WASD 八方向移动向量（已归一化） */
  getMoveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
  }

  /** 取走本帧指令并复位一次性标志 */
  consumeCommands(): InputCommand {
    const mv = this.getMoveVector();
    const cmd: InputCommand = {
      moveX: mv.x,
      moveY: mv.y,
      firing: this.firing,
      firePressed: this.firePressedEdge,
      reload: this.reloadEdge,
      switchTo: this.switchRequest,
      wheel: this.wheelSteps,
      cheatRush: this.cheatRushEdge,
    };
    this.firePressedEdge = false;
    this.reloadEdge = false;
    this.switchRequest = null;
    this.wheelSteps = 0;
    this.cheatRushEdge = false;
    return cmd;
  }
}