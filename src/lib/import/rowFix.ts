/**
 * Pure rules for inline-fixing a blocked import row in the review step.
 *
 * A row is fixable only when it failed the adapter's own per-row parsing
 * (category === 'error'), the adapter implements reparseRow, and the row
 * carries source_fields. The native eight-column Schwab parser, TradingView,
 * and IBKR adapters meet all three conditions. Schwab's six-column legacy
 * compatibility fallback still has no per-field source capture, so only that
 * fallback remains on the "fix the source file and re-select it" path.
 *
 * Nothing here writes to a database or touches React. A fix re-derives a
 * `ParsedImportRow` through the adapter's own row rules and hands the
 * caller back into the same `buildImportPreview` pipeline a fresh file
 * parse uses, so status counts, reconciliation and `can_commit` are always
 * recomputed by the one existing pipeline, never a second parallel one.
 */
import { buildImportPreview, rowsForItems } from './common.ts';
import type {
  AuditOptions,
  ImportPreview,
  ImportPreviewRow,
  ImportRowField,
  ParsedImportRow,
  PortfolioImportAdapter,
} from './types.ts';

export const IMPORT_ROW_FIELD_LABELS: Record<ImportRowField, string> = {
  date: '日期',
  action: '操作',
  symbol: '证券/币种',
  quantity: '数量',
  price: '成交价',
  fees: '佣金/费用',
  amount: '金额',
  usd_amount: 'USD 金额',
  currency: '币种',
  fx_rate: 'USD 汇率',
  exchange: '交易所',
  description: '说明',
};

const FIELD_ORDER: ImportRowField[] = [
  'date', 'action', 'symbol', 'quantity', 'price', 'fees', 'amount', 'usd_amount', 'currency', 'fx_rate', 'exchange', 'description',
];

/** True only for a row that failed parsing and whose adapter supports a fix. */
export function isRowFixable(
  adapter: Pick<PortfolioImportAdapter, 'reparseRow'> | null | undefined,
  row: ImportPreviewRow,
): boolean {
  return row.status === 'block' && row.category === 'error' && !!adapter?.reparseRow && !!row.source_fields;
}

export interface RowFieldEdit {
  field: ImportRowField;
  label: string;
  /** The untouched value read from the source file. Never changes. */
  original: string;
  /** The value a fix would use right now: the pending edit, or the original. */
  current: string;
}

/**
 * The editable fields for one row: the adapter's captured source fields,
 * each paired with any pending edit the caller is holding. Field order is
 * fixed so the edit form has a stable layout across sources.
 */
export function rowFieldEdits(
  row: ImportPreviewRow,
  pendingEdits: Partial<Record<ImportRowField, string>> = {},
): RowFieldEdit[] {
  const source = row.source_fields;
  if (!source) return [];
  return FIELD_ORDER
    .filter((field) => source[field] !== undefined)
    .map((field) => ({
      field,
      label: IMPORT_ROW_FIELD_LABELS[field],
      original: source[field] ?? '',
      current: pendingEdits[field] ?? source[field] ?? '',
    }));
}

export interface RowFixResult {
  /** The row to substitute into the preview's row list. */
  row: ParsedImportRow;
  /** Set when the fix was refused because it collided with another row. */
  collision_source_index: number | null;
}

/**
 * Re-parses one row from its source fields plus the caller's edits, through
 * the adapter's own per-row rules. `source_fields` on the result always
 * stays the row's pristine original text, whatever the adapter's
 * `reparseRow` sets it to, so a fix is always visibly layered on top of the
 * original rather than replacing it.
 *
 * If the corrected row's normalized identity collides with another row
 * already in the preview, the fix is refused: the returned row stays
 * blocked, with a reason naming the colliding row, instead of letting two
 * rows reach the RPC with the same import key.
 */
export function applyRowFix(
  adapter: PortfolioImportAdapter,
  preview: ImportPreview,
  sourceIndex: number,
  edits: Partial<Record<ImportRowField, string>>,
): RowFixResult | null {
  const row = preview.rows.find((candidate) => candidate.source_index === sourceIndex);
  if (!row || !isRowFixable(adapter, row)) return null;
  const merged = { ...row.source_fields, ...edits };
  const reparsed = adapter.reparseRow!(sourceIndex, merged, preview.detection);
  const fixed: ParsedImportRow = { ...reparsed, source_fields: row.source_fields };
  if (!fixed.item) return { row: fixed, collision_source_index: null };

  const collision = preview.rows.find((candidate) => (
    candidate.source_index !== sourceIndex
    && !!candidate.item
    && candidate.item.import_key === fixed.item!.import_key
  ));
  if (!collision) return { row: fixed, collision_source_index: null };
  return {
    collision_source_index: collision.source_index,
    row: {
      source_index: fixed.source_index,
      action: fixed.action,
      category: 'error',
      default_status: 'block',
      reason: `修正后与第 ${collision.source_index} 行的归一化结果完全相同，请再次修改后重试。`,
      source_fields: fixed.source_fields,
    },
  };
}

/**
 * Rebuilds the whole preview after one row's fix. Reuses `buildImportPreview`
 * over the row list with only the fixed row swapped in, so status counts,
 * the reconciliation totals and `can_commit` are recomputed from scratch by
 * the same function a fresh file parse uses — never patched in place.
 */
export function rebuildPreviewAfterRowFix(
  adapter: PortfolioImportAdapter,
  preview: ImportPreview,
  sourceIndex: number,
  edits: Partial<Record<ImportRowField, string>>,
  options: AuditOptions,
): ImportPreview | null {
  const result = applyRowFix(adapter, preview, sourceIndex, edits);
  if (!result) return null;
  const rows = preview.rows.map((row) => (row.source_index === sourceIndex ? result.row : row));
  const normalized = rowsForItems(rows);
  return buildImportPreview({ detection: preview.detection, rows, warnings: [] }, normalized, options);
}
