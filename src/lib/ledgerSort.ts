/**
 * Ledger table ordering. Pure: no React, no network — the table header and the
 * paginated caller share this so a header click reorders the whole filtered
 * set rather than just the rows on screen.
 */

export type TxnSortKey = 'date' | 'ticker' | 'amount';
export type TxnSortDirection = 'asc' | 'desc';

export interface TxnSort {
  key: TxnSortKey;
  direction: TxnSortDirection;
}

export const DEFAULT_TXN_SORT: TxnSort = { key: 'date', direction: 'desc' };

/** Minimal row shape the ordering needs. */
export interface SortableTxn {
  ticker: string;
  trade_date: string;
}

/** Next sort state for a header click: same column flips, a new column starts descending. */
export function nextSort(current: TxnSort, key: TxnSortKey): TxnSort {
  if (current.key !== key) return { key, direction: 'desc' };
  return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
}

export function sortTransactions<T extends SortableTxn>(
  rows: ReadonlyArray<T>,
  { key, direction }: TxnSort,
  cashEffect: (row: T) => number,
): T[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'ticker') return factor * a.ticker.localeCompare(b.ticker);
    if (key === 'amount') return factor * (cashEffect(a) - cashEffect(b));
    return factor * a.trade_date.localeCompare(b.trade_date);
  });
}
