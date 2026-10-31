/** 双击方向键检测（FR-C7 滑铲，v0.4.1）：同一方向键在 DASH_DOUBLE_TAP_MS 内两次按下（中间抬起）
 *  视为一次滑铲意图。零依赖纯逻辑，可单测（scripts/unit-check.ts）。
 *  键盘与触屏 D-pad 共用：键盘传 e.code，触屏传方向名。 */

/** 双击判定窗口（毫秒）：两次按下间隔小于该值触发滑铲 */
export const DASH_DOUBLE_TAP_MS = 250;

export class DoubleTapTracker {
  /** 各标识最近一次「有效按下」的时刻（performance.now() 毫秒） */
  private readonly lastPressAt = new Map<string, number>();

  /**
   * 记录一次按下并判定是否构成双击。
   * @param id 按键/方向标识（同一标识内比较）
   * @param now 当前毫秒时间戳
   * @param isRepeat 是否为按住不放的自动重复事件（OS key repeat）——重复事件不参与双击判定
   * @returns true = 构成双击（应触发滑铲）；触发后该标识计时复位，三连击不会连续触发两次
   */
  press(id: string, now: number, isRepeat = false): boolean {
    if (isRepeat) return false;
    const last = this.lastPressAt.get(id);
    this.lastPressAt.set(id, now);
    if (last !== undefined && now - last <= DASH_DOUBLE_TAP_MS) {
      this.lastPressAt.delete(id); // 触发后复位：三连击只算一次，第三次重新起算
      return true;
    }
    return false;
  }

  /** 清空全部计时（对局销毁/失焦时调用，防跨局残留触发） */
  reset(): void {
    this.lastPressAt.clear();
  }
}
