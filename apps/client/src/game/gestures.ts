/** iOS 手势加固（FR-U6，触屏双模式共用）：对局中禁双指缩放 / 双击放大 / 捏合手势。
 *  背景：iOS Safari 10+ 出于无障碍策略忽略 `user-scalable=no`，且 `touch-action: none`
 *  仅覆盖 #hud/.tbtn——双指落在 #game（touch-action:auto）仍会触发页面 pinch-zoom。
 *  这里在 window 层拦截（两个触屏控制器构造时安装、destroy 时成对移除）：
 *  - 双指及以上 touchstart/touchmove 一律 preventDefault（单指滚动面板不受影响）
 *  - gesturestart/change/end 全部 preventDefault（Safari 私有捏合事件）
 *  返回卸载函数。 */

export function installGestureGuards(): () => void {
  const multi = (e: TouchEvent): void => {
    if (e.touches.length > 1) e.preventDefault();
  };
  const gesture = (e: Event): void => e.preventDefault();
  window.addEventListener('touchstart', multi, { passive: false });
  window.addEventListener('touchmove', multi, { passive: false });
  window.addEventListener('gesturestart', gesture);
  window.addEventListener('gesturechange', gesture);
  window.addEventListener('gestureend', gesture);
  return () => {
    window.removeEventListener('touchstart', multi);
    window.removeEventListener('touchmove', multi);
    window.removeEventListener('gesturestart', gesture);
    window.removeEventListener('gesturechange', gesture);
    window.removeEventListener('gestureend', gesture);
  };
}