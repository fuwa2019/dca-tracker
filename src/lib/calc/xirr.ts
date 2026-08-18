// Use require shim since xirr is CommonJS without types.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import xirrLib from 'xirr';
import type { LedgerCashflowKind } from '../database.types.ts';

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
  cashflows: Array<{
    usd_in_date: string | null;
    usd_amount: number | null;
    cashflow_kind?: LedgerCashflowKind;
  }>;
  currentMarketValueUsd: number;
  asOf?: Date;
}): CashEvent[] {
  const events: CashEvent[] = [];
  const importedDeposits = args.cashflows.filter((cashflow) =>
    cashflow.cashflow_kind === 'broker_deposit');
  const fundingCashflows = importedDeposits.length > 0
    ? args.cashflows.filter((cashflow) =>
        cashflow.cashflow_kind === 'broker_deposit'
        || cashflow.cashflow_kind === 'stock_allocation')
    : args.cashflows;
  for (const c of fundingCashflows) {
    if (!c.usd_in_date || !c.usd_amount) continue;
    events.push({ amount: -Number(c.usd_amount), when: new Date(c.usd_in_date + 'T00:00:00Z') });
  }
  if (args.currentMarketValueUsd > 0) {
    events.push({ amount: args.currentMarketValueUsd, when: args.asOf ?? new Date() });
  }
  return events;
}

/**
 * V2 XIRR boundary: only money entering/leaving the investor-owned ETF sleeve
 * is an external cashflow. Dividends, interest, trades, taxes, and fees stay
 * inside the portfolio and therefore are intentionally excluded here.
 */
export function buildLedgerXirrEvents(args: {
  cashflows: Array<{
    effective_date?: string | null;
    usd_in_date?: string | null;
    usd_amount: number | string | null;
    cashflow_kind: LedgerCashflowKind;
  }>;
  currentMarketValueUsd: number;
  asOf?: Date;
}): CashEvent[] {
  const externalKinds = new Set<LedgerCashflowKind>([
    'fx_transfer',
    'broker_deposit',
    'broker_withdrawal',
    'stock_allocation',
  ]);
  const events: CashEvent[] = [];
  for (const cashflow of args.cashflows) {
    if (!externalKinds.has(cashflow.cashflow_kind)) continue;
    const date = cashflow.effective_date ?? cashflow.usd_in_date;
    const amount = Number(cashflow.usd_amount);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    events.push({ amount: -amount, when: new Date(`${date}T00:00:00Z`) });
  }
  if (args.currentMarketValueUsd > 0) {
    events.push({ amount: args.currentMarketValueUsd, when: args.asOf ?? new Date() });
  }
  return events;
}
