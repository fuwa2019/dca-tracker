/**
 * Export the stored ledger as a TradingView Portfolio CSV (six columns), so
 * broker files imported here can be loaded into TradingView without typing.
 *
 * Conventions follow the owner's own TradingView file:
 * - securities carry an exchange prefix (NASDAQ:QQQM, OMXSTO:SIVE);
 * - foreign securities keep their native price and native commission;
 * - account cash is `$CASH`; deposits and withdrawals are positive quantities;
 * - taxes, fees and FX conversion costs are "Taxes and fees" with a positive
 *   quantity, an FX conversion gain is a "Deposit";
 * - rows on one day are ordered deposits → sells → buys → income/costs →
 *   withdrawals, with one-minute steps, so cash exists before it is spent.
 *
 * Pure: no network or Supabase.
 */
import { tradeUsdPrice, type LedgerCashflowRow, type LedgerTransactionRow } from '../calc/portfolioLedger.ts';

export interface TradingViewExportTransaction extends LedgerTransactionRow {
  source_amount?: number | string | null;
}

export interface TradingViewExportCashflow extends LedgerCashflowRow {
  ticker?: string | null;
}

/** Exchange prefixes TradingView expects, keyed by ticker. */
const EXCHANGE_BY_TICKER: Record<string, string> = {
  QQQM: 'NASDAQ',
  QQQ: 'NASDAQ',
  SMH: 'NASDAQ',
  IBIT: 'NASDAQ',
  LITE: 'NASDAQ',
  AAOI: 'NASDAQ',
  NVDA: 'NASDAQ',
  AAPL: 'NASDAQ',
  MSFT: 'NASDAQ',
  AMZN: 'NASDAQ',
  GOOGL: 'NASDAQ',
  GOOG: 'NASDAQ',
  META: 'NASDAQ',
  TSLA: 'NASDAQ',
  AVGO: 'NASDAQ',
  AMD: 'NASDAQ',
  MU: 'NASDAQ',
  VGT: 'AMEX',
  VOO: 'AMEX',
  SPY: 'AMEX',
  VTI: 'AMEX',
  SOXX: 'NASDAQ',
  SGOV: 'NYSE',
  BIL: 'AMEX',
  BOXX: 'AMEX',
};

/** Exchange for a non-USD listing when the ticker itself is not mapped. */
const EXCHANGE_BY_CURRENCY: Record<string, string> = {
  SEK: 'OMXSTO',
  HKD: 'HKEX',
  JPY: 'TSE',
  EUR: 'XETR',
  GBP: 'LSE',
  CAD: 'TSX',
  CNY: 'SSE',
};

export function tradingViewSymbol(ticker: string, currency = 'USD', overrides: Record<string, string> = {}): string {
  const clean = ticker.trim().toUpperCase().replace(/\.[A-Z]+$/, '');
  if (clean.includes(':')) return clean;
  const exchange = overrides[clean] ?? EXCHANGE_BY_TICKER[clean] ?? EXCHANGE_BY_CURRENCY[currency.toUpperCase()];
  return exchange ? `${exchange}:${clean}` : clean;
}

interface Row {
  date: string;
  order: number;
  cells: [string, string, string, string, string];
}

/** Rank inside one day: cash must arrive before it is spent. */
const ORDER = { inflow: 0, sell: 1, buy: 2, income: 3, cost: 4, outflow: 5 } as const;

export function exportTradingViewCsv(
  transactions: readonly TradingViewExportTransaction[],
  cashflows: readonly TradingViewExportCashflow[],
  options: { exchangeOverrides?: Record<string, string> } = {},
): string {
  const overrides = options.exchangeOverrides ?? {};
  const rows: Row[] = [];

  for (const txn of transactions) {
    const currency = (txn.source_currency ?? 'USD').toUpperCase() || 'USD';
    const fx = Number(txn.fx_rate_to_usd);
    const foreign = currency !== 'USD' && Number.isFinite(fx) && fx > 0;
    const nativePrice = foreign && txn.source_price != null ? Number(txn.source_price) : tradeUsdPrice(txn);
    const feeUsd = Math.max(0, Number(txn.fees_usd ?? 0) || 0);
    // Native commission is derived (USD fee / rate); 8 decimals drops float noise.
    const commission = foreign ? Number((feeUsd / fx).toFixed(8)) : feeUsd;
    rows.push({
      date: txn.trade_date,
      order: txn.side === 'sell' ? ORDER.sell : ORDER.buy,
      cells: [
        tradingViewSymbol(txn.ticker, currency, overrides),
        txn.side === 'buy' ? 'Buy' : 'Sell',
        number(txn.shares),
        number(nativePrice),
        number(commission),
      ],
    });
  }

  for (const flow of cashflows) {
    const kind = flow.cashflow_kind ?? 'fx_transfer';
    const date = flow.effective_date ?? flow.usd_in_date ?? flow.cny_out_date;
    const amount = Number(flow.usd_amount);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    // A manual CNY transfer happened before the money reached the broker.
    if (kind === 'fx_transfer' && flow.cny_amount != null) continue;
    const magnitude = number(Math.abs(amount));
    const push = (symbol: string, side: string, order: number) =>
      rows.push({ date, order, cells: [symbol, side, magnitude, '', ''] });
    switch (kind) {
      case 'broker_deposit':
        push('$CASH', 'Deposit', ORDER.inflow);
        break;
      case 'broker_withdrawal':
        push('$CASH', 'Withdrawal', ORDER.outflow);
        break;
      case 'stock_allocation':
        push('$CASH', amount > 0 ? 'Deposit' : 'Withdrawal', amount > 0 ? ORDER.inflow : ORDER.outflow);
        break;
      case 'dividend':
        if (amount > 0) push(flow.ticker ? tradingViewSymbol(flow.ticker, 'USD', overrides) : '$CASH', 'Dividend', ORDER.income);
        else push('$CASH', 'Taxes and fees', ORDER.cost);
        break;
      case 'interest':
        push('$CASH', amount > 0 ? 'Deposit' : 'Taxes and fees', amount > 0 ? ORDER.income : ORDER.cost);
        break;
      case 'tax':
      case 'fee':
        push('$CASH', 'Taxes and fees', ORDER.cost);
        break;
      default:
        // fx_conversion and imported FX legs: a gain arrives, a cost leaves.
        push('$CASH', amount > 0 ? 'Deposit' : 'Taxes and fees', amount > 0 ? ORDER.income : ORDER.cost);
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const minuteByDate = new Map<string, number>();
  const lines = [['Symbol', 'Side', 'Qty', 'Fill Price', 'Commission', 'Closing Time']];
  for (const row of rows) {
    const minute = minuteByDate.get(row.date) ?? 0;
    minuteByDate.set(row.date, minute + 1);
    const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
    lines.push([...row.cells, `${row.date} ${time}`]);
  }
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\n') + '\n';
}

function number(value: number | string | null | undefined): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '';
  // Up to 10 decimals, no exponent, no trailing zeros.
  return parsed.toFixed(10).replace(/\.?0+$/, '');
}

export function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
