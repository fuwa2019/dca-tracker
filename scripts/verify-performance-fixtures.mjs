import assert from 'node:assert/strict';

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

console.log('performance fixtures ok');
