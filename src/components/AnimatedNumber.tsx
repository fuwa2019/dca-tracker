import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'framer-motion';

interface Props {
  value: number;
  format?: (v: number) => string;
  className?: string;
  duration?: number;
}

/** Spring-animated numeric display. Uses tabular-nums to avoid layout shift. */
export function AnimatedNumber({ value, format = (v) => v.toFixed(2), className, duration = 0.6 }: Props) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (latest) => format(latest));
  const prev = useRef(value);

  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    prev.current = value;
    return controls.stop;
  }, [mv, value, duration]);

  // Render a string motion value via state subscription
  const [display, setDisplay] = useState(format(value));
  useEffect(() => text.on('change', setDisplay), [text]);

  return (
    <motion.span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {display}
    </motion.span>
  );
}
