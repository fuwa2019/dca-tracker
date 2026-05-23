import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PerformancePanel } from '@/components/IbkrPerformancePanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { EmptyState } from '@/components/EmptyState';
import { supabase } from '@/lib/supabase';
import { pct, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { availableRanges, type HistoryPoint, type RangeKey } from '@/lib/calc/history';
import type { PerformanceHistory, SharedPortfolio, SharedHistory } from '@/lib/database.types';

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const shareToken = isValidShareToken(token) ? token : null;
  const [range, setRange] = useState<RangeKey>('ALL');
  const [showBenchmark, setShowBenchmark] = useState(true);

  const portfolio = useQuery({
    queryKey: ['share', 'portfolio', shareToken],
    queryFn: async () => {
      if (!shareToken) throw new Error('invalid_token');
      const { data, error } = await supabase.rpc('shared_portfolio', { p_token: shareToken });
      if (error) throw error;
      return data as SharedPortfolio | { error: string };
    },
    enabled: !!shareToken,
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });

  const historyQuery = useQuery({
    queryKey: ['share', 'history', shareToken],
    queryFn: async () => {
      if (!shareToken) throw new Error('invalid_token');
      const performance = await supabase.rpc('shared_performance_history', { p_token: shareToken });
      if (!performance.error) return performance.data as PerformanceHistory | { error: string };
      if (!isMissingRpc(performance.error)) throw performance.error;

      const legacy = await supabase.rpc('shared_history', { p_token: shareToken });
      if (legacy.error) throw legacy.error;
      return legacy.data as SharedHistory | { error: string };
    },
    enabled: !!shareToken,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
  });

  const history: HistoryPoint[] = useMemo(() => {
    const raw = historyQuery.data;
    if (!raw || 'error' in raw) return [];
    const series = Array.isArray(raw.series) ? raw.series : [];
    return series
      .map((p) => ({
        date: normalizeDate(p.date),
        returnPctUser: toFiniteNumber(p.return_pct_user),
        returnPctSpy: toFiniteNumber(p.return_pct_spy),
      }))
      .filter(
        (p): p is { date: string; returnPctUser: number; returnPctSpy: number } =>
          isIsoDate(p.date) && p.returnPctUser !== null && p.returnPctSpy !== null,
      )
      .map((p) => ({
        date: p.date,
        invested: 0,
        costBasis: 0,
        navUser: 0,
        navSpy: 0,
        returnPctUser: p.returnPctUser,
        returnPctSpy: p.returnPctSpy,
        pnlUser: 0,
        pnlSpy: 0,
        txns: [],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [historyQuery.data]);

  const ranges = useMemo(() => availableRanges(history), [history]);
  const effectiveRange = ranges.includes(range) ? range : (ranges[ranges.length - 1] ?? 'ALL');

  if (!shareToken) return <Centered>分享链接无效或已过期</Centered>;
  if (portfolio.isLoading) return <Centered>加载中…</Centered>;
  if (portfolio.error) return <Centered>加载失败，请稍后再试</Centered>;
  const data = portfolio.data;
  if (!data || 'error' in data) return <Centered>分享链接无效或已过期</Centered>;

  const last = history[history.length - 1];
  const portfolioReturn = last?.returnPctUser ?? 0;
  const spyReturn = last?.returnPctSpy ?? 0;
  const excess = Number.isFinite((1 + portfolioReturn) / (1 + spyReturn) - 1)
    ? (1 + portfolioReturn) / (1 + spyReturn) - 1
    : 0;
  const dateRange = last ? `${history[0].date} 至 ${last.date}` : '等待业绩缓存';

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="container max-w-[1200px] flex items-center gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">DCA Tracker · 只读分享</div>
            <div className="text-[11px] text-muted-foreground">仅显示比例与百分比，金额已隐藏</div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="container max-w-[1200px] space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        <Card className="overflow-hidden p-0">
          <div className={cn('grid gap-0', showBenchmark ? 'md:grid-cols-3' : 'md:grid-cols-1')}>
            <SummaryCell
              label="组合 TWR · 累计"
              value={last ? signedPct(portfolioReturn) : '—'}
              valueClass={cn(last ? changeColor(portfolioReturn) : 'text-muted-foreground', 'text-3xl')}
              sub={dateRange}
            />
            {showBenchmark && (
              <SummaryCell
                label="SPY · 同期"
                value={last ? signedPct(spyReturn) : '—'}
                valueClass={last ? changeColor(spyReturn) : 'text-muted-foreground'}
                sub="基准对照"
              />
            )}
            {showBenchmark && (
              <SummaryCell
                label="超额 vs SPY"
                value={last ? signedPct(excess) : '—'}
                valueClass={last ? changeColor(excess) : 'text-muted-foreground'}
                sub="(1+组合)/(1+SPY) − 1"
              />
            )}
          </div>
        </Card>

        <PerformancePanel
          history={history}
          range={effectiveRange}
          onRangeChange={setRange}
          availableRanges={ranges}
          showBenchmark={showBenchmark}
          onShowBenchmarkChange={setShowBenchmark}
          loading={historyQuery.isLoading}
          emptyMessage={
            historyQuery.error
              ? '历史数据加载失败，请刷新重试'
              : '暂无可公开展示的历史数据，请让分享者刷新业绩缓存。'
          }
        />

        <Card className="overflow-hidden p-0">
          <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-semibold">持仓权重</div>
              <div className="text-[11px] text-muted-foreground">{data.positions.length} 只 · 不显示具体股数与金额</div>
            </div>
          </div>
          {data.positions.length === 0 ? (
            <div className="px-4 py-6">
              <EmptyState icon={EyeOff} title="未公开持仓" description="分享者未启用持仓展示。" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {data.positions.map((p, i) => (
                <motion.div
                  key={p.ticker}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="w-14 shrink-0 font-semibold">{p.ticker}</div>
                  <div className="flex-1">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, p.weight_pct * 100)}%` }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 * i }}
                        className="h-full rounded-full bg-brand"
                      />
                    </div>
                  </div>
                  <div className="w-14 text-right text-xs text-muted-foreground tnum">
                    {pct(p.weight_pct, 1)}
                  </div>
                  <div className={cn('w-20 text-right font-medium tnum', changeColor(p.return_pct))}>
                    {signedPct(p.return_pct)}
                  </div>
                  <div className={cn('hidden w-20 text-right text-[11px] tnum sm:block', changeColor(p.day_change_pct ?? 0))}>
                    {p.day_change_pct !== null ? `${signedPct(p.day_change_pct)} 今日` : '—'}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-gain" />
            金额、入金、汇兑损耗、交易明细均不通过分享 API 暴露。
          </span>
          <span className="hidden text-[10px] sm:inline tnum">
            Generated {new Date(data.generated_at).toLocaleString('zh-CN', { hour12: false })}
          </span>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass: string;
  sub: string;
}) {
  return (
    <div className="border-t border-border px-5 py-5 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Eye className="h-3 w-3" />
        {label}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tnum', valueClass)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground tnum">{sub}</div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-brand-foreground text-sm font-bold">
      $
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-8 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function isValidShareToken(value: string | undefined): value is string {
  return /^[a-f0-9]{32}$/i.test(value ?? '');
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeDate(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 10);
  return '';
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}
