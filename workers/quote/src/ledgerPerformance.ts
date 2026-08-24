// Ledger TWR V2 cache refresh.
//
// D1 asks for the dashboard and the public share to read one V2 cache. The
// engine is NOT reimplemented here: `computeLedgerTwr` is imported straight
// from the application's pure calculation module, the same code
// `npm run test:finance` feeds Portfolio Performance 0.86.0's own stored ledger
// to. A second implementation would be free to drift from the one the
// reconciliation gate covers.
//
// This module runs under the service role, reads a user's ledger and ordinary
// closes, computes the curve, and posts it to `write_ledger_performance_cache`.
// That RPC validates against an allowlist and rebuilds the payload server-side,
// so nothing here can introduce a key into the cache.
//
// Units: `cumulative_return_pct` is a FRACTION (factor - 1), not a percent,
// despite the name. V1 stores fractions too (`exp(sum(ln(f))) - 1` in
// migration 0026), so the value is written through unscaled and the two
// methods remain directly comparable.

import { computeLedgerTwr } from '../../../src/lib/calc/ledgerTwr.ts';
import type {
  LedgerTwrCashEvent,
  LedgerTwrTrade,
} from '../../../src/lib/calc/ledgerTwr.ts';

export interface LedgerPerformanceEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface LedgerRefreshItem {
  user_id: string;
  benchmark: string;
  status: 'written' | 'skipped' | 'failed';
  points?: number;
  complete?: boolean;
  reason?: string;
}

function serviceHeaders(env: LedgerPerformanceEnv): Record<string, string> {
  return {
    'content-type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
  };
}

