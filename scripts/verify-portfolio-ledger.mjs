// Unified ledger contract: total return, TWR, XIRR, cash and position checks
// all come from one cash-flow series. Every expected value below can be
// checked by hand.
import assert from 'node:assert/strict';
import {
  buildLedger,
  buildLedgerSeries,
  summarizeLedger,
  summarizeLedgerWindow,
  ledgerCashBalance,
} from '../src/lib/calc/portfolioLedger.ts';
import { runLedgerChecks, hasBlockingFailure } from '../src/lib/calc/ledgerChecks.ts';
import { aggregatePositions } from '../src/lib/calc/position.ts';

const close = (entries) => new Map(entries);
const near = (actual, expected, tolerance, label) => {
  assert.ok(actual !== null && actual !== undefined, `${label}: value missing`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
};
const buy = (trade_date, ticker, shares, price, extra = {}) => ({
  trade_date, ticker, side: 'buy', shares, price, fees_usd: 0, settled_amount_usd: -(shares * price), ...extra,
});
const sell = (trade_date, ticker, shares, price, extra = {}) => ({
  trade_date, ticker, side: 'sell', shares, price, fees_usd: 0, settled_amount_usd: shares * price, ...extra,
});
const cash = (effective_date, cashflow_kind, usd_amount, extra = {}) => ({ effective_date, cashflow_kind, usd_amount, ...extra });

function run({ transactions, cashflows, closes, benchmark, fxRates, asOfDate }) {
  const ledger = buildLedger(transactions, cashflows);
  const series = buildLedgerSeries({ ledger, closes, benchmark, fxRates, asOfDate });
  const summary = summarizeLedger(ledger, series);
  return { ledger, series, summary };
}

/** Independent XIRR by bisection, used to hand-check the library. */
function bisectXirr(flows) {
  const t0 = Date.parse(`${flows[0][0]}T00:00:00Z`);
  const npv = (r) => flows.reduce((sum, [date, amount]) => sum + amount / Math.pow(1 + r, (Date.parse(`${date}T00:00:00Z`) - t0) / 86_400_000 / 365), 0);
  let lo = -0.99;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Golden: deposit 1000 -> buy -> +10% -> deposit 1000 + buy -> -5%.
//   TWR  = 1.10 x 0.95 - 1 = +4.50%
//   NAV  = (10 + 1000/110) x 104.5 = 1995.00; total return = 1995 - 2000 = -5.00
//   XIRR solves -1000 @2025-01-02, -1000 @2025-07-02, +1995 @2026-01-02.
// ---------------------------------------------------------------------------
{
  const secondShares = 1000 / 110;
  const { series, summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100), buy('2025-07-02', 'AAA', secondShares, 110)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 1000), cash('2025-07-02', 'broker_deposit', 1000)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-07-01', 110], ['2025-07-02', 110], ['2026-01-02', 104.5]])]]),
    benchmark: close([['2025-01-02', 500], ['2025-07-01', 520], ['2025-07-02', 520], ['2026-01-02', 550]]),
  });
  near(summary.twr, 0.045, 1e-12, 'golden TWR');
  near(summary.navUsd, 1995, 1e-9, 'golden NAV');
  near(summary.netInvestedUsd, 2000, 1e-9, 'golden net invested');
  near(summary.totalReturnUsd, -5, 1e-9, 'golden total return');
  const expectedXirr = bisectXirr([['2025-01-02', -1000], ['2025-07-02', -1000], ['2026-01-02', 1995]]);
  near(expectedXirr, -0.00334, 5e-5, 'golden XIRR hand value');
  near(summary.xirr, expectedXirr, 1e-6, 'golden XIRR');
  near(summary.benchmarkReturn, 0.1, 1e-12, 'golden benchmark');
  near(summary.excessReturn, 1.045 / 1.1 - 1, 1e-12, 'golden excess');
  near(summary.cashUsd, 0, 1e-9, 'golden cash');
  const bridge = summarizeLedgerWindow(series, '2025-07-02');
  assert.equal(bridge.status, 'ok');
  near(bridge.startingNavUsd, 1100, 1e-9, 'bridge start');
  near(bridge.externalFlowUsd, 1000, 1e-9, 'bridge flow');
  near(bridge.pnlUsd, -105, 1e-9, 'bridge pnl');
  near(bridge.endingNavUsd, 1995, 1e-9, 'bridge end');
  near(bridge.periodTwr, -0.05, 1e-12, 'bridge period TWR');
}

// No external flow after the opening deposit: TWR equals the simple return.
{
  const { summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 1000)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-06-02', 120]])]]),
  });
  near(summary.twr, 0.2, 1e-12, 'no-flow TWR');
  near(summary.totalReturnOnInvested, 0.2, 1e-12, 'no-flow simple return');
  near(summary.totalReturnUsd, 200, 1e-9, 'no-flow total return');
}

