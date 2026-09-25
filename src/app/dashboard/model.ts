import { useEffect, useMemo } from 'react';
import { useQuotes } from '@/hooks/useQuotes';
import { registerTrackedSymbols } from '@/lib/trackedSymbols';
import {
  useTransactions,
  useCashflows,
  useSettings,
} from '@/hooks/usePortfolio';
import { usePerformanceCacheStatus } from '@/hooks/usePerformanceCache';
import { useLedger } from '@/hooks/useLedger';
import { aggregatePositions, unrealizedPL, type Position } from '@/lib/calc/position';
import { QQQM_GOAL_UI_PATHS, simulateQqqmGoal } from '@/lib/calc/goalProbability';
import type { HistoryPoint } from '@/lib/calc/history';
import type { LedgerSeries, LedgerSummary } from '@/lib/calc/portfolioLedger';
import type { LedgerCheck } from '@/lib/calc/ledgerChecks';
import type { Quote } from '@/lib/quote';
import { toUsdQuotes, usdRatesByTicker } from '@/lib/usdQuotes';
import { getSelectedBenchmark, getWatchlist } from '@/lib/settings';

/**
 * Shared dashboard data + derived figures. Both dashboard variants render the
 * same model so the numbers never diverge — only the presentation differs.
 * This is a verbatim lift of the original DashboardPage computation.
 */
export interface DashboardModel {
  loading: boolean;
  positions: Position[];
  selectedBenchmark: string;
  quotes: Quote[];
  /** Quotes converted to USD, so foreign listings value correctly. */
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
  monthlyDca: number;
  /**
   * Goal outlook from the same probability model as the settings planner
   * (QQQM research model, baseline scenario). Null until NAV, target and a
   * monthly contribution are all known.
   */
  goal: { p50Years: number; within20Years: number | null } | null;
  xirr: number | null;
  portfolioCumulative: number;
  benchmarkCumulative: number;
  excessVsBenchmark: number;
  isEmpty: boolean;
  ledgerSummary: LedgerSummary;
  ledgerSeries: LedgerSeries;
  ledgerChecks: LedgerCheck[];
  /** A blocking accounting check failed; figures are shown as unreconciled. */
  unreconciled: boolean;
  /** False when some position had to be valued without a market price. */
  seriesComplete: boolean;
}

