import type { Database } from '../database.types';

export type TxnRow = Database['public']['Tables']['transactions']['Row'];

export interface Position {
  ticker: string;
  shares: number;
  /** Average-cost basis (USD per share) over remaining shares after subtracting sells proportionally. */
  avgCost: number;
  /** FIFO cost basis (USD per share) — the cost basis of remaining shares assuming oldest-first sells. */
  fifoCost: number;
  /** Total realized P/L (USD) — for sells that closed FIFO lots. Same regardless of basis chosen. */
  realizedUsd: number;
  /** Sum of buy notional (USD) over the lifetime — useful for "total invested in this ticker". */
  totalBoughtUsd: number;
  /** Number of buy transactions (display-only). */
  buyCount: number;
}

/**
 * Aggregate transactions into per-ticker positions.
 * Computes both average-cost AND FIFO bases so the UI can toggle.
 *
 * - avg cost: classical weighted average of buys, scaled down proportionally on sells
 *   (i.e. sells don't change the avg per-share basis)
 * - fifo cost: maintain a queue of lots, sells consume oldest-first
 */
export function aggregatePositions(transactions: TxnRow[]): Position[] {
  const byTicker = new Map<string, TxnRow[]>();
  for (const t of transactions) {
    const list = byTicker.get(t.ticker) ?? [];
    list.push(t);
    byTicker.set(t.ticker, list);
  }

  const out: Position[] = [];
  for (const [ticker, txns] of byTicker) {
    const sorted = [...txns].sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.created_at.localeCompare(b.created_at));

    // Average-cost tracking
    let avgShares = 0;
    let avgCostTotal = 0; // sum of (shares × price) for current avg-cost basis

    // FIFO tracking
    const fifoQueue: Array<{ shares: number; price: number }> = [];

    let realizedUsd = 0;
    let totalBoughtUsd = 0;
    let buyCount = 0;

    for (const tx of sorted) {
      const sh = Number(tx.shares);
      const px = Number(tx.price);

      if (tx.side === 'buy') {
        // avg
        avgCostTotal += sh * px;
        avgShares += sh;
        // fifo
        fifoQueue.push({ shares: sh, price: px });
        totalBoughtUsd += sh * px;
        buyCount += 1;
      } else {
        // sell — drain fifo queue, accumulate realized P/L.
        // If the sell exceeds current holdings (data corruption / form bypass),
        // we cap at available shares and warn rather than producing negative
        // net positions silently.
        const fifoAvailable = fifoQueue.reduce((acc, l) => acc + l.shares, 0);
        const capped = Math.min(sh, fifoAvailable);
        if (capped < sh - 1e-9) {
          // eslint-disable-next-line no-console
          console.warn(
            `[position] oversell on ${tx.ticker} on ${tx.trade_date}: tried to sell ${sh}, only ${fifoAvailable} available — capped`,
          );
        }
        let remaining = capped;
        while (remaining > 1e-9 && fifoQueue.length > 0) {
          const lot = fifoQueue[0];
          const take = Math.min(remaining, lot.shares);
          realizedUsd += take * (px - lot.price);
          lot.shares -= take;
          remaining -= take;
          if (lot.shares <= 1e-9) fifoQueue.shift();
        }
        // avg-cost: keep per-share basis, subtract proportional cost
        const avgSell = Math.min(capped, avgShares);
        if (avgShares > 1e-9) {
          const avgBasis = avgCostTotal / avgShares;
          avgCostTotal -= avgBasis * avgSell;
          avgShares -= avgSell;
          if (avgShares < 1e-9) {
            avgShares = 0;
            avgCostTotal = 0;
          }
        }
      }
    }

    const fifoShares = fifoQueue.reduce((acc, l) => acc + l.shares, 0);
    const fifoCostTotal = fifoQueue.reduce((acc, l) => acc + l.shares * l.price, 0);

    // Use FIFO shares as the source of truth for shares (= avgShares within float tolerance)
    const shares = fifoShares;
    if (shares <= 1e-9) {
      // Fully closed position — surface realized P/L but don't list as a current holding.
      // We still emit it so callers can show "closed" history if they want; UI filters by shares>0.
    }

    out.push({
      ticker,
      shares,
      avgCost: avgShares > 1e-9 ? avgCostTotal / avgShares : 0,
      fifoCost: fifoShares > 1e-9 ? fifoCostTotal / fifoShares : 0,
      realizedUsd,
      totalBoughtUsd,
      buyCount,
    });
  }

  return out.sort((a, b) => b.shares * Math.max(a.avgCost, 1) - a.shares * Math.max(b.avgCost, 1));
}

export function unrealizedPL(pos: Position, currentPrice: number | null, basis: 'avg' | 'fifo'): {
  marketValue: number;
  costBasis: number;
  unrealizedUsd: number;
  unrealizedPct: number;
} {
  const cost = basis === 'avg' ? pos.avgCost : pos.fifoCost;
  const price = currentPrice ?? cost;
  const marketValue = pos.shares * price;
  const costBasis = pos.shares * cost;
  const unrealizedUsd = marketValue - costBasis;
  const unrealizedPct = costBasis > 0 ? unrealizedUsd / costBasis : 0;
  return { marketValue, costBasis, unrealizedUsd, unrealizedPct };
}
