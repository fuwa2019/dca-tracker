import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ResponsiveContainer, AreaChart, Area, YAxis, Tooltip } from 'recharts';
import {
  ArrowUpRight,
  Plus,
  ArrowLeftRight,
  Activity,
  Wallet,
  Briefcase,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/StatCard';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState } from '@/components/EmptyState';
import { HoldingsList } from '@/components/HoldingsList';
import { TargetProgressRing } from '@/components/TargetProgressRing';
import { useQuotes } from '@/hooks/useQuotes';
import {
  useTransactions,
  useCashflows,
  useSettings,
  useTotalInvested,
  useCashBalance,
  usePortfolioHistory,
} from '@/hooks/usePortfolio';
import { usePerformanceCacheStatus } from '@/hooks/usePerformanceCache';
import { aggregatePositions, unrealizedPL } from '@/lib/calc/position';
import { monthsToTarget } from '@/lib/calc/target';
import { computeXirr, buildXirrEvents } from '@/lib/calc/xirr';
import type { HistoryPoint } from '@/lib/calc/history';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import { getSelectedBenchmark, getWatchlist } from '@/lib/settings';
import { cn } from '@/lib/utils';

const MINI_CHART_POINTS = 180;

export function DashboardPage() {
  const { data: txns = [] } = useTransactions();
  const { data: cashflows = [] } = useCashflows();
  const { data: settings } = useSettings();
  const { total: totalInvested } = useTotalInvested();
  const { cash } = useCashBalance();
  const selectedBenchmark = useMemo(() => getSelectedBenchmark(settings), [settings]);
  const cacheStatus = usePerformanceCacheStatus(selectedBenchmark);
  // Auto-refresh removed: cache status is shown, user refreshes via Data Health.

  const watchlist = useMemo(() => getWatchlist(settings), [settings]);
  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...watchlist, selectedBenchmark])],
    [positions, watchlist, selectedBenchmark],
  );
  const { data: quotes = [], isLoading: quotesLoading, isError: quotesError } = useQuotes(symbols);
  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);
  const quotesNone = !quotesLoading && quotes.length === 0 && positions.length > 0;
  const quotesPartial = !quotesLoading && positions.length > 0 && positions.some((p) => {
    const q = quoteByTicker.get(p.ticker);
    return !q || q.price == null;
  });

  const portfolioHistory = usePortfolioHistory(selectedBenchmark);
  const history: HistoryPoint[] = useMemo(() => {
    const rows = portfolioHistory.data?.series ?? [];
    return rows.map((p) => ({
      date: p.date,
      tradingDate: p.trading_date ?? p.date,
      asOfTimestamp: p.as_of_timestamp ?? null,
      provisional: !!p.is_provisional,
      invested: Number(p.invested) || 0,
      costBasis: Number(p.cost_basis) || 0,
      navUser: Number(p.nav_user) || 0,
      navSpy: Number(p.nav_spy) || 0,
      returnPctUser: Number(p.return_pct_user) || 0,
      returnPctSpy: Number(p.return_pct_spy) || 0,
      pnlUser: Number(p.pnl_user) || 0,
      pnlSpy: Number(p.pnl_spy) || 0,
      txns: p.txns ?? [],
    }));
  }, [portfolioHistory.data]);

  const costBasisMode = (settings?.cost_basis_default as 'avg' | 'fifo') ?? 'avg';

  const aggregates = useMemo(() => {
    let stockMv = 0;
    let costBasis = 0;
    let dayPL = 0;
    for (const p of positions) {
      const q = quoteByTicker.get(p.ticker);
      const { marketValue, costBasis: cb } = unrealizedPL(p, q?.price ?? null, costBasisMode);
      stockMv += marketValue;
      costBasis += cb;
      if (q?.change != null) dayPL += p.shares * q.change;
    }
    const nav = stockMv + cash;
    return { nav, stockMv, cash, costBasis, dayPL, totalPL: nav - totalInvested };
  }, [positions, quoteByTicker, totalInvested, cash, costBasisMode]);

  const prevNav = aggregates.nav - aggregates.dayPL;
  const dayChangePct = prevNav > 0 ? aggregates.dayPL / prevNav : 0;
  const totalReturnPct = totalInvested > 0 ? aggregates.totalPL / totalInvested : 0;

  const target = Number(settings?.target_usd ?? 1_000_000);
  const annualRet = Number(settings?.expected_annual_ret ?? 0.08);
  const monthlyDca = Number(settings?.monthly_dca_usd ?? 0);
  const { months } = monthsToTarget({
    currentValueUsd: aggregates.nav,
    monthlyContributionUsd: monthlyDca,
    annualReturn: annualRet,
    targetUsd: target,
  });

  const xirrEvents = useMemo(
    () => buildXirrEvents({ cashflows, currentMarketValueUsd: aggregates.nav }),
    [cashflows, aggregates.nav],
  );
  const xirr = useMemo(() => computeXirr(xirrEvents), [xirrEvents]);

  const last = history[history.length - 1];
  const portfolioCumulative = last?.returnPctUser ?? 0;
  const benchmarkCumulative = last?.returnPctSpy ?? 0;
  const excessVsBenchmark = Number.isFinite((1 + portfolioCumulative) / (1 + benchmarkCumulative) - 1)
    ? (1 + portfolioCumulative) / (1 + benchmarkCumulative) - 1
    : 0;

  const isEmpty = positions.length === 0 && cashflows.length === 0 && txns.length === 0;

  return (
    <div className="container max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 space-y-6">
      {isEmpty ? (
        <EmptyDashboard />
      ) : (
        <>
          <NavHero
            nav={aggregates.nav}
            stockMv={aggregates.stockMv}
            cash={aggregates.cash}
            dayPL={aggregates.dayPL}
            dayChangePct={dayChangePct}
            totalPL={aggregates.totalPL}
            totalReturnPct={totalReturnPct}
            cacheDirty={!!cacheStatus.data?.dirty}
            benchmark={selectedBenchmark}
          />

          {(quotesNone || quotesPartial || quotesError) && (
            <Card className="flex items-start gap-3 border-warn/30 bg-warn/5 p-3 text-sm">
              <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">
                  {quotesError ? '行情接口异常' : quotesNone ? '行情未连接' : '部分行情缺失'}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {quotesError
                    ? '行情接口请求失败，请检查网络或稍后重试。'
                    : quotesNone
                      ? '未配置 Quote Worker 地址，当前按成本价估算。'
                      : '部分持仓现价缺失，相关盈亏可能按成本估算，请稍后刷新。'}
                </p>
              </div>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <StatCard
              label="年化收益 XIRR"
              value={xirr !== null ? signedPct(xirr) : '—'}
              tone={xirr === null ? 'muted' : xirr >= 0 ? 'gain' : 'loss'}
              sub={xirr !== null ? '唯一年化主指标' : '至少需 2 笔不同日期入金'}
            />
            <StatCard
              label="组合累计表现"
              value={signedPct(portfolioCumulative)}
              tone={portfolioCumulative >= 0 ? 'gain' : 'loss'}
              sub={last ? `${history[0].date} 至 ${last.date}` : '录入后显示'}
            />
            <StatCard
              label={`超额 vs ${selectedBenchmark}`}
              value={signedPct(excessVsBenchmark)}
              className={changeColor(excessVsBenchmark)}
              sub={`组合 − ${selectedBenchmark} 同期`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 overflow-hidden p-0">
              <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">业绩曲线</div>
                  <div className="truncate text-[11px] text-muted-foreground tnum">
                    {last ? `${history[0].date} 至 ${last.date}` : '暂无'}
                  </div>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link to="/performance">
                    查看完整 <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              <MiniEquityCurve history={history} />
            </Card>

            <Card className="overflow-hidden p-0">
              <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">$1M 进度</div>
                  <div className="text-[11px] text-muted-foreground tnum">
                    {(annualRet * 100).toFixed(0)}% 年化 · 月供 {usd.format(monthlyDca)}
                  </div>
                </div>
              </div>
              <div className="flex justify-center px-4 py-4">
                <TargetProgressRing
                  current={aggregates.nav}
                  target={target}
                  monthsToTarget={months}
                  size={186}
                  strokeWidth={12}
                />
              </div>
            </Card>
          </div>

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight">持仓</h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  {positions.length} 只 · {costBasisMode === 'avg' ? '平均成本' : 'FIFO'}口径
                </p>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0">
                <Link to="/transactions">
                  全部交易 <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            {positions.length === 0 ? (
              <EmptyState
                icon={Briefcase}
                title="还没有持仓"
                description="去「交易」录入第一笔买入，持仓会自动出现在这里。"
                action={
                  <Button asChild size="sm">
                    <Link to="/transactions">
                      <Plus className="h-3.5 w-3.5" /> 添加交易
                    </Link>
                  </Button>
                }
              />
            ) : (
              <HoldingsList
                positions={positions}
                quoteByTicker={quoteByTicker}
                totalMarketValue={aggregates.stockMv}
                basis={costBasisMode}
              />
            )}
          </section>

          <QuickActions />
        </>
      )}
    </div>
  );
}

function NavHero({
  nav,
  stockMv,
  cash,
  dayPL,
  dayChangePct,
  totalPL,
  totalReturnPct,
  cacheDirty,
  benchmark,
}: {
  nav: number;
  stockMv: number;
  cash: number;
  dayPL: number;
  dayChangePct: number;
  totalPL: number;
  totalReturnPct: number;
  cacheDirty: boolean;
  benchmark: string;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="grid gap-0 md:grid-cols-[1.6fr_1fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="px-5 py-5"
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            组合净值 (NAV)
            {cacheDirty && <StatusBadge tone="warn" dot>缓存待刷新</StatusBadge>}
          </div>
          <div className="mt-1 text-[30px] font-semibold leading-tight tracking-tight tnum sm:text-[34px] whitespace-nowrap overflow-hidden text-ellipsis">
            {usd.format(nav)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground tnum">
            <span className="inline-flex items-center gap-1">
              <Briefcase className="h-3 w-3" /> 持仓 {usd.format(stockMv)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3 w-3" /> 现金 {usd.format(cash)}
            </span>
            <span className="inline-flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> 基准 {benchmark}
            </span>
          </div>
        </motion.div>
        <div className="border-t border-border md:border-l md:border-t-0">
          <KpiCell
            label="今日盈亏"
            value={signedUsd(dayPL)}
            sub={Number.isFinite(dayChangePct) && stockMv > 0 ? signedPct(dayChangePct) : '—'}
            valueClass={changeColor(dayPL)}
          />
        </div>
        <div className="border-t border-border md:border-l md:border-t-0">
          <KpiCell
            label="累计盈亏 (NAV vs 本金)"
            value={signedUsd(totalPL)}
            sub={Number.isFinite(totalReturnPct) ? signedPct(totalReturnPct) : '—'}
            valueClass={changeColor(totalPL)}
          />
        </div>
      </div>
    </Card>
  );
}

function KpiCell({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
      className="px-5 py-5"
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold leading-tight tnum', valueClass)}>{value}</div>
      <div className={cn('mt-1 text-[11px] tnum', valueClass)}>{sub}</div>
    </motion.div>
  );
}

function MiniEquityCurve({ history }: { history: HistoryPoint[] }) {
  const rows = useMemo(() => {
    if (history.length === 0) return [];
    const step = Math.max(1, Math.floor(history.length / MINI_CHART_POINTS));
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

  if (rows.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center px-4 text-xs text-muted-foreground">
        <TrendingUp className="mr-2 h-4 w-4 opacity-60" />
        曲线数据待生成
      </div>
    );
  }

  const positive = rows[rows.length - 1].value >= 0;
  const colorVar = positive ? 'var(--gain)' : 'var(--loss)';

  return (
    <div className="h-[180px] px-2 pb-2 pt-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <defs>
            <linearGradient id="mini-perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`hsl(${colorVar})`} stopOpacity={0.32} />
              <stop offset="100%" stopColor={`hsl(${colorVar})`} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--crosshair))', strokeDasharray: '3 3' }}
            content={({ active, payload }) =>
              active && payload && payload[0]?.payload ? (
                <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] tnum shadow">
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
            strokeWidth={2}
            fill="url(#mini-perf-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function QuickActions() {
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
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </Link>
          </Button>
        ))}
      </div>
    </Card>
  );
}

function EmptyDashboard() {
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
