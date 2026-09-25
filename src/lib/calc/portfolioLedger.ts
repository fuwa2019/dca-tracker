/**
 * Unified portfolio ledger: the single source for every private return figure.
 *
 * Transactions and cash events are normalized into ONE dated cash-flow ledger.
 * NAV, cash, net invested capital, total return, time-weighted return (TWR),
 * money-weighted return (XIRR), the NAV bridge and the daily P&L calendar are
 * all derived from that same series, so the figures cannot disagree about which
 * money was external. The quote Worker imports this module for the public
 * percentage cache, so the share page uses the same engine.
 *
 * Flow classification:
 * - external: broker deposits, broker withdrawals and stock-sleeve allocations
 *   move money across the portfolio boundary. They split TWR sub-periods and
 *   are the XIRR cash flows. Inflows count at the start of their day, outflows
 *   at the end, so a same-day deposit + buy is neutral.
 * - internal: trades, dividends, interest, taxes, fees and FX conversion P&L
 *   stay inside the portfolio. They change NAV and therefore are return.
 * - excluded: manual CNY->USD transfer rows when broker deposits exist. They
 *   describe money before it reached the broker; the broker deposit is the
 *   in-account record, so counting both would double the capital.
 *
 * Pure: no React, network or Supabase. All money is USD; foreign-currency
 * positions are valued as native close x USD rate.
 */

export type LedgerEventKind =
  | 'broker_deposit'
  | 'broker_withdrawal'
  | 'stock_allocation'
  | 'dividend'
  | 'interest'
  | 'tax'
  | 'fee'
  | 'fx_conversion'
  | 'fx_transfer';

export type FlowRole = 'external' | 'internal' | 'excluded';

export type FlowBasis =
  /** Broker deposits/withdrawals are recorded; the normal case. */
  | 'explicit'
  /** Only legacy manual CNY->USD transfer rows exist; they act as deposits. */
  | 'legacy_fx_transfer'
  /** No funding records at all; unfunded buys are treated as deposits. */
  | 'inferred_from_trades';

export interface LedgerTrade {
  id?: string;
  date: string;
  ticker: string;
  side: 'buy' | 'sell';
  shares: number;
  /** Signed USD settlement: negative for a buy, positive for a sell. */
  cashUsd: number;
  /** Currency the position is quoted and priced in. */
  currency: string;
  /** Execution price in `currency`. */
  nativePrice: number | null;
  /** USD per unit of `currency` at execution. */
  fxRateToUsd: number | null;
  account?: string | null;
}

export interface LedgerCashEvent {
  id?: string;
  date: string;
  kind: LedgerEventKind;
  /** Signed USD amount: positive adds cash, negative removes it. */
  amountUsd: number;
  role: FlowRole;
  /** True for flows synthesized by `inferred_from_trades`. */
  inferred?: boolean;
  account?: string | null;
}

export interface Ledger {
  trades: LedgerTrade[];
  cash: LedgerCashEvent[];
  flowBasis: FlowBasis;
}

/** Minimal row shapes, structurally compatible with the Supabase rows. */
export interface LedgerTransactionRow {
  id?: string;
  trade_date: string;
  ticker: string;
  side: 'buy' | 'sell';
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
  settled_amount_usd?: number | string | null;
  source_currency?: string | null;
  source_price?: number | string | null;
  fx_rate_to_usd?: number | string | null;
  created_at?: string | null;
  account_id?: string | null;
}

export interface LedgerCashflowRow {
  id?: string;
  cashflow_kind?: string | null;
  effective_date?: string | null;
  usd_in_date?: string | null;
  cny_out_date?: string | null;
  usd_amount: number | string | null;
  cny_amount?: number | string | null;
  account_id?: string | null;
}

const EXTERNAL_KINDS = new Set(['broker_deposit', 'broker_withdrawal', 'stock_allocation']);
const INTERNAL_KINDS = new Set(['dividend', 'interest', 'tax', 'fee', 'fx_conversion']);
const INCOME_KINDS = new Set(['dividend', 'interest']);
const COST_KINDS = new Set(['tax', 'fee']);

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Signed USD settlement of a trade; the broker's settled amount wins. */
export function tradeCashUsd(row: LedgerTransactionRow): number {
  const settled = num(row.settled_amount_usd);
  if (settled !== null && settled !== 0) {
    if (row.side === 'buy' && settled < 0) return settled;
    if (row.side === 'sell' && settled > 0) return settled;
  }
  const shares = num(row.shares) ?? 0;
  const fee = Math.max(0, num(row.fees_usd) ?? 0);
  const usdPrice = tradeUsdPrice(row);
  return row.side === 'buy' ? -(shares * usdPrice + fee) : shares * usdPrice - fee;
}

