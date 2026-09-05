/**
 * Import receipt and event-composition derivations.
 *
 * These are pure functions over the preview that the adapters already produce
 * and the counts the ledger RPC already returns. They add no RPC argument and
 * no RPC response field: the four-number summary is derived from the existing
 * receipt counts plus the preview's per-row statuses.
 */

import type { ImportPreviewRow, ImportRowStatus } from './types.ts';

/** Structural subset of the ledger import RPC result used by the summary. */
export interface LedgerImportReceiptCounts {
  added: number;
  unchanged: number;
  removed: number;
}

export interface ImportReceiptSummary {
  /** Rows the database newly wrote. */
  imported: number;
  /** Rows known to be duplicates before the write, plus any write-time races. */
  duplicates: number;
  /** Every source row that did not produce a new record, duplicates included. */
  skipped: number;
  /** All rows the source file produced, whatever their status. */
  total: number;
  /** Rows dropped before the write by the asset or source policy. */
  ignored: number;
  /** Rows that were never eligible to be sent. */
  blocked: number;
  /** Existing records the selected mode removed before rebuilding. */
  removed: number;
}

/**
 * Aligns the receipt with the Wealthfolio-style imported / duplicates /
 * skipped / total reading. `skipped` deliberately contains `duplicates`, which
 * is the same semantics as the reference receipt (0 imported / 13 duplicates /
 * 14 skipped / 14 total).
 */
export function summarizeImportReceipt(input: {
  result: LedgerImportReceiptCounts;
  status_counts: Record<ImportRowStatus, number>;
  total_rows: number;
  /** Known duplicates omitted from an append payload before it reached the RPC. */
  prefiltered_duplicates?: number;
}): ImportReceiptSummary {
  const total = Math.max(0, input.total_rows);
  const imported = Math.max(0, Math.min(input.result.added, total));
  const duplicateCandidates = Math.max(0, input.prefiltered_duplicates ?? 0)
    + Math.max(0, input.result.unchanged);
  const duplicates = Math.min(Math.max(0, total - imported), duplicateCandidates);
  return {
    imported,
    duplicates,
    skipped: total - imported,
    total,
    ignored: input.status_counts.ignore,
    blocked: input.status_counts.block,
    removed: Math.max(0, input.result.removed),
  };
}

export interface LedgerEventKindCount {
  kind: string;
  count: number;
}

/**
 * Counts normalized rows by trade side or cash-event type, the way the
 * reference tool's review step groups activities before the write.
 */
export function countLedgerEventKinds(
  rows: readonly ImportPreviewRow[],
  statuses: readonly ImportRowStatus[] = ['import'],
): LedgerEventKindCount[] {
  const allowed = new Set(statuses);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!allowed.has(row.status)) continue;
    const item = row.item;
    if (!item) continue;
    const kind = 'side' in item ? item.side : item.event_type;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (b.count - a.count) || a.kind.localeCompare(b.kind));
}

/**
 * Row-level reasons that must stay visible on the receipt. Blocked and ignored
 * rows are never silently corrected, so their reason text is carried through
 * from the preview instead of being collapsed into a count.
 */
export function retainedRowReasons(
  rows: readonly ImportPreviewRow[],
  statuses: readonly ImportRowStatus[] = ['block', 'ignore'],
): Array<{ source_index: number; status: ImportRowStatus; action: string; reason: string }> {
  const allowed = new Set(statuses);
  return rows
    .filter((row) => allowed.has(row.status) && !!row.reason)
    .map((row) => ({
      source_index: row.source_index,
      status: row.status,
      action: row.action,
      reason: row.reason as string,
    }));
}
