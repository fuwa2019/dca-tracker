import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CalendarDays,
  Clock,
  EyeOff,
  LineChart,
  LockKeyhole,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from '@/components/icons';
import type { LucideIcon } from '@/components/icons';
import { Card } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ThemeToggle';
import { EmptyState } from '@/components/EmptyState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Kicker } from '@/components/Kicker';
import { EquitySpark } from '@/app/dashboard/shared';
import { useEnterMotion } from '@/hooks/useEnterMotion';
import { supabase } from '@/lib/supabase';
import { pct, signedPct, changeColor } from '@/lib/format';
import { cn } from '@/lib/utils';
import { availableRanges, sliceByRange, type HistoryPoint, type RangeKey } from '@/lib/calc/history';
import { computeLookThrough } from '@/lib/calc/lookThrough';
import { LOCAL_MODE } from '@/lib/localMode';
import { LOCAL_SHARE_TOKEN, localPortfolioHistory, localShareLinks, localSharedPortfolio } from '@/lib/localData';
import { useEtfHoldings } from '@/hooks/useEtfHoldings';
import type { PerformanceHistory, SharedPortfolio, SharedHistory } from '@/lib/database.types';

const SHARE_DISTRIBUTION_COLOR_BY_LABEL: Record<string, string> = {
  'AI 芯片': '#3b82f6',
  '纳指 ETF': '#8b5cf6',
  '半导体 ETF': '#22c55e',
  '大型科技': '#ef476f',
  '现金 / 国债': '#7c3aed',
  '其他': '#64748b',
};
const SHARE_SECTOR_BY_TICKER: Record<string, string> = {
  NVDA: 'AI 芯片',
  QQQ: '纳指 ETF',
  SMH: '半导体 ETF',
  AAPL: '大型科技',
  MSFT: '大型科技',
  SGOV: '现金 / 国债',
};

