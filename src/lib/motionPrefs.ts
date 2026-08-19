/**
 * 入场动画的 reduced-motion 降级规则(纯函数,不依赖 React/framer)。
 *
 * CSS 的 `@media (prefers-reduced-motion: reduce)` 只能压掉 CSS 过渡与关键帧;
 * framer 与 Recharts 自己驱动时间线,必须在应用侧显式降级。
 * `MotionConfig reducedMotion="user"` 会让位移/缩放直接落到目标值,但仍然保留
 * `delay`——列表因此变成逐行"跳"入。开启 reduced motion 时这里直接取消入场
 * (initial=false)并把时长归零,元素以最终状态一次性呈现。
 */
export interface ReducedEnterMotion {
  initial: false;
  transition: { duration: 0 };
}

export interface FullEnterMotion<I, T> {
  initial: I;
  transition: T;
}

export function enterMotionProps<I, T>(
  reduceMotion: boolean,
  initial: I,
  transition: T,
): ReducedEnterMotion | FullEnterMotion<I, T> {
  if (reduceMotion) return { initial: false, transition: { duration: 0 } };
  return { initial, transition };
}