async function restGet<T>(env: LedgerPerformanceEnv, path: string): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL!}/rest/v1/${path}`, {
    headers: serviceHeaders(env),
  });
  if (!response.ok) {
    throw new Error(`supabase GET ${path} -> ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function rpc<T>(env: LedgerPerformanceEnv, fn: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL!}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: serviceHeaders(env),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`supabase RPC ${fn} -> ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

type TransactionRow = {
  trade_date: string;
  ticker: string;
  side: string;
  shares: string | number;
  price: string | number;
  settled_amount_usd: string | number | null;
  fees_usd: string | number | null;
};

type CashflowRow = {
  effective_date: string | null;
  usd_in_date: string | null;
  cashflow_kind: string | null;
  usd_amount: string | number | null;
};

type PriceRow = { ticker: string; trade_date: string; close: string | number | null };

/** Signed cash effect of a trade, preferring the broker's settled amount. */
function tradeUsdAmount(row: TransactionRow): number {
  const settled = row.settled_amount_usd === null ? null : Number(row.settled_amount_usd);
  if (settled !== null && Number.isFinite(settled)) return settled;
  const gross = Number(row.shares) * Number(row.price);
  const fees = Number(row.fees_usd ?? 0) || 0;
  // A buy leaves the account, a sell enters it; fees always leave.
  return row.side === 'sell' ? gross - fees : -(gross + fees);
}

export async function refreshLedgerPerformanceForUser(
  env: LedgerPerformanceEnv,
  userId: string,
  benchmark: string,
): Promise<LedgerRefreshItem> {
  const base: LedgerRefreshItem = { user_id: userId, benchmark, status: 'skipped' };

  const [transactions, cashflows] = await Promise.all([
    restGet<TransactionRow[]>(
      env,
      `transactions?select=trade_date,ticker,side,shares,price,settled_amount_usd,fees_usd`
        + `&user_id=eq.${userId}&order=trade_date.asc`,
    ),
    restGet<CashflowRow[]>(
      env,
      `cashflows?select=effective_date,usd_in_date,cashflow_kind,usd_amount`
        + `&user_id=eq.${userId}&order=effective_date.asc`,
    ),
  ]);

  if (transactions.length === 0 && cashflows.length === 0) {
    return { ...base, reason: 'no ledger rows' };
  }

  const trades: LedgerTwrTrade[] = transactions
    .filter((row) => row.side === 'buy' || row.side === 'sell')
    .map((row) => ({
      effective_date: row.trade_date,
      side: row.side as 'buy' | 'sell',
      ticker: row.ticker,
      shares: Number(row.shares),
      price: Number(row.price),
      usd_amount: tradeUsdAmount(row),
    }));

  const cashEvents: LedgerTwrCashEvent[] = cashflows
    .filter((row) => row.cashflow_kind && (row.effective_date ?? row.usd_in_date))
    .map((row) => ({
      effective_date: (row.effective_date ?? row.usd_in_date)!,
      event_type: row.cashflow_kind as LedgerTwrCashEvent['event_type'],
      usd_amount: Number(row.usd_amount ?? 0),
    }));

  const tickers = [...new Set(trades.map((trade) => trade.ticker))];
  const earliest = [...trades.map((t) => t.effective_date), ...cashEvents.map((e) => e.effective_date)]
    .sort()[0];
  if (!earliest) return { ...base, reason: 'no dated ledger rows' };

  const wanted = [...new Set([...tickers, benchmark])];
  // V2 values positions at the ORDINARY close, never the adjusted one.
  const priceRows = await restGet<PriceRow[]>(
    env,
    `daily_prices?select=ticker,trade_date,close`
      + `&ticker=in.(${wanted.map((t) => `"${t}"`).join(',')})`
      + `&trade_date=gte.${earliest}&order=trade_date.asc`,
  );

  const prices = new Map<string, Map<string, number>>();
  const benchmarkCloses = new Map<string, number>();
  for (const row of priceRows) {
    const close = row.close === null ? null : Number(row.close);
    if (close === null || !Number.isFinite(close)) continue;
    if (row.ticker === benchmark) benchmarkCloses.set(row.trade_date, close);
    if (!tickers.includes(row.ticker)) continue;
    let daily = prices.get(row.ticker);
    if (!daily) {
      daily = new Map<string, number>();
      prices.set(row.ticker, daily);
    }
    daily.set(row.trade_date, close);
  }

  const result = computeLedgerTwr({ trades, cash_events: cashEvents, prices });
  if (!result || result.points.length === 0) {
    return { ...base, reason: 'engine produced no points' };
  }

  // Benchmark curve: cumulative return of the benchmark's ordinary close from
  // the first point, carried forward across non-trading days so the two series
  // share a date axis.
  const benchmarkDates = [...benchmarkCloses.keys()].sort();
  const firstBenchmarkDate = benchmarkDates.find((date) => date >= result.points[0].date);
  const baseClose = firstBenchmarkDate ? benchmarkCloses.get(firstBenchmarkDate)! : null;
  let carried: number | null = baseClose;

  const series = result.points.map((point) => {
    const close = benchmarkCloses.get(point.date);
    if (close !== undefined) carried = close;
    const benchmarkReturn = baseClose && baseClose > 0 && carried !== null
      ? carried / baseClose - 1
      : null;
    return {
      date: point.date,
      return_pct_user: point.cumulative_return_pct,
      return_pct_spy: benchmarkReturn,
    };
  });

  // The engine's warnings are human-readable strings. The cache's warning
  // allowlist takes objects, and a free-text string could carry anything, so
  // only the count crosses the boundary — as a typed, amount-free entry.
  const warnings = result.complete
    ? []
    : [{ date: series[series.length - 1].date, type: 'incomplete_ledger_twr' }];

  const written = await rpc<{ ok: boolean; points: number }>(
    env,
    'write_ledger_performance_cache',
    {
      p_user_id: userId,
      p_benchmark: benchmark,
      p_series: series,
      p_complete: result.complete,
      p_warnings: warnings,
    },
  );

  return {
    user_id: userId,
    benchmark,
    status: 'written',
    points: written.points ?? series.length,
    complete: result.complete,
  };
}

export async function runLedgerPerformanceSync(
  env: LedgerPerformanceEnv,
): Promise<LedgerRefreshItem[]> {
  const universe = await rpc<Array<{ user_id: string; benchmark: string }>>(
    env,
    'ledger_performance_refresh_universe',
    {},
  );
  const items: LedgerRefreshItem[] = [];
  for (const row of universe) {
    try {
      items.push(await refreshLedgerPerformanceForUser(env, row.user_id, row.benchmark));
    } catch (error) {
      items.push({
        user_id: row.user_id,
        benchmark: row.benchmark,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return items;
}
