import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import { ArrowLeftRight, Plus, Activity, Briefcase, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HistoryPoint } from '@/lib/calc/history';
import { signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';

const SPARK_POINTS = 220;

/** Down-sampled return series for compact charts. */
export function useSparkRows(history: HistoryPoint[]) {
  return useMemo(() => {
    if (history.length === 0) return [] as { date: string; value: number }[];
    const step = Math.max(1, Math.floor(history.length / SPARK_POINTS));
    const out: { date: string; value: number }[] = [];
    for (let i = 0; i < history.length; i += step) {
      out.push({ date: history[i].date, value: history[i].returnPctUser * 100 });
    }
    const last = history[history.length - 1];
    if (out[out.length - 1]?.date !== last.date) {
      out.push({ date: last.date, value: last.returnPctUser * 100 });
    }
    return out;
  }, [history]);
}

/** Area spark with a left-to-right "draw" reveal. `colorVar` is a CSS var name. */
export function EquitySpark({
  history,
  colorVar = 'var(--brand)',
  height = 220,
  gradientId = 'spark-fill',
}: {
  history: HistoryPoint[];
  colorVar?: string;
  height?: number;
  gradientId?: string;
}) {
  const rows = useSparkRows(history);
  if (rows.length < 2) {
    return (
      <div
        className="flex items-center justify-center px-4 text-xs text-muted-foreground"
        style={{ height }}
      >
        <TrendingUp className="mr-2 h-4 w-4 opacity-60" />
        曲线数据待生成
      </div>
    );
  }
  return (
    <div className="relative px-1" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 6, left: 6, bottom: 6 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`hsl(${colorVar})`} stopOpacity={0.34} />
              <stop offset="100%" stopColor={`hsl(${colorVar})`} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--crosshair))', strokeDasharray: '3 3' }}
            content={({ active, payload }) =>
              active && payload && payload[0]?.payload ? (
                <div className="font-num rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow">
                  <div className="text-muted-foreground">{payload[0].payload.date}</div>
                  <div className={cn('font-semibold', changeColor(payload[0].payload.value))}>
                    {signedPct(payload[0].payload.value / 100)}
                  </div>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={`hsl(${colorVar})`}
            strokeWidth={2.2}
            fill={`url(#${gradientId})`}
            isAnimationActive
            animationDuration={1400}
            animationEasing="ease-in-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export { Kicker } from '@/components/Kicker';

export function QuickActions({ accentClass }: { accentClass?: string }) {
  const actions = [
    { to: '/transactions', label: '添加交易', short: '交易', icon: Plus },
    { to: '/cashflows', label: '记一笔入金', short: '入金', icon: ArrowLeftRight },
    { to: '/health', label: '数据健康', short: '健康', icon: Activity },
  ];
  return (
    <Card className="p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {actions.map(({ to, label, short, icon: Icon }) => (
          <Button key={to} asChild variant="ghost" className="h-12 justify-start text-xs sm:text-sm">
            <Link to={to} className="whitespace-nowrap">
              <Icon className={cn('h-4 w-4 shrink-0 text-muted-foreground', accentClass)} />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </Link>
          </Button>
        ))}
      </div>
    </Card>
  );
}

export function EmptyDashboard() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand"
      >
        <Briefcase className="h-6 w-6" />
      </motion.div>
      <div className="text-center space-y-1">
        <h2 className="text-lg font-semibold">还没有任何数据</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          先录入一笔入金（CNY → USD），再录一笔买入交易，业绩曲线和持仓就会自动出现。
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link to="/cashflows">
            <ArrowLeftRight className="h-3.5 w-3.5" /> 添加入金
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/transactions">
            <Plus className="h-3.5 w-3.5" /> 添加交易
          </Link>
        </Button>
      </div>
    </div>
  );
}
