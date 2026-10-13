import type { LedgerCashEvent } from './portfolioLedger.ts';

const WINDOW_DAYS = 365;
const MIN_DAYS = 30;
const DAYS_PER_MONTH = 365.25 / 12;

export interface ContributionPace {
  /** Net external deposits per month over the window, never below zero. */
  monthlyUsd: number;
  windowMonths: number;
  depositCount: number;
  /** Average days between deposit dates; null when the window has none. */
  averageIntervalDays: number | null;
  startDate: string;
}

/**
 * Observed monthly contribution from the ledger's external cash flows.
 *
 * The window is the last 12 months. A ledger younger than that starts at its
 * first deposit, which is treated as the opening capital and left out of the
 * average. Withdrawals reduce the net. Fewer than 30 days of history gives
 * null, since a monthly pace cannot be read from it.
 */
export function observedContributionPace(
  cash: readonly LedgerCashEvent[],
  asOf: string,
): ContributionPace | null {
  const external = cash.filter((event) => event.role === 'external' && event.date <= asOf);
  const firstInflow = external
    .filter((event) => event.amountUsd > 0)
    .reduce<string | null>((min, event) => (min === null || event.date < min ? event.date : min), null);
  if (firstInflow === null) return null;

  const windowStart = shiftDays(asOf, -WINDOW_DAYS);
  const youngLedger = firstInflow >= windowStart;
  const startDate = youngLedger ? firstInflow : windowStart;
  const days = daysBetween(startDate, asOf);
  if (days < MIN_DAYS) return null;

  let net = 0;
  const depositDates = new Set<string>();
  for (const event of external) {
    if (event.date <= startDate) continue;
    net += event.amountUsd;
    if (event.amountUsd > 0) depositDates.add(event.date);
  }

  const windowMonths = days / DAYS_PER_MONTH;
  return {
    monthlyUsd: Math.max(0, net) / windowMonths,
    windowMonths,
    depositCount: depositDates.size,
    averageIntervalDays: depositDates.size > 0 ? days / depositDates.size : null,
    startDate,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function shiftDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}
