/**
 * Full ledger export: every stored field needed to audit or rebuild the
 * ledger, one row per trade or cash event, in date order. Amounts keep their
 * stored precision; nothing is rounded for display.
 *
 * Pure: no network or Supabase.
 */
import { csvCell } from './tradingviewExport.ts';

export const LEDGER_EXPORT_COLUMNS = [
  'record_type',
  'date',
  'account',
  'kind',
  'ticker',
  'quantity',
  'price_native',
  'currency',
  'fx_rate_to_usd',
  'price_usd',
  'fees_usd',
  'amount_native',
  'amount_usd',
  'cny_amount',
  'target_rate_cny_per_usd',
  'import_source',
  'import_key',
  'description',
  'note',
] as const;

export interface LedgerExportTransaction {
  trade_date: string;
  ticker: string;
  side: 'buy' | 'sell';
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
  settled_amount_usd?: number | string | null;
  source_currency?: string | null;
  source_price?: number | string | null;
  source_amount?: number | string | null;
  fx_rate_to_usd?: number | string | null;
  import_source?: string | null;
  import_key?: string | null;
  source_description?: string | null;
  note?: string | null;
  account_id?: string | null;
}

export interface LedgerExportCashflow {
  cashflow_kind?: string | null;
  effective_date?: string | null;
  usd_in_date?: string | null;
  cny_out_date?: string | null;
  usd_amount: number | string | null;
  cny_amount?: number | string | null;
  target_rate?: number | string | null;
  ticker?: string | null;
  source_currency?: string | null;
  source_amount?: number | string | null;
  fx_rate_to_usd?: number | string | null;
  import_source?: string | null;
  import_key?: string | null;
  source_description?: string | null;
  note?: string | null;
  account_id?: string | null;
}

export function exportLedgerCsv(
  transactions: readonly LedgerExportTransaction[],
  cashflows: readonly LedgerExportCashflow[],
  accountNames: ReadonlyMap<string, string> = new Map(),
): string {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  const account = (id?: string | null) => (id ? accountNames.get(id) ?? id : '');
  const rows: Array<{ date: string; order: number; cells: string[] }> = [];

  for (const txn of transactions) {
    rows.push({
      date: txn.trade_date,
      order: 1,
      cells: [
        'trade',
        txn.trade_date,
        account(txn.account_id),
        txn.side,
        txn.ticker,
        text(txn.shares),
        text(txn.source_price ?? txn.price),
        text(txn.source_currency ?? 'USD'),
        text(txn.fx_rate_to_usd ?? ((txn.source_currency ?? 'USD') === 'USD' ? 1 : '')),
        text(txn.price),
        text(txn.fees_usd ?? 0),
        text(txn.source_amount ?? txn.settled_amount_usd),
        text(txn.settled_amount_usd),
        '',
        '',
        text(txn.import_source),
        text(txn.import_key),
        text(txn.source_description),
        text(txn.note),
      ],
    });
  }

  for (const flow of cashflows) {
    const date = flow.effective_date ?? flow.usd_in_date ?? flow.cny_out_date ?? '';
    rows.push({
      date,
      order: flow.cashflow_kind === 'broker_deposit' ? 0 : 2,
      cells: [
        'cash',
        date,
        account(flow.account_id),
        text(flow.cashflow_kind ?? 'fx_transfer'),
        text(flow.ticker),
        '',
        '',
        text(flow.source_currency ?? 'USD'),
        text(flow.fx_rate_to_usd),
        '',
        '',
        text(flow.source_amount ?? flow.usd_amount),
        text(flow.usd_amount),
        text(flow.cny_amount),
        text(flow.target_rate),
        text(flow.import_source),
        text(flow.import_key),
        text(flow.source_description),
        text(flow.note),
      ],
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  return [LEDGER_EXPORT_COLUMNS.join(','), ...rows.map((row) => row.cells.map(csvCell).join(','))].join('\n') + '\n';
}
