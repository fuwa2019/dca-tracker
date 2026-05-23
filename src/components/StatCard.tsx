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
      className="rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {trailing}
      </div>
      <div
        className={cn(
          'mt-2 text-[26px] font-semibold leading-tight tnum',
          toneClass[tone],
          className,
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs text-muted-foreground tnum">{sub}</div>
      )}
    </motion.div>
  );
}
