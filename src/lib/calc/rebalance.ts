/**
 * Buy-only rebalance: given current holdings and target weights, compute how to deploy NEW cash
 * so the resulting portfolio is as close to the targets as possible — without selling.
 *
 * Approach: pour new cash into the most-underweight bucket(s) using waterline algorithm.
 */
export interface RebalanceInput {
  holdings: Array<{ ticker: string; marketValue: number; price: number }>;
  /** Map ticker → target weight (0..1). Must sum to <=1.05 (small tolerance). */
  targetWeights: Record<string, number>;
  newCashUsd: number;
}

export interface RebalanceOutput {
  ticker: string;
  currentValue: number;
  currentWeight: number;
  targetWeight: number;
  /** USD to add to this ticker. */
  buyUsd: number;
  /** Whole-share count to buy (floor). */
  buyShares: number;
  /** Leftover USD that couldn't buy a full share. */
  leftoverUsd: number;
  /** Resulting weight after the suggested buys. */
  resultingWeight: number;
}

export function rebalance({ holdings, targetWeights, newCashUsd }: RebalanceInput): RebalanceOutput[] {
  if (newCashUsd <= 0) return [];

  // Merge holdings + targets into a unified ticker set
  const tickers = new Set<string>([...holdings.map((h) => h.ticker), ...Object.keys(targetWeights)]);
  const rows = [...tickers].map((t) => {
    const h = holdings.find((x) => x.ticker === t);
    return {
      ticker: t,
      marketValue: h?.marketValue ?? 0,
      price: h?.price ?? 0,
      targetWeight: targetWeights[t] ?? 0,
    };
  });

  const currentTotal = rows.reduce((s, r) => s + r.marketValue, 0);
  const newTotal = currentTotal + newCashUsd;

  // Target dollars per ticker after deploying new cash
  const idealDollars = rows.map((r) => r.targetWeight * newTotal);
  const buyDollarsRaw = rows.map((r, i) => Math.max(0, idealDollars[i] - r.marketValue));
  const buyRawSum = buyDollarsRaw.reduce((s, v) => s + v, 0);

  // Scale so allocated $ == newCashUsd (allocates strictly only what's available; if rawSum < cash, scale up to cash distributing by target weight)
  let scaled: number[];
  if (buyRawSum >= newCashUsd && buyRawSum > 0) {
    const scale = newCashUsd / buyRawSum;
    scaled = buyDollarsRaw.map((v) => v * scale);
  } else if (buyRawSum > 0) {
    // First fill the underweight gaps, then distribute remaining cash by target weight
    const remaining = newCashUsd - buyRawSum;
    const weightSum = rows.reduce((s, r) => s + r.targetWeight, 0) || 1;
    scaled = buyDollarsRaw.map((v, i) => v + (remaining * rows[i].targetWeight) / weightSum);
  } else {
    // Everything is already at-or-above target — distribute cash purely by target weight
    const weightSum = rows.reduce((s, r) => s + r.targetWeight, 0) || 1;
    scaled = rows.map((r) => (newCashUsd * r.targetWeight) / weightSum);
  }

  return rows.map((r, i) => {
    const buyUsd = scaled[i];
    // Schwab supports fractional shares to 4 decimal places. Floor to avoid
    // accidentally over-spending on the user's recommended buy.
    const rawShares = r.price > 0 ? buyUsd / r.price : 0;
    const buyShares = Math.floor(rawShares * 10000) / 10000;
    const leftoverUsd = buyUsd - buyShares * r.price;
    const resultingValue = r.marketValue + buyShares * r.price;
    return {
      ticker: r.ticker,
      currentValue: r.marketValue,
      currentWeight: currentTotal > 0 ? r.marketValue / currentTotal : 0,
      targetWeight: r.targetWeight,
      buyUsd,
      buyShares,
      leftoverUsd,
      resultingWeight: newTotal > 0 ? resultingValue / newTotal : 0,
    };
  });
}
