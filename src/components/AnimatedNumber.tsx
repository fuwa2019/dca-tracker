import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';

interface Props {
  value: number;
  format?: (v: number) => string;
  className?: string;
  duration?: number;
  /** 相对变化小于该比例时直接跳到目标值,不播放动画(默认 0.5%)。 */
  animateThreshold?: number;
}

/** Spring-animated numeric display. Uses tabular-nums to avoid layout shift. */
export function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  className,
  duration = 0.6,
  animateThreshold = 0.005,
}: Props) {
  const reduceMotion = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (latest) => format(latest));
  const prev = useRef(value);
  const mounted = useRef(false);

  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    // 行情每次轮询都会微调 NAV;变化很小就直接 snap,
    // 避免每次重放动画(动画期间逐帧 setState 很贵)。
    const rel = Math.abs(value - from) / Math.max(Math.abs(from), Math.abs(value), 1);
    // 数字滚动是 JS 驱动的,CSS 的 reduced-motion 降级管不到它,这里显式跳到目标值。
    if (reduceMotion) {
      mounted.current = true;
      mv.set(value);
      return;
    }
    if (mounted.current && rel < animateThreshold) {
      mv.set(value);
      return;
    }
    mounted.current = true;
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return controls.stop;
  }, [mv, value, duration, animateThreshold, reduceMotion]);

  // Render a string motion value via state subscription
  const [display, setDisplay] = useState(format(value));
  useEffect(() => text.on('change', setDisplay), [text]);

  return (
    <motion.span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {display}
    </motion.span>
  );
}
