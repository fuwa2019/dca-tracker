import { motion } from 'framer-motion';
import { usd0 } from '@/lib/format';

interface Props {
  current: number;
  target: number;
  monthsToTarget: number | null;
  size?: number;
  strokeWidth?: number;
}

export function TargetProgressRing({ current, target, monthsToTarget, size = 220, strokeWidth = 14 }: Props) {
  const progress = target > 0 ? Math.min(1, current / target) : 0;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const yrs = monthsToTarget !== null && monthsToTarget > 0 ? Math.floor(monthsToTarget / 12) : 0;
  const mos = monthsToTarget !== null && monthsToTarget > 0 ? Math.round(monthsToTarget % 12) : 0;

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="stroke-foreground"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - progress) }}
          transition={{ type: 'spring', damping: 28, stiffness: 80, mass: 1 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <span className="text-xs text-muted-foreground">距离目标</span>
        <span className="mt-1 text-3xl font-semibold tracking-tight tnum">
          {monthsToTarget === null ? '—' : monthsToTarget <= 0 ? '已达成 🎉' : `${yrs}年${mos}月`}
        </span>
        <span className="mt-2 text-xs text-muted-foreground tnum">
          {usd0.format(current)} / {usd0.format(target)}
        </span>
        <span className="mt-0.5 text-xs text-muted-foreground tnum">{(progress * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
