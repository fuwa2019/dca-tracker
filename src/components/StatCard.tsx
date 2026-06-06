import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'gain' | 'loss' | 'muted';

interface Props {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  tone?: Tone;
  /** Override tone classes — used when callers already compute changeColor(...). */
  className?: string;
  delay?: number;
}

const toneClass: Record<Tone, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  gain: 'text-gain',
  loss: 'text-loss',
};

export function StatCard({ label, value, sub, trailing, tone = 'default', className, delay = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', damping: 26, stiffness: 220 }}
      className="surface-card rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </div>
        {trailing}
      </div>
      <div
        className={cn(
          'font-num mt-2.5 text-[27px] font-semibold leading-none',
          toneClass[tone],
          className,
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="font-num mt-1.5 text-xs text-muted-foreground">{sub}</div>
      )}
    </motion.div>
  );
}
