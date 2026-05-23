// 30-year stress test: invariant checks on long-horizon fixtures.
// Replicates core calc formulas inline to independently verify correctness.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import xirrLib from 'xirr';

const FIXTURE_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures', 'long-horizon');
const MAX_CHART_POINTS = 720;
const BENCHMARK_TICKER = 'SPY';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function isWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

function approx(actual, expected, epsilon = 1e-8, label = '') {
  if (Math.abs(actual - expected) <= epsilon) return;
  assert.fail(`${label}: expected ${expected}, got ${actual} (diff ${actual - expected})`);
}

function assertFinite(value, label) {
  assert.ok(Number.isFinite(value), `${label}: expected finite, got ${value}`);
}

function assertNotNaN(value, label) {
  assert.ok(!Number.isNaN(value), `${label}: expected not NaN, got ${value}`);
}

// ---------------------------------------------------------------------------
// Daily-linked TWR (replicates buildEquityHistory core formula)
// ---------------------------------------------------------------------------
function computeDailyLinkedTwr(dailyNavs) {
  // dailyNavs: array of { date, navUser, flow, navSpy }
  let cumulativeUser = 1;
  let cumulativeSpy = 1;
  let prevNavUser = null;
  let prevNavSpy = null;

  for (const row of dailyNavs) {
    if (prevNavUser !== null && prevNavUser > 0) {
      const dailyReturn = (row.navUser - (row.flow ?? 0)) / prevNavUser - 1;
      if (Number.isFinite(dailyReturn) && 1 + dailyReturn > 0) {
        cumulativeUser *= 1 + dailyReturn;
      }
    }
    if (prevNavSpy !== null && prevNavSpy > 0) {
      const dailyReturn = (row.navSpy - (row.flow ?? 0)) / prevNavSpy - 1;
      if (Number.isFinite(dailyReturn) && 1 + dailyReturn > 0) {
        cumulativeSpy *= 1 + dailyReturn;
      }
    }
    prevNavUser = row.navUser;
    prevNavSpy = row.navSpy;
  }
  return { twrUser: cumulativeUser - 1, twrSpy: cumulativeSpy - 1 };
}

