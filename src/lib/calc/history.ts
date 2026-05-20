import type { TransactionRow, CashflowRow } from '@/lib/database.types';
import type { PriceMap } from '@/hooks/useDailyPrices';

export const BENCHMARK_TICKER = 'SPY';

export interface HistoryPoint {
  date: string;
  invested: number;          // cumulative cashflow.usd_amount up to and including this day
  costBasis: number;         // cumulative buy notional minus sell notional (signed cost)
  navUser: number;           // user's portfolio NAV: Σ netShares(d) × close(d)
  navSpy: number;            // SPY benchmark NAV under "buy SPY on each cashflow date" model
  returnPctUser: number;     // (navUser - invested) / invested
  returnPctSpy: number;      // (navSpy - invested) / invested
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
 * Build the daily equity-history series with a SPY benchmark obtained by the
 * "money-time-aligned" model: every cashflow.usd_amount is virtually used to
 * buy SPY on its usd_in_date, accumulating spyShares. Daily NAV is
 * spyShares × SPY close(d).
 *
 * Forward-fill rule: when a ticker's price is missing for a date (e.g. between
 * trading days, holidays, or pre-data dates), we re-use the most recent prior
 * close. If no prior close exists yet, we treat that ticker's contribution
 * as zero for that day.
 */
export function buildEquityHistory(input: BuildHistoryInput): HistoryPoint[] {
  const { transactions, cashflows, prices, todayQuotes, todaySpyPrice, asOf } = input;

  // Earliest date to start the series from: earliest cashflow USD-in date, or earliest trade
  const cashDates = cashflows.map((c) => c.usd_in_date).filter((d): d is string => !!d);
  const tradeDates = transactions.map((t) => t.trade_date);
  const allEventDates = [...cashDates, ...tradeDates].sort();
  if (allEventDates.length === 0) return [];
  const startIso = allEventDates[0];

  const today = asOf ?? new Date();
  const todayIso = isoUtcDate(today);

  // Pre-index events by date
  const cashByDate = new Map<string, number>();
  for (const c of cashflows) {
    if (c.usd_in_date && c.usd_amount) {
      cashByDate.set(c.usd_in_date, (cashByDate.get(c.usd_in_date) ?? 0) + Number(c.usd_amount));
    }
  }
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
  const netShares = new Map<string, number>();
  let spyShares = 0;
  let invested = 0;
  let costBasis = 0;

  // Pre-compute every date's close per ticker (with forward-fill in date order)
  // We iterate day-by-day to keep lastClose monotonically updated.

  const out: HistoryPoint[] = [];
  for (let iso = startIso; iso <= todayIso; iso = addDays(iso, 1)) {
    // Update forward-fill for every ticker we know about (from prices map)
    for (const [ticker, dailyMap] of prices) {
      const c = dailyMap.get(iso);
      if (typeof c === 'number') lastClose.set(ticker, c);
    }

    // 1) Apply this day's cashflow (this happens *before* the day's market close)
    const flow = cashByDate.get(iso);
    if (flow && flow > 0) {
      invested += flow;
      const spyPx = lastClose.get(BENCHMARK_TICKER);
      if (spyPx && spyPx > 0) {
        spyShares += flow / spyPx;
      }
    }

    // 2) Apply this day's transactions
    const dayTxns = txnsByDate.get(iso) ?? [];
    for (const t of dayTxns) {
      const delta = t.side === 'buy' ? t.shares : -t.shares;
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + delta);
      costBasis += t.side === 'buy' ? t.shares * t.price : -t.shares * t.price;
    }

    // 3) Compute end-of-day NAV
    const isLastDay = iso === todayIso;
    let navUser = 0;
    for (const [ticker, sh] of netShares) {
      if (Math.abs(sh) < 1e-9) continue;
      const px = isLastDay && todayQuotes?.get(ticker) != null
        ? (todayQuotes.get(ticker) as number)
        : (lastClose.get(ticker) ?? 0);
      navUser += sh * px;
    }
    const spyPxToday = isLastDay && todaySpyPrice != null
      ? todaySpyPrice
      : (lastClose.get(BENCHMARK_TICKER) ?? 0);
    const navSpy = spyShares * spyPxToday;

    out.push({
      date: iso,
      invested,
      costBasis,
      navUser,
      navSpy,
      returnPctUser: invested > 0 ? (navUser - invested) / invested : 0,
      returnPctSpy: invested > 0 ? (navSpy - invested) / invested : 0,
      pnlUser: navUser - invested,
      pnlSpy: navSpy - invested,
      txns: dayTxns,
    });
  }

  return out;
}

function isoUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Slice the history to the requested range, anchored on the last point. */
export type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'ALL';

export function sliceByRange(history: HistoryPoint[], range: RangeKey): HistoryPoint[] {
  if (range === 'ALL' || history.length === 0) return history;
  const last = history[history.length - 1];
  const days = { '1M': 30, '3M': 92, '6M': 184, '1Y': 365 }[range];
  const cutoff = addDays(last.date, -days);
  return history.filter((p) => p.date >= cutoff);
}

/** What ranges have enough data to display (≥ 5 points). */
export function availableRanges(history: HistoryPoint[]): RangeKey[] {
  if (history.length === 0) return ['ALL'];
  const all: RangeKey[] = ['1M', '3M', '6M', '1Y', 'ALL'];
  return all.filter((r) => sliceByRange(history, r).length >= 5);
}

/**
 * Aggregate per-day transaction markers into per-week or per-month buckets so the
 * chart doesn't drown in dots on long ranges. Returns one synthetic marker per
 * bucket, attached to the bucket's last day's data point.
 */
export function aggregateMarkers(
  history: HistoryPoint[],
  granularity: 'day' | 'week' | 'month',
): Array<{
  date: string;
  /** Index into the slice (so chart can position on x axis). */
  navUser: number;
  returnPctUser: number;
  totalBuyUsd: number;
  totalSellUsd: number;
  count: number;
  hasLumpsum: boolean;
}> {
  if (history.length === 0) return [];
  const buckets = new Map<string, {
    date: string;
    navUser: number;
    returnPctUser: number;
    totalBuyUsd: number;
    totalSellUsd: number;
    count: number;
    hasLumpsum: boolean;
  }>();
  for (const p of history) {
    if (p.txns.length === 0) continue;
    const key = granularity === 'day' ? p.date
      : granularity === 'week' ? isoWeekKey(p.date)
        : p.date.slice(0, 7);
    const existing = buckets.get(key) ?? {
      date: p.date,
      navUser: p.navUser,
      returnPctUser: p.returnPctUser,
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
  if (range === '6M' || range === '1Y') return 'week';
  return 'month';
}
