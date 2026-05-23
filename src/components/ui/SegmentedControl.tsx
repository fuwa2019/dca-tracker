import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: 'sm' | 'md';
  /** Optional layoutId namespace — set if multiple SegmentedControls share the same DOM tree. */
  name?: string;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  name,
  className,
  ariaLabel,
}: Props<T>) {
  const layoutId = `seg-${name ?? options.map((o) => o.value).join('-')}`;
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex rounded-lg border border-border bg-surface-elevated p-1 text-xs',
        size === 'md' && 'text-sm',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 flex min-w-[3.25rem] items-center justify-center rounded-md font-medium transition-colors whitespace-nowrap',
              size === 'sm' ? 'h-7 px-3' : 'h-8 px-3.5',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-md bg-surface shadow-sm ring-1 ring-border"
                transition={{ type: 'spring', damping: 30, stiffness: 360 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
