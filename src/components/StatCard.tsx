import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Props {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  delay?: number;
}

export function StatCard({ label, value, sub, className, delay = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', damping: 25, stiffness: 200 }}
    >
      <Card className={cn('p-4', className)}>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight tnum">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground tnum">{sub}</div>}
      </Card>
    </motion.div>
  );
}
