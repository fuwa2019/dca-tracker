/** Display-only grouping. Weights are NAV fractions, not percentage points. */
export function exposureBarCutoff(weights: readonly number[], trackWidth: number, barLimit: number): number {
  const sorted = weights.filter((weight) => Number.isFinite(weight) && weight > 0).sort((a, b) => b - a);
  if (!sorted.length) return Infinity;
  const readableCutoff = sorted[0] * 24 / Math.max(24, trackWidth);
  const firstExcluded = sorted[barLimit];
  // A group of equal weights crossing the budget belongs entirely to numbers.
  const rankCutoff = firstExcluded == null ? 0 : sorted.filter((weight) => weight > firstExcluded).at(-1) ?? Infinity;
  return Math.max(readableCutoff, rankCutoff);
}
