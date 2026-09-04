export type ImportSource = 'schwab' | 'ibkr' | 'tradingview';
export type ImportDelimiter = ',' | '\t' | ';';

export type ImportMode = 'append' | 'replace_source' | 'reset_all';

export type ImportRowStatus = 'import' | 'duplicate' | 'ignore' | 'block';

export type ImportRowCategory = 'trade' | 'cash_event' | 'ignored' | 'error';

export type LedgerCashEventType =
  | 'fx_transfer'
  | 'broker_deposit'
  | 'broker_withdrawal'
  | 'stock_allocation'
  | 'dividend'
  | 'interest'
  | 'tax'
  | 'fee';

export interface ImportInput {
  text: string;
  fileName?: string;
}

export interface ImportDetection {
  supported: boolean;
  source: ImportSource;
  format: string;
  confidence: 'high' | 'medium' | 'low';
  delimiter?: ImportDelimiter;
  header_row?: number;
  warnings: string[];
  /**
   * File-level parsing context an adapter's `reparseRow` needs to correctly
   * re-derive a single row outside the full-file loop (for example, which
   * source column an amount was read from). Adapter-specific; opaque to the
   * shared preview and reconciliation code.
   */
  context?: Record<string, string>;
}

export interface LedgerTrade {
  source: ImportSource;
  source_index: number;
  effective_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  shares: string;
  price: string;
  fees_usd: string;
  /** Signed settlement cash. A broker-supplied value is authoritative. */
  usd_amount: string;
  source_currency: string;
  /** Original broker-native execution price, when the source carries one. */
  source_price?: string;
  /** Original broker-native signed settlement amount, when available. */
  source_amount?: string;
  /** USD per unit of source_currency used for canonical conversion. */
  fx_rate_to_usd?: string;
  source_action: string;
  source_description: string;
  duplicate_ordinal: number;
  import_key: string;
}

export interface LedgerCashEvent {
  source: ImportSource;
  source_index: number;
  effective_date: string;
  event_type: LedgerCashEventType;
  ticker?: string;
  source_currency: string;
  /** USD per unit of source_currency used for canonical conversion. */
  fx_rate_to_usd?: string;
  source_amount: string;
  usd_amount: string;
  source_action: string;
  source_description: string;
  duplicate_ordinal: number;
  import_key: string;
}

export type LedgerItem = LedgerTrade | LedgerCashEvent;

/**
 * Conceptual per-row field names an adapter can capture from a source row for
 * inline fixing. Not every adapter uses every field; each source only reads
 * the subset its own file shape carries.
 */
export type ImportRowField =
  | 'date'
  | 'action'
  | 'symbol'
  | 'quantity'
  | 'price'
  | 'fees'
  | 'amount'
  | 'usd_amount'
  | 'currency'
  | 'fx_rate'
  | 'exchange'
  | 'description';

export interface ParsedImportRow {
  source_index: number;
  action: string;
  category: ImportRowCategory;
  default_status: Exclude<ImportRowStatus, 'duplicate'>;
  item?: LedgerItem;
  reason?: string;
  /**
   * Raw per-field text as read from the source row, keyed by conceptual
   * field name. Only adapters that support inline row fixing populate this;
   * once set it is never overwritten by a fix, so the original source text
   * stays visible even after the row has been corrected.
   */
  source_fields?: Partial<Record<ImportRowField, string>>;
}

export interface ParsedImport {
  detection: ImportDetection;
  rows: ParsedImportRow[];
  warnings: string[];
}

export interface NormalizedLedger {
  trades: LedgerTrade[];
  cash_events: LedgerCashEvent[];
}

export interface ImportReconciliation {
  ending_shares: Record<string, string>;
  cash_by_kind: Partial<Record<LedgerCashEventType, string>>;
  ending_cash_usd: string;
  investor_inflows_usd: string;
  investor_outflows_usd: string;
}

export interface ImportPreviewRow extends ParsedImportRow {
  status: ImportRowStatus;
}

export interface ImportPreview {
  source: ImportSource;
  format: string;
  mode: ImportMode;
  detection: ImportDetection;
  trades: LedgerTrade[];
  cash_events: LedgerCashEvent[];
  reconciliation: ImportReconciliation;
  rows: ImportPreviewRow[];
  warnings: string[];
  errors: string[];
  can_commit: boolean;
  status_counts: Record<ImportRowStatus, number>;
}

export interface ImportReceipt {
  source: ImportSource;
  mode: ImportMode;
  source_fingerprint?: string;
  committed_at?: string;
  transactions_added: number;
  cash_events_added: number;
  duplicates: number;
  ignored: number;
  blocked: number;
  removed: number;
  rolled_back: boolean;
}

export interface AuditOptions {
  mode?: ImportMode;
  existing_import_keys?: ReadonlySet<string>;
}

export interface PortfolioImportAdapter<Parsed extends ParsedImport = ParsedImport> {
  readonly source: ImportSource;
  detect(input: ImportInput): ImportDetection;
  parse(input: ImportInput): Parsed;
  normalize(parsed: Parsed): NormalizedLedger;
  audit(input: ImportInput, options?: AuditOptions): ImportPreview;
  export?(ledger: NormalizedLedger): string;
  /**
   * Re-parses one row from corrected field values, through the exact
   * per-row rules a full-file parse runs — never a second, parallel
   * validation path. Adapters that implement this also populate
   * `source_fields` on every row they produce, which is what makes that row
   * eligible for the review step's inline fix.
   */
  reparseRow?(
    sourceIndex: number,
    fields: Partial<Record<ImportRowField, string>>,
    detection: ImportDetection,
  ): ParsedImportRow;
}