// Mid-period withdrawal leaves at the end of its day.
//   +20% (1000 -> 1200), sell 5 @120 and withdraw 600, then +10%: TWR = 1.2 x 1.1 - 1.
{
  const { summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100), sell('2025-02-03', 'AAA', 5, 120)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 1000), cash('2025-02-03', 'broker_withdrawal', -600)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-02-03', 120], ['2025-03-03', 132]])]]),
  });
  near(summary.twr, 0.32, 1e-12, 'withdrawal TWR');
  near(summary.navUsd, 660, 1e-9, 'withdrawal NAV');
  near(summary.netInvestedUsd, 400, 1e-9, 'withdrawal net invested');
  near(summary.totalReturnUsd, 260, 1e-9, 'withdrawal total return');
  const expected = bisectXirr([['2025-01-02', -1000], ['2025-02-03', 600], ['2025-03-03', 660]]);
  near(summary.xirr, expected, 1e-6, 'withdrawal XIRR');
}

// Same-day deposit + buy is neutral: the deposit enters at the start of the day.
{
  const { series } = run({
    transactions: [buy('2025-01-02', 'AAA', 5, 100), buy('2025-01-03', 'AAA', 5, 100)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 500), cash('2025-01-03', 'broker_deposit', 500)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-01-03', 100]])]]),
  });
  assert.equal(series.points.length, 2);
  near(series.points[1].dailyReturn, 0, 1e-12, 'same-day deposit+buy return');
  near(series.points[1].cumulativeTwr, 0, 1e-12, 'same-day deposit+buy cumulative');
}

// Multi-currency: SEK position valued as native close x USD rate.
//   Buy 10 @100 SEK at 0.10 USD/SEK; price +10% and SEK +10% -> +21% in USD; sell.
{
  const sek = { source_currency: 'SEK' };
  const { summary, series, ledger } = run({
    transactions: [
      buy('2025-01-02', 'SIVE', 10, 10, { ...sek, source_price: 100, fx_rate_to_usd: 0.1 }),
      sell('2025-01-06', 'SIVE', 10, 12.1, { ...sek, source_price: 110, fx_rate_to_usd: 0.11 }),
    ],
    cashflows: [cash('2025-01-02', 'broker_deposit', 100)],
    closes: new Map([['SIVE', close([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 110]])]]),
    fxRates: new Map([['SEK', close([['2025-01-02', 0.1], ['2025-01-03', 0.11]])]]),
  });
  near(series.points.find((p) => p.date === '2025-01-03').navUsd, 121, 1e-9, 'SEK NAV in USD');
  near(summary.twr, 0.21, 1e-12, 'multi-currency TWR');
  near(summary.cashUsd, 121, 1e-9, 'multi-currency cash after sell');
  near(ledgerCashBalance(ledger), 121, 1e-9, 'multi-currency ledger cash');
  assert.equal(series.warnings.length, 0, 'daily FX supplied, no approximation warning');

  // Without daily FX the trade rate is used and the approximation is flagged.
  const approx = run({
    transactions: [buy('2025-01-02', 'SIVE', 10, 10, { ...sek, source_price: 100, fx_rate_to_usd: 0.1 })],
    cashflows: [cash('2025-01-02', 'broker_deposit', 100)],
    closes: new Map([['SIVE', close([['2025-01-02', 100], ['2025-01-03', 110]])]]),
  });
  near(approx.summary.navUsd, 110, 1e-9, 'trade-rate FX valuation');
  assert.ok(approx.series.warnings.some((w) => w.code === 'fx_trade_rate'));
}

// Dividends, tax and FX conversion P&L are internal: return, never capital.
{
  const { summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100)],
    cashflows: [
      cash('2025-01-02', 'broker_deposit', 1000),
      cash('2025-01-03', 'dividend', 20),
      cash('2025-01-03', 'tax', -2),
      cash('2025-01-03', 'fx_transfer', -0.5, { cny_amount: null }),
    ],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-01-03', 100]])]]),
  });
  near(summary.twr, 0.0175, 1e-12, 'dividend TWR');
  near(summary.netInvestedUsd, 1000, 1e-9, 'dividend not capital');
  near(summary.cashUsd, 17.5, 1e-9, 'dividend cash');
  near(summary.incomeUsd, 20, 1e-9, 'income');
  near(summary.costsUsd, -2, 1e-9, 'costs');
  near(summary.fxConversionUsd, -0.5, 1e-9, 'imported FX leg is conversion P&L');
}

// A manual CNY->USD transfer is excluded once broker deposits exist,
// and acts as the deposit in legacy ledgers without them.
{
  const withBroker = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 1000), cash('2025-01-01', 'fx_transfer', 1000, { cny_amount: 7200 })],
    closes: new Map([['AAA', close([['2025-01-02', 100]])]]),
  });
  near(withBroker.summary.netInvestedUsd, 1000, 1e-9, 'manual transfer not double counted');
  const legacy = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100)],
    cashflows: [cash('2025-01-02', 'fx_transfer', 1000, { cny_amount: 7200 })],
    closes: new Map([['AAA', close([['2025-01-02', 100]])]]),
  });
  assert.equal(legacy.ledger.flowBasis, 'legacy_fx_transfer');
  near(legacy.summary.netInvestedUsd, 1000, 1e-9, 'legacy transfer funds the account');
}

