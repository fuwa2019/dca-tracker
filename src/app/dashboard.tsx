import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { PositionCard } from '@/components/PositionCard';
import { StatCard } from '@/components/StatCard';
import { CostBasisToggle } from '@/components/CostBasisToggle';
import { TargetProgressRing } from '@/components/TargetProgressRing';
import {
  EquityCurveChart,
  MetricToggle,
  RangeToggle,
  availableRanges,
  type ChartMetric,
} from '@/components/EquityCurveChart';
import { useQuotes } from '@/hooks/useQuotes';
import { useDailyPrices } from '@/hooks/useDailyPrices';
import { useTransactions, useCashflows, useSettings, useTotalInvested, useCashBalance } from '@/hooks/usePortfolio';
import { aggregatePositions, unrealizedPL } from '@/lib/calc/position';
import { monthsToTarget } from '@/lib/calc/target';
import { computeXirr, buildXirrEvents } from '@/lib/calc/xirr';
import { computeTwr } from '@/lib/calc/twr';
import { buildEquityHistory, BENCHMARK_TICKER, type RangeKey } from '@/lib/calc/history';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import { isUsMarketOpen } from '@/lib/quote';

export function DashboardPage() {
  const [basis, setBasis] = useState<'avg' | 'fifo'>('avg');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('returnPct');
  const [chartRange, setChartRange] = useState<RangeKey>('ALL');
  const [showBenchmark, setShowBenchmark] = useState(true);
  const { data: txns = [] } = useTransactions();
  const { data: cashflows = [] } = useCashflows();
  const { data: settings } = useSettings();
  const { total: totalInvested } = useTotalInvested();
  const { cash } = useCashBalance();

  const watchlist = settings?.watchlist ?? ['VOO', 'QQQM', 'SMH'];
  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...watchlist, BENCHMARK_TICKER])],
    [positions, watchlist],
  );
  const { data: quotes = [] } = useQuotes(symbols);
  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);

  // --- Equity-history data plumbing ----------------------------
  const earliestDate = useMemo(() => {
    const cashDates = cashflows.map((c) => c.usd_in_date).filter((d): d is string => !!d);
    const tradeDates = txns.map((t) => t.trade_date);
    const all = [...cashDates, ...tradeDates].sort();
    return all[0] ?? null;
  }, [cashflows, txns]);
  const historySymbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), BENCHMARK_TICKER])],
    [positions],
  );
  const { data: dailyPrices } = useDailyPrices(historySymbols, earliestDate);
  const todayQuotes = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of quotes) if (q.price != null) m.set(q.ticker, q.price);
    return m;
  }, [quotes]);
  const history = useMemo(() => {
    if (!dailyPrices) return [];
    return buildEquityHistory({
      transactions: txns,
      cashflows,
      prices: dailyPrices,
      todayQuotes,
      todaySpyPrice: todayQuotes.get(BENCHMARK_TICKER),
    });
  }, [dailyPrices, txns, cashflows, todayQuotes]);

  // One-time diagnostic — remove once曲线确认正常。
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (history.length === 0) return;
    // eslint-disable-next-line no-console
    console.log('[equity-curve]', {
      points: history.length,
      first: history[0],
      last: history[history.length - 1],
      pricesTickers: dailyPrices ? [...dailyPrices.keys()] : [],
      pricesSizes: dailyPrices ? Object.fromEntries([...dailyPrices.entries()].map(([k, v]) => [k, v.size])) : {},
    });
  }, [history, dailyPrices]);

  const ranges = useMemo(() => availableRanges(history), [history]);
  const effectiveRange = ranges.includes(chartRange) ? chartRange : (ranges[ranges.length - 1] ?? 'ALL');

  const aggregates = useMemo(() => {
    let stockMv = 0;
    let costBasis = 0;
    let dayPL = 0;
    for (const p of positions) {
      const q = quoteByTicker.get(p.ticker);
      const { marketValue, costBasis: cb } = unrealizedPL(p, q?.price ?? null, basis);
      stockMv += marketValue;
      costBasis += cb;
      if (q?.change != null) dayPL += p.shares * q.change;
    }
    // NAV = stocks + uninvested cash sitting in Schwab.
    const nav = stockMv + cash;
    return { mv: nav, stockMv, cash, costBasis, dayPL, totalPL: nav - totalInvested };
  }, [positions, quoteByTicker, basis, totalInvested, cash]);

  const target = Number(settings?.target_usd ?? 1_000_000);
  const annualRet = Number(settings?.expected_annual_ret ?? 0.08);
  const monthlyDca = Number(settings?.monthly_dca_usd ?? 0);
  const { months } = monthsToTarget({
    currentValueUsd: aggregates.mv,
    monthlyContributionUsd: monthlyDca,
    annualReturn: annualRet,
    targetUsd: target,
  });

  const xirrEvents = useMemo(
    () => buildXirrEvents({ cashflows, currentMarketValueUsd: aggregates.mv }),
    [cashflows, aggregates.mv],
  );
  const xirr = useMemo(() => computeXirr(xirrEvents), [xirrEvents]);
  const xirrHint = useMemo(() => {
    if (xirr !== null) return '按每笔入金时点和金额精确折现';
    const usableDeposits = xirrEvents.filter((e) => e.amount < 0).length;
    if (aggregates.mv <= 0) return '需要先有当前持仓市值';
    if (usableDeposits === 0) return '需要至少 1 笔填好"USD 到账日"的入金';
    if (usableDeposits < 2 && new Set(xirrEvents.map((e) => e.when.toISOString().slice(0, 10))).size < 2) {
      return '需要至少 2 笔不同日期的入金';
    }
    return '数据条件不足以计算';
  }, [xirr, xirrEvents, aggregates.mv]);
  const twrResult = useMemo(
    () =>
      computeTwr({
        transactions: txns.map((t) => ({
          trade_date: t.trade_date,
          ticker: t.ticker,
          side: t.side,
          price: Number(t.price),
          shares: Number(t.shares),
        })),
        cashflows: cashflows.map((c) => ({ usd_in_date: c.usd_in_date, usd_amount: c.usd_amount })),
        currentMarketValueUsd: aggregates.mv,
        priceOn: dailyPrices
          ? (ticker, isoDate) => dailyPrices.get(ticker)?.get(isoDate) ?? null
          : undefined,
      }),
    [txns, cashflows, aggregates.mv, dailyPrices],
  );

  const marketOpen = isUsMarketOpen();

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-3xl font-semibold tracking-tight"
        >
          总览
        </motion.h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {marketOpen ? '🟢 美股盘中 · 行情延迟 ~15min' : '⚪️ 盘后 / 休市'}
          </span>
          <CostBasisToggle value={basis} onChange={setBasis} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="组合净值 (NAV)"
          value={usd.format(aggregates.mv)}
          sub={`持仓 ${usd.format(aggregates.stockMv)} · 现金 ${usd.format(aggregates.cash)}`}
          delay={0}
        />
        <StatCard
          label="今日盈亏"
          value={signedUsd(aggregates.dayPL)}
          sub={aggregates.stockMv > 0 ? signedPct(aggregates.dayPL / aggregates.stockMv) : '—'}
          className={changeColor(aggregates.dayPL)}
          delay={0.05}
        />
        <StatCard
          label="累计盈亏 (NAV vs 本金)"
          value={signedUsd(aggregates.totalPL)}
          sub={totalInvested > 0 ? signedPct(aggregates.totalPL / totalInvested) : '—'}
          className={changeColor(aggregates.totalPL)}
          delay={0.1}
        />
        <StatCard
          label="开仓盈亏（持仓口径）"
          value={signedUsd(aggregates.stockMv - aggregates.costBasis)}
          sub={aggregates.costBasis > 0 ? signedPct((aggregates.stockMv - aggregates.costBasis) / aggregates.costBasis) : '—'}
          className={changeColor(aggregates.stockMv - aggregates.costBasis)}
          delay={0.15}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="年化收益率 (XIRR · 钱加权)"
          value={xirr !== null ? signedPct(xirr) : '—'}
          sub={xirrHint}
          className={changeColor(xirr)}
        />
        <StatCard
          label={`时间加权 TWR · 年化 ${twrResult?.approximated ? '(粗估)' : ''}`}
          value={
            twrResult?.annualized != null
              ? signedPct(twrResult.annualized)
              : twrResult
                ? signedPct(twrResult.twr)
                : '—'
          }
          sub={
            twrResult
              ? twrResult.annualized != null
                ? `累计 ${signedPct(twrResult.twr)} · ${twrResult.periodDays} 天`
                : `累计区间 · ${twrResult.periodDays} 天 (不足 90 天不年化，避免噪声)`
              : '录入交易后显示'
          }
          className={changeColor(twrResult?.annualized ?? twrResult?.twr ?? 0)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>资产曲线</CardTitle>
                <CardDescription>
                  {chartMetric === 'returnPct' ? '收益率 %' : '收益金额 $'}
                  {showBenchmark && ' · 对照 SPY (资金时点对齐)'}
                </CardDescription>
              </div>
              <MetricToggle value={chartMetric} onChange={setChartMetric} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <RangeToggle value={effectiveRange} onChange={setChartRange} available={ranges} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>vs SPY</span>
                <Switch checked={showBenchmark} onCheckedChange={setShowBenchmark} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <EquityCurveChart
              history={history}
              metric={chartMetric}
              range={effectiveRange}
              showBenchmark={showBenchmark}
            />
            <AnimatePresence>
              {history.length === 0 && earliestDate && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-2 text-center text-[11px] text-muted-foreground"
                >
                  正在拉取历史价格…
                </motion.p>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>$1M 进度</CardTitle>
            <CardDescription>预设 {(annualRet * 100).toFixed(0)}% 年化 · 月供 {usd.format(monthlyDca)}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center pb-6">
            <TargetProgressRing current={aggregates.mv} target={target} monthsToTarget={months} />
          </CardContent>
        </Card>
      </div>

      <div>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight">持仓</h2>
          <span className="text-xs text-muted-foreground">{positions.length} 只</span>
        </div>
        {positions.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            还没有持仓 — 去「交易」页录入第一笔买入
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {positions.map((p, i) => (
              <PositionCard key={p.ticker} position={p} quote={quoteByTicker.get(p.ticker)} basis={basis} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
