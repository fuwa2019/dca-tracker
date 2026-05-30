import { isoDateInNewYork } from '@/lib/nyse-calendar';

/**
 * Time-weighted return (TWR) — geometric chain of sub-period returns that
 * removes the effect of cashflow timing/size. The goal: assess strategy
 * performance regardless of when you happened to deposit money.
 *
 * Approach used here is the "Modified Dietz" approximation per sub-period
 * (small periods → close to true TWR), with sub-periods bounded by cashflow
 * dates. Since we don't have historical daily portfolio NAV from a broker,
 * we approximate per-sub-period market value from:
 *   value(t) = Σ over tickers: net_shares_at(t) × close_price_on(t)
 *
 * Caller supplies a `priceOn(ticker, date)` function (e.g. from cached
 * Yahoo chart endpoint). When called without historical prices, we fall
 * back to cumulative-buy cost basis as a no-growth lower bound — clearly
 * marked so the UI can disclose the approximation.
 */
export interface TwrInput {
  transactions: Array<{ trade_date: string; ticker: string; side: 'buy' | 'sell'; price: number; shares: number }>;
  cashflows: Array<{ usd_in_date: string | null; usd_amount: number | null }>;
  currentMarketValueUsd: number;
  asOfDate?: Date;
  /** Optional callback to get historical price on a US trading-date ISO string. */
  priceOn?: (ticker: string, isoDate: string) => number | null;
}

export interface TwrResult {
  twr: number;
  annualized: number | null;
  /** Was historical pricing available, or did we fall back to cost-basis approximation? */
  approximated: boolean;
  periodDays: number;
}

export function computeTwr(input: TwrInput): TwrResult | null {
  const { transactions, cashflows, currentMarketValueUsd, asOfDate, priceOn } = input;
  if (transactions.length === 0) return null;

  // Build flow timeline: array of dates where cashflows OR transactions occur, plus today.
  const flowDates = new Set<string>();
  for (const c of cashflows) if (c.usd_in_date) flowDates.add(c.usd_in_date);
  for (const t of transactions) flowDates.add(t.trade_date);
  const startIso = [...flowDates].sort()[0];
  if (!startIso) return null;
  const today = asOfDate ?? new Date();
  const todayIso = isoDateInNewYork(today);
  const breakpoints = [...flowDates].filter((d) => d <= todayIso).sort();
  // Always include "today" as the terminal breakpoint
  if (breakpoints[breakpoints.length - 1] !== todayIso) breakpoints.push(todayIso);

  // For each breakpoint, compute net shares per ticker
  const txnsByDate = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const flowsByDate = new Map<string, number>();
  for (const c of cashflows) {
    if (c.usd_in_date && c.usd_amount) {
      flowsByDate.set(c.usd_in_date, (flowsByDate.get(c.usd_in_date) ?? 0) + Number(c.usd_amount));
    }
  }

  let approximated = !priceOn;
  let prevValue = 0;
  let cumulativeFlow = 0; // total invested up to and including prev breakpoint
  const subReturns: number[] = [];

  for (let i = 0; i < breakpoints.length; i++) {
    const d = breakpoints[i];

    // Net shares at end-of-day d
    const netShares = new Map<string, number>();
    for (const t of txnsByDate) {
      if (t.trade_date > d) break;
      const s = Number(t.shares);
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + (t.side === 'buy' ? s : -s));
    }

    let value = 0;
    if (i === breakpoints.length - 1) {
      value = currentMarketValueUsd;
    } else if (priceOn) {
      for (const [tk, sh] of netShares) {
        const px = priceOn(tk, d);
        if (px == null) {
          approximated = true;
          // fall back: use last buy price for this ticker up to date d
          const last = [...txnsByDate].reverse().find((t) => t.ticker === tk && t.trade_date <= d && t.side === 'buy');
          value += sh * (last ? Number(last.price) : 0);
        } else {
          value += sh * px;
        }
      }
    } else {
      // No priceOn provided: use cost basis as proxy (cumulative buy notional at d)
      for (const [tk, sh] of netShares) {
        const last = [...txnsByDate].reverse().find((t) => t.ticker === tk && t.trade_date <= d && t.side === 'buy');
        value += sh * (last ? Number(last.price) : 0);
      }
    }

    const flowOnDay = flowsByDate.get(d) ?? 0;
    cumulativeFlow += flowOnDay;

    if (i > 0 && prevValue > 0) {
      // Strict TWR: the sub-period return is V_just_before_flow / V_prev_start − 1,
      // i.e. flow on date d is treated as arriving at the END of the prior sub-period
      // (period boundary). After we record the return, we add the flow into the
      // NEW sub-period's starting value (prevValue for next iteration).
      const valueBeforeFlow = value - flowOnDay;
      const r = valueBeforeFlow / prevValue - 1;
      if (Number.isFinite(r)) subReturns.push(r);
    }
    // Set up next sub-period's starting value: post-flow value on this breakpoint.
    prevValue = value;
  }

  if (subReturns.length === 0) return null;
  const twr = subReturns.reduce((acc, r) => acc * (1 + r), 1) - 1;

  const startMs = new Date(startIso + 'T00:00:00Z').getTime();
  const endMs = today.getTime();
  const periodDays = Math.max(1, Math.round((endMs - startMs) / 86_400_000));
  // Annualize only if span >= 90d; otherwise too noisy
  const annualized = periodDays >= 90 ? Math.pow(1 + twr, 365 / periodDays) - 1 : null;

  return { twr, annualized, approximated, periodDays };
}
