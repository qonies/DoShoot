/** 触屏虚拟摇杆纯数学（FR-U6）：零依赖、无 DOM 访问，供 unit 单测与 touch.ts 同源消费。
 *  屏幕坐标约定：x 向右为正、y 向下为正（与触屏/世界坐标一致，见 touch.ts） */

/** 摇杆输出向量：已按半径归一化（|v| ≤ 1），死区内为零向量 */
export interface StickVector {
  x: number;
  y: number;
}

/** 触点位移 → 摇杆向量：钳制到半径内、归一化、死区内归零。
 *  半径/死区单位为像素（基座半径与视觉一致） */
export function stickVector(dx: number, dy: number, radius: number, deadzone: number): StickVector {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (!(len > deadzone)) return { x: 0, y: 0 };
  const clamped = Math.min(len, radius);
  // 死区边缘从 0 平滑起步（(len-deadzone)/(radius-deadzone)），避免越过死区瞬间满速抖动
  const mag = Math.min(1, (clamped - deadzone) / Math.max(1e-6, radius - deadzone));
  return { x: (dx / len) * mag, y: (dy / len) * mag };
}

/** 触屏设备判定：粗指针（手机/平板）或存在触摸面。
 *  iPadOS 桌面模式 UA 伪装成 macOS，但 matchMedia('(pointer: coarse)') 仍按触屏上报；
 *  触屏笔记本/带触摸屏的桌面机（hover:hover + pointer:fine）不判为触屏端——
 *  否则会误显示虚拟摇杆/按钮并替换操作提示（体检修复批次 3 收紧，保持桌面端零影响） */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (window.matchMedia('(pointer: coarse)').matches) return true;
  return (
    'ontouchstart' in window &&
    typeof navigator !== 'undefined' &&
    navigator.maxTouchPoints > 0 &&
    !window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

// ---------- D-pad + 点击射击模式（FR-U6 pad 模式，v0.3.8） ----------

/** D-pad 方向键合成：四向布尔 → 归一化移动向量（斜向模长 1）；对向同按抵消为 0。
 *  坐标约定与 stickVector 一致：x 向右、y 向下为正（世界坐标同向） */
export function dpadVector(up: boolean, down: boolean, left: boolean, right: boolean): StickVector {
  const x = (right ? 1 : 0) - (left ? 1 : 0);
  const y = (down ? 1 : 0) - (up ? 1 : 0);
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/** 客户端像素坐标 → NDC（canvas 满窗 100vw/100dvh：x = cx/W*2-1，y = 1 - cy/H*2）。
 *  供 pad 模式把点击位置换算后经 GameScene.screenToGround 投到世界地面点 */
export function clientToNdc(cx: number, cy: number, width: number, height: number): StickVector {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  return { x: (cx / width) * 2 - 1, y: 1 - (cy / height) * 2 };
}