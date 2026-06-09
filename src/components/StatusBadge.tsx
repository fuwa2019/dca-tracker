import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'night' | 'neutral';

const tones: Record<StatusTone, string> = {
  ok: 'bg-gain-soft',
  warn: 'bg-warn-soft',
  bad: 'bg-loss-soft',
  info: 'bg-brand-soft',
  night: 'bg-night-soft',
  neutral: 'bg-surface-elevated text-muted-foreground',
};

interface Props {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}

export function StatusBadge({ tone = 'neutral', children, className, dot }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80"
        />
      )}
      {children}
    </span>
  );
}
