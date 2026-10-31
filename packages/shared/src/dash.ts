/** 滑铲（FR-C7）分阶段速度剖面：助跑加速 → 匀速滑行 → 减速到停。
 *  服务端权威推进与客户端预测共用同一解析函数（与步长无关 → 两端累计位移一致），
 *  实际位移 = DASH_DISTANCE × dashProgress(elapsed)。 */

import { DASH_DECEL_TIME, DASH_GLIDE_TIME, DASH_RAMP_TIME, DASH_TOTAL_TIME } from './constants';

/** 归一化峰值速度下的「面积」（三段位移积分之和）：把累计位移归一到 0..1 */
const PROFILE_AREA = DASH_RAMP_TIME / 2 + DASH_GLIDE_TIME + DASH_DECEL_TIME / 2;

/** 滑铲速度倍率（0..1，相对峰值速度）：助跑段线性加速 → 滑行段恒定 1 → 减速段线性归零。
 *  仅表现/测试用（位移走 dashProgress 的解析积分） */
export function dashSpeed(elapsed: number): number {
  if (!(elapsed > 0) || elapsed >= DASH_TOTAL_TIME) return 0;
  if (elapsed < DASH_RAMP_TIME) return elapsed / DASH_RAMP_TIME;
  if (elapsed < DASH_RAMP_TIME + DASH_GLIDE_TIME) return 1;
  return 1 - (elapsed - DASH_RAMP_TIME - DASH_GLIDE_TIME) / DASH_DECEL_TIME;
}

/** 滑铲累计位移比例（0..1）：速度剖面的解析积分（不依赖调用步长，
 *  服务端 30Hz tick 与客户端 60fps 预测在同一 elapsed 下得到同一比例） */
export function dashProgress(elapsed: number): number {
  if (!(elapsed > 0)) return 0;
  if (elapsed >= DASH_TOTAL_TIME) return 1;
  let dist: number;
  if (elapsed < DASH_RAMP_TIME) {
    // 助跑段速度 v = t/ramp → 位移 t²/(2·ramp)
    dist = (elapsed * elapsed) / (2 * DASH_RAMP_TIME);
  } else if (elapsed < DASH_RAMP_TIME + DASH_GLIDE_TIME) {
    dist = DASH_RAMP_TIME / 2 + (elapsed - DASH_RAMP_TIME);
  } else {
    // 减速段速度 v = 1 − t3/decel → 位移 t3 − t3²/(2·decel)
    const t3 = elapsed - DASH_RAMP_TIME - DASH_GLIDE_TIME;
    dist = DASH_RAMP_TIME / 2 + DASH_GLIDE_TIME + (t3 - (t3 * t3) / (2 * DASH_DECEL_TIME));
  }
  return Math.min(1, dist / PROFILE_AREA);
}