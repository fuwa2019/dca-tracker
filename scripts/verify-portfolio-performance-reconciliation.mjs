import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLedgerTwr } from '../src/lib/calc/ledgerTwr.ts';
import { buildLedgerXirrEvents, computeXirr } from '../src/lib/calc/xirr.ts';

const fixtureDir = 'docs/research/competitive/2026-08/fixtures';
const canonical = JSON.parse(readFileSync(`${fixtureDir}/canonical-ledger.json`, 'utf8'));
const priceFixture = JSON.parse(readFileSync(`${fixtureDir}/ordinary-close-prices.json`, 'utf8'));
const prices = new Map();
for (const row of priceFixture.prices) {
  for (const [ticker, value] of Object.entries(row)) {
    if (ticker === 'date') continue;
    const daily = prices.get(ticker) ?? new Map();
    daily.set(row.date, Number(value));
    prices.set(ticker, daily);
  }
}

const trades = canonical.events
  .filter((event) => event.kind === 'trade')
  .map((event) => ({
    effective_date: event.effective_date,
    side: event.side,
    ticker: event.ticker,
    shares: event.shares,
    price: event.price,
    usd_amount: event.usd_amount,
  }));
const cashEvents = canonical.events
  .filter((event) => event.kind !== 'trade')
  .map((event) => ({
    effective_date: event.effective_date,
    event_type: event.kind,
    usd_amount: event.usd_amount,
  }));

const engine = computeLedgerTwr({ trades, cash_events: cashEvents, prices, as_of_date: '2026-01-15' });
assert.ok(engine?.complete, `ledger TWR must be complete: ${engine?.warnings.join('; ')}`);
const referenceTtwr = referenceDailyTtwr(trades, cashEvents, prices);
const twrDifference = Math.abs((engine?.cumulative_return_pct ?? NaN) - referenceTtwr);
assert.ok(twrDifference <= 0.00000001, `TTWROR difference too large: ${twrDifference}`);

const endingMarketValue = Number(canonical.expected.ending_cash_usd)
  + Number(canonical.expected.ending_shares.VGT) * 111
  + Number(canonical.expected.ending_shares.SMH) * 203;
const ledgerXirrEvents = buildLedgerXirrEvents({
  cashflows: cashEvents.map((event) => ({
    effective_date: event.effective_date,
    usd_amount: event.usd_amount,
    cashflow_kind: event.event_type,
  })),
  currentMarketValueUsd: endingMarketValue,
  asOf: new Date('2026-01-15T00:00:00Z'),
});
const engineXirr = computeXirr(ledgerXirrEvents);
const referenceXirr = solveXirr(ledgerXirrEvents);
assert.ok(engineXirr != null, 'XIRR engine must converge for canonical fixture');
assert.ok(Math.abs(engineXirr - referenceXirr) <= 0.0001, `XIRR difference exceeds 1bp: ${engineXirr} vs ${referenceXirr}`);

console.log(JSON.stringify({
  reference: 'portfolio-performance-daily-flow-formula',
  twr_engine: engine.cumulative_return_pct,
  twr_reference: referenceTtwr,
  twr_difference: twrDifference,
  xirr_engine: engineXirr,
  xirr_reference: referenceXirr,
  xirr_difference: Math.abs(engineXirr - referenceXirr),
}));

// The block above is a mathematical gate against the documented formula. The
// block below is the application gate: the same shipped engine, fed Portfolio
// Performance's own stored ledger, must reproduce what the application
// displayed. Anything left over is a formula disagreement, not a rounding one.
const stored = JSON.parse(readFileSync(`${fixtureDir}/portfolio-performance-stored-ledger.json`, 'utf8'));
const observed = reproduceObservedPortfolioPerformance(stored);
assert.equal(
  observed.final_value_display,
  stored.observed.final_value_usd,
  `PP final value mismatch: ${observed.final_value_display} vs ${stored.observed.final_value_usd}`,
);
assert.equal(
  observed.ttwror_display,
  stored.observed.ttwror_pct,
  `PP TTWROR mismatch: ${observed.ttwror_display} vs ${stored.observed.ttwror_pct}`,
);
assert.equal(
  observed.irr_display,
  stored.observed.irr_pct,
  `PP IRR mismatch: ${observed.irr_display} vs ${stored.observed.irr_pct}`,
);
console.log(JSON.stringify({
  reference: 'portfolio-performance-0.86.0-application-output',
  ...observed,
}));

/**
 * Rebuild the application's displayed figures from its own stored integers.
 * Money is stored in cents and shares in 1e-8 units, so this reads the
 * application's rounding rather than re-applying the canonical fixture's
 * full precision. With no quote provider configured the application values a
 * security at the gross price of its latest transaction.
 */
