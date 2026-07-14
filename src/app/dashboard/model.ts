import { useEffect, useMemo } from 'react';
import { useQuotes } from '@/hooks/useQuotes';
import { registerTrackedSymbols } from '@/lib/trackedSymbols';
import {
  useTransactions,
  useCashflows,
  useSettings,
  useTotalInvested,
  useCashBalance,
  usePortfolioHistory,
} from '@/hooks/usePortfolio';
import { usePerformanceCacheStatus } from '@/hooks/usePerformanceCache';
import { aggregatePositions, unrealizedPL, type Position } from '@/lib/calc/position';
import { monthsToTarget } from '@/lib/calc/target';
import { computeXirr, buildXirrEvents } from '@/lib/calc/xirr';
import { buildAccountValueHistory, type HistoryPoint } from '@/lib/calc/history';
import { useDailyPrices } from '@/hooks/useDailyPrices';
import type { Quote } from '@/lib/quote';
import { getSelectedBenchmark, getWatchlist } from '@/lib/settings';
import etfHoldings from '@/data/etf-holdings.json';

const CASH_LIKE_TICKERS = new Set(
  (etfHoldings._meta.cashLike ?? []).map((ticker) => ticker.toUpperCase()),
);

/**
 * Shared dashboard data + derived figures. Both dashboard variants render the
 * same model so the numbers never diverge — only the presentation differs.
 * This is a verbatim lift of the original DashboardPage computation.
 */
export interface DashboardModel {
  positions: Position[];
  selectedBenchmark: string;
  quotes: Quote[];
  quoteByTicker: Map<string, Quote>;
  quotesLoading: boolean;
  quotesError: boolean;
  quotesNone: boolean;
  quotesPartial: boolean;
  cacheDirty: boolean;
  history: HistoryPoint[];
  accountValueHistory: HistoryPoint[];
  last: HistoryPoint | undefined;
  costBasisMode: 'avg' | 'fifo';
  aggregates: {
    nav: number;
    stockMv: number;
    cash: number;
    costBasis: number;
    dayPL: number;
    totalPL: number;
    unrealizedPL: number;
    realizedPL: number;
  };
  dayChangePct: number;
  totalReturnPct: number;
  target: number;
  annualRet: number;
  monthlyDca: number;
  monthsToTarget: number | null;
  xirr: number | null;
  portfolioCumulative: number;
  benchmarkCumulative: number;
  excessVsBenchmark: number;
  isEmpty: boolean;
}

export function useDashboardModel(): DashboardModel {
  const { data: txns = [] } = useTransactions();
  const { data: cashflows = [] } = useCashflows();
  const { data: settings } = useSettings();
  const { total: totalInvested } = useTotalInvested();
  const { cash } = useCashBalance();
  const selectedBenchmark = useMemo(() => getSelectedBenchmark(settings), [settings]);
  const cacheStatus = usePerformanceCacheStatus(selectedBenchmark);

  const watchlist = useMemo(() => getWatchlist(settings), [settings]);
  const allPositions = useMemo(() => aggregatePositions(txns), [txns]);
  const positions = useMemo(
    () => allPositions.filter((p) => p.shares > 1e-9),
    [allPositions],
  );
  const symbols = useMemo(
    () => [...new Set([...txns.map((t) => t.ticker), ...watchlist, selectedBenchmark])],
    [txns, watchlist, selectedBenchmark],
  );
  const accountValueSymbols = useMemo(
    () => [...new Set(txns
      .filter((txn) => !CASH_LIKE_TICKERS.has(txn.ticker.toUpperCase()))
      .map((txn) => txn.ticker))],
    [txns],
  );
  const { data: quotes = [], isLoading: quotesLoading, isError: quotesError } = useQuotes(symbols);
  useEffect(() => {
    void registerTrackedSymbols(symbols, 'dashboard').catch((error) => {
      if (import.meta.env.DEV) console.warn('[tracked-symbols] dashboard registration failed:', error);
    });
  }, [symbols]);
  const quoteByTicker = useMemo(() => new Map(quotes.map((q) => [q.ticker, q])), [quotes]);
  const quotesNone = !quotesLoading && quotes.length === 0 && positions.length > 0;
  const quotesPartial = !quotesLoading && positions.length > 0 && positions.some((p) => {
    const q = quoteByTicker.get(p.ticker);
    return !q || q.price == null;
  });

  const portfolioHistory = usePortfolioHistory(selectedBenchmark);
  const accountValueStartDate = useMemo(() => {
    const dates = txns
      .filter((txn) => !CASH_LIKE_TICKERS.has(txn.ticker.toUpperCase()))
      .map((txn) => txn.trade_date)
      .filter(Boolean)
      .sort();
    return dates[0] ?? null;
  }, [txns]);
  const dailyPrices = useDailyPrices(accountValueSymbols, accountValueStartDate);
  const rawHistory: HistoryPoint[] = useMemo(() => {
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
    const realizedPL = allPositions.reduce((sum, p) => sum + p.realizedUsd, 0);
    const nav = stockMv + cash;
    return {
      nav,
      stockMv,
      cash,
      costBasis,
      dayPL,
      totalPL: nav - totalInvested,
      unrealizedPL: stockMv - costBasis,
      realizedPL,
    };
  }, [positions, allPositions, quoteByTicker, totalInvested, cash, costBasisMode]);

  const history = useMemo(
    () => rawHistory,
    [rawHistory],
  );
  const accountValueHistory = useMemo(
    () => buildAccountValueHistory({
      transactions: txns,
      cashflows,
      prices: dailyPrices.data ?? new Map(),
      todayQuotes: new Map(quotes.filter((quote) => quote.price != null).map((quote) => [quote.ticker, quote.price as number])),
      excludedValueTickers: CASH_LIKE_TICKERS,
    }),
    [txns, cashflows, dailyPrices.data, quotes],
  );

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

  return {
    positions,
    selectedBenchmark,
    quotes,
    quoteByTicker,
    quotesLoading,
    quotesError,
    quotesNone,
    quotesPartial,
    cacheDirty: !!cacheStatus.data?.dirty,
    history,
    accountValueHistory,
    last,
    costBasisMode,
    aggregates,
    dayChangePct,
    totalReturnPct,
    target,
    annualRet,
    monthlyDca,
    monthsToTarget: months,
    xirr,
    portfolioCumulative,
    benchmarkCumulative,
    excessVsBenchmark,
    isEmpty,
  };
}
