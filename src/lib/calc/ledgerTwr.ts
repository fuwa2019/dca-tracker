import type { LedgerCashEventType } from '../import/types.ts';

export interface LedgerTwrTrade {
  effective_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  shares: number | string;
  price: number | string;
  usd_amount: number | string;
}

export interface LedgerTwrCashEvent {
  effective_date: string;
  event_type: LedgerCashEventType;
  usd_amount: number | string;
}

export interface LedgerTwrPoint {
  date: string;
  beginning_nav_usd: number;
  ending_nav_usd: number;
  external_inflow_usd: number;
  external_outflow_usd: number;
  period_return_pct: number | null;
  cumulative_return_pct: number;
}

export interface LedgerTwrResult {
  method: 'ledger_twr_v2';
  points: LedgerTwrPoint[];
  cumulative_return_pct: number;
  complete: boolean;
  warnings: string[];
}

export interface LedgerTwrInput {
  trades: LedgerTwrTrade[];
  cash_events: LedgerTwrCashEvent[];
  /** Ordinary close prices keyed by ticker and ISO date. */
  prices: Map<string, Map<string, number>>;
  starting_nav_usd?: number;
  as_of_date?: string;
}

const EXTERNAL_EVENT_TYPES = new Set<LedgerCashEventType>([
  'fx_transfer',
  'broker_deposit',
  'broker_withdrawal',
  'stock_allocation',
]);

function asFiniteNumber(value: number | string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function datesFromPrices(prices: Map<string, Map<string, number>>): string[] {
  const dates = new Set<string>();
  for (const daily of prices.values()) {
    for (const date of daily.keys()) dates.add(date);
  }
  return [...dates];
}

function ordinaryClose(
  ticker: string,
  date: string,
  prices: Map<string, Map<string, number>>,
  lastClose: Map<string, number>,
): number | null {
  const direct = prices.get(ticker)?.get(date);
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    lastClose.set(ticker, direct);
    return direct;
  }
  return lastClose.get(ticker) ?? null;
}

export function computeLedgerTwr(input: LedgerTwrInput): LedgerTwrResult | null {
  if (input.trades.length === 0 && input.cash_events.length === 0) return null;

  const eventDates = [
    ...input.trades.map((trade) => trade.effective_date),
    ...input.cash_events.map((event) => event.effective_date),
  ];
  const startDate = [...new Set(eventDates)].sort()[0];
  if (!startDate) return null;
  const allDates = new Set<string>([
    ...eventDates,
    ...datesFromPrices(input.prices),
  ]);
  const endDate = input.as_of_date ?? [...allDates].sort().at(-1)!;
  const dates = [...allDates].filter((date) => date >= startDate && date <= endDate).sort();
  const tradesByDate = groupByDate(input.trades);
  const eventsByDate = groupByDate(input.cash_events);
  const shares = new Map<string, number>();
  const lastClose = new Map<string, number>();
  const warnings: string[] = [];
  const missingPriceKeys = new Set<string>();
  let cash = 0;
  let previousNav = input.starting_nav_usd ?? 0;
  let cumulativeFactor = 1;
  const points: LedgerTwrPoint[] = [];

  for (const date of dates) {
    const dayEvents = eventsByDate.get(date) ?? [];
    const externalInflow = dayEvents
      .filter((event) => EXTERNAL_EVENT_TYPES.has(event.event_type))
      .map((event) => asFiniteNumber(event.usd_amount) ?? 0)
      .filter((amount) => amount > 0)
      .reduce((sum, amount) => sum + amount, 0);
    const externalOutflow = dayEvents
      .filter((event) => EXTERNAL_EVENT_TYPES.has(event.event_type))
      .map((event) => asFiniteNumber(event.usd_amount) ?? 0)
      .filter((amount) => amount < 0)
      .reduce((sum, amount) => sum - amount, 0);

    // External inflows are available at the start of the day. Internal cash
    // events and trades remain inside the portfolio and are not neutralized.
    cash += externalInflow;
    for (const event of dayEvents) {
      if (EXTERNAL_EVENT_TYPES.has(event.event_type)) continue;
      cash += asFiniteNumber(event.usd_amount) ?? 0;
    }
    for (const trade of tradesByDate.get(date) ?? []) {
      const tradeShares = asFiniteNumber(trade.shares) ?? 0;
      const settlement = asFiniteNumber(trade.usd_amount) ?? 0;
      shares.set(
        trade.ticker,
        (shares.get(trade.ticker) ?? 0) + (trade.side === 'buy' ? tradeShares : -tradeShares),
      );
      cash += settlement;
    }

    let marketValue = 0;
    for (const [ticker, quantity] of shares) {
      if (Math.abs(quantity) < 1e-12) continue;
      const close = ordinaryClose(ticker, date, input.prices, lastClose);
      if (close == null) {
        missingPriceKeys.add(`${ticker}|${date}`);
        continue;
      }
      marketValue += quantity * close;
    }

    const valueBeforeOutflow = cash + marketValue;
    cash -= externalOutflow;
    const endingNav = cash + marketValue;
    const denominator = previousNav + externalInflow;
    const periodReturn = denominator > 0
      ? (valueBeforeOutflow / denominator) - 1
      : null;
    if (periodReturn != null && Number.isFinite(periodReturn) && periodReturn > -1) {
      cumulativeFactor *= 1 + periodReturn;
    }
    points.push({
      date,
      beginning_nav_usd: previousNav,
      ending_nav_usd: endingNav,
      external_inflow_usd: externalInflow,
      external_outflow_usd: externalOutflow,
      period_return_pct: periodReturn,
      cumulative_return_pct: cumulativeFactor - 1,
    });
    previousNav = endingNav;
  }

  for (const key of missingPriceKeys) warnings.push(`缺少普通收盘价：${key}`);
  for (const point of points) {
    if (point.period_return_pct === null && point.beginning_nav_usd + point.external_inflow_usd <= 0) {
      warnings.push(`${point.date} 缺少可用于 TWR 的期初资产或外部入金。`);
    }
  }

  return {
    method: 'ledger_twr_v2',
    points,
    cumulative_return_pct: cumulativeFactor - 1,
    complete: warnings.length === 0,
    warnings: [...new Set(warnings)],
  };
}

function groupByDate<T extends { effective_date: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.effective_date) ?? [];
    existing.push(row);
    grouped.set(row.effective_date, existing);
  }
  return grouped;
}