// Trade-only ledgers infer funding from unfunded buys and say so.
{
  const { ledger, summary, series } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100), sell('2025-01-03', 'AAA', 5, 110), buy('2025-01-06', 'AAA', 5, 100)],
    cashflows: [],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-01-03', 110], ['2025-01-06', 100]])]]),
  });
  assert.equal(ledger.flowBasis, 'inferred_from_trades');
  near(summary.netInvestedUsd, 1000, 1e-9, 'sell proceeds fund the later buy');
  near(summary.twr, 0.05, 1e-12, 'inferred: +10% then 1050/1100');
  const checks = runLedgerChecks({ ledger, series, summary });
  assert.equal(checks.find((c) => c.id === 'flow_basis').status, 'warn');
}

// Checks: an early buy, a displayed cash mismatch and an oversell all surface.
{
  const { ledger, series, summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 10, 100), sell('2025-01-06', 'AAA', 12, 100)],
    cashflows: [cash('2025-01-03', 'broker_deposit', 1000)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-01-03', 100], ['2025-01-06', 100]])]]),
  });
  const checks = runLedgerChecks({ ledger, series, summary, displayedCashUsd: summary.cashUsd + 5 });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId.cash_reconciliation.status, 'fail');
  near(byId.cash_reconciliation.difference, 5, 1e-9, 'cash difference reported');
  assert.equal(byId.position_reconciliation.status, 'fail');
  assert.match(byId.position_reconciliation.message, /超过持有数量/);
  assert.equal(byId.funding_before_buy.status, 'warn');
  assert.match(byId.funding_before_buy.message, /之前没有入金/);
  assert.ok(hasBlockingFailure(checks));
}

// A consistent ledger passes; TWR and simple return of opposite sign warn only.
{
  const { ledger, series, summary } = run({
    transactions: [buy('2025-01-02', 'AAA', 1, 100), buy('2025-02-03', 'AAA', 100, 50)],
    cashflows: [cash('2025-01-02', 'broker_deposit', 100), cash('2025-02-03', 'broker_deposit', 5000)],
    closes: new Map([['AAA', close([['2025-01-02', 100], ['2025-01-31', 50], ['2025-02-03', 50], ['2025-03-03', 55]])]]),
  });
  const checks = runLedgerChecks({ ledger, series, summary, displayedCashUsd: summary.cashUsd, displayedShares: new Map([['AAA', 101]]) });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId.cash_reconciliation.status, 'pass');
  assert.equal(byId.position_reconciliation.status, 'pass');
  assert.ok(summary.twr < 0 && summary.totalReturnOnInvested > 0, 'fixture has opposite signs');
  assert.equal(byId.return_consistency.status, 'warn');
  assert.equal(hasBlockingFailure(checks), false);
}

// Statement cash is compared to the cent.
{
  const { ledger, series, summary } = run({
    transactions: [],
    cashflows: [cash('2025-01-02', 'broker_deposit', 100)],
    closes: new Map(),
  });
  const failing = runLedgerChecks({ ledger, series, summary, statementCash: [{ label: 'IBKR', asOf: '2025-01-02', statementCashUsd: 99.98, ledgerCashUsd: 100 }] });
  assert.equal(failing.find((c) => c.id === 'statement_cash').status, 'fail');
  const passing = runLedgerChecks({ ledger, series, summary, statementCash: [{ label: 'IBKR', asOf: '2025-01-02', statementCashUsd: 100.004, ledgerCashUsd: 100 }] });
  assert.equal(passing.find((c) => c.id === 'statement_cash').status, 'pass');
}

// An empty window is unverifiable, never a vacuous pass.
{
  const { series } = run({
    transactions: [],
    cashflows: [cash('2025-01-02', 'dividend', 0.001)],
    closes: new Map(),
  });
  const bridge = summarizeLedgerWindow(series);
  assert.equal(bridge.status, 'unverifiable');
}

// Schwab lists a same-day Sell above its Buy, so the sell can be stored first.
// Holdings must still net to zero, and agree with the ledger's position check.
{
  const rows = [
    { ...sell('2026-06-02', 'IBIT', 0.2582, 38.045), created_at: '2026-06-02T00:00:01Z' },
    { ...buy('2026-06-02', 'IBIT', 0.2582, 38.725), created_at: '2026-06-02T00:00:02Z' },
  ];
  const ibit = aggregatePositions(rows).find((p) => p.ticker === 'IBIT');
  near(ibit.shares, 0, 1e-12, 'same-day sell listed before buy nets to zero');
  near(ibit.realizedUsd, 0.2582 * (38.045 - 38.725), 1e-9, 'the round trip realizes its loss');
  const { ledger, series, summary } = run({
    transactions: rows,
    cashflows: [cash('2026-06-02', 'broker_deposit', 20)],
    closes: new Map([['IBIT', close([['2026-06-02', 38.5]])]]),
  });
  const checks = runLedgerChecks({ ledger, series, summary, displayedShares: new Map([['IBIT', ibit.shares]]) });
  assert.equal(checks.find((c) => c.id === 'position_reconciliation').status, 'pass');
}

console.log('portfolio ledger contract passed');
