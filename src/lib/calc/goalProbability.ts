import { QQQM_GOAL_MODEL } from '../../data/qqqm-goal-model.ts';

export const GOAL_HORIZONS_YEARS = [10, 15, 20, 25, 30, 35, 40] as const;
export const QQQM_GOAL_UI_PATHS = 4_000;

const MONTHS_PER_YEAR = 12;
const HISTORY_WEIGHT = 0.2;
const FUNDAMENTAL_WEIGHT = 1 - HISTORY_WEIGHT;
const FUNDAMENTAL_FIRST_YEARS = 10;
const STRESS_VALUATION_YEARS = 15;
const AI_STRESS_YEARS = 20;
const BLOCK_LENGTHS = [6, 12, 24, 36] as const;
const DEFAULT_SEED = 20260905;
const QUANTILES = [
  ['p10', 0.1],
  ['p25', 0.25],
  ['p50', 0.5],
  ['p75', 0.75],
  ['p90', 0.9],
] as const;

type QuantileKey = (typeof QUANTILES)[number][0];

export type GoalStressScenario =
  | 'baseline'
  | 'lost-decade'
  | 'dot-com-early'
  | 'financial-crisis-early'
  | 'valuation-pe20'
  | 'persistent-ai';

export interface QqqmGoalSimulationInput {
  initialValueUsd: number;
  monthlyContributionUsd: number;
  targetUsd: number;
  pathCount?: number;
  seed?: number;
  /** Annual increase in the contribution, expressed in today's purchasing power. */
  contributionGrowth?: number;
  /** Simplified annual tax drag. The default is zero; this is not tax advice. */
  annualTaxDrag?: number;
  stress?: GoalStressScenario;
}

export interface GoalSuccessPoint {
  years: (typeof GOAL_HORIZONS_YEARS)[number];
  probability: number;
}

export interface QqqmGoalSimulation {
  asOf: string;
  stress: GoalStressScenario;
  pathCount: number;
  quantiles: Record<QuantileKey, number>;
  successByYear: GoalSuccessPoint[];
}

interface FundamentalPath {
  growthFirst: number;
  growthLater: number;
  peStart: number;
  peTerminal: number;
  dividendYield: number;
  normalizationMonths: number;
}

interface RestartSampler {
  cumulativeWeights: Float64Array;
  totalWeight: number;
}

const HISTORICAL_RETURNS = QQQM_GOAL_MODEL.monthlyRealLogReturns;
const HISTORICAL_MEAN = mean(HISTORICAL_RETURNS);
const FEE_LOG_MONTHLY = Math.log1p(-QQQM_GOAL_MODEL.fee) / MONTHS_PER_YEAR;
const FEE_LOG_ANNUAL = Math.log1p(-QQQM_GOAL_MODEL.fee);
const SEGMENT_ENDS = new Uint8Array(HISTORICAL_RETURNS.length);
const SEGMENT_STARTS = new Uint8Array(HISTORICAL_RETURNS.length);
for (const end of QQQM_GOAL_MODEL.segmentEnds) {
  SEGMENT_ENDS[end] = 1;
  if (end + 1 < HISTORICAL_RETURNS.length) SEGMENT_STARTS[end + 1] = 1;
}
SEGMENT_STARTS[0] = 1;

const SCENARIOS = [
  { weight: 0.1, growthFirst: 0.01, growthLater: 0.015, terminalPe: 20, inflation: 0.04, normalizationYears: 10 },
  { weight: 0.2, growthFirst: 0.025, growthLater: 0.025, terminalPe: 23, inflation: 0.032, normalizationYears: 12 },
  { weight: 0.4, growthFirst: 0.045, growthLater: 0.04, terminalPe: 26, inflation: 0.025, normalizationYears: 15 },
  { weight: 0.2, growthFirst: 0.06, growthLater: 0.055, terminalPe: 30, inflation: 0.023, normalizationYears: 15 },
  { weight: 0.1, growthFirst: 0.08, growthLater: 0.07, terminalPe: 35, inflation: 0.02, normalizationYears: 15 },
] as const;
const CURRENT_PE = 34.45;
const GROSS_DIVIDEND_YIELD = 0.006;
const BASELINE_HISTORICAL_DRIFT = HISTORICAL_MEAN * MONTHS_PER_YEAR + FEE_LOG_ANNUAL;