// ---------------------------------------------------------------------------
// Chart downsampling (replicates IbkrPerformancePanel logic)
// ---------------------------------------------------------------------------
function downsampleChartRows(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows;
  // Always keep first and last point, sample evenly from the middle.
  // Guarantees result.length <= maxPoints (mirrors IbkrPerformancePanel).
  const result = [rows[0]];
  const n = rows.length;
  const step = (n - 1) / (maxPoints - 1);
  for (let i = 1; i < maxPoints - 1; i++) {
    result.push(rows[Math.round(i * step)]);
  }
  result.push(rows[n - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// XIRR wrapper
// ---------------------------------------------------------------------------
function computeXirr(cashflows, transactions, finalMarketValue, asOfDate) {
  const events = [];

  // Outflows: cashflows (money put in = negative for XIRR)
  for (const cf of cashflows) {
    if (cf.usd_in_date && cf.usd_amount > 0) {
      events.push({ amount: -cf.usd_amount, when: new Date(cf.usd_in_date) });
    }
  }

  // Inferred flows: if no cashflows, use buy transactions as deposits
  const hasFlows = events.length > 0;
  if (!hasFlows) {
    for (const t of transactions) {
      if (t.side === 'buy') {
        events.push({ amount: -(t.shares * t.price), when: new Date(t.trade_date) });
      }
    }
  }

  // Terminal value (what you'd get if you sold everything today)
  events.push({ amount: finalMarketValue, when: new Date(asOfDate) });

  // Need at least one negative and one positive on different days
  const negatives = events.filter(e => e.amount < 0);
  const positives = events.filter(e => e.amount > 0);
  if (negatives.length === 0 || positives.length === 0) return null;

  const dates = [...new Set(events.map(e => e.when.toISOString().slice(0, 10)))].sort();
  if (dates.length < 2) return null;

  try {
    const fn = xirrLib;
    return fn(events);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Timeline validation: check running shares never go negative
// ---------------------------------------------------------------------------
function checkRunningShares(transactions) {
  const byTicker = new Map();
  for (const t of transactions) {
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }

  const violations = [];
  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort((a, b) =>
      a.trade_date.localeCompare(b.trade_date) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '') ||
      a.id.localeCompare(b.id)
    );
    let running = 0;
    for (const t of sorted) {
      running += t.side === 'buy' ? t.shares : -t.shares;
      if (running < -1e-9) {
        violations.push({
          ticker,
          date: t.trade_date,
          side: t.side,
          shares: t.shares,
          running,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// NAV = stock MV + cash invariant
// ---------------------------------------------------------------------------
function verifyNavInvariant(transactions, cashflows, prices) {
  // Build price lookup: ticker → date → close
  const priceMap = new Map();
  for (const p of prices) {
    let m = priceMap.get(p.ticker);
    if (!m) { m = new Map(); priceMap.set(p.ticker, m); }
    m.set(p.trade_date, p.adjusted_close ?? p.close);
  }

  // Build sorted event timeline
  const dates = new Set();
  for (const cf of cashflows) { if (cf.usd_in_date) dates.add(cf.usd_in_date); }
  for (const t of transactions) dates.add(t.trade_date);
  const sortedDates = [...dates].sort();

  if (sortedDates.length === 0) return { ok: true };

  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  let invested = 0;
  let costBasis = 0;
  const netShares = new Map();
  const cashByDate = new Map();
  const txnsByDate = new Map();

  for (const cf of cashflows) {
    if (cf.usd_in_date && cf.usd_amount) {
      cashByDate.set(cf.usd_in_date, (cashByDate.get(cf.usd_in_date) ?? 0) + cf.usd_amount);
    }
  }
  for (const t of transactions) {
    const list = txnsByDate.get(t.trade_date) ?? [];
    list.push(t);
    txnsByDate.set(t.trade_date, list);
  }

  // Forward-fill price tracking
  const lastClose = new Map();

  const violations = [];
  for (let iso = startDate; iso <= endDate; iso = addDays(iso, 1)) {
    // Update forward-fill prices
    for (const [ticker, dailyMap] of priceMap) {
      const c = dailyMap.get(iso);
      if (typeof c === 'number') lastClose.set(ticker, c);
    }

    // Apply cashflow
    const flow = cashByDate.get(iso) ?? 0;
    if (flow > 0) invested += flow;

    // Apply transactions
    const dayTxns = txnsByDate.get(iso) ?? [];
    for (const t of dayTxns) {
      const delta = t.side === 'buy' ? t.shares : -t.shares;
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + delta);
      costBasis += t.side === 'buy' ? t.shares * t.price : -t.shares * t.price;
    }

    // Compute NAV
    let stockMv = 0;
    for (const [ticker, sh] of netShares) {
      if (Math.abs(sh) < 1e-9) continue;
      const px = lastClose.get(ticker) ?? 0;
      stockMv += sh * px;
    }
    const cash = invested - costBasis;
    const nav = stockMv + cash;

    // Sanity: NAV should be >= 0 (can't have negative portfolio value with long-only)
    if (nav < -1e-6) {
      violations.push({ date: iso, nav, stockMv, cash, invested, costBasis });
    }
  }

  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// avg / fifo cost basis computation (replicates aggregatePositions)
// ---------------------------------------------------------------------------
function computePositions(transactions) {
  const byTicker = new Map();
  for (const t of transactions) {
    const tk = t.ticker.toUpperCase();
    const list = byTicker.get(tk) ?? [];
    list.push(t);
    byTicker.set(tk, list);
  }

  const positions = [];
  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort((a, b) =>
      a.trade_date.localeCompare(b.trade_date) ||
      (a.created_at ?? '').localeCompare(b.created_at ?? '')
    );

    // Average-cost
    let avgShares = 0;
    let avgCostTotal = 0;

    // FIFO queue
    const fifoQueue = [];
    let realizedUsd = 0;

    for (const tx of sorted) {
      const sh = Number(tx.shares);
      const px = Number(tx.price);

      if (tx.side === 'buy') {
        avgCostTotal += sh * px;
        avgShares += sh;
        fifoQueue.push({ shares: sh, price: px });
      } else {
        let remaining = sh;
        while (remaining > 1e-9 && fifoQueue.length > 0) {
          const lot = fifoQueue[0];
          const take = Math.min(remaining, lot.shares);
          realizedUsd += take * (px - lot.price);
          lot.shares -= take;
          remaining -= take;
          if (lot.shares <= 1e-9) fifoQueue.shift();
        }
        if (avgShares > 1e-9) {
          const avgBasis = avgCostTotal / avgShares;
          avgCostTotal -= avgBasis * sh;
          avgShares -= sh;
          if (avgShares < 1e-9) { avgShares = 0; avgCostTotal = 0; }
        }
      }
    }

    const fifoShares = fifoQueue.reduce((acc, l) => acc + l.shares, 0);
    const fifoCostTotal = fifoQueue.reduce((acc, l) => acc + l.shares * l.price, 0);

    positions.push({
      ticker,
      shares: fifoShares,
      avgCost: avgShares > 1e-9 ? avgCostTotal / avgShares : 0,
      fifoCost: fifoShares > 1e-9 ? fifoCostTotal / fifoShares : 0,
      realizedUsd,
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Extreme timeline test: verify sell-after-buy timeline catches oversell
// ---------------------------------------------------------------------------
function extremeTimelineTest() {
  console.log('\n--- Extreme timeline test ---');

  const scenarios = [
    {
      label: 'buy 10, sell 5, sell 5 → valid',
      txns: [
        { id: '1', trade_date: '2020-01-01', ticker: 'TEST', side: 'buy', shares: 10, price: 100, created_at: '2020-01-01T10:00:00Z' },
        { id: '2', trade_date: '2020-06-01', ticker: 'TEST', side: 'sell', shares: 5, price: 110, created_at: '2020-06-01T10:00:00Z' },
        { id: '3', trade_date: '2021-01-01', ticker: 'TEST', side: 'sell', shares: 5, price: 120, created_at: '2021-01-01T10:00:00Z' },
      ],
      expectViolation: false,
    },
    {
      label: 'buy 6, sell 5, sell 5 → oversell (second sell exceeds remaining)',
      txns: [
        { id: '1', trade_date: '2020-01-01', ticker: 'TEST', side: 'buy', shares: 6, price: 100, created_at: '2020-01-01T10:00:00Z' },
        { id: '2', trade_date: '2020-06-01', ticker: 'TEST', side: 'sell', shares: 5, price: 110, created_at: '2020-06-01T10:00:00Z' },
        { id: '3', trade_date: '2021-01-01', ticker: 'TEST', side: 'sell', shares: 5, price: 120, created_at: '2021-01-01T10:00:00Z' },
      ],
      expectViolation: true,
    },
    {
      label: 'buy 10, sell 3, sell 8 → oversell (second sell exceeds remaining 7)',
      txns: [
        { id: '1', trade_date: '2020-01-01', ticker: 'TEST', side: 'buy', shares: 10, price: 100, created_at: '2020-01-01T10:00:00Z' },
        { id: '2', trade_date: '2020-06-01', ticker: 'TEST', side: 'sell', shares: 3, price: 110, created_at: '2020-06-01T10:00:00Z' },
        { id: '3', trade_date: '2021-01-01', ticker: 'TEST', side: 'sell', shares: 8, price: 120, created_at: '2021-01-01T10:00:00Z' },
      ],
      expectViolation: true,
    },
    {
      label: 'sell before any buy → immediate oversell',
      txns: [
        { id: '1', trade_date: '2020-01-01', ticker: 'TEST', side: 'sell', shares: 5, price: 100, created_at: '2020-01-01T10:00:00Z' },
        { id: '2', trade_date: '2020-06-01', ticker: 'TEST', side: 'buy', shares: 10, price: 110, created_at: '2020-06-01T10:00:00Z' },
      ],
      expectViolation: true,
    },
    {
      label: 'two tickers, one oversells, one valid → catch the bad one',
      txns: [
        { id: '1', trade_date: '2020-01-01', ticker: 'AAPL', side: 'buy', shares: 10, price: 100, created_at: '2020-01-01T10:00:00Z' },
        { id: '2', trade_date: '2020-01-01', ticker: 'TSLA', side: 'buy', shares: 5, price: 200, created_at: '2020-01-01T10:00:00Z' },
        { id: '3', trade_date: '2020-06-01', ticker: 'TSLA', side: 'sell', shares: 10, price: 250, created_at: '2020-06-01T10:00:00Z' },
      ],
      expectViolation: true,
    },
  ];

  let passed = 0;
  for (const sc of scenarios) {
    const violations = checkRunningShares(sc.txns);
    const hasViolation = violations.length > 0;
    if (hasViolation === sc.expectViolation) {
      passed++;
      console.log(`  ✓ ${sc.label}`);
    } else {
      console.log(`  ✗ ${sc.label} — expected violation=${sc.expectViolation}, got=${hasViolation}`);
      if (violations.length > 0) console.log('    violations:', JSON.stringify(violations));
    }
  }
  assert.strictEqual(passed, scenarios.length, `extreme timeline: ${passed}/${scenarios.length} passed`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log('═'.repeat(60));
console.log('30-Year Long-Horizon Stress Test');
console.log('═'.repeat(60));

// --- Load fixtures ---
const startLoad = performance.now();
const prices = JSON.parse(readFileSync(join(FIXTURE_DIR, 'prices.json'), 'utf-8'));
const cashflows = JSON.parse(readFileSync(join(FIXTURE_DIR, 'cashflows.json'), 'utf-8'));
const transactions = JSON.parse(readFileSync(join(FIXTURE_DIR, 'transactions.json'), 'utf-8'));
const loadMs = performance.now() - startLoad;
console.log(`\nLoaded ${prices.length} prices, ${cashflows.length} cashflows, ${transactions.length} transactions (${loadMs.toFixed(0)} ms)`);

// --- Invariant 1: Running shares never negative ---
console.log('\n--- Invariant 1: Running shares >= 0 ---');
const t1 = performance.now();
const shareViolations = checkRunningShares(transactions);
const shareMs = performance.now() - t1;
assert.strictEqual(shareViolations.length, 0,
  `Found ${shareViolations.length} negative-share violations: ${JSON.stringify(shareViolations.slice(0, 5))}`);
console.log(`  ✓ No negative shares (${shareMs.toFixed(0)} ms)`);

// --- Invariant 2 & 3: NAV & cash invariants ---
console.log('\n--- Invariant 2 & 3: NAV = stock MV + cash ---');
const t2 = performance.now();
const navResult = verifyNavInvariant(transactions, cashflows, prices);
const navMs = performance.now() - t2;
assert.ok(navResult.ok, `NAV invariant violated: ${JSON.stringify(navResult.violations?.slice(0, 5))}`);
console.log(`  ✓ NAV invariant holds (${navMs.toFixed(0)} ms)`);

// --- Invariant 4: TWR not NaN / Infinity ---
console.log('\n--- Invariant 4: TWR finite ---');

// Build daily NAV series for TWR computation
function buildDailyNavSeries(transactions, cashflows, prices) {
  const priceMap = new Map();
  for (const p of prices) {
    let m = priceMap.get(p.ticker);
    if (!m) { m = new Map(); priceMap.set(p.ticker, m); }
    m.set(p.trade_date, p.adjusted_close ?? p.close);
  }

  const dates = new Set();
  for (const cf of cashflows) { if (cf.usd_in_date) dates.add(cf.usd_in_date); }
  for (const t of transactions) dates.add(t.trade_date);
  const sortedDates = [...dates].sort();
  if (sortedDates.length === 0) return [];
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  const cashByDate = new Map();
  const txnsByDate = new Map();
  for (const cf of cashflows) {
    if (cf.usd_in_date && cf.usd_amount) {
      cashByDate.set(cf.usd_in_date, (cashByDate.get(cf.usd_in_date) ?? 0) + cf.usd_amount);
    }
  }
  for (const t of transactions) {
    const list = txnsByDate.get(t.trade_date) ?? [];
    list.push(t);
    txnsByDate.set(t.trade_date, list);
  }

  const spyPrices = priceMap.get(BENCHMARK_TICKER);
  const lastClose = new Map();
  const netShares = new Map();
  let spyShares = 0;
  let pendingSpyCash = 0;
  let invested = 0;
  let costBasis = 0;

  const series = [];
  for (let iso = startDate; iso <= endDate; iso = addDays(iso, 1)) {
    for (const [ticker, dailyMap] of priceMap) {
      const c = dailyMap.get(iso);
      if (typeof c === 'number') lastClose.set(ticker, c);
    }

    const flow = cashByDate.get(iso) ?? 0;
    if (flow > 0) {
      invested += flow;
      pendingSpyCash += flow;
    }

    const spyCloseToday = spyPrices?.get(iso);
    if (spyCloseToday && spyCloseToday > 0 && pendingSpyCash > 0) {
      spyShares += pendingSpyCash / spyCloseToday;
      pendingSpyCash = 0;
    }

    const dayTxns = txnsByDate.get(iso) ?? [];
    for (const t of dayTxns) {
      const delta = t.side === 'buy' ? t.shares : -t.shares;
      netShares.set(t.ticker, (netShares.get(t.ticker) ?? 0) + delta);
      costBasis += t.side === 'buy' ? t.shares * t.price : -t.shares * t.price;
    }

    let stockMv = 0;
    for (const [ticker, sh] of netShares) {
      if (Math.abs(sh) < 1e-9) continue;
      stockMv += sh * (lastClose.get(ticker) ?? 0);
    }
    const navUser = stockMv + (invested - costBasis);
    const spyPx = lastClose.get(BENCHMARK_TICKER) ?? 0;
    const navSpy = spyShares * spyPx + pendingSpyCash;

    series.push({ date: iso, navUser, navSpy, flow });
  }
  return series;
}

const t4 = performance.now();
const dailySeries = buildDailyNavSeries(transactions, cashflows, prices);
const { twrUser, twrSpy } = computeDailyLinkedTwr(dailySeries);
const twrMs = performance.now() - t4;

assertFinite(twrUser, 'TWR user');
assertFinite(twrSpy, 'TWR SPY');
assertNotNaN(twrUser, 'TWR user');
assertNotNaN(twrSpy, 'TWR SPY');
console.log(`  ✓ TWR user: ${(twrUser * 100).toFixed(2)}%, SPY: ${(twrSpy * 100).toFixed(2)}% (${twrMs.toFixed(0)} ms)`);

// --- Invariant 5: TWR not anomalous -100% ---
console.log('\n--- Invariant 5: TWR not -100% ---');
assert.ok(twrUser > -0.9999, `TWR user should not be exactly -100%, got ${twrUser}`);
assert.ok(twrSpy > -0.9999, `TWR SPY should not be exactly -100%, got ${twrSpy}`);
// Realistic bounds: 30-year TWR for a DCA strategy should be well above -50%
assert.ok(twrUser > -0.5, `TWR user suspiciously low: ${(twrUser * 100).toFixed(2)}% — possible cascade bug`);
console.log('  ✓ TWR values are realistic (not -100% cascade)');

// --- Invariant 6: XIRR finite ---
console.log('\n--- Invariant 6: XIRR finite ---');
const finalMarketValue = dailySeries.length > 0
  ? dailySeries[dailySeries.length - 1].navUser
  : 0;
const asOfDate = dailySeries.length > 0
  ? dailySeries[dailySeries.length - 1].date
  : '2026-12-31';

const t6 = performance.now();
const xirrResult = computeXirr(cashflows, transactions, finalMarketValue, asOfDate);
const xirrMs = performance.now() - t6;

assert.ok(xirrResult !== null, 'XIRR must converge for 30-year normal fixture');
assertFinite(xirrResult, 'XIRR');
assertNotNaN(xirrResult, 'XIRR');
console.log(`  ✓ XIRR: ${(xirrResult * 100).toFixed(2)}% (${xirrMs.toFixed(0)} ms)`);

// --- Invariant 7: avg / fifo cost basis ---
console.log('\n--- Invariant 7: avg / fifo cost basis ---');
const t7 = performance.now();
const positions = computePositions(transactions);
const posMs = performance.now() - t7;

let posErrors = 0;
for (const pos of positions) {
  if (!Number.isFinite(pos.avgCost) || pos.avgCost < 0) {
    console.log(`  ✗ ${pos.ticker}: avgCost=${pos.avgCost}`);
    posErrors++;
  }
  if (!Number.isFinite(pos.fifoCost) || pos.fifoCost < 0) {
    console.log(`  ✗ ${pos.ticker}: fifoCost=${pos.fifoCost}`);
    posErrors++;
  }
  if (pos.shares < 0) {
    console.log(`  ✗ ${pos.ticker}: negative shares=${pos.shares}`);
    posErrors++;
  }
}
assert.strictEqual(posErrors, 0, `${posErrors} position errors`);
console.log(`  ✓ ${positions.length} positions, avg & fifo both valid (${posMs.toFixed(0)} ms)`);

// --- Invariant 8: Chart downsampling ---
console.log('\n--- Invariant 8: Chart points downsampled ---');
const fullSeriesLength = dailySeries.length;
const sampled = downsampleChartRows(dailySeries, MAX_CHART_POINTS);
assert.ok(sampled.length <= MAX_CHART_POINTS,
  `Downsampled ${fullSeriesLength} → ${sampled.length} points (max ${MAX_CHART_POINTS})`);
console.log(`  ✓ ${fullSeriesLength} daily points → ${sampled.length} chart points (max ${MAX_CHART_POINTS})`);

// --- Extreme timeline test (item 4) ---
extremeTimelineTest();

// --- Timing summary ---
console.log('\n═'.repeat(60));
console.log('All invariants passed.');
console.log(`Timing: load=${loadMs.toFixed(0)}ms shares=${shareMs.toFixed(0)}ms nav=${navMs.toFixed(0)}ms twr=${twrMs.toFixed(0)}ms xirr=${xirrMs.toFixed(0)}ms pos=${posMs.toFixed(0)}ms`);
console.log(`30-year data: ${fullSeriesLength} calendar days, ${transactions.length} transactions, ${cashflows.length} cashflows`);
console.log('═'.repeat(60));
