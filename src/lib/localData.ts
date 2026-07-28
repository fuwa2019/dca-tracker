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
import { aggregatePositions, unrealizedPL } from '@/lib/calc/position';
import type { PriceMap } from '@/hooks/useDailyPrices';
import type {
  CashflowRow,
  PerformanceCacheStatus,
  PortfolioHistory,
  SettingsRow,
  ShareLinkRow,
  SharedPortfolio,
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

const DEMO_ALLOCATIONS = [
  { ticker: 'QQQ', monthlyUsd: 65 },
  { ticker: 'NVDA', monthlyUsd: 45 },
  { ticker: 'AAPL', monthlyUsd: 30 },
  { ticker: 'MSFT', monthlyUsd: 25 },
  { ticker: 'SMH', monthlyUsd: 25 },
  { ticker: 'SGOV', monthlyUsd: 10 },
] as const;

const DEMO_MONTHLY_USD = DEMO_ALLOCATIONS.reduce((sum, row) => sum + row.monthlyUsd, 0);

const DERIVED_SERIES = [
  { ticker: 'NVDA', start: 12, beta: 1.65, drift: 1.8, wave: 0.08, phase: 0.2 },
  { ticker: 'AAPL', start: 24, beta: 0.82, drift: 0.22, wave: 0.025, phase: 1.7 },
  { ticker: 'MSFT', start: 38, beta: 0.95, drift: 0.38, wave: 0.03, phase: 2.4 },
  { ticker: 'SMH', start: 48, beta: 1.25, drift: 0.72, wave: 0.05, phase: 1.0 },
  { ticker: 'SGOV', start: 100, beta: 0.02, drift: 0.05, wave: 0.002, phase: 0 },
] as const;

const DEMO_QUOTE_CHANGE: Record<string, number> = {
  NVDA: 0.026,
  AAPL: 0.009,
  MSFT: 0.004,
  SGOV: 0.0001,
  QQQ: -0.012,
  SMH: -0.024,
};

function buildLocalPriceSeries(): Record<string, Array<[string, number]>> {
  const out: Record<string, Array<[string, number]>> = { ...dataset.prices };
  const base = dataset.prices[LOCAL_TICKER] ?? [];
  const first = base[0]?.[1] ?? 1;
  const denom = Math.max(1, base.length - 1);

  for (const cfg of DERIVED_SERIES) {
    if (out[cfg.ticker]) continue;
    out[cfg.ticker] = base.map(([date, close], i) => {
      const t = i / denom;
      const broadReturn = Math.max(0.01, close / first);
      const cycle = 1 + cfg.wave * Math.sin(t * Math.PI * 7 + cfg.phase);
      const price = cfg.start * Math.pow(broadReturn, cfg.beta) * (1 + cfg.drift * t) * cycle;
      return [date, Number(Math.max(1, price).toFixed(4))];
    });
  }
  return out;
}

const localPriceSeries = buildLocalPriceSeries();

/** ticker → date → adjusted close (matches `useDailyPrices` PriceMap shape). */
export const localPriceMap: PriceMap = (() => {
  const map: PriceMap = new Map();
  for (const [ticker, points] of Object.entries(localPriceSeries)) {
    map.set(ticker, new Map(points));
  }
  return map;
})();

function priceSeries(ticker: string): Array<[string, number]> {
  return localPriceSeries[ticker] ?? [];
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

export const localTransactions: TransactionRow[] = trades.flatMap(([date], monthIndex) =>
  DEMO_ALLOCATIONS.map((allocation, assetIndex) => {
    const close = priceSeries(allocation.ticker).find(([d]) => d === date)?.[1] ?? 1;
    return {
      id: `local-txn-${monthIndex}-${allocation.ticker}`,
      user_id: LOCAL_USER.id,
      batch_id: null,
      trade_date: date,
      ticker: allocation.ticker,
      side: 'buy' as const,
      price: close,
      shares: Number((allocation.monthlyUsd / close).toFixed(6)),
      fees_usd: 0,
      kind: assetIndex === 0 ? 'dca' as const : 'lumpsum' as const,
      note: '[LOCAL_DEMO]',
      source_description: null,
      import_source: null,
      import_key: null,
      created_at: `${date}T00:0${assetIndex}:00.000Z`,
      updated_at: `${date}T00:0${assetIndex}:00.000Z`,
    };
  }),
);

export const localCashflows: CashflowRow[] = trades.map(([date], i) => ({
  id: `local-cf-${i}`,
  user_id: LOCAL_USER.id,
  batch_id: null,
  cny_out_date: date,
  cny_amount: Number((DEMO_MONTHLY_USD * dataset.targetRate).toFixed(2)),
  usd_in_date: date,
  usd_amount: DEMO_MONTHLY_USD,
  target_rate: dataset.targetRate,
  fees_cny: 0,
  fees_usd: 0,
  cashflow_kind: 'fx_transfer',
  source_action: null,
  source_description: null,
  import_source: null,
  import_key: null,
  note: '[LOCAL_DEMO]',
  created_at: `${date}T00:00:00.000Z`,
}));

export const localSettings: SettingsRow = {
  user_id: LOCAL_USER.id,
  target_usd: 1_000_000,
  expected_annual_ret: 0.08,
  monthly_dca_usd: DEMO_MONTHLY_USD,
  email_enabled: false,
  email_to: null,
  cost_basis_default: 'avg',
  watchlist: DEMO_ALLOCATIONS.map((row) => row.ticker),
  benchmarks: [LOCAL_BENCHMARK],
  selected_benchmark: LOCAL_BENCHMARK,
  updated_at: new Date().toISOString(),
};

/** Last bundled close per symbol, presented as a "current" quote. */
export const localQuotes: Quote[] = Object.entries(localPriceSeries).map(([ticker, points]) => {
  const last = points[points.length - 1];
  const price = last?.[1] ?? null;
  const demoChangePct = DEMO_QUOTE_CHANGE[ticker];
  const prev = points[points.length - 2] ?? last;
  const prevClose = price != null && demoChangePct != null
    ? price / (1 + demoChangePct)
    : prev?.[1] ?? null;
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
  asOf: new Date(`${localPriceSeries[LOCAL_TICKER].at(-1)?.[0]}T00:00:00Z`),
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

export const LOCAL_SHARE_TOKEN = 'localdemoactive000000000000000001';

const localQuoteByTicker = new Map(localQuotes.map((q) => [q.ticker, q]));
const localSharePositions = aggregatePositions(localTransactions)
  .map((position) => {
    const quote = localQuoteByTicker.get(position.ticker);
    const { marketValue, unrealizedPct } = unrealizedPL(position, quote?.price ?? null, 'avg');
    return {
      ticker: position.ticker,
      marketValue,
      returnPct: unrealizedPct,
      dayChangePct: quote?.changePct ?? null,
    };
  })
  .filter((row) => row.marketValue > 0)
  .sort((a, b) => b.marketValue - a.marketValue);
const localShareTotal = localSharePositions.reduce((sum, row) => sum + row.marketValue, 0);

export const localSharedPortfolio: SharedPortfolio = {
  positions: localSharePositions.map((row) => ({
    ticker: row.ticker,
    weight_pct: localShareTotal > 0 ? row.marketValue / localShareTotal : 0,
    return_pct: row.returnPct,
    day_change_pct: row.dayChangePct,
  })),
  total_return_pct: localPortfolioHistory.series.at(-1)?.return_pct_user ?? 0,
  cash_weight_pct: 0,
  has_snapshot_price: true,
  generated_at: localPortfolioHistory.generated_at,
};

export const localShareLinks: ShareLinkRow[] = [
  {
    token: LOCAL_SHARE_TOKEN,
    user_id: LOCAL_USER.id,
    expires_at: null,
    revoked: false,
    created_at: localPortfolioHistory.generated_at,
    access_count: 12,
    last_accessed_at: localPortfolioHistory.generated_at,
  },
  {
    token: 'localdemorevoked0000000000000002',
    user_id: LOCAL_USER.id,
    expires_at: null,
    revoked: true,
    created_at: '2025-12-31T00:00:00.000Z',
    access_count: 3,
    last_accessed_at: '2026-01-15T00:00:00.000Z',
  },
];
