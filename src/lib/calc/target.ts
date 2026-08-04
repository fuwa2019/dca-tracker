const MONTHS_PER_YEAR = 12;
const ZERO_RATE_EPSILON = 1e-12;
const WHOLE_MONTH_EPSILON = 1e-10;

export interface TargetProjectionInput {
  currentValueUsd: number;
  monthlyContributionUsd: number;
  annualReturn: number;
}

/** Convert an effective annual return (8% = 0.08) to its equivalent monthly rate. */
export function monthlyRateFromAnnualReturn(annualReturn: number): number | null {
  if (!Number.isFinite(annualReturn) || annualReturn <= -1) return null;
  return Math.expm1(Math.log1p(annualReturn) / MONTHS_PER_YEAR);
}

/**
 * Project a portfolio after n monthly periods.
 *
 * Monthly contributions are invested at the beginning of each period, matching
 * the product's first-trading-day DCA convention:
 *
 *   FV = P0 * (1 + i)^n + C * (1 + i) * ((1 + i)^n - 1) / i
 */
export function projectValue(args: TargetProjectionInput & { months: number }): number {
  const { currentValueUsd: P0, monthlyContributionUsd: C, annualReturn, months: n } = args;
  if (
    ![P0, C, n].every(Number.isFinite)
    || P0 < 0
    || C < 0
    || n < 0
  ) return Number.NaN;

  const i = monthlyRateFromAnnualReturn(annualReturn);
  if (i === null) return Number.NaN;
  if (Math.abs(i) < ZERO_RATE_EPSILON) return P0 + C * n;

  const logGrowth = n * Math.log1p(i);
  const growth = Math.exp(logGrowth);
  const contributionFactor = (1 + i) * Math.expm1(logGrowth) / i;
  return P0 * growth + C * contributionFactor;
}

/**
 * Return the first complete month in which the projection reaches the target.
 *
 * Solving the beginning-of-period annuity formula for n gives:
 *
 *   n = ln((FV * i + C * (1 + i)) / (P0 * i + C * (1 + i)))
 *       / ln(1 + i)
 */
export function monthsToTarget(args: TargetProjectionInput & { targetUsd: number }): {
  months: number | null;
  years: number | null;
  achievable: boolean;
} {
  const { currentValueUsd: P0, monthlyContributionUsd: C, annualReturn, targetUsd: FV } = args;
  const unreachable = { months: null, years: null, achievable: false } as const;

  if (
    ![P0, C, annualReturn, FV].every(Number.isFinite)
    || P0 < 0
    || C < 0
    || FV <= 0
  ) return unreachable;
  if (P0 >= FV) return { months: 0, years: 0, achievable: true };

  const i = monthlyRateFromAnnualReturn(annualReturn);
  if (i === null || (C === 0 && i <= 0)) return unreachable;

  if (Math.abs(i) < ZERO_RATE_EPSILON) {
    if (C === 0) return unreachable;
    const rawMonths = (FV - P0) / C;
    const months = firstCompleteMonth(rawMonths);
    return { months, years: months / MONTHS_PER_YEAR, achievable: true };
  }

  const contributionTerm = C * (1 + i);
  const numerator = FV * i + contributionTerm;
  const denominator = P0 * i + contributionTerm;
  if (numerator <= 0 || denominator <= 0) return unreachable;

  const rawMonths = Math.log(numerator / denominator) / Math.log1p(i);
  if (!Number.isFinite(rawMonths) || rawMonths < 0) return unreachable;

  let months = firstCompleteMonth(rawMonths);
  const tolerance = Math.max(1, Math.abs(FV)) * 1e-12;
  const valueAtMonth = projectValue({ ...args, months });
  if (valueAtMonth + tolerance < FV) months += 1;

  if (months > 0) {
    const previousValue = projectValue({ ...args, months: months - 1 });
    if (previousValue >= FV) months -= 1;
  }

  return { months, years: months / MONTHS_PER_YEAR, achievable: true };
}

function firstCompleteMonth(months: number): number {
  const nearestInteger = Math.round(months);
  const tolerance = Math.max(1, Math.abs(months)) * WHOLE_MONTH_EPSILON;
  return Math.abs(months - nearestInteger) <= tolerance
    ? nearestInteger
    : Math.ceil(months);
}
