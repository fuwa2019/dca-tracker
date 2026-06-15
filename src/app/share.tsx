import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Activity,
  CalendarDays,
  Clock,
  EyeOff,
  LineChart,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PerformancePanel } from '@/components/IbkrPerformancePanel';
import { ThemeToggle } from '@/components/ThemeToggle';
import { EmptyState } from '@/components/EmptyState';
import { ExposureGauge } from '@/components/ExposureGauge';
import { supabase } from '@/lib/supabase';
import { pct, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { availableRanges, type HistoryPoint, type RangeKey } from '@/lib/calc/history';
import { computeLookThrough, type EtfHoldingsData } from '@/lib/calc/lookThrough';
import { MONITOR_LINES, SHOVEL_TICKERS } from '@/lib/calc/exposureConfig';
import etfHoldings from '@/data/etf-holdings.json';
import type { PerformanceHistory, SharedPortfolio, SharedHistory } from '@/lib/database.types';

const HOLDINGS = etfHoldings as unknown as EtfHoldingsData;
const SHOVEL_SET = new Set(SHOVEL_TICKERS.map((t) => t.toUpperCase()));

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const shareToken = isValidShareToken(token) ? token : null;
  const [range, setRange] = useState<RangeKey>('ALL');
  const showBenchmark = true;

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
        tradingDate: normalizeDate(p.trading_date ?? p.date),
        asOfTimestamp: p.as_of_timestamp ?? null,
        provisional: !!p.is_provisional,
        returnPctUser: toFiniteNumber(p.return_pct_user),
        returnPctSpy: toFiniteNumber(p.return_pct_spy),
      }))
      .filter(
        (p): p is {
          date: string;
          tradingDate: string;
          asOfTimestamp: string | null;
          provisional: boolean;
          returnPctUser: number;
          returnPctSpy: number;
        } =>
          isIsoDate(p.date) && p.returnPctUser !== null && p.returnPctSpy !== null,
      )
      .map((p) => ({
        date: p.date,
        tradingDate: p.tradingDate,
        asOfTimestamp: p.asOfTimestamp,
        provisional: p.provisional,
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

  // 脱敏穿透:仅用公开的持仓权重(%)推算,不涉及任何金额。
  const sharePositions = useMemo(() => {
    const d = portfolio.data;
    if (!d || 'error' in d) return [] as Array<{ ticker: string; value: number }>;
    return d.positions
      .filter((p) => Number.isFinite(p.weight_pct) && p.weight_pct > 0)
      .map((p) => ({ ticker: p.ticker, value: p.weight_pct }));
  }, [portfolio.data]);
  const lookThrough = useMemo(
    () => computeLookThrough({ holdings: sharePositions, data: HOLDINGS, lines: MONITOR_LINES }),
    [sharePositions],
  );
  const lookThroughTop = useMemo(() => lookThrough.stocks.slice(0, 10), [lookThrough.stocks]);
  const lookThroughMax = lookThroughTop[0]?.weightNav ?? 0.0001;

  if (!shareToken) return <Centered>分享链接无效或已过期</Centered>;
  if (portfolio.isLoading) return <Centered>加载中...</Centered>;
  if (portfolio.error) return <Centered>加载失败，请稍后再试</Centered>;
  const data = portfolio.data;
  if (!data || 'error' in data) return <Centered>分享链接无效或已过期</Centered>;

  const last = history[history.length - 1];
  const benchmark = historyQuery.data && !('error' in historyQuery.data)
    ? (historyQuery.data.benchmark ?? 'SPY')
    : 'SPY';
  const portfolioReturn = last?.returnPctUser ?? 0;
  const spyReturn = last?.returnPctSpy ?? 0;
  const excess = Number.isFinite((1 + portfolioReturn) / (1 + spyReturn) - 1)
    ? (1 + portfolioReturn) / (1 + spyReturn) - 1
    : 0;
  const dateRange = last ? `${history[0].date} 至 ${last.date}` : '等待业绩缓存';
  const rawHistory = historyQuery.data && !('error' in historyQuery.data) ? historyQuery.data : null;
  const usesTradingDays = rawHistory?.excluded_non_trading_days ?? rawHistory?.date_basis === 'benchmark_price_dates';
  const tradingCalendar = usesTradingDays ? benchmark : (rawHistory?.trading_calendar ?? benchmark);
  const generatedAt = rawHistory?.updated_at ?? rawHistory?.generated_at ?? data.generated_at;
  const hasSnapshotPrices = data.has_snapshot_price;
  const pointCount = history.length;
  const positionCount = data.positions.length;
  const hasProvisionalClose = !!last?.provisional;

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/95 lg:bg-background/80 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-background/75">
        <div className="container flex max-w-[1200px] items-center gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-semibold">DCA Tracker</div>
              <span className="hidden rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                只读分享
              </span>
            </div>
            <div className="truncate text-[11px] text-muted-foreground">仅显示比例、日期和权重，金额已隐藏</div>
          </div>
          <div className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            公开报告
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container max-w-[1200px] space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        <section className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="max-w-2xl">
            <div className="kicker">Public Performance Report</div>
            <h1 className="mt-0.5 font-serif text-2xl font-semibold tracking-tight sm:text-3xl">只读业绩报告</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              展示组合的时间加权收益率、基准对照、日期区间与持仓权重(含底层穿透),帮助你对外分享业绩表现。
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <MetaChip icon={ShieldCheck} label="隐私安全视图" />
              <MetaChip icon={CalendarDays} label={usesTradingDays ? `${tradingCalendar} 交易日` : '日历日'} />
              <MetaChip icon={Clock} label={`更新 ${formatDateTime(generatedAt)}`} numeric />
              {hasProvisionalClose && <MetaChip icon={Clock} label="收盘价待核对" />}
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:min-w-[300px] sm:grid-cols-3">
            <ScopeMeta label="基准" value={benchmark} icon={LineChart} />
            <ScopeMeta label="交易日点位" value={String(pointCount)} icon={Activity} />
            <ScopeMeta label="公开持仓" value={String(positionCount)} icon={LockKeyhole} />
          </div>
        </section>

        {!hasSnapshotPrices && (
          <Card className="flex items-start gap-3 border-warn/30 bg-warn/5 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">行情快照未更新</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                分享页行情快照未更新，收益率可能按成本估算，与实际市值存在偏差。
              </p>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <SummaryCell
              label="组合累计表现"
              value={last ? signedPct(portfolioReturn) : '-'}
              valueClass={cn(last ? changeColor(portfolioReturn) : 'text-muted-foreground', 'text-3xl')}
              sub={dateRange}
            />
            <SummaryCell
              label={`${benchmark} · 同期`}
              value={last ? signedPct(spyReturn) : '-'}
              valueClass={last ? changeColor(spyReturn) : 'text-muted-foreground'}
              sub="基准对照"
            />
            <SummaryCell
              label={`超额 vs ${benchmark}`}
              value={last ? signedPct(excess) : '-'}
              valueClass={last ? changeColor(excess) : 'text-muted-foreground'}
              sub={`组合 / ${benchmark} 同期`}
            />
          </div>
        </Card>

        <PerformancePanel
          history={history}
          range={effectiveRange}
          onRangeChange={setRange}
          availableRanges={ranges}
          showBenchmark={showBenchmark}
          onShowBenchmarkChange={() => undefined}
          benchmarkLabel={benchmark}
          loading={historyQuery.isLoading}
          hideBenchmarkToggle
          emptyMessage={
            historyQuery.error
              ? '历史数据加载失败，请刷新重试'
              : '暂无可公开展示的历史数据，请让分享者刷新业绩缓存。'
          }
        />

        <Card className="overflow-hidden rounded-lg p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-elevated/40 px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">持仓权重</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">你实际买入的 ETF / 标的 · {positionCount} 只 · 不显示股数与金额</div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" />
              权重和百分比
            </div>
          </div>
          {positionCount === 0 ? (
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
                  className="grid grid-cols-[minmax(56px,72px)_minmax(0,1fr)_64px] items-center gap-3 px-4 py-3 sm:grid-cols-[96px_minmax(0,1fr)_96px_96px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.ticker}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground sm:hidden">累计 {signedPct(p.return_pct)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-elevated ring-1 ring-border/60">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${clampPercent(p.weight_pct * 100)}%` }}
                          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 * i }}
                          className="h-full rounded-full bg-brand"
                        />
                      </div>
                      <div className="w-12 text-right text-xs text-muted-foreground tnum">
                        {pct(p.weight_pct, 1)}
                      </div>
                    </div>
                    <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">组合权重</div>
                  </div>
                  <div className={cn('hidden text-right font-medium tnum sm:block', changeColor(p.return_pct))}>
                    {signedPct(p.return_pct)}
                    <div className="mt-0.5 text-[10px] font-normal text-muted-foreground">累计</div>
                  </div>
                  <div className={cn('text-right text-[11px] tnum', changeColor(p.day_change_pct ?? 0))}>
                    {p.day_change_pct != null ? signedPct(p.day_change_pct) : '-'}
                    <div className="mt-0.5 text-[10px] text-muted-foreground">今日</div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>

        {lookThroughTop.length > 0 && (
          <Card className="overflow-hidden rounded-lg p-0">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-elevated/40 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">穿透敞口</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  把 ETF 拆成底层股票后的真实单票权重 · 仅百分比
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                穿透仅用权重
              </div>
            </div>

            <div className="grid gap-px bg-border sm:grid-cols-2">
              {lookThrough.lines.map((line) => (
                <div key={line.config.id} className="bg-card px-4 py-5">
                  <ExposureGauge line={line} denomNote="占公开持仓" />
                </div>
              ))}
            </div>

            <div className="divide-y divide-border border-t border-border">
              {lookThroughTop.map((s, i) => (
                <div
                  key={s.ticker}
                  className="grid grid-cols-[64px_minmax(0,1fr)_52px] items-center gap-3 px-4 py-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{s.ticker}</span>
                    {SHOVEL_SET.has(s.ticker) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-label="AI 铲子线成分" />
                    )}
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-elevated">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(4, (s.weightNav / lookThroughMax) * 100)}%` }}
                      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.04 * i }}
                      className="h-full rounded-full bg-brand"
                    />
                  </div>
                  <div className="text-right text-xs font-semibold tnum">{pct(s.weightNav, 1)}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-4 py-2.5 text-[10px] leading-4 text-muted-foreground">
              穿透基于公开持仓权重与一份手动维护的 ETF 成分股表,只取每只 ETF 的前若干大成分,其余归入「未穿透长尾」;占比以公开持仓为分母。
            </div>
          </Card>
        )}

        <footer className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>金额、入金、汇兑损耗、交易明细均不通过分享 API 暴露。</span>
          </span>
          <span className="tnum sm:text-right">
            Generated {formatDateTime(data.generated_at)}
          </span>
        </footer>
      </main>
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
    <div className="px-5 py-5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-2 text-2xl font-semibold tnum', valueClass)}>{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground tnum">{sub}</div>
    </div>
  );
}

function MetaChip({
  icon: Icon,
  label,
  numeric = false,
}: {
  icon: LucideIcon;
  label: string;
  numeric?: boolean;
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground',
      numeric && 'tnum',
    )}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function ScopeMeta({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold tnum">{value}</div>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground shadow-sm shadow-brand/25">
      $
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background p-4 text-foreground">
      <div className="m-auto w-full max-w-sm rounded-lg border border-border bg-card px-5 py-6 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <div className="mt-4 text-base font-semibold">只读分享</div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(2, value));
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

function formatDateTime(value: string | null | undefined) {
  if (!value) return '暂无';
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return value;
  }
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}