export function SharePage() {
  const enter = useEnterMotion();
  const etfHoldings = useEtfHoldings();
  const { token } = useParams<{ token: string }>();
  const shareToken = isValidShareToken(token) ? token : null;
  const [range, setRange] = useState<RangeKey>('ALL');

  const portfolio = useQuery({
    queryKey: ['share', 'portfolio', shareToken],
    queryFn: async () => {
      if (!shareToken) throw new Error('invalid_token');
      if (LOCAL_MODE) {
        const link = localShareLinks.find((row) => row.token === shareToken && !row.revoked);
        if (!link) return { error: 'not_found' };
        return localSharedPortfolio;
      }
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
      if (LOCAL_MODE) return localPortfolioHistory as PerformanceHistory;
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
  const chartHistory = useMemo(() => sliceByRange(history, effectiveRange), [history, effectiveRange]);

  // RPC 返回的持仓权重以证券市值为分母；先还原为组合净值权重，现金单列。
  const cashWeight = useMemo(() => {
    const d = portfolio.data;
    if (!d || 'error' in d) return 0;
    return clampUnit(toFiniteNumber(d.cash_weight_pct) ?? 0);
  }, [portfolio.data]);
  const shareRows = useMemo(() => {
    const d = portfolio.data;
    if (!d || 'error' in d) return [] as SharedPortfolio['positions'];
    const securityToNav = 1 - cashWeight;
    return [...d.positions]
      .map((p) => ({ ...p, weight_pct: Math.max(0, Number(p.weight_pct) || 0) * securityToNav }))
      .sort((a, b) => b.weight_pct - a.weight_pct);
  }, [cashWeight, portfolio.data]);
  const sharePositions = useMemo(
    () => shareRows
      .filter((p) => Number.isFinite(p.weight_pct) && p.weight_pct > 0)
      .map((p) => ({ ticker: p.ticker, value: p.weight_pct })),
    [shareRows],
  );
  const lookThrough = useMemo(
    () => computeLookThrough({ holdings: sharePositions, uninvestedCash: cashWeight, data: etfHoldings.data, lines: [] }),
    [cashWeight, sharePositions, etfHoldings.data],
  );
  const lookThroughTop = useMemo(() => lookThrough.stocks.slice(0, 10), [lookThrough.stocks]);
  const decomposedWeight = useMemo(
    () => lookThrough.stocks.reduce((sum, stock) => sum + stock.weightNav, 0),
    [lookThrough.stocks],
  );
  const topLookThrough = lookThroughTop[0];
  const movers = useMemo(() => {
    const rows = shareRows
      .filter((row) => row.day_change_pct !== null && Number.isFinite(row.day_change_pct))
      .map((row) => ({
        ticker: row.ticker,
        changePct: row.day_change_pct ?? 0,
        contribution: row.weight_pct * (row.day_change_pct ?? 0),
      }));
    return {
      winners: rows.filter((row) => row.changePct > 0).sort((a, b) => b.changePct - a.changePct).slice(0, 3),
      losers: rows.filter((row) => row.changePct < 0).sort((a, b) => a.changePct - b.changePct).slice(0, 3),
      hasQuotes: rows.length > 0,
    };
  }, [shareRows]);
  const distribution = useMemo(() => {
    const byLabel = new Map<string, number>();
    const cashLike = new Set((etfHoldings.data._meta?.cashLike ?? []).map((ticker) => ticker.toUpperCase()));
    let cashLikeWeight = 0;
    for (const row of shareRows) {
      if (cashLike.has(row.ticker.toUpperCase())) {
        cashLikeWeight += row.weight_pct;
        continue;
      }
      const label = SHARE_SECTOR_BY_TICKER[row.ticker] ?? '其他';
      byLabel.set(label, (byLabel.get(label) ?? 0) + row.weight_pct);
    }
    const totalCashWeight = lookThrough.totalNav > 0 ? lookThrough.cashValue / lookThrough.totalNav : cashLikeWeight + cashWeight;
    if (totalCashWeight > 0) byLabel.set('现金 / 国债', totalCashWeight);
    return [...byLabel.entries()]
      .map(([label, value]) => ({
        label,
        value,
        color: SHARE_DISTRIBUTION_COLOR_BY_LABEL[label] ?? '#64748b',
      }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [cashWeight, etfHoldings.data, lookThrough.cashValue, lookThrough.totalNav, shareRows]);
  const dayReturn = useMemo(
    () => shareRows.reduce((sum, row) => sum + row.weight_pct * (row.day_change_pct ?? 0), 0),
    [shareRows],
  );

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
  const periodDays = calendarDaysBetween(history[0]?.date, last?.date);
  const shortTermAnnualized = periodDays != null && periodDays < 90;
  const annualizedReturn = annualizeReturn(portfolioReturn, history[0]?.date, last?.date);
  const reportLead = last
    ? `从 ${history[0].date} 到 ${last.date}，组合累计 ${signedPct(portfolioReturn)}，相对 ${benchmark} ${signedPct(excess)}。`
    : '等待业绩缓存生成。';

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/95 lg:bg-background/80 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-background/75">
        <div className="container flex max-w-[1200px] items-center gap-2.5 px-3 py-2.5 sm:px-6 sm:py-3">
          <Logo />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate text-sm font-semibold">DCA Tracker</div>
              <span className="hidden rounded-md border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
                分享报告
              </span>
            </div>
            <div className="hidden truncate text-[11px] text-muted-foreground sm:block">收益率、权重与基准对照</div>
          </div>
          <div className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            报告视图
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="container max-w-[1180px] space-y-4 px-3 py-4 sm:space-y-5 sm:px-6 sm:py-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-1 sm:gap-y-3 sm:pb-2"
        >
          <Kicker index="01" en="Portfolio Report" zh="组合总览" />
          <div className="flex flex-col items-start gap-1.5 text-left sm:items-end sm:gap-2 sm:text-right">
            <div className="hidden kicker sm:block">Period</div>
            <div className="font-num text-[11px] text-muted-foreground sm:text-xs">{dateRange}</div>
            <div className="hidden flex-wrap gap-2 text-[11px] sm:flex">
              <MetaChip icon={ShieldCheck} label="报告视图" />
              <MetaChip icon={CalendarDays} label={usesTradingDays ? `${tradingCalendar} 交易日` : '日历日'} />
              <MetaChip icon={Clock} label={`更新 ${formatDateTime(generatedAt)}`} numeric />
              {hasProvisionalClose && <MetaChip icon={Clock} label="行情状态：临时收盘价" />}
            </div>
          </div>
        </motion.header>

        {!hasSnapshotPrices && (
          <Card className="flex items-start gap-3 border-warn/30 bg-warn/5 p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-foreground">行情快照未更新</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                收益率可能按成本估算，与实际市值存在偏差。
              </p>
            </div>
          </Card>
        )}

        <div className="rule-top" />

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="grid gap-x-10 gap-y-5 py-4 sm:py-6 lg:grid-cols-[1.45fr_1fr]"
        >
          <div>
            <div className="kicker">组合累计表现 · TWR</div>
            <div className={cn('font-serif-fig mt-2 whitespace-nowrap text-[clamp(3.35rem,17vw,6rem)] font-semibold leading-[0.92]', last ? changeColor(portfolioReturn) : 'text-muted-foreground')}>
              {last ? signedPct(portfolioReturn) : '-'}
            </div>
            <p className="mt-3 max-w-2xl text-xs leading-5 text-muted-foreground sm:mt-4 sm:text-sm sm:leading-6">
              {reportLead}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-xl border border-border bg-border sm:rounded-2xl">
            <ShareHeroKpi
              label="今日表现 · Today"
              value={last ? signedPct(dayReturn) : '-'}
              sub="按持仓权重估算"
              tone={last ? changeColor(dayReturn) : 'text-muted-foreground'}
            />
            <ShareHeroKpi
              label={`${benchmark} 同期 · Benchmark`}
              value={last ? signedPct(spyReturn) : '-'}
              sub="复权价总回报 proxy"
              tone={last ? changeColor(spyReturn) : 'text-muted-foreground'}
            />
            <ShareHeroKpi
              label={`超额 vs ${benchmark}`}
              value={last ? signedPct(excess) : '-'}
              sub={`组合 / ${benchmark} 同期`}
              tone={last ? changeColor(excess) : 'text-muted-foreground'}
            />
            <ShareHeroKpi
              label="报告范围 · Scope"
              value={`${positionCount} 持仓`}
              sub={`${pointCount} 个交易日`}
              tone="text-foreground"
            />
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="rule-top grid grid-cols-3 divide-x divide-border border-b border-border"
        >
          <ShareEditorialMetric
            en={shortTermAnnualized ? 'Annualized · TWR · Short window' : 'Annualized · TWR'}
            zh={shortTermAnnualized ? '时间加权年化（短期外推）' : '时间加权年化'}
            value={annualizedReturn !== null ? signedPct(annualizedReturn) : '-'}
            tone={annualizedReturn === null ? 'text-muted-foreground' : changeColor(annualizedReturn)}
            sub={shortTermAnnualized ? '短期外推 · 不等同 XIRR' : '时间加权 TWR'}
          />
          <ShareEditorialMetric
            en="Cumulative · TWR"
            zh="时间加权累计"
            value={last ? signedPct(portfolioReturn) : '-'}
            tone={last ? changeColor(portfolioReturn) : 'text-muted-foreground'}
            sub={last ? `${history[0].date} 至 ${last.date}` : '等待业绩缓存'}
          />
          <ShareEditorialMetric
            en={`Excess vs ${benchmark}`}
            zh="超额收益"
            value={last ? signedPct(excess) : '-'}
            tone={last ? changeColor(excess) : 'text-muted-foreground'}
            sub={`组合 − ${benchmark} 同期`}
          />
        </motion.section>
        {shortTermAnnualized && (
          <p className="-mt-2 text-[11px] leading-5 text-muted-foreground">
            当前区间不足 90 天，年化值只是短期外推；累计 TWR 更适合判断这段表现。它与登录页的 XIRR 分别衡量价格表现和资金投入时点，因此可能同时为正负不同方向。
          </p>
        )}

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="py-3 sm:py-4"
        >
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <Kicker index="02" en="Performance" zh="业绩曲线" />
            {ranges.length > 1 && (
              <SegmentedControl
                value={effectiveRange}
                onChange={(v) => setRange(v as RangeKey)}
                options={ranges.map((r) => ({ value: r, label: r === 'ALL' ? 'All' : r }))}
                size="sm"
                name="share-chart-range"
                ariaLabel="选择分享页曲线时间段"
                className="w-full sm:w-auto"
              />
            )}
          </div>
          <EquitySpark history={chartHistory} colorVar="var(--brand)" height={230} gradientId="share-performance-spark" mode="return" />
          <div className="font-num mt-1 text-[11px] text-muted-foreground">
            组合表现：剔除买入影响，适合和 {benchmark} 比较。
          </div>
          {hasProvisionalClose && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              行情状态为临时收盘价，最终收盘后收益可能小幅变化。
            </div>
          )}
          {historyQuery.error && (
            <Card className="mt-3 border-loss/30 bg-loss/5 p-3 text-xs text-muted-foreground">
              历史数据加载失败，请刷新重试。
            </Card>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="grid gap-4 pb-2 sm:gap-6 lg:grid-cols-3"
        >
          <ShareMoverCard title="每日赢家" icon={TrendingUp} rows={movers.winners} hasQuotes={movers.hasQuotes} />
          <ShareMoverCard title="每日输家" icon={TrendingDown} rows={movers.losers} hasQuotes={movers.hasQuotes} />
          <ShareDistributionCard rows={distribution} assetCount={positionCount} />
        </motion.section>

        <Card className="overflow-hidden rounded-lg p-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-elevated/40 px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold">持仓权重（组合净值）</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">证券持仓 · 现金单列 · {positionCount} 只</div>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground">
              <LockKeyhole className="h-3.5 w-3.5" />
              权重口径
            </div>
          </div>
          {positionCount === 0 ? (
            <div className="px-4 py-6">
              <EmptyState icon={EyeOff} title="暂无持仓" description="当前报告没有可展示的持仓。" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {shareRows.map((p, i) => (
                <motion.div
                  key={p.ticker}
                  {...enter({ opacity: 0, y: 4 }, { delay: i * 0.03 })}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-[minmax(48px,62px)_minmax(0,1fr)_52px] items-center gap-2 px-3 py-3 sm:grid-cols-[96px_minmax(0,1fr)_96px_96px] sm:gap-3 sm:px-4"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.ticker}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground sm:hidden">累计 {signedPct(p.return_pct)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-elevated ring-1 ring-border/60">
                        <motion.div
                          {...enter({ width: 0 }, { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.05 * i })}
                          animate={{ width: `${clampPercent(p.weight_pct * 100)}%` }}
                          className="h-full rounded-full bg-brand"
                        />
                      </div>
                      <div className="w-10 shrink-0 text-right text-[11px] text-muted-foreground tnum sm:w-12 sm:text-xs">
                        {pct(p.weight_pct, 1)}
                      </div>
                    </div>
                    <div className="mt-1 hidden text-[10px] text-muted-foreground sm:block">组合净值权重</div>
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
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-elevated/40 px-3 py-3 sm:px-4">
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

            <div className="grid gap-px bg-border sm:grid-cols-4">
              <ShareExposureStat
                label="最大单票"
                value={topLookThrough ? `${topLookThrough.ticker} ${pct(topLookThrough.weightNav, 1)}` : '-'}
                sub="穿透后权重"
              />
              <ShareExposureStat
                label="已穿透"
                value={pct(decomposedWeight, 1)}
                sub="ETF 成分 + 直接持有"
              />
              <ShareExposureStat
                label="长尾"
                value={pct(lookThrough.unclassifiedValue / Math.max(lookThrough.totalNav, 1e-9), 1)}
                sub="未列出的小成分"
              />
              <ShareExposureStat
                label="现金 / 国债"
                value={pct(lookThrough.cashValue / Math.max(lookThrough.totalNav, 1e-9), 1)}
                sub="短债类不拆股"
              />
            </div>

            <div className="divide-y divide-border border-t border-border">
              {lookThroughTop.map((s, i) => (
                <div
                  key={s.ticker}
                  className="grid grid-cols-[54px_minmax(0,1fr)_48px] items-center gap-2 px-3 py-2.5 sm:grid-cols-[64px_minmax(0,1fr)_52px] sm:gap-3 sm:px-4"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold">{s.ticker}</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-surface-elevated">
                    <motion.div
                      {...enter({ width: 0 }, { duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.04 * i })}
                      animate={{ width: `${Math.min(100, Math.max(2, s.weightNav * 100))}%` }}
                      className="h-full rounded-full bg-brand"
                    />
                  </div>
                  <div className="text-right text-xs font-semibold tnum">{pct(s.weightNav, 1)}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-3 py-2.5 text-[10px] leading-4 text-muted-foreground sm:px-4">
              ETF 成分按维护表拆分，长尾成分合并显示；占比以组合权重为分母。
            </div>
          </Card>
        )}

        <footer className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-3 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>报告口径：TWR、持仓权重、基准对照。</span>
          <span className="tnum sm:text-right">
            Generated {formatDateTime(data.generated_at)}
          </span>
        </footer>
      </main>
    </div>
  );
}

function ShareHeroKpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="min-w-0 bg-surface px-3 py-3 sm:px-5 sm:py-4">
      <div className="kicker truncate text-[8px] sm:text-[10px]">{label}</div>
      <div className={cn('font-serif-fig mt-1.5 whitespace-nowrap text-[clamp(1.25rem,6.5vw,1.7rem)] font-semibold leading-none sm:text-3xl', tone)}>
        {value}
      </div>
      <div className="font-num mt-1 truncate text-[9px] text-muted-foreground sm:text-[11px]">{sub}</div>
    </div>
  );
}

function ShareMoverCard({
  title,
  icon: Icon,
  rows,
  hasQuotes,
}: {
  title: string;
  icon: LucideIcon;
  rows: Array<{ ticker: string; changePct: number; contribution: number }>;
  hasQuotes: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-brand" />
          {title}
        </div>
        <div className="text-[10px] text-muted-foreground">今日表现</div>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          {hasQuotes ? (title === '每日赢家' ? '今日暂无上涨持仓' : '今日暂无下跌持仓') : '暂无今日行情'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((row) => (
            <div key={`${title}-${row.ticker}`} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="font-semibold">{row.ticker}</div>
              <div className="text-right">
                <div className={cn('font-num text-sm font-semibold', changeColor(row.changePct))}>
                  {signedPct(row.changePct)}
                </div>
                <div className={cn('font-num text-[10px]', changeColor(row.contribution))}>
                  贡献 {signedPct(row.contribution)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ShareDistributionCard({
  rows,
  assetCount,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
  assetCount: number;
}) {
  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    cursor += row.value * 100;
    return `${row.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const donutBackground = stops.length > 0 ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#e5e7eb 0% 100%)';

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LineChart className="h-4 w-4 text-brand" />
          组合分布
        </div>
        <div className="text-[10px] text-muted-foreground">板块</div>
      </div>
      <div className="grid items-center gap-4 sm:grid-cols-[132px_1fr]">
        <div
          className="relative mx-auto h-32 w-32 rounded-full"
          style={{ background: donutBackground }}
          aria-label="分享组合分布环形图"
        >
          <div className="absolute inset-[27px] flex flex-col items-center justify-center rounded-full bg-surface">
            <div className="font-serif-fig text-2xl font-semibold">{assetCount}</div>
            <div className="text-[10px] text-muted-foreground">总资产</div>
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="font-num font-medium">{pct(row.value, 1)}</span>
              </div>
              <div className="font-num ml-3.5 mt-0.5 text-[10px] text-muted-foreground">组合权重</div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ShareEditorialMetric({
  en,
  zh,
  value,
  tone,
  sub,
}: {
  en: string;
  zh: string;
  value: string;
  tone: string;
  sub: string;
}) {
  return (
    <div className="min-w-0 px-2 py-3 sm:px-5 sm:py-5">
      <div className="kicker truncate text-[8px] sm:text-[10px]">{en}</div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground sm:text-sm">{zh}</div>
      <div className={cn('font-serif-fig mt-2 whitespace-nowrap text-[clamp(1rem,5.4vw,1.35rem)] font-semibold leading-none sm:text-4xl', tone)}>{value}</div>
      <div className="font-num mt-1 hidden truncate text-[11px] text-muted-foreground sm:block">{sub}</div>
    </div>
  );
}

function ShareExposureStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-card px-4 py-4">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-serif-fig mt-1 text-2xl font-semibold tnum">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{sub}</div>
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

function Logo() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground shadow-sm shadow-brand/25">
      $
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen bg-background p-4 text-foreground">
      <div className="m-auto w-full max-w-sm rounded-lg border border-border bg-card px-5 py-6 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="mt-4 text-base font-semibold">分享报告</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(2, value));
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value));
}

function calendarDaysBetween(startDate: string | undefined, endDate: string | undefined) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

function isValidShareToken(value: string | undefined): value is string {
  if (LOCAL_MODE && value === LOCAL_SHARE_TOKEN) return true;
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

function annualizeReturn(cumulativeReturn: number, startDate: string | undefined, endDate: string | undefined) {
  if (!startDate || !endDate || !Number.isFinite(cumulativeReturn) || cumulativeReturn <= -1) return null;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const years = (end - start) / (365.25 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(years) || years <= 0) return null;
  return Math.pow(1 + cumulativeReturn, 1 / years) - 1;
}

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || /function .* does not exist|could not find .* function/i.test(error.message ?? '');
}
