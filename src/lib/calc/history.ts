import type { TransactionRow, CashflowRow } from '@/lib/database.types';
import type { PriceMap } from '@/hooks/useDailyPrices';
import { isoDateInNewYork } from '@/lib/nyse-calendar';

export const BENCHMARK_TICKER = 'SPY';

export interface HistoryPoint {
  date: string;
  tradingDate?: string;
  asOfTimestamp?: string | null;
  provisional?: boolean;
  invested: number;          // cumulative trade-funding flows up to and including this day
  costBasis: number;         // cumulative buy notional minus sell notional (signed cost)
  navUser: number;           // user's portfolio NAV: Σ netShares(d) × close(d)
  navSpy: number;            // SPY benchmark NAV under the same trade-funding flow model
  returnPctUser: number;     // cumulative daily-linked TWR
  returnPctSpy: number;      // cumulative daily-linked TWR for the SPY benchmark
  pnlUser: number;           // navUser - invested
  pnlSpy: number;
  /** Transactions that landed on this date (for marker rendering). */
  txns: Array<{ side: 'buy' | 'sell'; ticker: string; shares: number; price: number; kind: 'dca' | 'lumpsum' }>;
}

export interface BuildHistoryInput {
  transactions: TransactionRow[];
  cashflows: CashflowRow[];
  prices: PriceMap;
  /** Today's real-time quotes (used only for the very last day). */
  todayQuotes?: Map<string, number>;
  /** Today's SPY price (used for the very last day's benchmark NAV). */
  todaySpyPrice?: number;
  asOf?: Date;
}

/**
 * Build the account-value line shown on the dashboard.
 *
 * This is deliberately separate from buildEquityHistory(): the latter models
 * trade-funded TWR and therefore ignores idle cash by design. Account value
 * must instead include actual USD deposits, then subtract buys/add sells on
 * their real dates. Do not derive old values from today's NAV and a return
 * series: later deposits would be incorrectly projected into the past.
 */
export function buildAccountValueHistory(input: BuildHistoryInput): HistoryPoint[] {
  const { transactions, cashflows, prices, todayQuotes, asOf } = input;
  const eventDates = [
    ...transactions.map((t) => t.trade_date),
    ...cashflows.map((c) => c.usd_in_date ?? c.cny_out_date),
  ].filter(Boolean).sort();
  if (eventDates.length === 0) return [];

  const startIso = eventDates[0];
  const todayIso = isoDateInNewYork(asOf ?? new Date());
  const depositsByDate = new Map<string, number>();
  for (const cashflow of cashflows) {
    const amount = Number(cashflow.usd_amount) || 0;
    const date = cashflow.usd_in_date ?? cashflow.cny_out_date;
    if (amount > 0 && date) depositsByDate.set(date, (depositsByDate.get(date) ?? 0) + amount);
  }
  const txnsByDate = new Map<string, TransactionRow[]>();
  for (const txn of transactions) {
    const rows = txnsByDate.get(txn.trade_date) ?? [];
    rows.push(txn);
    txnsByDate.set(txn.trade_date, rows);
  }

  const lastClose = new Map<string, number>();
  const lastTradePrice = new Map<string, number>();
  const shares = new Map<string, number>();
  const out: HistoryPoint[] = [];
  let cash = 0;
  let invested = 0;
  let costBasis = 0;

  for (let iso = startIso; iso <= todayIso; iso = addDays(iso, 1)) {
    for (const [ticker, dailyMap] of prices) {
      const close = dailyMap.get(iso);
      if (typeof close === 'number' && close > 0) lastClose.set(ticker, close);
    }

    const deposit = depositsByDate.get(iso) ?? 0;
    cash += deposit;
    invested += deposit;
    const dayTxns = txnsByDate.get(iso) ?? [];
    for (const txn of dayTxns) {
      const quantity = Number(txn.shares) || 0;
      const price = Number(txn.price) || 0;
      const notional = quantity * price;
      if (!(quantity > 0) || !(price > 0)) continue;
      const delta = txn.side === 'buy' ? quantity : -quantity;
      shares.set(txn.ticker, (shares.get(txn.ticker) ?? 0) + delta);
      lastTradePrice.set(txn.ticker, price);
      cash += txn.side === 'buy' ? -notional : notional;
      costBasis += txn.side === 'buy' ? notional : -notional;
    }

    let stockValue = 0;
    for (const [ticker, quantity] of shares) {
      if (Math.abs(quantity) < 1e-9) continue;
      const price = iso === todayIso && todayQuotes?.get(ticker) != null
        ? todayQuotes.get(ticker)!
        : (lastClose.get(ticker) ?? lastTradePrice.get(ticker) ?? 0);
      stockValue += quantity * price;
    }
    const navUser = stockValue + cash;
    out.push({
      date: iso,
      invested,
      costBasis,
      navUser,
      navSpy: 0,
      returnPctUser: 0,
      returnPctSpy: 0,
      pnlUser: navUser - invested,
      pnlSpy: 0,
      txns: dayTxns.map((txn) => ({
        side: txn.side,
        ticker: txn.ticker,
        shares: Number(txn.shares),
        price: Number(txn.price),
        kind: txn.kind,
      })),
    });
  }

  return out;
}

