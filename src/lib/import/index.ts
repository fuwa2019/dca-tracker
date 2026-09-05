import { ibkrImportAdapter } from './ibkr.ts';
import { schwabLedgerImportAdapter } from './schwabLedger.ts';
import { tradingViewImportAdapter } from './tradingview.ts';
import type { ImportInput, PortfolioImportAdapter } from './types.ts';

export * from './types.ts';
export { buildReconciliation, newLedgerItemsForAppend } from './common.ts';
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
export { schwabLedgerImportAdapter as schwabImportAdapter } from './schwabLedger.ts';
export { tradingViewImportAdapter } from './tradingview.ts';

export const portfolioImportAdapters: ReadonlyArray<PortfolioImportAdapter> = [
  // Keep six-column TradingView ahead of Schwab's legacy compatibility fallback.
  tradingViewImportAdapter,
  ibkrImportAdapter,
  schwabLedgerImportAdapter,
];

export function detectPortfolioImportAdapter(input: ImportInput): PortfolioImportAdapter | null {
  return portfolioImportAdapters.find((adapter) => adapter.detect(input).supported) ?? null;
}
