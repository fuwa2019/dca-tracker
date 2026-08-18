import assert from 'node:assert/strict';
import { computeLedgerTwr } from '../src/lib/calc/ledgerTwr.ts';
import { calculateLedgerCashBalance } from '../src/lib/calc/cashBalance.ts';
import { buildLedgerXirrEvents } from '../src/lib/calc/xirr.ts';

const prices = new Map([
  ['VGT', new Map([
    ['2026-01-01', 100],
    ['2026-01-02', 110],
    ['2026-01-03', 110],
    ['2026-01-04', 110],
    ['2026-01-05', 110],
    ['2026-01-06', 110],
  ])],
]);

const result = computeLedgerTwr({
  trades: [
    { effective_date: '2026-01-01', side: 'buy', ticker: 'VGT', shares: '1', price: '100', usd_amount: '-100' },
    { effective_date: '2026-01-03', side: 'sell', ticker: 'VGT', shares: '0.5', price: '110', usd_amount: '55' },
    { effective_date: '2026-01-04', side: 'buy', ticker: 'VGT', shares: '1', price: '110', usd_amount: '-110' },
  ],
  cash_events: [
    { effective_date: '2026-01-01', event_type: 'broker_deposit', usd_amount: '100' },
    { effective_date: '2026-01-03', event_type: 'broker_withdrawal', usd_amount: '-50' },
    { effective_date: '2026-01-04', event_type: 'broker_deposit', usd_amount: '110' },
    { effective_date: '2026-01-05', event_type: 'dividend', usd_amount: '10' },
    { effective_date: '2026-01-06', event_type: 'tax', usd_amount: '-5' },
    { effective_date: '2026-01-06', event_type: 'fee', usd_amount: '-2' },
  ],
  prices,
  as_of_date: '2026-01-06',
});

assert.equal(
  calculateLedgerCashBalance(
    [
      { usd_amount: 100 },
      { usd_amount: -50 },
      { usd_amount: 110 },
      { usd_amount: 10 },
      { usd_amount: -5 },
      { usd_amount: -2 },
    ],
    [
      { side: 'buy', shares: 1, price: 100, settled_amount_usd: -100 },
      { side: 'sell', shares: 0.5, price: 110, settled_amount_usd: 55 },
      { side: 'buy', shares: 1, price: 110, settled_amount_usd: -110 },
    ],
  ),
  8,
  'V2 cash includes explicit events and settled trade cash exactly once',
);

assert.ok(result);
assert.equal(result.method, 'ledger_twr_v2');
assert.equal(result.complete, true);
assert.equal(result.warnings.length, 0);
const day2 = result.points.find((point) => point.date === '2026-01-02');
const day3 = result.points.find((point) => point.date === '2026-01-03');
const day4 = result.points.find((point) => point.date === '2026-01-04');
const day5 = result.points.find((point) => point.date === '2026-01-05');
const day6 = result.points.find((point) => point.date === '2026-01-06');
const closeTo = (actual, expected, message) => assert.ok(
  actual != null && Math.abs(actual - expected) < 1e-12,
  `${message}: expected ${expected}, got ${actual}`,
);
closeTo(day2?.period_return_pct, 0.1, 'ordinary close movement is measured');
closeTo(day3?.period_return_pct, 0, 'end-of-day withdrawal is neutralized');
closeTo(day4?.period_return_pct, 0, 'start-of-day deposit and same-price buy are neutralized');
closeTo(day5?.period_return_pct, 10 / 170, 'dividend remains internal portfolio performance');
closeTo(day6?.period_return_pct, -7 / 180, 'tax and fee remain internal portfolio performance');
const expectedCumulative = (1.1 * (1 + 10 / 170) * (1 - 7 / 180)) - 1;
assert.ok(Math.abs(result.cumulative_return_pct - expectedCumulative) < 1e-12);

const incomplete = computeLedgerTwr({
  trades: [{ effective_date: '2026-01-01', side: 'buy', ticker: 'SMH', shares: 1, price: 200, usd_amount: -200 }],
  cash_events: [{ effective_date: '2026-01-01', event_type: 'broker_deposit', usd_amount: 200 }],
  prices: new Map(),
  as_of_date: '2026-01-01',
});
assert.equal(incomplete?.complete, false, 'missing ordinary close must stay incomplete');
assert.ok(incomplete?.warnings.some((warning) => warning.includes('缺少普通收盘价')));

const xirrEvents = buildLedgerXirrEvents({
  cashflows: [
    { effective_date: '2026-01-01', usd_amount: 100, cashflow_kind: 'broker_deposit' },
    { effective_date: '2026-01-03', usd_amount: -50, cashflow_kind: 'broker_withdrawal' },
    { effective_date: '2026-01-04', usd_amount: -10, cashflow_kind: 'stock_allocation' },
    { effective_date: '2026-01-05', usd_amount: 10, cashflow_kind: 'dividend' },
    { effective_date: '2026-01-06', usd_amount: -5, cashflow_kind: 'tax' },
  ],
  currentMarketValueUsd: 200,
  asOf: new Date('2026-01-06T00:00:00Z'),
});
assert.deepEqual(
  xirrEvents.map((event) => event.amount),
  [-100, 50, 10, 200],
  'V2 XIRR includes only investor cash and ETF sleeve boundary transfers',
);

console.log('ledger performance fixtures ok');
