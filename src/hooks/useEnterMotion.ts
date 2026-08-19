import { useCallback } from 'react';
import { useReducedMotion } from 'framer-motion';
import { enterMotionProps } from '@/lib/motionPrefs';

/**
 * 返回一个把 `initial` / `transition` 组装好的辅助函数:
 * `<motion.div {...enter({ opacity: 0, y: 4 }, { delay: i * 0.02 })} animate={...} />`
 * 系统开启 reduced motion 时,入场动画与排队延迟一起被取消。
 */
export function useEnterMotion() {
  const reduceMotion = useReducedMotion() === true;
  return useCallback(
    <I, T>(initial: I, transition: T) => enterMotionProps(reduceMotion, initial, transition),
    [reduceMotion],
  );
}
