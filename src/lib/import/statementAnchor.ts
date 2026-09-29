import { buildLedger, type LedgerCashflowRow, type LedgerTransactionRow } from '../calc/portfolioLedger.ts';
import {
  STATEMENT_AS_OF_CONTEXT_KEY,
  STATEMENT_OPENING_CASH_CONTEXT_KEY,
  STATEMENT_OPENING_ROW_CONTEXT_KEY,
  STATEMENT_PERIOD_START_CONTEXT_KEY,
  buildReconciliation,
  makeImportKey,
} from './common.ts';
import type {
  AccountLedgerEntry,
  AuditOptions,
  ImportPreview,
  ImportPreviewRow,
  ImportSource,
  LedgerCashEvent,
} from './types.ts';

/**
 * Statement-anchored append.
 *
 * IBKR books "FX Translations P&L" as one lump on the period end, covering
 * the whole export period, so two exports whose periods overlap both carry
 * the overlap's revaluation and the rows do not deduplicate. The statement's
 * opening cash is the broker's own figure for the day before the period, so
 * an append is anchored to it instead:
 *
 * - calibration: opening cash minus the account's ledger cash before the
 *   period, booked the day before the period starts;
 * - reversal: every FX row from this source dated inside the period that the
 *   new file no longer carries is reversed on its own date.
 *
 * The ledger then equals the opening cash before the period and the ending
 * cash after it. Both rows are `fx_conversion` (investment P&L, not a flow),
 * derived from the file plus the ledger, so re-importing the same file finds
 * nothing left to correct. A calibration above the limit means rows are
 * missing, not revaluation, and blocks the append.
 */

// Shown as the row's action in the review table.
export const STATEMENT_ANCHOR_ACTION = '对账单校准';
/** Largest calibration accepted as revaluation drift rather than missing rows. */
export const STATEMENT_ANCHOR_MAX_USD = 1;
const EPSILON_USD = 0.000001;

function round10(value: number): number {
  return Number(value.toFixed(10));
}

