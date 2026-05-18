// Use require shim since xirr is CommonJS without types.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import xirrLib from 'xirr';

interface CashEvent {
  /** Negative = money in (you invested). Positive = money out (you received). */
  amount: number;
  when: Date;
}

/**
 * Compute XIRR (annualized money-weighted return) for a stream of cashflows
 * + a terminal "redemption" event valued at the current portfolio market value.
 *
 * Returns null if the input is degenerate (single day, all-positive, etc.).
 */
export function computeXirr(events: CashEvent[]): number | null {
  // xirr lib requires >= 2 events on different days AND at least one negative amount.
  if (events.length < 2) return null;
  const days = new Set(events.map((e) => Math.floor(e.when.getTime() / 86_400_000)));
  if (days.size < 2) return null;
  if (!events.some((e) => e.amount < 0)) return null;
  if (!events.some((e) => e.amount > 0)) return null;
  try {
    const fn = (xirrLib as unknown) as (events: CashEvent[]) => number;
    return fn(events);
  } catch {
    return null;
  }
}

/**
 * Build the standard XIRR event stream:
 *   - Each deposit (USD inflow into Schwab) → negative amount on its USD-in date
 *   - Withdrawals (none in V1) would be positive on their date
 *   - Plus a final "virtual redemption" = current marketValue on today's date (positive)
 */
export function buildXirrEvents(args: {
  cashflows: Array<{ usd_in_date: string | null; usd_amount: number | null }>;
  currentMarketValueUsd: number;
  asOf?: Date;
}): CashEvent[] {
  const events: CashEvent[] = [];
  for (const c of args.cashflows) {
    if (!c.usd_in_date || !c.usd_amount) continue;
    events.push({ amount: -Number(c.usd_amount), when: new Date(c.usd_in_date + 'T00:00:00Z') });
  }
  if (args.currentMarketValueUsd > 0) {
    events.push({ amount: args.currentMarketValueUsd, when: args.asOf ?? new Date() });
  }
  return events;
}