/**
 * Build the daily equity-history series with a SPY benchmark obtained by the
 * trade-funding model: the curve starts on the first trade date, sell proceeds
 * fund later buys first, and only the unfunded portion of a buy is treated as a
 * new external flow. Those same inferred flows virtually buy SPY.
 *
 * returnPctUser / returnPctSpy are daily-linked time-weighted returns, similar
 * to PortfolioAnalyst performance reporting: external trade-funding flows are
 * removed from that day's return calculation, while sells and cash reuse remain
 * internal portfolio transfers. Cashflows are intentionally ignored here; they
 * affect account NAV elsewhere, but not the trading-performance curve.
 *
 * Cache-backed dashboard/share charts are generated in SQL on SPY price dates
 * only, so holidays and weekends are not counted as observations. This local
 * helper is retained for legacy/offline callers and still forward-fills missing
 * ticker prices while iterating calendar days.
 */
export function buildEquityHistory(input: BuildHistoryInput): HistoryPoint[] {
  const { transactions, prices, todayQuotes, todaySpyPrice, asOf } = input;

  // Earliest date to start the series from: earliest trade.
  const tradeDates = transactions.map((t) => t.trade_date);
  if (tradeDates.length === 0) return [];
  const startIso = [...tradeDates].sort()[0];

  // Warn early if SPY isn't in the prices map — that means the benchmark line
  // will be flat and any benchmark line stuck at 0% bug in the UI starts here.
  if (!prices.has(BENCHMARK_TICKER) || (prices.get(BENCHMARK_TICKER)?.size ?? 0) === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[history] no daily prices for ${BENCHMARK_TICKER} — SPY benchmark will be flat at 0%`);
  }

  const today = asOf ?? new Date();
  const todayIso = isoDateInNewYork(today);

  // Pre-index events by date
  const flowByDate = inferTradeFundingFlows(transactions);
  const txnsByDate = new Map<string, HistoryPoint['txns']>();
  for (const t of transactions) {
    const list = txnsByDate.get(t.trade_date) ?? [];
    list.push({
      side: t.side,
      ticker: t.ticker,
      shares: Number(t.shares),
      price: Number(t.price),
      kind: t.kind,
    });
    txnsByDate.set(t.trade_date, list);
  }

  // Per-ticker latest known close (for forward-fill)
  const lastClose = new Map<string, number>();
  const lastTradePrice = new Map<string, number>();
  const netShares = new Map<string, number>();
  let spyShares = 0;
  let pendingSpyCash = 0; // cash sitting in queue waiting for the next SPY trading day
  let invested = 0;
  let costBasis = 0;
  let prevNavUser: number | null = null;
  let prevNavSpy: number | null = null;
  let cumulativeUser = 1;
  let cumulativeSpy = 1;

  // Pre-compute every date's close per ticker (with forward-fill in date order)
  // We iterate day-by-day to keep lastClose monotonically updated.

  const out: HistoryPoint[] = [];
  for (let iso = startIso; iso <= todayIso; iso = addDays(iso, 1)) {
    // Update forward-fill for every ticker we know about (from prices map)
    for (const [ticker, dailyMap] of prices) {
      const c = dailyMap.get(iso);
      if (typeof c === 'number') lastClose.set(ticker, c);
    }

    // 1) Apply this day's external trade-funding flow before the market close.
    const flow = flowByDate.get(iso);
    if (flow && flow > 0) {
      invested += flow;
      pendingSpyCash += flow;
    }

    // 2) Drain any pending SPY cash if today is a SPY trading day
    //    (i.e., we have an actual close price for SPY on this date — not just a forward-filled prior close).
    const spyCloseToday = prices.get(BENCHMARK_TICKER)?.get(iso);
    if (spyCloseToday && spyCloseToday > 0 && pendingSpyCash > 0) {
      spyShares += pendingSpyCash / spyCloseToday;
      pendingSpyCash = 0;
    }

    // 3) Apply this day's transactions
    const dayTxns = txnsByDate.get(iso) ?? [];
    for (const t of dayTxns) {
      const delta = t.side === 'buy' ? t.shares : -t.shares;
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + delta);
      lastTradePrice.set(t.ticker, t.price);
      costBasis += t.side === 'buy' ? t.shares * t.price : -t.shares * t.price;
    }

    // 3) Compute end-of-day NAV (stock holdings + cash generated/reused by trades)
    const isLastDay = iso === todayIso;
    let stockMv = 0;
    for (const [ticker, sh] of netShares) {
      if (Math.abs(sh) < 1e-9) continue;
      const px = isLastDay && todayQuotes?.get(ticker) != null
        ? (todayQuotes.get(ticker) as number)
        : (lastClose.get(ticker) ?? lastTradePrice.get(ticker) ?? 0);
      stockMv += sh * px;
    }
    // cash = cumulative trade-funding flows minus cumulative buy-cost plus sell-proceeds.
    // We've been tracking costBasis as buys - sells, so cash = invested - costBasis.
    const cashOnDay = invested - costBasis;
    const navUser = stockMv + cashOnDay;
    const spyPxToday = isLastDay && todaySpyPrice != null
      ? todaySpyPrice
      : (lastClose.get(BENCHMARK_TICKER) ?? 0);
    // On the last day, if SPY has a live price and there's still pending flow
    // from a non-trading day, drain it against the live price.
    if (isLastDay && todaySpyPrice != null && todaySpyPrice > 0 && pendingSpyCash > 0) {
      spyShares += pendingSpyCash / todaySpyPrice;
      pendingSpyCash = 0;
    }
    const navSpy = spyShares * spyPxToday + pendingSpyCash;

    if (prevNavUser !== null && prevNavUser > 0) {
      const dailyReturnUser = (navUser - (flow ?? 0)) / prevNavUser - 1;
      if (Number.isFinite(dailyReturnUser) && 1 + dailyReturnUser > 0) {
        cumulativeUser *= 1 + dailyReturnUser;
      } else if (Number.isFinite(dailyReturnUser)) {
        // eslint-disable-next-line no-console
        console.warn(`[history] skipping extreme daily return for user on ${iso}: dailyReturn=${dailyReturnUser} (1+r <= 0 would contaminate cumulative product)`);
      }
    }
    if (prevNavSpy !== null && prevNavSpy > 0) {
      const dailyReturnSpy = (navSpy - (flow ?? 0)) / prevNavSpy - 1;
      if (Number.isFinite(dailyReturnSpy) && 1 + dailyReturnSpy > 0) {
        cumulativeSpy *= 1 + dailyReturnSpy;
      } else if (Number.isFinite(dailyReturnSpy)) {
        // eslint-disable-next-line no-console
        console.warn(`[history] skipping extreme daily return for SPY on ${iso}: dailyReturn=${dailyReturnSpy} (1+r <= 0 would contaminate cumulative product)`);
      }
    }
    prevNavUser = navUser;
    prevNavSpy = navSpy;

    out.push({
      date: iso,
      invested,
      costBasis,
      navUser,
      navSpy,
      returnPctUser: cumulativeUser - 1,
      returnPctSpy: cumulativeSpy - 1,
      pnlUser: navUser - invested,
      pnlSpy: navSpy - invested,
      txns: dayTxns,
    });
  }

  return out;
}

function inferTradeFundingFlows(transactions: TransactionRow[]): Map<string, number> {
  const out = new Map<string, number>();
  let cash = 0;

  const ordered = [...transactions].sort((a, b) =>
    a.trade_date.localeCompare(b.trade_date)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id)
  );

  for (const t of ordered) {
    const notional = Number(t.shares) * Number(t.price);
    if (!Number.isFinite(notional) || notional <= 0) continue;

    if (t.side === 'sell') {
      cash += notional;
      continue;
    }

    const flow = Math.max(notional - cash, 0);
    if (flow > 0) {
      out.set(t.trade_date, (out.get(t.trade_date) ?? 0) + flow);
    }
    cash = Math.max(cash - notional, 0);
  }

  return out;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Slice the history to the requested range, anchored on the last point. */
export type RangeKey = '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

export function sliceByRange(history: HistoryPoint[], range: RangeKey): HistoryPoint[] {
  if (range === 'ALL' || history.length === 0) return history;
  const last = history[history.length - 1];
  if (range === 'YTD') {
    const startOfYear = `${last.date.slice(0, 4)}-01-01`;
    return history.filter((p) => p.date >= startOfYear);
  }
  const days = { '1M': 30, '3M': 92, '6M': 184, '1Y': 365 }[range];
  const cutoff = addDays(last.date, -days);
  return history.filter((p) => p.date >= cutoff);
}

/** What ranges have enough data to display (≥ 5 points). */
export function availableRanges(history: HistoryPoint[]): RangeKey[] {
  if (history.length === 0) return ['ALL'];
  const all: RangeKey[] = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
  return all.filter((r) => sliceByRange(history, r).length >= 5);
}

/**
 * Aggregate per-day transaction markers into per-week or per-month buckets so the
 * chart doesn't drown in dots on long ranges. Returns one synthetic marker per
 * bucket, attached to the bucket's last day's data point.
 */
export interface MarkerPoint {
  date: string;
  navUser: number;
  returnPctUser: number;
  pnlUser: number;
  totalBuyUsd: number;
  totalSellUsd: number;
  count: number;
  hasLumpsum: boolean;
}

export function aggregateMarkers(
  history: HistoryPoint[],
  granularity: 'day' | 'week' | 'month',
): MarkerPoint[] {
  if (history.length === 0) return [];
  const buckets = new Map<string, MarkerPoint>();
  for (const p of history) {
    if (p.txns.length === 0) continue;
    const key = granularity === 'day' ? p.date
      : granularity === 'week' ? isoWeekKey(p.date)
        : p.date.slice(0, 7);
    const existing = buckets.get(key) ?? {
      date: p.date,
      navUser: p.navUser,
      returnPctUser: p.returnPctUser,
      pnlUser: p.pnlUser,
      totalBuyUsd: 0,
      totalSellUsd: 0,
      count: 0,
      hasLumpsum: false,
    };
    for (const t of p.txns) {
      const notional = t.shares * t.price;
      if (t.side === 'buy') existing.totalBuyUsd += notional;
      else existing.totalSellUsd += notional;
      existing.count += 1;
      if (t.kind === 'lumpsum') existing.hasLumpsum = true;
    }
    // Anchor to the latest day in the bucket
    existing.date = p.date;
    existing.navUser = p.navUser;
    existing.returnPctUser = p.returnPctUser;
    existing.pnlUser = p.pnlUser;
    buckets.set(key, existing);
  }
  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isoWeekKey(iso: string): string {
  // Cheap: YYYY-Www approx using ISO week-of-year computed from day-of-year/7
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Pick a marker aggregation granularity based on the visible range. */
export function markerGranularityFor(range: RangeKey): 'day' | 'week' | 'month' {
  if (range === '1M' || range === '3M') return 'day';
  if (range === '6M' || range === 'YTD' || range === '1Y') return 'week';
  return 'month';
}
