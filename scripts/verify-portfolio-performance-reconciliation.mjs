import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildLedger,
  buildLedgerSeries,
  solveXirr as solveLedgerXirr,
} from '../src/lib/calc/portfolioLedger.ts';

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

const referenceTtwr = referenceDailyTtwr(trades, cashEvents, prices);
const stored = JSON.parse(readFileSync(`${fixtureDir}/portfolio-performance-stored-ledger.json`, 'utf8'));

// Two gates for the unified ledger (portfolioLedger), the engine every page
// and the share cache use: (1) the documented Portfolio Performance daily-flow
// formula on the canonical ledger, and (2) Portfolio Performance 0.86.0's own
// stored ledger, whose displayed figures it must reproduce to the cent.
{
  const unified = runUnifiedLedger(trades, cashEvents, prices, '2026-01-15');
  const difference = Math.abs(unified.twr - referenceTtwr);
  assert.ok(difference <= 0.00000001, `unified TTWROR difference too large: ${difference}`);
  const endingValue = Number(canonical.expected.ending_cash_usd)
    + Number(canonical.expected.ending_shares.VGT) * 111
    + Number(canonical.expected.ending_shares.SMH) * 203;
  const xirrEvents = [
    ...cashEvents
      .filter((event) => ['broker_deposit', 'broker_withdrawal', 'stock_allocation'].includes(event.event_type))
      .map((event) => ({ amount: -Number(event.usd_amount), when: new Date(`${event.effective_date}T00:00:00Z`) })),
    { amount: endingValue, when: new Date('2026-01-15T00:00:00Z') },
  ];
  const engineXirr = solveLedgerXirr(xirrEvents);
  const referenceXirr = solveXirr(xirrEvents);
  assert.ok(Math.abs(engineXirr - referenceXirr) <= 0.0001, `XIRR difference exceeds 1bp: ${engineXirr} vs ${referenceXirr}`);
  console.log(JSON.stringify({ reference: 'portfolio-performance-daily-flow-formula', twr_engine: unified.twr, twr_reference: referenceTtwr, xirr_engine: engineXirr, xirr_reference: referenceXirr }));
}
{
  const { storedTrades, storedCashEvents, storedPrices, ledgerEnd } = storedLedgerInputs(stored);
  const unified = runUnifiedLedger(storedTrades, storedCashEvents, storedPrices, ledgerEnd);
  const finalValue = Math.round(unified.finalValue * 100) / 100;
  assert.equal(finalValue.toFixed(2), stored.observed.final_value_usd, 'unified PP final value');
  assert.equal((unified.twr * 100).toFixed(2), stored.observed.ttwror_pct, 'unified PP TTWROR');
  const irr = solveLedgerXirr([
    ...storedCashEvents
      .filter((event) => event.event_type === 'broker_deposit' || event.event_type === 'broker_withdrawal')
      .map((event) => ({ amount: -Number(event.usd_amount), when: new Date(`${event.effective_date}T00:00:00Z`) })),
    { amount: finalValue, when: new Date(`${stored.observed.run_date}T00:00:00Z`) },
  ]);
  assert.equal((irr * 100).toFixed(2), stored.observed.irr_pct, 'unified PP IRR');
  console.log(JSON.stringify({ reference: 'unified-ledger-vs-portfolio-performance-0.86.0', final_value: finalValue, ttwror_pct: unified.twr * 100, irr_pct: irr * 100 }));
}

function runUnifiedLedger(inputTrades, inputCashEvents, priceMap, asOfDate) {
  const ledger = buildLedger(
    inputTrades.map((trade) => ({
      trade_date: trade.effective_date,
      ticker: trade.ticker,
      side: trade.side,
      shares: trade.shares,
      price: trade.price,
      settled_amount_usd: trade.usd_amount,
    })),
    inputCashEvents.map((event) => ({
      effective_date: event.effective_date,
      cashflow_kind: event.event_type,
      usd_amount: event.usd_amount,
    })),
  );
  const series = buildLedgerSeries({ ledger, closes: priceMap, asOfDate });
  assert.ok(series.complete, `unified ledger must be complete: ${series.warnings.map((w) => w.message).join('; ')}`);
  const last = series.points.at(-1);
  return { twr: last.cumulativeTwr, finalValue: last.navUsd };
}

function storedLedgerInputs(fixture) {
  const SHARE_UNIT = 1e-8;
  const CASH_KINDS = { deposit: 'broker_deposit', removal: 'broker_withdrawal', dividend: 'dividend', interest: 'interest', tax: 'tax', fee: 'fee' };
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
      storedTrades.push({ effective_date: row.date, side: row.kind, ticker: row.security, shares, price, usd_amount: row.kind === 'buy' ? -amount : amount });
      const daily = storedPrices.get(row.security) ?? new Map();
      daily.set(row.date, price);
      storedPrices.set(row.security, daily);
      continue;
    }
    storedCashEvents.push({ effective_date: row.date, event_type: CASH_KINDS[row.kind], usd_amount: SIGNED[row.kind] * amount });
  }
  const ledgerEnd = fixture.transactions.map((row) => row.date).sort().at(-1);
  return { storedTrades, storedCashEvents, storedPrices, ledgerEnd };
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
