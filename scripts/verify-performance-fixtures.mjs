import assert from 'node:assert/strict';
import { aggregatePositions } from '../src/lib/calc/position.ts';
import { buildEquityHistory } from '../src/lib/calc/history.ts';
import {
  transactionCashAmount,
  transactionCashEffect,
} from '../src/lib/calc/transactionAmounts.ts';
import { summarizeCashflows } from '../src/lib/calc/cashflows.ts';
import { calculateBrokerCashBalance } from '../src/lib/calc/cashBalance.ts';
import { buildXirrEvents } from '../src/lib/calc/xirr.ts';

function dailyLinkedTwr(rows) {
  let cumulative = 1;
  let prevNav = null;
  for (const row of rows) {
    if (prevNav !== null && prevNav > 0) {
      const factor = (row.nav - (row.flow ?? 0)) / prevNav;
      if (Number.isFinite(factor) && factor >= 0) cumulative *= factor;
    }
    prevNav = row.nav;
  }
  return cumulative - 1;
}

function modifiedDietz({ startValue, endValue, flows }) {
  const weightedFlows = flows.reduce((sum, flow) => sum + flow.amount * flow.weight, 0);
  const totalFlows = flows.reduce((sum, flow) => sum + flow.amount, 0);
  const denominator = startValue + weightedFlows;
  if (Math.abs(denominator) < 1e-9) return null;
  return (endValue - startValue - totalFlows) / denominator;
}