const LOST_DECADE = zeroMean(
  sliceStressWindow(QQQM_GOAL_MODEL.stressWindows.lostDecade).map((value) => value + FEE_LOG_MONTHLY),
);
const DOT_COM_EARLY = sliceStressWindow(QQQM_GOAL_MODEL.stressWindows.dotComEarly).map((value) => value + FEE_LOG_MONTHLY);
const FINANCIAL_CRISIS_EARLY = sliceStressWindow(QQQM_GOAL_MODEL.stressWindows.financialCrisisEarly)
  .map((value) => value + FEE_LOG_MONTHLY);

/**
 * Run the research model against a live goal.
 *
 * The report uses 50,000 paths. The browser uses a smaller, deterministic
 * sample so the settings form stays responsive. The method is the same:
 * uncertain forward fundamental drift, 20% historical log-drift shrinkage,
 * paired stationary-block innovations, fund fee already included, and
 * end-of-month contributions in today's purchasing power.
 */
export function simulateQqqmGoal(input: QqqmGoalSimulationInput): QqqmGoalSimulation | null {
  if (!isValidInput(input)) return null;

  const pathCount = normalizePathCount(input.pathCount);
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed as number) : DEFAULT_SEED;
  const contributionGrowth = input.contributionGrowth ?? 0;
  const annualTaxDrag = input.annualTaxDrag ?? 0;
  const stress = input.stress ?? 'baseline';
  const rng = createRng(seed);
  const restartSamplers = new Map<number, RestartSampler>();

  for (const blockLength of BLOCK_LENGTHS) {
    restartSamplers.set(blockLength, buildRestartSampler(blockLength));
  }

  const blockForPath = (path: number) => BLOCK_LENGTHS[
    Math.min(BLOCK_LENGTHS.length - 1, Math.floor(path / (pathCount / BLOCK_LENGTHS.length)))
  ];
  const historicalDrifts = new Float64Array(pathCount);
  for (let path = 0; path < pathCount; path += 1) {
    const blockLength = blockForPath(path);
    historicalDrifts[path] = sampleHistoricalDrift(blockLength, rng, restartSamplers.get(blockLength)!);
  }
  centerHistoricalDrifts(historicalDrifts);

  const firstPassage = new Float64Array(pathCount);
  firstPassage.fill(Number.POSITIVE_INFINITY);
  const taxLog = Math.log1p(-annualTaxDrag) / MONTHS_PER_YEAR;
  const horizonMonths = GOAL_HORIZONS_YEARS.at(-1)! * MONTHS_PER_YEAR;

  for (let path = 0; path < pathCount; path += 1) {
    if (input.initialValueUsd >= input.targetUsd) {
      firstPassage[path] = 0;
      continue;
    }

    const blockLength = blockForPath(path);
    const sampler = restartSamplers.get(blockLength)!;
    const fundamental = sampleFundamentalPath(rng);
    let historicalIndex = randomIndex(rng, HISTORICAL_RETURNS.length);
    let wealth = input.initialValueUsd;
    let contributionFactor = 1;

    for (let month = 0; month < horizonMonths; month += 1) {
      if (month > 0 && month % MONTHS_PER_YEAR === 0) {
        contributionFactor *= 1 + contributionGrowth;
      }

      const baseReturn = ensembleMonthlyReturn(
        month,
        HISTORICAL_RETURNS[historicalIndex],
        historicalDrifts[path],
        fundamental,
      );
      const monthlyReturn = applyStress(
        stress,
        month,
        baseReturn,
        fundamental,
      );
      const contribution = input.monthlyContributionUsd * contributionFactor;
      wealth = wealth * Math.exp(monthlyReturn + taxLog) + contribution;

      if (wealth >= input.targetUsd) {
        firstPassage[path] = (month + 1) / MONTHS_PER_YEAR;
        break;
      }

      historicalIndex = advanceHistoricalIndex(historicalIndex, blockLength, rng, sampler);
    }
  }

  const sortedFirstPassage = Array.from(firstPassage).sort((a, b) => a - b);
  const quantiles = {} as Record<QuantileKey, number>;
  for (const [key, probability] of QUANTILES) {
    const index = Math.max(0, Math.ceil(probability * pathCount) - 1);
    quantiles[key] = sortedFirstPassage[index];
  }

  return {
    asOf: QQQM_GOAL_MODEL.asOf,
    stress,
    pathCount,
    quantiles,
    successByYear: GOAL_HORIZONS_YEARS.map((years) => ({
      years,
      probability: sortedFirstPassage.filter((value) => value <= years).length / pathCount,
    })),
  };
}

