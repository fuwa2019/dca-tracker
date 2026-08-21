import { ibkrImportAdapter } from './ibkr.ts';
import { schwabImportAdapter } from './schwab.ts';
import { tradingViewImportAdapter } from './tradingview.ts';
import type { ImportInput, PortfolioImportAdapter } from './types.ts';

export * from './types.ts';
export { buildReconciliation } from './common.ts';
export {
  countLedgerEventKinds,
  retainedRowReasons,
  summarizeImportReceipt,
  type ImportReceiptSummary,
  type LedgerEventKindCount,
  type LedgerImportReceiptCounts,
} from './receipt.ts';
export {
  IMPORT_ROW_FIELD_LABELS,
  applyRowFix,
  isRowFixable,
  rebuildPreviewAfterRowFix,
  rowFieldEdits,
  type RowFieldEdit,
  type RowFixResult,
} from './rowFix.ts';
export { ibkrImportAdapter } from './ibkr.ts';
export { schwabImportAdapter } from './schwab.ts';
export { tradingViewImportAdapter } from './tradingview.ts';

export const portfolioImportAdapters: ReadonlyArray<PortfolioImportAdapter> = [
  // TradingView must be checked first because the legacy Schwab parser also
  // accepts the same six-column header shape for backward compatibility.
  tradingViewImportAdapter,
  ibkrImportAdapter,
  schwabImportAdapter,
];

export function detectPortfolioImportAdapter(input: ImportInput): PortfolioImportAdapter | null {
  return portfolioImportAdapters.find((adapter) => adapter.detect(input).supported) ?? null;
}
