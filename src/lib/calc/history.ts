import type { TransactionRow, CashflowRow } from '@/lib/database.types';
import type { PriceMap } from '@/hooks/useDailyPrices';

export const BENCHMARK_TICKER = 'SPY';

export interface HistoryPoint {
  date: string;
  invested: number;          // cumulative cashflow.usd_amount up to and including this day
  costBasis: number;         // cumulative buy notional minus sell notional (signed cost)
  navUser: number;           // user's portfolio NAV: Σ netShares(d) × close(d)
  navSpy: number;            // SPY benchmark NAV under "buy SPY on each cashflow date" model
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
 * Build the daily equity-history series with a SPY benchmark obtained by the
 * "money-time-aligned" model: every cashflow.usd_amount is virtually used to
 * buy SPY on its usd_in_date, accumulating spyShares. Daily NAV is
 * spyShares × SPY close(d) plus any cash pending for the next SPY trading day.
 *
 * returnPctUser / returnPctSpy are daily-linked time-weighted returns, similar
 * to PortfolioAnalyst performance reporting: external deposits are removed from
 * that day's return calculation, while buys/sells remain internal transfers.
 * If no cashflows were recorded, buy transactions are treated as inferred
 * external deposits so an imported trade-only history can still show
 * post-purchase performance.
 *
 * Forward-fill rule: when a ticker's price is missing for a date (e.g. between
 * trading days, holidays, or pre-data dates), we re-use the most recent prior
 * close. If no prior close exists yet, we use the latest trade price as the
 * temporary account-equity anchor until market closes arrive.
 */
export function buildEquityHistory(input: BuildHistoryInput): HistoryPoint[] {
  const { transactions, cashflows, prices, todayQuotes, todaySpyPrice, asOf } = input;

  // Earliest date to start the series from: earliest cashflow USD-in date, or earliest trade
  const cashDates = cashflows.map((c) => c.usd_in_date).filter((d): d is string => !!d);
  const tradeDates = transactions.map((t) => t.trade_date);
  const allEventDates = [...cashDates, ...tradeDates].sort();
  if (allEventDates.length === 0) return [];
  const startIso = allEventDates[0];

  // Warn early if SPY isn't in the prices map — that means the benchmark line
  // will be flat and any 'SPY 对照 0%' bug in the UI starts here.
  if (!prices.has(BENCHMARK_TICKER) || (prices.get(BENCHMARK_TICKER)?.size ?? 0) === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[history] no daily prices for ${BENCHMARK_TICKER} — SPY benchmark will be flat at 0%`);
  }

  const today = asOf ?? new Date();
  const todayIso = isoUtcDate(today);

  const hasRecordedCashflows = cashflows.some((c) => !!c.usd_in_date && Number(c.usd_amount) > 0);

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
  if (!hasRecordedCashflows) {
    for (const t of transactions) {
      if (t.side !== 'buy') continue;
      const inferredDeposit = Number(t.shares) * Number(t.price);
      cashByDate.set(t.trade_date, (cashByDate.get(t.trade_date) ?? 0) + inferredDeposit);
    }
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

    // 1) Apply this day's cashflow (this happens *before* the day's market close)
    const flow = cashByDate.get(iso);
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

    // 3) Compute end-of-day NAV (stock holdings + uninvested cash sitting in Schwab)
    const isLastDay = iso === todayIso;
    let stockMv = 0;
    for (const [ticker, sh] of netShares) {
      if (Math.abs(sh) < 1e-9) continue;
      const px = isLastDay && todayQuotes?.get(ticker) != null
        ? (todayQuotes.get(ticker) as number)
        : (lastClose.get(ticker) ?? lastTradePrice.get(ticker) ?? 0);
      stockMv += sh * px;
    }
    // cash = cumulative deposits minus cumulative buy-cost plus sell-proceeds (= invested - costBasis).
    // We've been tracking costBasis as buys - sells, so cash = invested - costBasis.
    const cashOnDay = invested - costBasis;
    const navUser = stockMv + cashOnDay;
    const spyPxToday = isLastDay && todaySpyPrice != null
      ? todaySpyPrice
      : (lastClose.get(BENCHMARK_TICKER) ?? 0);
    // On the last day, if SPY has a live price and there's still pending cash
    // (e.g. user added a Sat/Sun cashflow and Monday's close isn't in daily_prices yet),
    // drain it against the live price so today's navSpy reflects today's deposit.
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
  if (range === '6M' || range === '1Y') return 'week';
  return 'month';
}
