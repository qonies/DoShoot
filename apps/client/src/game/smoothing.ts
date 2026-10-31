/** 和解修正/滑铲的表现层平滑纯函数（v0.4.2 画面平滑优化）：零依赖、可单测（scripts/unit-check.ts）。
 *  物理位置仍以「本地预测 + 服务端权威和解」为准；本模块只决定「表现层要不要把某次位移
 *  平滑掉」——快照和解的 28Hz 阶跃修正被转成衰减偏移，相机/角色网格连续追上，消除画面抖动。 */

/** 和解修正量超过该距离（世界单位）视为「瞬移」（重生/换图等），不做平滑直接对齐。
 *  取值需远大于正常和解修正量（实测平均 0.075、最大 0.32 单位），又远小于跨图传送距离 */
export const CORRECTION_SMOOTH_MAX = 1.5;

/**
 * 快照和解修正量 (dx, dy)（权威对齐后的位置差）是否为「可平滑的普通修正」：
 * true = 走表现层衰减偏移（视觉连续追上）；false = 视为瞬移（直接对齐，不平滑）。
 * 非有限值（异常快照）一律不平滑（防御）。
 */
export function isSmoothableCorrection(dx: number, dy: number, maxDist: number): boolean {
  return Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) < maxDist;
}

/**
 * 帧率无关的指数衰减系数：每帧 `value *= decayFactor(dt, tau)`，
 * 约 3 个 tau 后残差 <5%（tau=0.05 → ~0.15s 内平滑追上）。dt=0 时不衰减（返回 1）。
 */
export function decayFactor(dt: number, tau: number): number {
  if (!(tau > 0)) return 0; // tau 非法 → 立即对齐
  if (!(dt > 0)) return 1; // 本帧无时间流逝 → 保持不变
  return Math.exp(-dt / tau);
}
