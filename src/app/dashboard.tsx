import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { PositionCard } from '@/components/PositionCard';
import { StatCard } from '@/components/StatCard';
import { CostBasisToggle } from '@/components/CostBasisToggle';
import { TargetProgressRing } from '@/components/TargetProgressRing';
import { EquityCurveChart } from '@/components/EquityCurveChart';
import { useQuotes } from '@/hooks/useQuotes';
import { useTransactions, useCashflows, useSettings, useTotalInvested } from '@/hooks/usePortfolio';
import { aggregatePositions, unrealizedPL } from '@/lib/calc/position';
import { monthsToTarget } from '@/lib/calc/target';
import { computeXirr, buildXirrEvents } from '@/lib/calc/xirr';
import { computeTwr } from '@/lib/calc/twr';
import { usd, signedUsd, signedPct, changeColor } from '@/lib/format';
import { isUsMarketOpen } from '@/lib/quote';

export function DashboardPage() {
  const [basis, setBasis] = useState<'avg' | 'fifo'>('avg');
  const { data: txns = [] } = useTransactions();
  const { data: cashflows = [] } = useCashflows();
  const { data: settings } = useSettings();
  const { total: totalInvested } = useTotalInvested();

  const watchlist = settings?.watchlist ?? ['VOO', 'QQQM', 'SMH'];
  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const symbols = useMemo(
    () => [...new Set([...positions.map((p) => p.ticker), ...watchlist])],
    [positions, watchlist],
  );
  const { data: quotes = [] } = useQuotes(symbols);
  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);

  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of quotes) if (q.price != null) m[q.ticker] = q.price;
    return m;
  }, [quotes]);

  const aggregates = useMemo(() => {
    let mv = 0;
    let costBasis = 0;
    let dayPL = 0;
    for (const p of positions) {
      const q = quoteByTicker.get(p.ticker);
      const { marketValue, costBasis: cb } = unrealizedPL(p, q?.price ?? null, basis);
      mv += marketValue;
      costBasis += cb;
      if (q?.change != null) dayPL += p.shares * q.change;
    }
    return { mv, costBasis, dayPL, totalPL: mv - totalInvested };
  }, [positions, quoteByTicker, basis, totalInvested]);

  const target = Number(settings?.target_usd ?? 1_000_000);
  const annualRet = Number(settings?.expected_annual_ret ?? 0.08);
  const monthlyDca = Number(settings?.monthly_dca_usd ?? 0);
  const { months } = monthsToTarget({
    currentValueUsd: aggregates.mv,
    monthlyContributionUsd: monthlyDca,
    annualReturn: annualRet,
    targetUsd: target,
  });

  const xirr = useMemo(
    () => computeXirr(buildXirrEvents({ cashflows, currentMarketValueUsd: aggregates.mv })),
    [cashflows, aggregates.mv],
  );
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
      }),
    [txns, cashflows, aggregates.mv],
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
        <StatCard label="组合市值" value={usd.format(aggregates.mv)} sub={`本金 ${usd.format(totalInvested)}`} delay={0} />
        <StatCard
          label="今日盈亏"
          value={signedUsd(aggregates.dayPL)}
          sub={aggregates.mv > 0 ? signedPct(aggregates.dayPL / aggregates.mv) : '—'}
          className={changeColor(aggregates.dayPL)}
          delay={0.05}
        />
        <StatCard
          label="累计盈亏 (vs 本金)"
          value={signedUsd(aggregates.totalPL)}
          sub={totalInvested > 0 ? signedPct(aggregates.totalPL / totalInvested) : '—'}
          className={changeColor(aggregates.totalPL)}
          delay={0.1}
        />
        <StatCard
          label="开仓盈亏"
          value={signedUsd(aggregates.mv - aggregates.costBasis)}
          sub={aggregates.costBasis > 0 ? signedPct((aggregates.mv - aggregates.costBasis) / aggregates.costBasis) : '—'}
          className={changeColor(aggregates.mv - aggregates.costBasis)}
          delay={0.15}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="年化收益率 (XIRR · 钱加权)"
          value={xirr !== null ? signedPct(xirr) : '—'}
          sub="按每笔入金时点和金额精确折现"
          className={changeColor(xirr)}
        />
        <StatCard
          label={`时间加权 TWR · 年化 ${twrResult?.approximated ? '(粗估)' : ''}`}
          value={twrResult?.annualized != null ? signedPct(twrResult.annualized) : '—'}
          sub={twrResult ? `累计 ${signedPct(twrResult.twr)} · ${twrResult.periodDays} 天` : '不足 90 天不显示年化'}
          className={changeColor(twrResult?.annualized ?? 0)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>资产曲线</CardTitle>
            <CardDescription>累计入金 vs 累计成本（绿色虚线为当前市值参考）</CardDescription>
          </CardHeader>
          <CardContent>
            <EquityCurveChart transactions={txns} cashflows={cashflows} quotes={priceMap} />
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