export function useDashboardModel(): DashboardModel {
  const transactionsQuery = useTransactions();
  const cashflowsQuery = useCashflows();
  const settingsQuery = useSettings();
  const txns = transactionsQuery.data ?? [];
  const cashflows = cashflowsQuery.data ?? [];
  const settings = settingsQuery.data;
  const coreLoading = transactionsQuery.isPending || cashflowsQuery.isPending || settingsQuery.isPending;
  const selectedBenchmark = useMemo(() => getSelectedBenchmark(settings), [settings]);
  const cacheStatus = usePerformanceCacheStatus(selectedBenchmark);

  const watchlist = useMemo(() => getWatchlist(settings), [settings]);
  const allPositions = useMemo(() => aggregatePositions(txns), [txns]);
  const positions = useMemo(
    () => allPositions.filter((p) => p.shares > 1e-9),
    [allPositions],
  );
  const symbols = useMemo(
    () => coreLoading
      ? []
      : [...new Set([...txns.map((t) => t.ticker), ...watchlist, selectedBenchmark])],
    [coreLoading, txns, watchlist, selectedBenchmark],
  );
  const { data: quotes = [], isLoading: quotesLoading, isError: quotesError } = useQuotes(symbols);
  useEffect(() => {
    if (symbols.length === 0) return;
    void registerTrackedSymbols(symbols, 'dashboard').catch((error) => {
      if (import.meta.env.DEV) console.warn('[tracked-symbols] dashboard registration failed:', error);
    });
  }, [symbols]);

  const ledgerModel = useLedger({ quotes });
  const { summary, series } = ledgerModel;

  // Foreign listings are quoted in their own currency; the holdings view and
  // the day P&L work in USD, at the same rate the ledger values them.
  const quoteByTicker = useMemo(
    () => toUsdQuotes(quotes, usdRatesByTicker(ledgerModel.ledger.trades)),
    [quotes, ledgerModel.ledger],
  );
  const quotesNone = !quotesLoading && quotes.length === 0 && positions.length > 0;
  const quotesPartial = !quotesLoading && positions.length > 0 && positions.some((p) => {
    const q = quoteByTicker.get(p.ticker);
    return !q || q.price == null;
  });

  const costBasisMode = (settings?.cost_basis_default as 'avg' | 'fifo') ?? 'avg';

  const aggregates = useMemo(() => {
    let costBasis = 0;
    let dayPL = 0;
    let quotedMv = 0;
    for (const p of positions) {
      const q = quoteByTicker.get(p.ticker);
      const { marketValue, costBasis: cb } = unrealizedPL(p, q?.price ?? null, costBasisMode);
      quotedMv += marketValue;
      costBasis += cb;
      if (q?.change != null) dayPL += p.shares * q.change;
    }
    const realizedPL = allPositions.reduce((sum, p) => sum + p.realizedUsd, 0);
    // NAV, cash and total return come from the ledger so every page agrees.
    const stockMv = positions.length > 0 ? summary.marketValueUsd : 0;
    return {
      nav: summary.navUsd,
      stockMv: stockMv || quotedMv,
      cash: summary.cashUsd,
      costBasis,
      dayPL,
      totalPL: summary.totalReturnUsd,
      unrealizedPL: (stockMv || quotedMv) - costBasis,
      realizedPL,
    };
  }, [positions, allPositions, quoteByTicker, costBasisMode, summary]);

  const history = ledgerModel.history;

  const prevNav = aggregates.nav - aggregates.dayPL;
  const dayChangePct = prevNav > 0 ? aggregates.dayPL / prevNav : 0;
  const totalReturnPct = summary.totalReturnOnInvested ?? 0;

  const target = Number(settings?.target_usd ?? 1_000_000);
  const monthlyDca = Number(settings?.monthly_dca_usd ?? 0);
  const hasMonthly = settings?.monthly_dca_usd != null;
  // Rounded so live quote ticks do not rerun thousands of paths.
  const navForGoal = Math.round(aggregates.nav / 10) * 10;
  const goal = useMemo(() => {
    if (ledgerModel.loading || !hasMonthly || target <= 0 || navForGoal < 0) return null;
    const simulation = simulateQqqmGoal({
      initialValueUsd: navForGoal,
      monthlyContributionUsd: monthlyDca,
      targetUsd: target,
      stress: 'baseline',
      pathCount: QQQM_GOAL_UI_PATHS,
    });
    if (!simulation) return null;
    return {
      p50Years: simulation.quantiles.p50,
      within20Years: simulation.successByYear.find((point) => point.years === 20)?.probability ?? null,
    };
  }, [ledgerModel.loading, hasMonthly, target, navForGoal, monthlyDca]);

  const last = history[history.length - 1];
  const isEmpty = positions.length === 0 && cashflows.length === 0 && txns.length === 0;

  return {
    loading: coreLoading || (positions.length > 0 && quotesLoading) || ledgerModel.loading,
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
    accountValueHistory: history,
    last,
    costBasisMode,
    aggregates,
    dayChangePct,
    totalReturnPct,
    target,
    monthlyDca,
    goal,
    xirr: summary.xirr,
    portfolioCumulative: summary.twr ?? 0,
    benchmarkCumulative: summary.benchmarkReturn ?? 0,
    excessVsBenchmark: summary.excessReturn ?? 0,
    isEmpty,
    ledgerSummary: summary,
    ledgerSeries: series,
    ledgerChecks: ledgerModel.checks,
    unreconciled: ledgerModel.unreconciled,
    seriesComplete: series.complete,
  };
}
