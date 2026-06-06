// Offline data source for the "local version" (VITE_LOCAL_MODE=1).
//
// Builds a 10-year monthly QQQ DCA simulation from the bundled price dataset so
// the dashboard, performance, transactions, cashflows and settings pages all
// render without ever touching Supabase or the Quote Worker.
//
// Everything here is derived once (module scope) and memoized — the dataset is
// static, so there is no reason to recompute per render.

import datasetJson from '@/data/local-dataset.json';
import { LOCAL_USER } from '@/lib/localMode';
import { buildEquityHistory } from '@/lib/calc/history';
import type { PriceMap } from '@/hooks/useDailyPrices';
import type {
  CashflowRow,
  PerformanceCacheStatus,
  PortfolioHistory,
  SettingsRow,
  TransactionRow,
} from '@/lib/database.types';
import type { Quote } from '@/lib/quote';

interface Dataset {
  generatedAt: string;
  ticker: string;
  benchmark: string;
  monthlyUsd: number;
  targetRate: number;
  prices: Record<string, Array<[string, number]>>;
}

const dataset = datasetJson as unknown as Dataset;

export const LOCAL_TICKER = dataset.ticker;
export const LOCAL_BENCHMARK = dataset.benchmark;

/** ticker → date → adjusted close (matches `useDailyPrices` PriceMap shape). */
export const localPriceMap: PriceMap = (() => {
  const map: PriceMap = new Map();
  for (const [ticker, points] of Object.entries(dataset.prices)) {
    map.set(ticker, new Map(points));
  }
  return map;
})();

function priceSeries(ticker: string): Array<[string, number]> {
  return dataset.prices[ticker] ?? [];
}

function firstTradingDayOnOrAfter(monthStart: string): [string, number] | null {
  const month = monthStart.slice(0, 7);
  for (const [date, close] of priceSeries(LOCAL_TICKER)) {
    if (date >= monthStart && date.startsWith(month)) return [date, close];
  }
  return null;
}

/** First trading day of each month across the dataset's covered range. */
function monthlyTradeDays(): Array<[string, number]> {
  const series = priceSeries(LOCAL_TICKER);
  if (series.length === 0) return [];
  const start = series[0][0];
  const end = series[series.length - 1][0];
  const out: Array<[string, number]> = [];
  let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  for (;;) {
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    if (monthStart > end) break;
    const hit = firstTradingDayOnOrAfter(monthStart);
    if (hit) out.push(hit);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const trades = monthlyTradeDays();

export const localTransactions: TransactionRow[] = trades.map(([date, close], i) => ({
  id: `local-txn-${i}`,
  user_id: LOCAL_USER.id,
  batch_id: null,
  trade_date: date,
  ticker: LOCAL_TICKER,
  side: 'buy',
  price: close,
  shares: Number((dataset.monthlyUsd / close).toFixed(6)),
  kind: 'dca',
  note: '[LOCAL_DEMO]',
  created_at: `${date}T00:00:00.000Z`,
  updated_at: `${date}T00:00:00.000Z`,
}));

export const localCashflows: CashflowRow[] = trades.map(([date], i) => ({
  id: `local-cf-${i}`,
  user_id: LOCAL_USER.id,
  batch_id: null,
  cny_out_date: date,
  cny_amount: Number((dataset.monthlyUsd * dataset.targetRate).toFixed(2)),
  usd_in_date: date,
  usd_amount: dataset.monthlyUsd,
  target_rate: dataset.targetRate,
  fees_cny: 0,
  fees_usd: 0,
  note: '[LOCAL_DEMO]',
  created_at: `${date}T00:00:00.000Z`,
}));

export const localSettings: SettingsRow = {
  user_id: LOCAL_USER.id,
  target_usd: 1_000_000,
  expected_annual_ret: 0.08,
  monthly_dca_usd: dataset.monthlyUsd,
  email_enabled: false,
  email_to: null,
  cost_basis_default: 'avg',
  watchlist: ['QQQ', 'SPY', 'VOO'],
  benchmarks: [LOCAL_BENCHMARK],
  selected_benchmark: LOCAL_BENCHMARK,
  updated_at: new Date().toISOString(),
};

/** Last bundled close per symbol, presented as a "current" quote. */
export const localQuotes: Quote[] = Object.entries(dataset.prices).map(([ticker, points]) => {
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  const price = last?.[1] ?? null;
  const prevClose = prev?.[1] ?? null;
  const change = price != null && prevClose != null ? price - prevClose : null;
  const changePct = change != null && prevClose ? change / prevClose : null;
  return {
    ticker,
    source: 'yahoo',
    price,
    displayPrice: price,
    prevClose,
    change,
    changePct,
    currency: 'USD',
    asOf: last?.[0],
    fetchedAt: new Date().toISOString(),
    marketState: 'CLOSED',
    fallback: true,
    providerLabel: '本地数据',
  };
});

const builtHistory = buildEquityHistory({
  transactions: localTransactions,
  cashflows: localCashflows,
  prices: localPriceMap,
  asOf: new Date(`${dataset.prices[LOCAL_TICKER].at(-1)?.[0]}T00:00:00Z`),
});

export const localPortfolioHistory: PortfolioHistory = {
  generated_at: new Date().toISOString(),
  benchmark: LOCAL_BENCHMARK,
  method: 'TWR',
  price_basis: 'adjusted_close',
  flow_basis: 'trade_funding',
  date_basis: 'trading_day',
  dirty: false,
  series: builtHistory.map((p) => ({
    date: p.date,
    trading_date: p.tradingDate ?? p.date,
    as_of_timestamp: p.asOfTimestamp ?? null,
    is_provisional: !!p.provisional,
    invested: p.invested,
    cost_basis: p.costBasis,
    nav_user: p.navUser,
    nav_spy: p.navSpy,
    return_pct_user: p.returnPctUser,
    return_pct_spy: p.returnPctSpy,
    pnl_user: p.pnlUser,
    pnl_spy: p.pnlSpy,
    txns: p.txns,
  })),
};

export const localCacheStatus: PerformanceCacheStatus = {
  exists: localPortfolioHistory.series.length > 0,
  benchmark: LOCAL_BENCHMARK,
  method: 'TWR',
  dirty: false,
  points: localPortfolioHistory.series.length,
  generated_at: localPortfolioHistory.generated_at,
  updated_at: localPortfolioHistory.generated_at,
  last_refresh_attempt_at: localPortfolioHistory.generated_at,
  refresh_ms: 0,
  error: null,
};