/** Execution price in USD, derived from native price x FX when available. */
export function tradeUsdPrice(row: LedgerTransactionRow): number {
  const currency = (row.source_currency ?? 'USD').toUpperCase();
  const nativePrice = num(row.source_price);
  const fx = num(row.fx_rate_to_usd);
  if (currency !== 'USD' && nativePrice !== null && nativePrice > 0 && fx !== null && fx > 0) {
    return nativePrice * fx;
  }
  return num(row.price) ?? 0;
}

function cashflowDate(row: LedgerCashflowRow): string | null {
  return row.effective_date ?? row.usd_in_date ?? row.cny_out_date ?? null;
}

/** A manual CNY->USD transfer carries a CNY amount; imported FX legs do not. */
function isManualFxTransfer(row: LedgerCashflowRow): boolean {
  return row.cashflow_kind === 'fx_transfer' && num(row.cny_amount) !== null;
}

export function classifyCashflow(
  row: LedgerCashflowRow,
  basis: FlowBasis,
): { kind: LedgerEventKind; role: FlowRole } | null {
  const kind = (row.cashflow_kind ?? 'fx_transfer') as string;
  if (EXTERNAL_KINDS.has(kind)) return { kind: kind as LedgerEventKind, role: 'external' };
  if (INTERNAL_KINDS.has(kind)) return { kind: kind as LedgerEventKind, role: 'internal' };
  if (kind === 'fx_transfer') {
    if (!isManualFxTransfer(row)) {
      // Imported broker FX legs (for example IBKR "外汇交易组成部分") are the
      // conversion gain or cost inside the account, not investor money.
      return { kind: 'fx_conversion', role: 'internal' };
    }
    return { kind: 'fx_transfer', role: basis === 'legacy_fx_transfer' ? 'external' : 'excluded' };
  }
  return null;
}

/**
 * Normalize database rows into the ledger. Rows that cannot be dated or
 * valued are dropped here and reported by `runLedgerChecks`.
 */
export function buildLedger(
  transactions: readonly LedgerTransactionRow[],
  cashflows: readonly LedgerCashflowRow[],
): Ledger {
  const hasBrokerFlows = cashflows.some((row) => EXTERNAL_KINDS.has(row.cashflow_kind ?? ''));
  const hasManualTransfers = cashflows.some(isManualFxTransfer);
  const flowBasis: FlowBasis = hasBrokerFlows
    ? 'explicit'
    : hasManualTransfers ? 'legacy_fx_transfer' : 'inferred_from_trades';

  const trades: LedgerTrade[] = transactions
    .filter((row) => row.trade_date && (num(row.shares) ?? 0) > 0)
    .map((row) => {
      const currency = (row.source_currency ?? 'USD').toUpperCase() || 'USD';
      const nativePrice = currency === 'USD' ? num(row.price) : num(row.source_price);
      return {
        id: row.id,
        date: row.trade_date,
        ticker: row.ticker.trim().toUpperCase(),
        side: row.side,
        shares: num(row.shares) ?? 0,
        cashUsd: tradeCashUsd(row),
        currency,
        nativePrice,
        fxRateToUsd: currency === 'USD' ? 1 : num(row.fx_rate_to_usd),
        account: row.account_id ?? null,
      };
    })
    .sort(compareByDate);

  const cash: LedgerCashEvent[] = [];
  for (const row of cashflows) {
    const date = cashflowDate(row);
    const amount = num(row.usd_amount);
    const classified = classifyCashflow(row, flowBasis);
    if (!date || amount === null || amount === 0 || !classified) continue;
    cash.push({
      id: row.id,
      date,
      kind: classified.kind,
      amountUsd: amount,
      role: classified.role,
      account: row.account_id ?? null,
    });
  }

  if (flowBasis === 'inferred_from_trades') cash.push(...inferTradeFunding(trades, cash));
  cash.sort(compareByDate);
  return { trades, cash, flowBasis };
}