function isValidInput(input: QqqmGoalSimulationInput): boolean {
  const values = [input.initialValueUsd, input.monthlyContributionUsd, input.targetUsd];
  if (!values.every(Number.isFinite)) return false;
  if (input.initialValueUsd < 0 || input.monthlyContributionUsd < 0 || input.targetUsd <= 0) return false;
  if (input.contributionGrowth != null && (!Number.isFinite(input.contributionGrowth) || input.contributionGrowth <= -1)) {
    return false;
  }
  if (input.annualTaxDrag != null && (!Number.isFinite(input.annualTaxDrag)
    || input.annualTaxDrag < 0 || input.annualTaxDrag >= 1)) {
    return false;
  }
  return true;
}

function normalizePathCount(pathCount: number | undefined): number {
  const requested = Number.isFinite(pathCount) ? Math.trunc(pathCount as number) : QQQM_GOAL_UI_PATHS;
  return Math.max(BLOCK_LENGTHS.length, Math.floor(requested / BLOCK_LENGTHS.length) * BLOCK_LENGTHS.length);
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomIndex(rng: () => number, size: number): number {
  return Math.min(size - 1, Math.floor(rng() * size));
}

function triangular(rng: () => number, low: number, mode: number, high: number): number {
  const split = (mode - low) / (high - low);
  const value = rng();
  return value < split
    ? low + Math.sqrt(value * (high - low) * (mode - low))
    : high - Math.sqrt((1 - value) * (high - low) * (high - mode));
}

function sampleFundamentalPath(rng: () => number): FundamentalPath {
  const scenario = weightedScenario(rng);
  return {
    growthFirst: clamp(
      scenario.growthFirst + triangular(rng, -0.015, 0, 0.015),
      -0.1,
      0.15,
    ),
    growthLater: clamp(
      scenario.growthLater + triangular(rng, -0.01, 0, 0.01),
      -0.1,
      0.12,
    ),
    peStart: triangular(rng, 30, CURRENT_PE, 40),
    peTerminal: scenario.terminalPe * triangular(rng, 0.85, 1, 1.15),
    dividendYield: triangular(rng, 0.004, GROSS_DIVIDEND_YIELD, 0.008),
    normalizationMonths: scenario.normalizationYears * MONTHS_PER_YEAR,
  };
}

function weightedScenario(rng: () => number) {
  const draw = rng();
  let cumulative = 0;
  for (const scenario of SCENARIOS) {
    cumulative += scenario.weight;
    if (draw <= cumulative) return scenario;
  }
  return SCENARIOS.at(-1)!;
}

function ensembleMonthlyReturn(
  month: number,
  historicalReturn: number,
  historicalDrift: number,
  fundamental: FundamentalPath,
): number {
  const earnings = month < FUNDAMENTAL_FIRST_YEARS * MONTHS_PER_YEAR
    ? Math.log1p(fundamental.growthFirst)
    : Math.log1p(fundamental.growthLater);
  const valuation = month < fundamental.normalizationMonths
    ? Math.log(fundamental.peTerminal / fundamental.peStart) / fundamental.normalizationMonths
    : 0;
  const fundamentalDrift = earnings / MONTHS_PER_YEAR
    + Math.log1p(fundamental.dividendYield) / MONTHS_PER_YEAR
    + FEE_LOG_MONTHLY
    + valuation;
  return historicalReturn - HISTORICAL_MEAN
    + FUNDAMENTAL_WEIGHT * fundamentalDrift
    + HISTORY_WEIGHT * historicalDrift / MONTHS_PER_YEAR;
}

function applyStress(
  stress: GoalStressScenario,
  month: number,
  baseReturn: number,
  fundamental: FundamentalPath,
): number {
  switch (stress) {
    case 'lost-decade':
      return month < LOST_DECADE.length ? LOST_DECADE[month] : baseReturn;
    case 'dot-com-early':
      return month < DOT_COM_EARLY.length ? DOT_COM_EARLY[month] : baseReturn;
    case 'financial-crisis-early':
      return month < FINANCIAL_CRISIS_EARLY.length ? FINANCIAL_CRISIS_EARLY[month] : baseReturn;
    case 'valuation-pe20': {
      const oldValuation = month < fundamental.normalizationMonths
        ? Math.log(fundamental.peTerminal / fundamental.peStart) / fundamental.normalizationMonths
        : 0;
      const newValuation = month < STRESS_VALUATION_YEARS * MONTHS_PER_YEAR
        ? Math.log(20 / fundamental.peStart) / (STRESS_VALUATION_YEARS * MONTHS_PER_YEAR)
        : 0;
      return baseReturn + FUNDAMENTAL_WEIGHT * (newValuation - oldValuation);
    }
    case 'persistent-ai':
      if (month >= AI_STRESS_YEARS * MONTHS_PER_YEAR) return baseReturn;
      return baseReturn + FUNDAMENTAL_WEIGHT * (
        Math.log1p(month < FUNDAMENTAL_FIRST_YEARS * MONTHS_PER_YEAR
          ? fundamental.growthFirst + 0.03
          : fundamental.growthLater + 0.03)
        - Math.log1p(month < FUNDAMENTAL_FIRST_YEARS * MONTHS_PER_YEAR
          ? fundamental.growthFirst
          : fundamental.growthLater)
      ) / MONTHS_PER_YEAR;
    case 'baseline':
      return baseReturn;
    default:
      return baseReturn;
  }
}

function buildRestartSampler(blockLength: number): RestartSampler {
  const cumulativeWeights = new Float64Array(HISTORICAL_RETURNS.length);
  let totalWeight = 0;
  for (let index = 0; index < HISTORICAL_RETURNS.length; index += 1) {
    totalWeight += SEGMENT_STARTS[index] ? blockLength : 1;
    cumulativeWeights[index] = totalWeight;
  }
  return { cumulativeWeights, totalWeight };
}

function sampleHistoricalDrift(
  blockLength: number,
  rng: () => number,
  sampler: RestartSampler,
): number {
  let index = randomIndex(rng, HISTORICAL_RETURNS.length);
  let total = 0;
  for (let month = 0; month < HISTORICAL_RETURNS.length; month += 1) {
    total += HISTORICAL_RETURNS[index];
    if (month === HISTORICAL_RETURNS.length - 1) break;
    index = advanceHistoricalIndex(index, blockLength, rng, sampler);
  }
  return total / HISTORICAL_RETURNS.length * MONTHS_PER_YEAR + FEE_LOG_ANNUAL;
}

function advanceHistoricalIndex(
  index: number,
  blockLength: number,
  rng: () => number,
  sampler: RestartSampler,
): number {
  const restart = SEGMENT_ENDS[index] === 1 || rng() < 1 / blockLength;
  return restart
    ? weightedRandomIndex(rng, sampler)
    : index + 1;
}

function weightedRandomIndex(rng: () => number, sampler: RestartSampler): number {
  const target = rng() * sampler.totalWeight;
  let low = 0;
  let high = sampler.cumulativeWeights.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sampler.cumulativeWeights[middle] > target) high = middle;
    else low = middle + 1;
  }
  return low;
}

function centerHistoricalDrifts(drifts: Float64Array) {
  const adjustment = BASELINE_HISTORICAL_DRIFT - Array.from(drifts).reduce((sum, value) => sum + value, 0) / drifts.length;
  for (let index = 0; index < drifts.length; index += 1) drifts[index] += adjustment;
}

function sliceStressWindow(window: readonly [number, number]): number[] {
  return HISTORICAL_RETURNS.slice(window[0], window[1]);
}

function zeroMean(values: number[]): number[] {
  const average = mean(values);
  return values.map((value) => value - average);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