function approx(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

function dailyPnl(row, previous) {
  if (!previous) return null;
  return row.nav - (row.invested - previous.invested) - previous.nav;
}

// Single buy followed by a 10% price move.
approx(dailyLinkedTwr([
  { date: '2026-01-01', nav: 100, flow: 100 },
  { date: '2026-01-02', nav: 110, flow: 0 },
]), 0.1);

// A deposit with no market movement should not create performance.
approx(dailyLinkedTwr([
  { date: '2026-01-01', nav: 100, flow: 100 },
  { date: '2026-01-02', nav: 200, flow: 100 },
]), 0);

// Cash drag is real: if half the NAV is uninvested and stock rises 10%, account TWR is 5%.
approx(dailyLinkedTwr([
  { date: '2026-01-01', nav: 200, flow: 200 },
  { date: '2026-01-02', nav: 210, flow: 0 },
]), 0.05);

// Modified Dietz fixture: $100 start, $100 mid-period flow, $210 end -> about 6.67%.
approx(modifiedDietz({
  startValue: 100,
  endValue: 210,
  flows: [{ amount: 100, weight: 0.5 }],
}), 10 / 150);

assert.equal(dailyPnl({ nav: 100, invested: 100 }, null), null, 'first trading day has no prior NAV baseline');
approx(dailyPnl({ nav: 110, invested: 100 }, { nav: 100, invested: 100 }), 10);
approx(dailyPnl({ nav: 200, invested: 200 }, { nav: 100, invested: 100 }), 0);
approx(dailyPnl({ nav: 215, invested: 200 }, { nav: 110, invested: 100 }), 5);

const importedDepositSummary = summarizeCashflows([
  {
    cny_amount: 720,
    usd_amount: 99,
    target_rate: 7.2,
    fees_cny: 0,
  },
  {
    cny_amount: null,
    usd_amount: 125.4,
    target_rate: null,
    fees_cny: 0,
  },
]);
approx(importedDepositSummary.totalUsdActual, 224.4);
approx(importedDepositSummary.totalCny, 720);
approx(importedDepositSummary.totalUsdIdeal, 100);
approx(importedDepositSummary.totalLoss, 1);
approx(importedDepositSummary.lossPct, 0.01);

const authoritativeDepositEvents = buildXirrEvents({
  cashflows: [
    { usd_in_date: '2026-01-01', usd_amount: 1000, cashflow_kind: 'fx_transfer' },
    { usd_in_date: '2026-01-02', usd_amount: 650, cashflow_kind: 'broker_deposit' },
  ],
  currentMarketValueUsd: 700,
  asOf: new Date('2026-02-01T00:00:00Z'),
});
assert.deepEqual(
  authoritativeDepositEvents.map((event) => event.amount),
  [-650, 700],
  'imported broker deposits replace manual FX rows as the XIRR funding source',
);
const legacyFxEvents = buildXirrEvents({
  cashflows: [{ usd_in_date: '2026-01-01', usd_amount: 1000, cashflow_kind: 'fx_transfer' }],
  currentMarketValueUsd: 1100,
  asOf: new Date('2026-02-01T00:00:00Z'),
});
assert.deepEqual(
  legacyFxEvents.map((event) => event.amount),
  [-1000, 1100],
  'manual FX rows remain the legacy XIRR fallback when no broker deposit exists',
);
const buyWithFee = transaction({
  id: 'buy-fee',
  trade_date: '2026-01-02',
  side: 'buy',
  ticker: 'VOO',
  shares: 10,
  price: 10,
  fees_usd: 10,
});
const sellWithFee = transaction({
  id: 'sell-fee',
  trade_date: '2026-01-03',
  side: 'sell',
  ticker: 'VOO',
  shares: 4,
  price: 15,
  fees_usd: 2,
});

assert.equal(transactionCashAmount(buyWithFee), 110, 'buy cash amount includes fee');
assert.equal(transactionCashAmount(sellWithFee), 58, 'sell cash amount deducts fee');
assert.equal(
  transactionCashEffect(buyWithFee) + transactionCashEffect(sellWithFee),
  -52,
  'cash balance uses buy total cost and sell net proceeds',
);
approx(
  calculateBrokerCashBalance([{ usd_amount: 224.4 }], [buyWithFee, sellWithFee]),
  172.4,
);

const [feePosition] = aggregatePositions([buyWithFee, sellWithFee]);
approx(feePosition.shares, 6);
approx(feePosition.avgCost, 11);
approx(feePosition.fifoCost, 11);
approx(feePosition.totalBoughtUsd, 110);
approx(feePosition.realizedUsd, 14);

const firstBuy = transaction({
  id: 'history-buy-1',
  trade_date: '2026-01-01',
  side: 'buy',
  ticker: 'VOO',
  shares: 1,
  price: 100,
});
const secondBuyWithFee = transaction({
  id: 'history-buy-2',
  trade_date: '2026-01-02',
  side: 'buy',
  ticker: 'VOO',
  shares: 1,
  price: 100,
  fees_usd: 1,
});
const feeHistory = buildEquityHistory({
  transactions: [firstBuy, secondBuyWithFee],
  cashflows: [],
  prices: new Map([
    ['VOO', new Map([['2026-01-01', 100], ['2026-01-02', 100]])],
    ['SPY', new Map([['2026-01-01', 100], ['2026-01-02', 100]])],
  ]),
  asOf: new Date('2026-01-02T17:00:00-05:00'),
});
const feeDay = feeHistory.find((row) => row.date === '2026-01-02');
assert.ok(feeDay, 'fee history includes second trade day');
approx(feeDay.invested, 201);
approx(feeDay.navUser, 200);
approx(feeDay.pnlUser, -1);
approx(feeDay.returnPctUser, -0.01);

console.log('performance fixtures ok');

function transaction(overrides) {
  return {
    id: overrides.id,
    user_id: 'finance-fixture-user',
    batch_id: null,
    trade_date: overrides.trade_date,
    ticker: overrides.ticker,
    side: overrides.side,
    price: overrides.price,
    shares: overrides.shares,
    fees_usd: overrides.fees_usd ?? 0,
    kind: 'dca',
    note: null,
    source_description: null,
    import_source: null,
    import_key: null,
    created_at: `${overrides.trade_date}T12:00:00.000Z`,
    updated_at: `${overrides.trade_date}T12:00:00.000Z`,
  };
}
