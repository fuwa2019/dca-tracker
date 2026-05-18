import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface Props {
  value: 'avg' | 'fifo';
  onChange: (v: 'avg' | 'fifo') => void;
}

export function CostBasisToggle({ value, onChange }: Props) {
  return (
    <div className="relative inline-flex rounded-lg bg-muted p-1 text-xs">
      {(['avg', 'fifo'] as const).map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            'relative z-10 rounded-md px-3 py-1.5 font-medium transition-colors',
            value === opt ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {opt === 'avg' ? '平均成本' : 'FIFO'}
          {value === opt && (
            <motion.span
              layoutId="cost-basis-pill"
              className="absolute inset-0 -z-10 rounded-md bg-background shadow-sm"
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
