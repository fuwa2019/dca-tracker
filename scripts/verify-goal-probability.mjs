import assert from 'node:assert/strict';
import {
  GOAL_HORIZONS_YEARS,
  simulateQqqmGoal,
} from '../src/lib/calc/goalProbability.ts';

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

console.log('goal probability fixtures ok', JSON.stringify({
  p50Years: baseline.quantiles.p50,
  successBy20Years: baseline.successByYear.find((point) => point.years === 20)?.probability,
}));
