import assert from 'node:assert/strict';
import {
  GOAL_HORIZONS_YEARS,
  simulateQqqmGoal,
} from '../src/lib/calc/goalProbability.ts';
import { observedContributionPace } from '../src/lib/calc/contributionPace.ts';

const input = {
  initialValueUsd: 0.25,
  monthlyContributionUsd: 0.002,
  targetUsd: 1,
  pathCount: 4_000,
  seed: 20260905,
};

const baseline = simulateQqqmGoal(input);
assert.ok(baseline);
assert.equal(baseline.pathCount, 4_000);
assert.equal(baseline.asOf, '2026-09-05');
assert.deepEqual(
  baseline.successByYear.map((point) => point.years),
  GOAL_HORIZONS_YEARS,
);
assert.ok(baseline.quantiles.p10 <= baseline.quantiles.p25);
assert.ok(baseline.quantiles.p25 <= baseline.quantiles.p50);
assert.ok(baseline.quantiles.p50 <= baseline.quantiles.p75);
assert.ok(baseline.quantiles.p75 <= baseline.quantiles.p90);
for (let index = 1; index < baseline.successByYear.length; index += 1) {
  assert.ok(
    baseline.successByYear[index - 1].probability <= baseline.successByYear[index].probability,
  );
}

assert.deepEqual(simulateQqqmGoal(input), baseline, 'seeded simulations stay reproducible');
assert.equal(simulateQqqmGoal({
  initialValueUsd: 100,
  monthlyContributionUsd: 0,
  targetUsd: 100,
  pathCount: 400,
})?.quantiles.p90, 0);
assert.equal(simulateQqqmGoal({
  initialValueUsd: 0,
  monthlyContributionUsd: 1,
  targetUsd: 1,
  pathCount: 400,
})?.quantiles.p90, 1 / 12);
assert.equal(simulateQqqmGoal({
  initialValueUsd: 0,
  monthlyContributionUsd: 0,
  targetUsd: 1,
  pathCount: 400,
})?.quantiles.p90, Infinity);
assert.equal(simulateQqqmGoal({
  initialValueUsd: -1,
  monthlyContributionUsd: 1,
  targetUsd: 1,
}), null);

for (const stress of [
  'lost-decade',
  'dot-com-early',
  'financial-crisis-early',
  'valuation-pe20',
  'persistent-ai',
]) {
  const result = simulateQqqmGoal({ ...input, stress });
  assert.ok(result, stress + ' returns a result');
  assert.equal(result.stress, stress);
  assert.ok(result.quantiles.p10 <= result.quantiles.p90);
}

const ext = (date, amountUsd, kind = 'broker_deposit') => ({ date, kind, amountUsd, role: 'external' });

// A young ledger: the first deposit is opening capital, not pace.
const young = observedContributionPace([
  ext('2026-04-13', 1000),
  ext('2026-05-13', 100),
  ext('2026-06-13', 100),
  ext('2026-07-13', 100),
  ext('2026-08-13', 100),
  ext('2026-09-13', 100),
  ext('2026-10-13', 100),
  { date: '2026-09-01', kind: 'dividend', amountUsd: 50, role: 'internal' },
], '2026-10-13');
assert.ok(young);
assert.equal(young.startDate, '2026-04-13');
assert.equal(young.depositCount, 6);
assert.ok(Math.abs(young.monthlyUsd - 600 / (183 / (365.25 / 12))) < 1e-9);
assert.ok(Math.abs(young.averageIntervalDays - 183 / 6) < 1e-9);

// An old ledger: deposits before the 12-month window are ignored.
const old = observedContributionPace([
  ext('2024-01-10', 5000),
  ext('2025-09-01', 5000),
  ext('2025-12-01', 1200),
  ext('2026-06-01', 1200),
], '2026-10-13');
assert.ok(old);
assert.equal(old.startDate, '2025-10-13');
assert.equal(old.depositCount, 2);
assert.ok(Math.abs(old.monthlyUsd - 2400 / (365 / (365.25 / 12))) < 1e-9);

// Withdrawals offset deposits; the pace never goes negative.
const drained = observedContributionPace([
  ext('2026-01-01', 1000),
  ext('2026-03-01', 100),
  ext('2026-05-01', -400, 'broker_withdrawal'),
], '2026-10-13');
assert.ok(drained);
assert.equal(drained.monthlyUsd, 0);

// Too little history or no external deposits gives no pace.
assert.equal(observedContributionPace([ext('2026-10-01', 500)], '2026-10-13'), null);
assert.equal(observedContributionPace([], '2026-10-13'), null);
assert.equal(observedContributionPace([
  { date: '2026-01-01', kind: 'dividend', amountUsd: 10, role: 'internal' },
], '2026-10-13'), null);

// Several deposits on one date count as one deposit day.
const sameDay = observedContributionPace([
  ext('2026-01-01', 1000),
  ext('2026-06-01', 50),
  ext('2026-06-01', 50),
], '2026-10-13');
assert.equal(sameDay.depositCount, 1);

console.log('goal probability fixtures ok', JSON.stringify({
  p50Years: baseline.quantiles.p50,
  successBy20Years: baseline.successByYear.find((point) => point.years === 20)?.probability,
}));
