// Ledger TWR V2 cache refresh.
//
// The dashboard, the performance page and the public share must report one
// return. The engine is NOT reimplemented here: `portfolioLedger` is imported
// straight from the application's pure calculation module, the same code the
// private pages run in the browser and `npm run test:finance` covers. A second
// implementation would be free to drift from it.
//
// This module runs under the service role, reads a user's ledger, ordinary
// closes and the benchmark's adjusted closes, computes the curve, and posts
// only percentages to `write_ledger_performance_cache`. That RPC validates
// against an allowlist and rebuilds the payload server-side, so nothing here
// can introduce a key into the cache.
//
// Units: `return_pct_user` is a FRACTION (factor - 1), not a percent, despite
// the name. V1 stores fractions too, so the two methods stay comparable.

import {
  buildLedger,
  buildLedgerSeries,
  type LedgerCashflowRow,
  type LedgerTransactionRow,
} from '../../../src/lib/calc/portfolioLedger.ts';

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

type PriceRow = {
  ticker: string;
  trade_date: string;
  close: string | number | null;
  adjusted_close: string | number | null;
};

export async function refreshLedgerPerformanceForUser(
  env: LedgerPerformanceEnv,
  userId: string,
  benchmark: string,
): Promise<LedgerRefreshItem> {
  const base: LedgerRefreshItem = { user_id: userId, benchmark, status: 'skipped' };

  const [transactions, cashflows] = await Promise.all([
    restGet<LedgerTransactionRow[]>(
      env,
      `transactions?select=trade_date,ticker,side,shares,price,settled_amount_usd,fees_usd,source_currency,source_price,fx_rate_to_usd`
        + `&user_id=eq.${userId}&order=trade_date.asc`,
    ),
    restGet<LedgerCashflowRow[]>(
      env,
      `cashflows?select=effective_date,usd_in_date,cny_out_date,cashflow_kind,usd_amount,cny_amount`
        + `&user_id=eq.${userId}&order=effective_date.asc`,
    ),
  ]);

  if (transactions.length === 0 && cashflows.length === 0) {
    return { ...base, reason: 'no ledger rows' };
  }

  const ledger = buildLedger(transactions, cashflows);
  const tickers = [...new Set(ledger.trades.map((trade) => trade.ticker))];
  const earliest = [...ledger.trades.map((t) => t.date), ...ledger.cash.map((e) => e.date)].sort()[0];
  if (!earliest) return { ...base, reason: 'no dated ledger rows' };

  const wanted = [...new Set([...tickers, benchmark])];
  // Positions are valued at the ORDINARY close (dividends are explicit cash
  // events); the benchmark uses the adjusted close as its total-return proxy.
  const priceRows = await restGet<PriceRow[]>(
    env,
    `daily_prices?select=ticker,trade_date,close,adjusted_close`
      + `&ticker=in.(${wanted.map((t) => `"${t}"`).join(',')})`
      + `&trade_date=gte.${earliest}&order=trade_date.asc`,
  );

  const closes = new Map<string, Map<string, number>>();
  const benchmarkPrices = new Map<string, number>();
  for (const row of priceRows) {
    const close = row.close === null ? null : Number(row.close);
    const adjusted = row.adjusted_close === null ? close : Number(row.adjusted_close);
    if (row.ticker === benchmark && adjusted !== null && Number.isFinite(adjusted)) {
      benchmarkPrices.set(row.trade_date, adjusted);
    }
    if (close === null || !Number.isFinite(close) || !tickers.includes(row.ticker)) continue;
    let daily = closes.get(row.ticker);
    if (!daily) {
      daily = new Map<string, number>();
      closes.set(row.ticker, daily);
    }
    daily.set(row.trade_date, close);
  }

  const result = buildLedgerSeries({ ledger, closes, benchmark: benchmarkPrices });
  if (result.points.length === 0) {
    return { ...base, reason: 'engine produced no points' };
  }

  const series = result.points.map((point) => ({
    date: point.date,
    return_pct_user: point.cumulativeTwr,
    return_pct_spy: point.benchmarkCumulative,
  }));

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