/**
 * Trade-only ledgers: sell proceeds and internal cash fund later buys first;
 * any shortfall becomes a synthetic deposit on the buy date.
 */
function inferTradeFunding(trades: LedgerTrade[], internal: LedgerCashEvent[]): LedgerCashEvent[] {
  const events = [
    ...trades.map((trade) => ({ date: trade.date, amount: trade.cashUsd, order: 1 })),
    ...internal.map((event) => ({ date: event.date, amount: event.amountUsd, order: 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const inferred: LedgerCashEvent[] = [];
  let cash = 0;
  for (const event of events) {
    cash += event.amount;
    if (cash < -1e-9) {
      inferred.push({
        date: event.date,
        kind: 'broker_deposit',
        amountUsd: -cash,
        role: 'external',
        inferred: true,
      });
      cash = 0;
    }
  }
  return inferred;
}

function compareByDate(a: { date: string }, b: { date: string }): number {
  return a.date.localeCompare(b.date);
}

// ---------------------------------------------------------------------------
// Daily series
// ---------------------------------------------------------------------------

export type PriceSeries = ReadonlyMap<string, ReadonlyMap<string, number>>;

export interface LedgerSeriesInput {
  ledger: Ledger;
  /** Ordinary closes in each ticker's own currency, keyed ticker -> date. */
  closes: PriceSeries;
  /** Benchmark total-return proxy (adjusted close), keyed by date. */
  benchmark?: ReadonlyMap<string, number>;
  /** USD per unit of currency, keyed currency -> date. Optional. */
  fxRates?: PriceSeries;
  /** Latest native prices for the terminal (as-of) point. */
  latestPrices?: ReadonlyMap<string, number>;
  /** Latest benchmark price for the terminal point. */
  latestBenchmark?: number | null;
  /** Last date to value; defaults to the last event or price date. */
  asOfDate?: string;
}

export interface LedgerPoint {
  date: string;
  navUsd: number;
  cashUsd: number;
  marketValueUsd: number;
  externalInflowUsd: number;
  externalOutflowUsd: number;
  /** Cumulative external inflows minus outflows through this day. */
  netInvestedUsd: number;
  /** Investment gain on this day: NAV change not explained by external flows. */
  dailyPnlUsd: number;
  /** Cumulative investment gain: NAV minus net invested. */
  pnlUsd: number;
  dailyReturn: number | null;
  cumulativeTwr: number;
  benchmarkCumulative: number | null;
  trades: LedgerTrade[];
}

export type LedgerWarningCode =
  | 'missing_price'
  | 'fx_trade_rate'
  | 'unfunded_period'
  | 'negative_cash';

export interface LedgerWarning {
  code: LedgerWarningCode;
  message: string;
  ticker?: string;
  date?: string;
  amountUsd?: number;
}

export interface LedgerSeries {
  points: LedgerPoint[];
  warnings: LedgerWarning[];
  /** False when a position had to be valued without a market price. */
  complete: boolean;
  /** Most negative intraday cash and when it happened; 0 when never negative. */
  minCashUsd: number;
  minCashDate: string | null;
  tickerCurrency: Map<string, string>;
}

/** Latest value on or before a date, by binary search over sorted dates. */
function asOfLookup(series: ReadonlyMap<string, number> | undefined) {
  const entries = series
    ? [...series.entries()].filter(([, value]) => Number.isFinite(value) && value > 0).sort((a, b) => a[0].localeCompare(b[0]))
    : [];
  return (date: string): number | null => {
    let lo = 0;
    let hi = entries.length - 1;
    let found: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entries[mid][0] <= date) {
        found = entries[mid][1];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  };
}

export function buildLedgerSeries(input: LedgerSeriesInput): LedgerSeries {
  const { ledger } = input;
  const eventDates = [...ledger.trades.map((t) => t.date), ...ledger.cash.filter((e) => e.role !== 'excluded').map((e) => e.date)];
  const empty: LedgerSeries = {
    points: [],
    warnings: [],
    complete: true,
    minCashUsd: 0,
    minCashDate: null,
    tickerCurrency: new Map(),
  };
  if (eventDates.length === 0) return empty;

  const startDate = eventDates.reduce((min, date) => (date < min ? date : min));
  const lastEvent = eventDates.reduce((max, date) => (date > max ? date : max));
  let calendar: string[];
  if (input.benchmark && input.benchmark.size > 0) {
    calendar = [...input.benchmark.keys()];
  } else {
    const dates = new Set<string>(eventDates);
    for (const series of input.closes.values()) for (const date of series.keys()) dates.add(date);
    calendar = [...dates];
  }
  const lastPriceDate = calendar.reduce((max, date) => (date > max ? date : max), startDate);
  const endDate = input.asOfDate ?? (lastEvent > lastPriceDate ? lastEvent : lastPriceDate);
  calendar = [...new Set(calendar)].filter((date) => date >= startDate && date <= endDate).sort();
  if (calendar.length === 0 || calendar[calendar.length - 1] < endDate) calendar.push(endDate);

  // Events on non-calendar days (weekends, foreign-only sessions) are applied
  // on the next calendar day; anything after the last one lands on it.
  const rollForward = (date: string): string => {
    let lo = 0;
    let hi = calendar.length - 1;
    let found = calendar[calendar.length - 1];
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (calendar[mid] >= date) {
        found = calendar[mid];
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return found;
  };
  const tradesByDay = new Map<string, LedgerTrade[]>();
  for (const trade of ledger.trades) push(tradesByDay, rollForward(trade.date), trade);
  const cashByDay = new Map<string, LedgerCashEvent[]>();
  for (const event of ledger.cash) if (event.role !== 'excluded') push(cashByDay, rollForward(event.date), event);

  const tickerCurrency = new Map<string, string>();
  const tickerTrades = new Map<string, LedgerTrade[]>();
  for (const trade of ledger.trades) {
    tickerCurrency.set(trade.ticker, trade.currency);
    push(tickerTrades, trade.ticker, trade);
  }
  const closeLookup = new Map<string, (date: string) => number | null>();
  for (const ticker of tickerCurrency.keys()) closeLookup.set(ticker, asOfLookup(input.closes.get(ticker)));
  const fxLookup = new Map<string, (date: string) => number | null>();
  for (const currency of new Set(tickerCurrency.values())) {
    if (currency !== 'USD') fxLookup.set(currency, asOfLookup(input.fxRates?.get(currency)));
  }
  const benchmarkLookup = asOfLookup(input.benchmark);

  const warnings: LedgerWarning[] = [];
  const warned = new Set<string>();
  const warnOnce = (key: string, warning: LedgerWarning) => {
    if (warned.has(key)) return;
    warned.add(key);
    warnings.push(warning);
  };
  let complete = true;

  const priceFor = (ticker: string, date: string, terminal: boolean): number | null => {
    if (terminal) {
      const latest = input.latestPrices?.get(ticker);
      if (latest !== undefined && Number.isFinite(latest) && latest > 0) return latest;
    }
    const close = closeLookup.get(ticker)?.(date) ?? null;
    if (close !== null) return close;
    const lastTrade = [...(tickerTrades.get(ticker) ?? [])].reverse().find((t) => t.date <= date && t.nativePrice);
    if (lastTrade?.nativePrice) {
      complete = false;
      warnOnce(`price:${ticker}`, {
        code: 'missing_price',
        ticker,
        date,
        message: `${ticker} 自 ${date} 起缺少收盘价，暂按最近成交价估值。`,
      });
      return lastTrade.nativePrice;
    }
    return null;
  };

  const fxFor = (ticker: string, date: string): number => {
    const currency = tickerCurrency.get(ticker) ?? 'USD';
    if (currency === 'USD') return 1;
    const market = fxLookup.get(currency)?.(date) ?? null;
    if (market !== null) return market;
    const trades = tickerTrades.get(ticker) ?? [];
    const prior = [...trades].reverse().find((t) => t.date <= date && t.fxRateToUsd);
    const rate = prior?.fxRateToUsd ?? trades.find((t) => t.fxRateToUsd)?.fxRateToUsd ?? null;
    warnOnce(`fx:${ticker}`, {
      code: 'fx_trade_rate',
      ticker,
      message: `${ticker} 以 ${currency} 计价，缺少每日汇率，按成交时汇率近似折算 USD。`,
    });
    if (rate === null) complete = false;
    return rate ?? 0;
  };

  const shares = new Map<string, number>();
  const points: LedgerPoint[] = [];
  let cash = 0;
  let previousNav = 0;
  let netInvested = 0;
  let factor = 1;
  let minCash = 0;
  let minCashDate: string | null = null;
  const benchmarkBase = benchmarkLookup(calendar[0]) ?? firstValue(input.benchmark);

  calendar.forEach((date, index) => {
    const terminal = index === calendar.length - 1;
    const dayEvents = cashByDay.get(date) ?? [];
    const dayTrades = tradesByDay.get(date) ?? [];
    let inflow = 0;
    let outflow = 0;
    for (const event of dayEvents) {
      if (event.role !== 'external') continue;
      if (event.amountUsd > 0) inflow += event.amountUsd;
      else outflow -= event.amountUsd;
    }

    cash += inflow;
    for (const event of dayEvents) if (event.role === 'internal') cash += event.amountUsd;
    for (const trade of dayTrades) {
      shares.set(trade.ticker, (shares.get(trade.ticker) ?? 0) + (trade.side === 'buy' ? trade.shares : -trade.shares));
      cash += trade.cashUsd;
    }
    if (cash < minCash - 1e-9) {
      minCash = cash;
      minCashDate = date;
    }

    let marketValue = 0;
    for (const [ticker, quantity] of shares) {
      if (Math.abs(quantity) < 1e-9) continue;
      const price = priceFor(ticker, date, terminal);
      if (price === null) {
        complete = false;
        warnOnce(`price:${ticker}`, {
          code: 'missing_price',
          ticker,
          date,
          message: `${ticker} 在 ${date} 没有任何可用价格，市值按 0 计。`,
        });
        continue;
      }
      marketValue += quantity * price * fxFor(ticker, date);
    }

    const valueBeforeOutflow = cash + marketValue;
    cash -= outflow;
    const nav = cash + marketValue;
    const denominator = previousNav + inflow;
    let dailyReturn: number | null = null;
    if (denominator > 1e-9) {
      dailyReturn = valueBeforeOutflow / denominator - 1;
      if (Number.isFinite(dailyReturn) && dailyReturn > -1) factor *= 1 + dailyReturn;
      else dailyReturn = null;
    } else if (Math.abs(valueBeforeOutflow) > 0.005 || dayTrades.length > 0) {
      warnOnce(`unfunded:${date}`, {
        code: 'unfunded_period',
        date,
        message: `${date} 之前没有入金或期初资产，当天无法计算 TWR。`,
      });
    }
    netInvested += inflow - outflow;
    const dailyPnl = valueBeforeOutflow - denominator;

    const benchmarkPrice = terminal && input.latestBenchmark ? input.latestBenchmark : benchmarkLookup(date);
    points.push({
      date,
      navUsd: nav,
      cashUsd: cash,
      marketValueUsd: marketValue,
      externalInflowUsd: inflow,
      externalOutflowUsd: outflow,
      netInvestedUsd: netInvested,
      dailyPnlUsd: dailyPnl,
      pnlUsd: nav - netInvested,
      dailyReturn,
      cumulativeTwr: factor - 1,
      benchmarkCumulative: benchmarkBase && benchmarkPrice ? benchmarkPrice / benchmarkBase - 1 : null,
      trades: dayTrades,
    });
    previousNav = nav;
  });

  if (minCash < -0.01) {
    warnings.push({
      code: 'negative_cash',
      date: minCashDate ?? undefined,
      amountUsd: minCash,
      message: `现金在 ${minCashDate} 降到 ${minCash.toFixed(2)} USD：买入早于对应入金，或缺少入金记录。`,
    });
  }

  return { points, warnings, complete, minCashUsd: minCash, minCashDate, tickerCurrency };
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function firstValue(series?: ReadonlyMap<string, number>): number | null {
  if (!series) return null;
  const first = [...series.entries()].sort((a, b) => a[0].localeCompare(b[0])).find(([, v]) => v > 0);
  return first?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface LedgerSummary {
  startDate: string | null;
  asOf: string | null;
  navUsd: number;
  cashUsd: number;
  marketValueUsd: number;
  totalInflowUsd: number;
  totalOutflowUsd: number;
  netInvestedUsd: number;
  /** NAV minus net invested capital. */
  totalReturnUsd: number;
  /** Total return over net invested capital (simple, not annualized). */
  totalReturnOnInvested: number | null;
  twr: number | null;
  twrAnnualized: number | null;
  xirr: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  incomeUsd: number;
  costsUsd: number;
  fxConversionUsd: number;
  flowBasis: FlowBasis;
}

export function summarizeLedger(ledger: Ledger, series: LedgerSeries): LedgerSummary {
  const points = series.points;
  const last = points[points.length - 1];
  const first = points[0];
  let inflow = 0;
  let outflow = 0;
  for (const point of points) {
    inflow += point.externalInflowUsd;
    outflow += point.externalOutflowUsd;
  }
  let income = 0;
  let costs = 0;
  let fx = 0;
  for (const event of ledger.cash) {
    if (event.role !== 'internal') continue;
    if (INCOME_KINDS.has(event.kind)) income += event.amountUsd;
    else if (COST_KINDS.has(event.kind)) costs += event.amountUsd;
    else if (event.kind === 'fx_conversion') fx += event.amountUsd;
  }
  const netInvested = inflow - outflow;
  const nav = last?.navUsd ?? 0;
  const hasReturn = points.some((point) => point.dailyReturn !== null);
  const twr = hasReturn ? (last?.cumulativeTwr ?? null) : null;
  const days = first && last ? daysBetween(first.date, last.date) : 0;
  const benchmark = last?.benchmarkCumulative ?? null;

  const xirrEvents = points.flatMap((point) => {
    const when = new Date(`${point.date}T00:00:00Z`);
    const events: Array<{ amount: number; when: Date }> = [];
    if (point.externalInflowUsd > 0) events.push({ amount: -point.externalInflowUsd, when });
    if (point.externalOutflowUsd > 0) events.push({ amount: point.externalOutflowUsd, when });
    return events;
  });
  if (last && nav > 0) xirrEvents.push({ amount: nav, when: new Date(`${last.date}T00:00:00Z`) });

  return {
    startDate: first?.date ?? null,
    asOf: last?.date ?? null,
    navUsd: nav,
    cashUsd: last?.cashUsd ?? 0,
    marketValueUsd: last?.marketValueUsd ?? 0,
    totalInflowUsd: inflow,
    totalOutflowUsd: outflow,
    netInvestedUsd: netInvested,
    totalReturnUsd: nav - netInvested,
    totalReturnOnInvested: netInvested > 0 ? (nav - netInvested) / netInvested : null,
    twr,
    twrAnnualized: twr !== null && days >= 365 ? Math.pow(1 + twr, 365 / days) - 1 : null,
    xirr: solveXirr(xirrEvents),
    benchmarkReturn: benchmark,
    excessReturn: twr !== null && benchmark !== null && 1 + benchmark > 0 ? (1 + twr) / (1 + benchmark) - 1 : null,
    incomeUsd: income,
    costsUsd: costs,
    fxConversionUsd: fx,
    flowBasis: ledger.flowBasis,
  };
}

export type BridgeStatus = 'ok' | 'gap' | 'unverifiable';

export interface LedgerWindow {
  startDate: string;
  endDate: string;
  /** NAV at the close before the window; 0 when the window opens the ledger. */
  startingNavUsd: number;
  externalFlowUsd: number;
  /** Sum of daily investment gains inside the window. */
  pnlUsd: number;
  endingNavUsd: number;
  identityGapUsd: number;
  periodTwr: number | null;
  benchmarkReturn: number | null;
  excessReturn: number | null;
  status: BridgeStatus;
  /** Why the bridge could not be verified, when `status` is `unverifiable`. */
  reason?: string;
}

/**
 * NAV bridge over the points from `fromDate` (inclusive) to the end:
 * starting NAV + external net flow + investment P&L = ending NAV.
 * The P&L is accumulated day by day, so the identity checks that the series is
 * continuous. An empty or all-zero window is reported as unverifiable instead
 * of passing vacuously.
 */
export function summarizeLedgerWindow(series: LedgerSeries, fromDate?: string | null): LedgerWindow | null {
  const points = series.points;
  if (points.length === 0) return null;
  const startIndex = fromDate ? points.findIndex((point) => point.date >= fromDate) : 0;
  if (startIndex < 0) return null;
  const window = points.slice(startIndex);
  const before = startIndex > 0 ? points[startIndex - 1] : null;
  const last = window[window.length - 1];

  const startingNav = before?.navUsd ?? 0;
  let flow = 0;
  let pnl = 0;
  for (const point of window) {
    flow += point.externalInflowUsd - point.externalOutflowUsd;
    pnl += point.dailyPnlUsd;
  }
  const endingNav = last.navUsd;
  const gap = endingNav - (startingNav + flow + pnl);
  const previousFactor = 1 + (before?.cumulativeTwr ?? 0);
  const periodTwr = previousFactor > 0 && window.some((p) => p.dailyReturn !== null)
    ? (1 + last.cumulativeTwr) / previousFactor - 1
    : null;
  const benchStart = before?.benchmarkCumulative ?? window[0].benchmarkCumulative;
  const benchmarkReturn = benchStart !== null && last.benchmarkCumulative !== null && 1 + benchStart > 0
    ? (1 + last.benchmarkCumulative) / (1 + benchStart) - 1
    : null;

  let status: BridgeStatus = Math.abs(gap) >= 0.005 ? 'gap' : 'ok';
  let reason: string | undefined;
  const allZero = [startingNav, flow, pnl, endingNav].every((value) => Math.abs(value) < 0.005);
  if (allZero) {
    status = 'unverifiable';
    reason = '区间内期初净值、资金流、盈亏与期末净值均为 0，没有可校验的数据。';
  } else if (!series.complete) {
    status = 'unverifiable';
    reason = '部分持仓缺少价格，净值为估算值。';
  }

  return {
    startDate: window[0].date,
    endDate: last.date,
    startingNavUsd: startingNav,
    externalFlowUsd: flow,
    pnlUsd: pnl,
    endingNavUsd: endingNav,
    identityGapUsd: gap,
    periodTwr,
    benchmarkReturn,
    excessReturn: periodTwr !== null && benchmarkReturn !== null && 1 + benchmarkReturn > 0
      ? (1 + periodTwr) / (1 + benchmarkReturn) - 1
      : null,
    status,
    reason,
  };
}

/** Running share balance per ticker; reports the first oversell. */
export function tradeShareBalances(trades: readonly LedgerTrade[]): {
  shares: Map<string, number>;
  oversells: Array<{ ticker: string; date: string; shares: number }>;
} {
  const shares = new Map<string, number>();
  const oversells: Array<{ ticker: string; date: string; shares: number }> = [];
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date) || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1));
  for (const trade of sorted) {
    const next = (shares.get(trade.ticker) ?? 0) + (trade.side === 'buy' ? trade.shares : -trade.shares);
    shares.set(trade.ticker, next);
    if (next < -1e-6 && !oversells.some((o) => o.ticker === trade.ticker)) {
      oversells.push({ ticker: trade.ticker, date: trade.date, shares: next });
    }
  }
  return { shares, oversells };
}

/** Cash implied by the ledger: opening cash + every in-scope cash event + every trade. */
export function ledgerCashBalance(ledger: Ledger, openingCashUsd = 0): number {
  let cash = openingCashUsd;
  for (const event of ledger.cash) if (event.role !== 'excluded') cash += event.amountUsd;
  for (const trade of ledger.trades) cash += trade.cashUsd;
  return Math.round(cash * 1e8) / 1e8;
}

/**
 * Annualized money-weighted return: the rate at which the dated flows have zero
 * net present value (Actual/365). Negative amounts are money in, positive money
 * out, the terminal NAV included. Bisection over a bracketing interval, so it
 * never diverges; null when the flows have no sign change or span one day.
 */
export function solveXirr(events: ReadonlyArray<{ amount: number; when: Date }>): number | null {
  if (events.length < 2) return null;
  if (!events.some((e) => e.amount < 0) || !events.some((e) => e.amount > 0)) return null;
  const t0 = Math.min(...events.map((e) => e.when.getTime()));
  const years = events.map((e) => (e.when.getTime() - t0) / 86_400_000 / 365);
  if (Math.max(...years) <= 0) return null;
  const npv = (rate: number) => events.reduce((sum, e, i) => sum + e.amount / Math.pow(1 + rate, years[i]), 0);
  let lo = -0.9999;
  let hi = 1;
  while (npv(lo) * npv(hi) > 0 && hi < 1e6) hi *= 4;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 300 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  const rate = (lo + hi) / 2;
  return Number.isFinite(rate) ? rate : null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
