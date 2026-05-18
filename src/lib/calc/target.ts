/**
 * Compute how many months until current portfolio + monthly contributions × compound growth
 * reaches a target value.
 *
 * FV formula for future value of present + annuity:
 *   FV = P0 (1+i)^n + C × [(1+i)^n − 1] / i
 *
 * Solve for n given FV (=target):
 *   n = ln((FV·i + C) / (P0·i + C)) / ln(1+i)
 *
 * When i ≈ 0 (no growth assumed): n = (target − P0) / C.
 */
export function monthsToTarget(args: {
  currentValueUsd: number;
  monthlyContributionUsd: number;
  annualReturn: number; // 0.08 = 8%/yr
  targetUsd: number;
}): { months: number | null; years: number | null; achievable: boolean } {
  const { currentValueUsd: P0, monthlyContributionUsd: C, annualReturn, targetUsd: FV } = args;
  if (P0 >= FV) return { months: 0, years: 0, achievable: true };
  if (C <= 0 && annualReturn <= 0) return { months: null, years: null, achievable: false };

  const i = annualReturn / 12;
  if (Math.abs(i) < 1e-9) {
    if (C <= 0) return { months: null, years: null, achievable: false };
    const m = (FV - P0) / C;
    return { months: m, years: m / 12, achievable: true };
  }

  const numerator = FV * i + C;
  const denominator = P0 * i + C;
  if (denominator <= 0 || numerator <= 0) return { months: null, years: null, achievable: false };
  const ratio = numerator / denominator;
  if (ratio <= 1) return { months: 0, years: 0, achievable: true };
  const m = Math.log(ratio) / Math.log(1 + i);
  return { months: m, years: m / 12, achievable: true };
}

/** Project portfolio value n months out under the same model — for the progress curve. */
export function projectValue(args: {
  currentValueUsd: number;
  monthlyContributionUsd: number;
  annualReturn: number;
  months: number;
}): number {
  const { currentValueUsd: P0, monthlyContributionUsd: C, annualReturn, months: n } = args;
  const i = annualReturn / 12;
  if (Math.abs(i) < 1e-9) return P0 + C * n;
  const pow = Math.pow(1 + i, n);
  return P0 * pow + C * ((pow - 1) / i);
}
