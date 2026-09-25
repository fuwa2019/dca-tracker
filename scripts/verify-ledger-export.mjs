// Exports of the stored ledger: TradingView six-column and the full ledger.
import assert from 'node:assert/strict';
import { exportTradingViewCsv, tradingViewSymbol } from '../src/lib/export/tradingviewExport.ts';
import { exportLedgerCsv, LEDGER_EXPORT_COLUMNS } from '../src/lib/export/ledgerExport.ts';
import { tradingViewImportAdapter } from '../src/lib/import/tradingview.ts';

const transactions = [
  { trade_date: '2026-06-02', ticker: 'QQQM', side: 'buy', shares: 0.0978, price: 306.4453, fees_usd: 0, settled_amount_usd: -29.97, source_currency: 'USD' },
  { trade_date: '2026-06-04', ticker: 'SIVE', side: 'buy', shares: 12, price: 8.155665, fees_usd: 1.743838192208, settled_amount_usd: -99.611818192208, source_currency: 'SEK', source_price: 76.5, fx_rate_to_usd: 0.10661, import_source: 'ibkr', import_key: 'k1' },
  { trade_date: '2026-06-15', ticker: 'QQQM', side: 'sell', shares: 0.05, price: 305.29, fees_usd: 0.01, settled_amount_usd: 15.25, source_currency: 'USD' },
];
const cashflows = [
  { effective_date: '2026-06-01', cashflow_kind: 'broker_deposit', usd_amount: 767.11 },
  { effective_date: '2026-06-04', cashflow_kind: 'dividend', usd_amount: 4.2, ticker: 'SGOV' },
  { effective_date: '2026-06-04', cashflow_kind: 'tax', usd_amount: -0.42, ticker: 'SGOV' },
  { effective_date: '2026-06-04', cashflow_kind: 'fx_conversion', usd_amount: -0.2630952776 },
  { effective_date: '2026-06-18', cashflow_kind: 'fx_conversion', usd_amount: 0.0637014163 },
  { effective_date: '2026-06-20', cashflow_kind: 'broker_withdrawal', usd_amount: -50 },
  // A manual CNY transfer happened before the broker; it is not exported.
  { effective_date: '2026-05-30', cashflow_kind: 'fx_transfer', usd_amount: 760, cny_amount: 5500 },
];

assert.equal(tradingViewSymbol('QQQM'), 'NASDAQ:QQQM');
assert.equal(tradingViewSymbol('SIVE', 'SEK'), 'OMXSTO:SIVE');
assert.equal(tradingViewSymbol('SGOV'), 'NYSE:SGOV');
assert.equal(tradingViewSymbol('ZZZZ'), 'ZZZZ', 'unknown US tickers stay bare for TradingView to resolve');

const tv = exportTradingViewCsv(transactions, cashflows);
const lines = tv.trim().split('\n');
assert.equal(lines[0], 'Symbol,Side,Qty,Fill Price,Commission,Closing Time');
assert.equal(lines.length - 1, 9, 'three trades + six in-account cash events; the CNY transfer is skipped');
assert.ok(lines.includes('$CASH,Deposit,767.11,,,2026-06-01 00:00:00'));
assert.ok(lines.includes('OMXSTO:SIVE,Buy,12,76.5,16.35717280,2026-06-04 00:00:00'.replace('16.35717280', '16.3571728')),
  'foreign trade keeps native price and native commission');
assert.ok(lines.includes('NYSE:SGOV,Dividend,4.2,,,2026-06-04 00:01:00'), 'dividend follows the day\'s trades');
assert.ok(lines.includes('$CASH,Taxes and fees,0.42,,,2026-06-04 00:02:00'), 'tax is a positive Taxes and fees row');
assert.ok(lines.includes('$CASH,Taxes and fees,0.2630952776,,,2026-06-04 00:03:00'), 'FX cost is Taxes and fees');
assert.ok(lines.includes('$CASH,Deposit,0.0637014163,,,2026-06-18 00:00:00'), 'FX gain is a Deposit');
assert.ok(lines.includes('$CASH,Withdrawal,50,,,2026-06-20 00:00:00'));
assert.ok(!tv.includes('5500'), 'CNY amounts never leave through the TradingView export');

// USD trades and deposits round-trip through the TradingView parser. (Cash
// outflows are positive quantities in TradingView files; the in-repo parser,
// no longer an import path, expects them signed, so they are not compared.)
const usdOnly = exportTradingViewCsv(transactions.filter((t) => t.source_currency === 'USD'), [cashflows[0]]);
const reparsed = tradingViewImportAdapter.audit({ text: usdOnly, fileName: 'tv.csv' });
assert.equal(reparsed.status_counts.block, 0, `TradingView parser accepts the export: ${JSON.stringify(reparsed.rows.filter((r) => r.status === 'block'))}`);
assert.equal(reparsed.trades.length, 2);
assert.equal(reparsed.cash_events.length, 1);

const ledger = exportLedgerCsv(transactions, cashflows, new Map());
const ledgerLines = ledger.trim().split('\n');
assert.equal(ledgerLines[0], LEDGER_EXPORT_COLUMNS.join(','));
assert.equal(ledgerLines.length - 1, transactions.length + cashflows.length, 'the full ledger keeps every row');
assert.ok(ledgerLines.some((line) => line.startsWith('trade,2026-06-04,,buy,SIVE,12,76.5,SEK,0.10661,8.155665,1.743838192208,')));
assert.ok(ledgerLines.some((line) => line.includes('fx_transfer') && line.includes('5500')), 'the full ledger keeps CNY transfers');

console.log('ledger export checks passed');
