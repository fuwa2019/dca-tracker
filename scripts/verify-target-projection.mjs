import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  monthlyRateFromAnnualReturn,
  monthsToTarget,
  projectValue,
} from '../src/lib/calc/target.ts';

const fixture = JSON.parse(readFileSync(
  new URL('../tests/fixtures/target/smh-vgt-2015-2025.json', import.meta.url),
  'utf8',
));

const EXPECTED_MONTHS = 132;
const EXPECTED_ENDING_VALUE_PER_MONTHLY_DOLLAR = 657.9940366602929;
const EXPECTED_EQUIVALENT_ANNUAL_RETURN = 0.2714508714392063;
const MILLION_USD = 1_000_000;

assert.equal(fixture.source.provider, 'Yahoo Finance chart API');
assert.equal(fixture.source.currency, 'USD');
assert.equal(fixture.source.timeZone, 'America/New_York');
assert.equal(fixture.source.priceField, 'adjustedClose');
assert.equal(fixture.period.months, EXPECTED_MONTHS);
assert.equal(fixture.monthlyPurchases.length, EXPECTED_MONTHS);
assert.equal(fixture.simulation.monthlyTotalUsd, 1);
assert.equal(fixture.simulation.allocation.SMH + fixture.simulation.allocation.VGT, 1);
assert.equal(fixture.simulation.timing, 'first trading day of each calendar month');
assert.equal(fixture.simulation.dividendsReinvested, true);
assert.equal(fixture.simulation.feesAndTaxesUsd, 0);

const seenMonths = new Set();
let smhUnits = 0;
let vgtUnits = 0;
for (const [index, row] of fixture.monthlyPurchases.entries()) {
  const expectedMonth = new Date(Date.UTC(2015, index, 1)).toISOString().slice(0, 7);
  assert.equal(row.month, expectedMonth, `month ${index + 1} is contiguous`);
  assert.ok(row.tradeDate.startsWith(`${row.month}-`), `${row.month} trade date is in the same month`);
  assert.ok(!seenMonths.has(row.month), `${row.month} appears once`);
  assert.ok(Number.isFinite(row.SMH) && row.SMH > 0, `${row.month} has a valid SMH price`);
  assert.ok(Number.isFinite(row.VGT) && row.VGT > 0, `${row.month} has a valid VGT price`);
  seenMonths.add(row.month);
  smhUnits += fixture.simulation.allocation.SMH / row.SMH;
  vgtUnits += fixture.simulation.allocation.VGT / row.VGT;
}

assert.equal(fixture.monthlyPurchases[0].tradeDate, '2015-01-02');
assert.equal(fixture.monthlyPurchases.at(-1).tradeDate, '2025-12-01');
assert.equal(fixture.terminal.tradeDate, '2025-12-31');
assert.ok(fixture.terminal.SMH > 0 && fixture.terminal.VGT > 0);

const historicalEndingValue = smhUnits * fixture.terminal.SMH + vgtUnits * fixture.terminal.VGT;
approx(historicalEndingValue, EXPECTED_ENDING_VALUE_PER_MONTHLY_DOLLAR, 1e-9);

// Solve independently through the month-by-month recurrence, then make the
// closed form used by the app reproduce the frozen historical result.
const equivalentMonthlyRate = solveEquivalentMonthlyRate(historicalEndingValue, EXPECTED_MONTHS);
const equivalentAnnualReturn = Math.expm1(Math.log1p(equivalentMonthlyRate) * 12);
approx(equivalentAnnualReturn, EXPECTED_EQUIVALENT_ANNUAL_RETURN, 1e-12);
approx(monthlyRateFromAnnualReturn(equivalentAnnualReturn), equivalentMonthlyRate, 1e-14);
approx(
  projectByRecurrence({
    currentValueUsd: 0,
    monthlyContributionUsd: 1,
    monthlyRate: equivalentMonthlyRate,
    months: EXPECTED_MONTHS,
  }),
  historicalEndingValue,
  1e-9,
);
approx(
  projectValue({
    currentValueUsd: 0,
    monthlyContributionUsd: 1,
    annualReturn: equivalentAnnualReturn,
    months: EXPECTED_MONTHS,
  }),
  historicalEndingValue,
  1e-9,
);

const monthlyContributionForMillion = MILLION_USD / historicalEndingValue;
const millionProjection = {
  currentValueUsd: 0,
  monthlyContributionUsd: monthlyContributionForMillion,
  annualReturn: equivalentAnnualReturn,
};
approx(projectValue({ ...millionProjection, months: EXPECTED_MONTHS }), MILLION_USD, 1e-6);
assert.ok(projectValue({ ...millionProjection, months: EXPECTED_MONTHS - 1 }) < MILLION_USD);
assert.deepEqual(
  monthsToTarget({ ...millionProjection, targetUsd: MILLION_USD }),
  { months: EXPECTED_MONTHS, years: 11, achievable: true },
);