function reproduceObservedPortfolioPerformance(fixture) {
  const SHARE_UNIT = 1e-8;
  const CASH_KINDS = {
    deposit: 'broker_deposit',
    removal: 'broker_withdrawal',
    dividend: 'dividend',
    interest: 'interest',
    tax: 'tax',
    fee: 'fee',
  };
  const SIGNED = { deposit: 1, removal: -1, dividend: 1, interest: 1, tax: -1, fee: -1 };

  const storedTrades = [];
  const storedCashEvents = [];
  const storedPrices = new Map();
  for (const row of fixture.transactions) {
    const amount = row.net_cents / 100;
    if (row.kind === 'buy' || row.kind === 'sell') {
      const shares = row.shares_1e8 * SHARE_UNIT;
      const grossCents = row.kind === 'buy' ? row.net_cents - row.fee_cents : row.net_cents + row.fee_cents;
      const price = grossCents / 100 / shares;
      storedTrades.push({
        effective_date: row.date,
        side: row.kind,
        ticker: row.security,
        shares,
        price,
        usd_amount: row.kind === 'buy' ? -amount : amount,
      });
      const daily = storedPrices.get(row.security) ?? new Map();
      daily.set(row.date, price);
      storedPrices.set(row.security, daily);
      continue;
    }
    storedCashEvents.push({
      effective_date: row.date,
      event_type: CASH_KINDS[row.kind],
      usd_amount: SIGNED[row.kind] * amount,
    });
  }

  const ledgerEnd = fixture.transactions.map((row) => row.date).sort().at(-1);
  const twr = computeLedgerTwr({
    trades: storedTrades,
    cash_events: storedCashEvents,
    prices: storedPrices,
    as_of_date: ledgerEnd,
  });
  assert.ok(twr?.complete, `PP-stored TWR must be complete: ${twr?.warnings.join('; ')}`);
  const finalValue = twr.points.at(-1).ending_nav_usd;

  // The report period ends on the run date, not on the last ledger date. No
  // price moves in between, so only the annualization window changes.
  const irrEvents = buildLedgerXirrEvents({
    cashflows: storedCashEvents.map((event) => ({
      effective_date: event.effective_date,
      usd_amount: event.usd_amount,
      cashflow_kind: event.event_type,
    })),
    currentMarketValueUsd: Math.round(finalValue * 100) / 100,
    asOf: new Date(`${fixture.observed.run_date}T00:00:00Z`),
  });
  const irr = computeXirr(irrEvents);
  assert.ok(irr != null, 'PP-stored XIRR must converge');

  return {
    final_value_usd: finalValue,
    final_value_display: (Math.round(finalValue * 100) / 100).toFixed(2),
    ttwror_pct: twr.cumulative_return_pct * 100,
    ttwror_display: (twr.cumulative_return_pct * 100).toFixed(2),
    irr_pct: irr * 100,
    irr_display: (irr * 100).toFixed(2),
    quote_gap_pct: (engine.cumulative_return_pct - twr.cumulative_return_pct) * 100,
  };
}

function referenceDailyTtwr(inputTrades, inputCashEvents, priceMap) {
  const eventDates = [
    ...inputTrades.map((trade) => trade.effective_date),
    ...inputCashEvents.map((event) => event.effective_date),
  ];
  const start = [...new Set(eventDates)].sort()[0];
  const dates = [...new Set([
    ...eventDates,
    ...[...priceMap.values()].flatMap((daily) => [...daily.keys()]),
  ])].filter((date) => date >= start && date <= '2026-01-15').sort();
  const tradesByDate = groupByDate(inputTrades);
  const eventsByDate = groupByDate(inputCashEvents);
  const externalKinds = new Set(['fx_transfer', 'broker_deposit', 'broker_withdrawal', 'stock_allocation']);
  const shares = new Map();
  const lastClose = new Map();
  let cash = 0;
  let previousNav = 0;
  let factor = 1;
  for (const date of dates) {
    const events = eventsByDate.get(date) ?? [];
    const inflow = events
      .filter((event) => externalKinds.has(event.event_type))
      .map((event) => Number(event.usd_amount))
      .filter((amount) => amount > 0)
      .reduce((sum, amount) => sum + amount, 0);
    const outflow = events
      .filter((event) => externalKinds.has(event.event_type))
      .map((event) => Number(event.usd_amount))
      .filter((amount) => amount < 0)
      .reduce((sum, amount) => sum - amount, 0);
    cash += inflow;
    for (const event of events) {
      if (!externalKinds.has(event.event_type)) cash += Number(event.usd_amount);
    }
    for (const trade of tradesByDate.get(date) ?? []) {
      const quantity = Number(trade.shares);
      shares.set(trade.ticker, (shares.get(trade.ticker) ?? 0) + (trade.side === 'buy' ? quantity : -quantity));
      cash += Number(trade.usd_amount);
    }
    let marketValue = 0;
    for (const [ticker, quantity] of shares) {
      const direct = priceMap.get(ticker)?.get(date);
      if (direct != null) lastClose.set(ticker, direct);
      marketValue += quantity * (lastClose.get(ticker) ?? 0);
    }
    const beforeOutflow = cash + marketValue;
    cash -= outflow;
    const endingNav = cash + marketValue;
    const denominator = previousNav + inflow;
    if (denominator > 0) factor *= beforeOutflow / denominator;
    previousNav = endingNav;
  }
  return factor - 1;
}

function groupByDate(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const entries = grouped.get(row.effective_date) ?? [];
    entries.push(row);
    grouped.set(row.effective_date, entries);
  }
  return grouped;
}

function solveXirr(events) {
  const valueAt = (rate) => events.reduce((sum, event) => {
    const days = (event.when.getTime() - events[0].when.getTime()) / 86_400_000;
    return sum + event.amount / ((1 + rate) ** (days / 365));
  }, 0);
  let low = -0.9999;
  let high = 1;
  while (valueAt(low) * valueAt(high) > 0 && high < 1_000_000) high *= 2;
  assert.ok(valueAt(low) * valueAt(high) <= 0, 'reference XIRR must have a bracket');
  for (let i = 0; i < 200; i += 1) {
    const middle = (low + high) / 2;
    if (valueAt(low) * valueAt(middle) <= 0) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}