function dayBefore(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function usd(value: number): string {
  return value.toFixed(2);
}

/** Recomputes a preview's derived totals after rows were added. */
function withExtraRows(preview: ImportPreview, extraRows: ImportPreviewRow[], extraErrors: string[], extraWarnings: string[]): ImportPreview {
  const rows = [...preview.rows, ...extraRows].sort((left, right) => left.source_index - right.source_index);
  const cashEvents = [
    ...preview.cash_events,
    ...extraRows.flatMap((row) => (row.item && 'event_type' in row.item ? [row.item] : [])),
  ];
  const statusCounts = { ...preview.status_counts };
  for (const row of extraRows) statusCounts[row.status] += 1;
  const errors = [...preview.errors, ...extraErrors];
  return {
    ...preview,
    rows,
    cash_events: cashEvents,
    reconciliation: buildReconciliation({ trades: preview.trades, cash_events: cashEvents }),
    warnings: [...preview.warnings, ...extraWarnings],
    errors,
    can_commit: errors.length === 0 && (statusCounts.import + statusCounts.duplicate) > 0,
    status_counts: statusCounts,
  };
}

export function withStatementAnchor(preview: ImportPreview, options: AuditOptions = {}): ImportPreview {
  const context = preview.detection.context ?? {};
  const opening = context[STATEMENT_OPENING_CASH_CONTEXT_KEY];
  const start = context[STATEMENT_PERIOD_START_CONTEXT_KEY];
  const end = context[STATEMENT_AS_OF_CONTEXT_KEY];
  if (!opening || !start || !end) return preview;
  const openingCash = Number(opening);

  if ((options.mode ?? 'append') !== 'append') {
    if (Math.abs(openingCash) < 0.005) return preview;
    return withExtraRows(preview, [], [], [
      `文件期初现金为 ${usd(openingCash)} USD（${start} 起），不是从开户开始的完整历史；替换会删除 ${start} 之前的全部记录，账本将对不上券商现金。只补这一段请用「新增导入」。`,
    ]);
  }
  const ledger = options.account_ledger;
  if (!ledger) return preview;

  const source = preview.source;
  const summaryRow = Number(context[STATEMENT_OPENING_ROW_CONTEXT_KEY]) || 1;
  const existing = options.existing_import_keys ?? new Set<string>();
  const fileKeys = new Set(preview.rows.flatMap((row) => (row.item ? [row.item.import_key] : [])));
  const rows: ImportPreviewRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  const anchorRow = (date: string, amount: number, action: string, kind: string, description: string, reason: string): ImportPreviewRow => {
    const usdAmount = amount.toFixed(10);
    const event: LedgerCashEvent = {
      source,
      source_index: summaryRow,
      effective_date: date,
      event_type: 'fx_conversion',
      source_currency: 'USD',
      source_amount: usdAmount,
      usd_amount: usdAmount,
      fx_rate_to_usd: '1.000000000000',
      source_action: action,
      source_description: description,
      duplicate_ordinal: 1,
      import_key: `${makeImportKey([source, kind, date, usdAmount])}|1`,
    };
    return {
      source_index: summaryRow,
      action: STATEMENT_ANCHOR_ACTION,
      category: 'cash_event',
      default_status: 'import',
      status: existing.has(event.import_key) ? 'duplicate' : 'import',
      item: event,
      reason,
    };
  };

  const ledgerBefore = round10(ledger.filter((entry) => entry.date < start).reduce((sum, entry) => sum + entry.usd_amount, 0));
  const calibration = round10(openingCash - ledgerBefore);
  const calibrationDate = dayBefore(start);
  if (Math.abs(calibration) > STATEMENT_ANCHOR_MAX_USD) {
    errors.push(
      `期初现金对不上：对账单 ${start} 期初现金 ${usd(openingCash)} USD，账本 ${calibrationDate} 为 ${usd(ledgerBefore)} USD，相差 ${usd(calibration)} USD，超过汇兑折算可解释的 ${usd(STATEMENT_ANCHOR_MAX_USD)} USD。可能缺少 ${start} 之前的记录：请先补导之前期间的文件，或用「替换此来源」导入完整历史。`,
    );
  } else if (Math.abs(calibration) >= EPSILON_USD) {
    rows.push(anchorRow(
      calibrationDate,
      calibration,
      '对账单期初校准',
      'statement_anchor',
      `对账单期初现金 ${opening} − 账本 ${calibrationDate} 现金 ${ledgerBefore.toFixed(10)}`,
      `汇兑折算校准：让账本 ${calibrationDate} 的现金等于对账单期初现金 ${usd(openingCash)} USD。`,
    ));
  }

  const inPeriod = (entry: AccountLedgerEntry) => entry.date >= start && entry.date <= end;
  const superseded = ledger.filter((entry) => inPeriod(entry) && !!entry.import_key && !fileKeys.has(entry.import_key));
  const staleFxByDate = new Map<string, number>();
  for (const entry of superseded) {
    if (entry.kind === 'fx_conversion') staleFxByDate.set(entry.date, (staleFxByDate.get(entry.date) ?? 0) + entry.usd_amount);
  }
  for (const [date, total] of [...staleFxByDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const reversal = round10(-total);
    if (Math.abs(reversal) < EPSILON_USD) continue;
    rows.push(anchorRow(
      date,
      reversal,
      '重叠期间换汇冲销',
      'statement_reversal',
      `冲销 ${date} 已入账、被本文件期间取代的换汇损益 ${round10(total).toFixed(10)}`,
      `冲销 ${date} 的旧换汇损益：本文件期间覆盖该日，汇兑折算已按本文件重新计入。`,
    ));
  }
  const otherMissing = superseded.filter((entry) => entry.kind !== 'fx_conversion');
  if (otherMissing.length > 0) {
    const dates = [...new Set(otherMissing.map((entry) => entry.date))].sort().join('、');
    warnings.push(`账本里有 ${otherMissing.length} 条本文件期间内的记录不在文件中（${dates}），未自动处理，请核对是否为券商更正。`);
  }

  if (rows.length === 0 && errors.length === 0 && warnings.length === 0) return preview;
  return withExtraRows(preview, rows, errors, warnings);
}

type SourcedRow = { import_source?: string | null; import_key?: string | null };

/**
 * The rows booked on a source's broker account, in the shape
 * `withStatementAnchor` reads. Cash follows the ledger engine (the broker's
 * settled amount, excluded legacy transfers left out), so the anchor sees the
 * same cash the health page reconciles. Without accounts, falls back to the
 * rows imported from the source.
 */
export function accountLedgerEntries(
  transactions: ReadonlyArray<LedgerTransactionRow & SourcedRow>,
  cashflows: ReadonlyArray<LedgerCashflowRow & SourcedRow>,
  source: ImportSource,
  accountIds: ReadonlySet<string>,
): AccountLedgerEntry[] {
  const ledger = buildLedger(transactions, cashflows);
  const transactionById = new Map(transactions.map((row) => [row.id, row]));
  const cashflowById = new Map(cashflows.map((row) => [row.id, row]));
  const belongs = (account: string | null | undefined, row: SourcedRow | undefined) => (
    accountIds.size > 0 ? !!account && accountIds.has(account) : row?.import_source === source
  );
  const keyOf = (row: SourcedRow | undefined) => (row?.import_source === source ? row.import_key ?? null : null);
  const entries: AccountLedgerEntry[] = [];
  for (const trade of ledger.trades) {
    const row = transactionById.get(trade.id);
    if (belongs(trade.account, row)) entries.push({ date: trade.date, usd_amount: trade.cashUsd, kind: 'trade', import_key: keyOf(row) });
  }
  for (const event of ledger.cash) {
    if (event.role === 'excluded' || event.inferred) continue;
    const row = cashflowById.get(event.id);
    if (belongs(event.account, row)) entries.push({ date: event.date, usd_amount: event.amountUsd, kind: event.kind, import_key: keyOf(row) });
  }
  return entries;
}