// An 8% effective annual return must be exactly 8% after 12 monthly periods.
approx(projectValue({
  currentValueUsd: 100,
  monthlyContributionUsd: 0,
  annualReturn: 0.08,
  months: 12,
}), 108, 1e-10);

const monthlyAtEightPercent = monthlyRateFromAnnualReturn(0.08);
assert.notEqual(monthlyAtEightPercent, null);
approx(projectValue({
  currentValueUsd: 0,
  monthlyContributionUsd: 100,
  annualReturn: 0.08,
  months: 1,
}), 100 * (1 + monthlyAtEightPercent), 1e-10);

assert.deepEqual(
  monthsToTarget({
    currentValueUsd: 0,
    monthlyContributionUsd: 100,
    annualReturn: 0,
    targetUsd: 1_001,
  }),
  { months: 11, years: 11 / 12, achievable: true },
);
assert.deepEqual(
  monthsToTarget({
    currentValueUsd: 0,
    monthlyContributionUsd: 1,
    annualReturn: -0.5,
    targetUsd: 100,
  }),
  { months: null, years: null, achievable: false },
);
assert.equal(monthlyRateFromAnnualReturn(-1), null);

for (const annualReturn of [0, 0.02, 0.08, EXPECTED_EQUIVALENT_ANNUAL_RETURN, 1]) {
  for (const currentValueUsd of [0, 10_000]) {
    for (const monthlyContributionUsd of [0, 200, 1_500]) {
      for (const months of [1, 12, 60, 132, 360]) {
        const projection = { currentValueUsd, monthlyContributionUsd, annualReturn };
        const targetUsd = projectValue({ ...projection, months });
        const previousValue = projectValue({ ...projection, months: months - 1 });
        if (!Number.isFinite(targetUsd) || targetUsd <= currentValueUsd || targetUsd <= previousValue) continue;

        const result = monthsToTarget({ ...projection, targetUsd });
        assert.equal(result.months, months, `round trip at ${annualReturn} annual return and ${months} months`);
        assert.ok(projectValue({ ...projection, months: result.months }) + targetUsd * 1e-12 >= targetUsd);
        assert.ok(projectValue({ ...projection, months: result.months - 1 }) < targetUsd);
      }
    }
  }
}

const decliningProjection = {
  currentValueUsd: 0,
  monthlyContributionUsd: 100,
  annualReturn: -0.1,
  targetUsd: 1_000,
};
const decliningResult = monthsToTarget(decliningProjection);
assert.equal(decliningResult.achievable, true);
assert.notEqual(decliningResult.months, null);
assert.ok(projectValue({ ...decliningProjection, months: decliningResult.months }) >= decliningProjection.targetUsd);
assert.ok(projectValue({ ...decliningProjection, months: decliningResult.months - 1 }) < decliningProjection.targetUsd);

const historicalXirr = solveXirr(
  fixture.monthlyPurchases.map((row) => ({ date: row.tradeDate, amount: -1 })),
  { date: fixture.terminal.tradeDate, amount: historicalEndingValue },
);

console.log('target projection fixtures ok', JSON.stringify({
  months: EXPECTED_MONTHS,
  endingValuePerMonthlyDollar: Number(historicalEndingValue.toFixed(6)),
  equivalentAnnualReturnPct: Number((equivalentAnnualReturn * 100).toFixed(6)),
  historicalXirrPct: Number((historicalXirr * 100).toFixed(6)),
  monthlyContributionForMillionUsd: Number(monthlyContributionForMillion.toFixed(2)),
}));

function projectByRecurrence({ currentValueUsd, monthlyContributionUsd, monthlyRate, months }) {
  let value = currentValueUsd;
  for (let month = 0; month < months; month += 1) {
    value = (value + monthlyContributionUsd) * (1 + monthlyRate);
  }
  return value;
}

function solveEquivalentMonthlyRate(targetValue, months) {
  let low = -0.999999;
  let high = 1;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const midpoint = (low + high) / 2;
    const value = projectByRecurrence({
      currentValueUsd: 0,
      monthlyContributionUsd: 1,
      monthlyRate: midpoint,
      months,
    });
    if (value < targetValue) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function solveXirr(flows, terminal) {
  const origin = Date.parse(`${flows[0].date}T00:00:00Z`);
  const allFlows = [...flows, terminal];
  const npv = (rate) => allFlows.reduce((sum, flow) => {
    const years = (Date.parse(`${flow.date}T00:00:00Z`) - origin) / 31_557_600_000;
    return sum + flow.amount / ((1 + rate) ** years);
  }, 0);

  let low = -0.999999;
  let high = 2;
  for (let iteration = 0; iteration < 240; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (npv(midpoint) > 0) low = midpoint;
    else high = midpoint;
  }
  return (low + high) / 2;
}

function approx(actual, expected, epsilon) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected} +/- ${epsilon}, got ${actual}`,
  );
}
