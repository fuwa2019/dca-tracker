import { useMemo } from 'react';
import { useAccounts, useCashflows, usePortfolioHistory, useSettings, useTransactions } from '@/hooks/usePortfolio';
import { useDailyPrices } from '@/hooks/useDailyPrices';
import { aggregatePositions } from '@/lib/calc/position';
import {
  buildLedger,
  buildLedgerSeries,
  summarizeLedger,
  type Ledger,
  type LedgerSeries,
  type LedgerSummary,
} from '@/lib/calc/portfolioLedger';
import { hasBlockingFailure, runLedgerChecks, type LedgerCheck, type StatementCash } from '@/lib/calc/ledgerChecks';
import type { HistoryPoint } from '@/lib/calc/history';
import { isoDateInNewYork } from '@/lib/nyse-calendar';
import { getSelectedBenchmark } from '@/lib/settings';
import type { Quote } from '@/lib/quote';
import { useQuotes } from '@/hooks/useQuotes';

export interface LedgerModel {
  loading: boolean;
  /** True once transactions and cashflows are loaded; prices may still be loading. */
  ready: boolean;
  benchmark: string;
  ledger: Ledger;
  series: LedgerSeries;
  summary: LedgerSummary;
  checks: LedgerCheck[];
  /** A blocking accounting check failed: figures must be marked unreconciled. */
  unreconciled: boolean;
  /** The ledger series in the shape the existing chart components read. */
  history: HistoryPoint[];
}

interface Options {
  /** Live quotes; when given, the last point is valued at them as of today. */
  quotes?: readonly Quote[];
  /** Fetch live quotes for held tickers and the benchmark when `quotes` is absent. */
  live?: boolean;
  statementCash?: readonly StatementCash[];
}

/**
 * The private, amount-bearing view of the portfolio. Every page that shows a
 * return reads it from here, so overview, performance and health cannot
 * disagree. The public share page reads the percentage cache, which the quote
 * Worker writes with the same `portfolioLedger` module.
 */
export function useLedger(options: Options = {}): LedgerModel {
  const transactions = useTransactions();
  const cashflows = useCashflows();
  const settings = useSettings();
  const benchmark = getSelectedBenchmark(settings.data);
  const shareCache = usePortfolioHistory(benchmark);

  const txns = transactions.data;
  const flows = cashflows.data;
  const ledger = useMemo(() => buildLedger(txns ?? [], flows ?? []), [txns, flows]);

  const tickers = useMemo(() => [...new Set(ledger.trades.map((trade) => trade.ticker))], [ledger]);
  const startDate = useMemo(() => {
    const dates = [...ledger.trades.map((t) => t.date), ...ledger.cash.map((e) => e.date)].sort();
    return dates[0] ?? null;
  }, [ledger]);
  const closes = useDailyPrices(tickers, startDate, 'close');
  const benchmarkPrices = useDailyPrices([benchmark], startDate, 'adjusted');

  const heldTickers = useMemo(() => {
    const shares = new Map<string, number>();
    for (const trade of ledger.trades) shares.set(trade.ticker, (shares.get(trade.ticker) ?? 0) + (trade.side === 'buy' ? trade.shares : -trade.shares));
    return [...shares].filter(([, value]) => Math.abs(value) > 1e-9).map(([ticker]) => ticker);
  }, [ledger]);
  const ownQuotes = useQuotes(options.live && !options.quotes && allSettled(transactions, cashflows) ? [...heldTickers, benchmark] : []);
  const quotes = options.quotes ?? (options.live ? ownQuotes.data : undefined);
  const latestPrices = useMemo(() => {
    if (!quotes) return undefined;
    const map = new Map<string, number>();
    for (const quote of quotes) if (quote.price != null && quote.price > 0) map.set(quote.ticker, quote.price);
    return map;
  }, [quotes]);

  const series = useMemo(
    () => buildLedgerSeries({
      ledger,
      closes: closes.data ?? new Map(),
      benchmark: benchmarkPrices.data?.get(benchmark),
      latestPrices,
      latestBenchmark: latestPrices?.get(benchmark) ?? null,
      asOfDate: latestPrices ? isoDateInNewYork(new Date()) : undefined,
    }),
    [ledger, closes.data, benchmarkPrices.data, benchmark, latestPrices],
  );
  const summary = useMemo(() => summarizeLedger(ledger, series), [ledger, series]);

  const displayedShares = useMemo(() => {
    const map = new Map<string, number>();
    for (const position of aggregatePositions(txns ?? [])) map.set(position.ticker, position.shares);
    return map;
  }, [txns]);

  const shareSeries = shareCache.data?.series;
  const shareCacheReturn = shareSeries && shareSeries.length > 0
    ? Number(shareSeries[shareSeries.length - 1].return_pct_user)
    : null;

  const accounts = useAccounts();
  const statementCash = useMemo<readonly StatementCash[] | undefined>(() => {
    if (options.statementCash) return options.statementCash;
    const rows = (accounts.data ?? []).filter((account) => account.statement_cash_usd != null && account.statement_as_of);
    if (rows.length === 0) return undefined;
    return rows.map((account) => {
      const asOf = account.statement_as_of!;
      let cash = 0;
      for (const trade of ledger.trades) if (trade.account === account.id && trade.date <= asOf) cash += trade.cashUsd;
      for (const event of ledger.cash) {
        if (event.account === account.id && event.role !== 'excluded' && event.date <= asOf) cash += event.amountUsd;
      }
      return {
        label: account.name,
        asOf,
        statementCashUsd: Number(account.statement_cash_usd),
        ledgerCashUsd: Math.round(cash * 1e8) / 1e8,
      };
    });
  }, [options.statementCash, accounts.data, ledger]);
  const checks = useMemo(
    () => runLedgerChecks({
      ledger,
      series,
      summary,
      displayedCashUsd: summary.cashUsd,
      displayedShares,
      statementCash,
      shareCacheReturn: shareCache.isLoading ? undefined : shareCacheReturn,
    }),
    [ledger, series, summary, displayedShares, statementCash, shareCache.isLoading, shareCacheReturn],
  );

  const history = useMemo(() => series.points.map(toHistoryPoint), [series]);
  const ready = !transactions.isPending && !cashflows.isPending && !settings.isPending;
  const pricesLoading = (tickers.length > 0 && closes.isPending) || (!!startDate && benchmarkPrices.isPending);

  return {
    loading: !ready || pricesLoading,
    ready,
    benchmark,
    ledger,
    series,
    summary,
    checks,
    unreconciled: ready && !pricesLoading && hasBlockingFailure(checks),
    history,
  };
}

function allSettled(...queries: Array<{ isPending: boolean }>) {
  return queries.every((query) => !query.isPending);
}

function toHistoryPoint(point: LedgerSeries['points'][number]): HistoryPoint {
  return {
    date: point.date,
    tradingDate: point.date,
    asOfTimestamp: null,
    provisional: false,
    invested: point.netInvestedUsd,
    costBasis: 0,
    navUser: point.navUsd,
    navSpy: 0,
    returnPctUser: point.cumulativeTwr,
    returnPctSpy: point.benchmarkCumulative ?? 0,
    pnlUser: point.pnlUsd,
    pnlSpy: 0,
    txns: point.trades.map((trade) => ({
      side: trade.side,
      ticker: trade.ticker,
      shares: trade.shares,
      price: trade.shares > 0 ? Math.abs(trade.cashUsd) / trade.shares : 0,
      settled_amount_usd: trade.cashUsd,
      kind: 'dca' as const,
    })),
  };
}
