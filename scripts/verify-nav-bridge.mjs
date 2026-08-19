import assert from 'node:assert/strict';
import { computeNavBridge } from '../src/lib/calc/navBridge.ts';

// The cached history contract guarantees pnlUser = navUser - invested per point.
const history = [
  { date: '2026-01-02', invested: 100, navUser: 100, pnlUser: 0, returnPctUser: 0 },
  { date: '2026-01-05', invested: 100, navUser: 110, pnlUser: 10, returnPctUser: 0.1 },
  { date: '2026-01-06', invested: 210, navUser: 218, pnlUser: 8, returnPctUser: 0.078 },
  { date: '2026-01-07', invested: 210, navUser: 231, pnlUser: 21, returnPctUser: 0.1426 },
];

// Full-range bridge starts from an empty account.
const full = computeNavBridge(history, history);
assert.ok(full);
assert.equal(full.start_date, '2026-01-02');
assert.equal(full.end_date, '2026-01-07');
assert.equal(full.starting_nav_usd, 0);
assert.equal(full.external_flow_usd, 210);
assert.equal(full.pnl_usd, 21);
assert.equal(full.ending_nav_usd, 231);
assert.ok(Math.abs(full.identity_gap_usd) < 1e-9, 'identity holds on a consistent cache');
assert.ok(full.period_return_pct !== null);
assert.ok(Math.abs(full.period_return_pct - 0.1426) < 1e-9, 'full-range TWR equals cumulative return');

// A window that starts mid-series anchors on the point before the window.
const window2 = history.slice(2);
const mid = computeNavBridge(history, window2);
assert.ok(mid);
assert.equal(mid.start_date, '2026-01-06');
assert.equal(mid.starting_nav_usd, 110);
assert.equal(mid.external_flow_usd, 110);
assert.equal(mid.pnl_usd, 11);
assert.equal(mid.ending_nav_usd, 231);
assert.ok(Math.abs(mid.identity_gap_usd) < 1e-9);
// Chained TWR: (1 + 0.1426) / (1 + 0.1) - 1
assert.ok(mid.period_return_pct !== null);
assert.ok(Math.abs(mid.period_return_pct - ((1 + 0.1426) / (1 + 0.1) - 1)) < 1e-12);

// An inconsistent cache surfaces a non-zero identity gap instead of hiding it.
const broken = [
  { date: '2026-02-02', invested: 100, navUser: 100, pnlUser: 0, returnPctUser: 0 },
  { date: '2026-02-03', invested: 100, navUser: 130, pnlUser: 10, returnPctUser: 0.1 },
];
const gap = computeNavBridge(broken, broken);
assert.ok(gap);
assert.ok(Math.abs(gap.identity_gap_usd - 20) < 1e-9, 'gap = ending - (start + flow + pnl)');

// Degenerate inputs return null rather than fabricating a bridge.
assert.equal(computeNavBridge(history, []), null);
assert.equal(computeNavBridge([], []), null);

// A window whose first date is not in the base history cannot be anchored.
assert.equal(
  computeNavBridge(history, [{ date: '2027-01-01', invested: 0, navUser: 0, pnlUser: 0, returnPctUser: 0 }]),
  null,
);

// Previous cumulative return of -100% makes chained TWR undefined, not Infinity.
const crashed = [
  { date: '2026-03-02', invested: 100, navUser: 0, pnlUser: -100, returnPctUser: -1 },
  { date: '2026-03-03', invested: 200, navUser: 100, pnlUser: -100, returnPctUser: -1 },
];
const afterCrash = computeNavBridge(crashed, crashed.slice(1));
assert.ok(afterCrash);
assert.equal(afterCrash.period_return_pct, null);

console.log('nav bridge fixtures passed');
