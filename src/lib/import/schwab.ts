import {
  exportSchwabTransactions,
  parseSchwabTransactions,
  type SchwabParseResult,
} from '../schwabTransactions.ts';
import {
  buildImportPreview,
  fixedDecimal,
  rowsForItems,
} from './common.ts';
import type {
  ImportDetection,
  ImportInput,
  LedgerCashEvent,
  LedgerTrade,
  NormalizedLedger,
  ParsedImport,
  ParsedImportRow,
  PortfolioImportAdapter,
} from './types.ts';

interface SchwabParsedImport extends ParsedImport {
  legacy: SchwabParseResult;
}

function detectionFrom(legacy: SchwabParseResult): ImportDetection {
  return {
    supported: legacy.delimiter !== null,
    source: 'schwab',
    format: legacy.delimiter === ',' ? 'schwab-or-portfolio-csv' : 'schwab-tsv',
    confidence: legacy.delimiter ? 'high' : 'low',
    delimiter: legacy.delimiter ?? undefined,
    header_row: legacy.headerRow ?? undefined,
    warnings: [],
  };
}

function tradeFromRow(row: SchwabParseResult['rows'][number]): LedgerTrade {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.trade_date,
    side: row.side,
    ticker: row.ticker,
    shares: fixedDecimal(String(row.shares), 10),
    price: fixedDecimal(String(row.price), 12),
    fees_usd: fixedDecimal(String(row.fees_usd), 10),
    usd_amount: fixedDecimal(String(row.amount), 10),
    source_currency: 'USD',
    source_action: row.side === 'buy' ? 'Buy' : 'Sell',
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function cashEventFromDeposit(row: SchwabParseResult['deposits'][number]): LedgerCashEvent {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.deposit_date,
    event_type: 'broker_deposit',
    source_currency: 'USD',
    source_amount: fixedDecimal(String(row.amount), 10),
    usd_amount: fixedDecimal(String(row.amount), 10),
    source_action: row.source_action,
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function cashEventFromAllocation(row: SchwabParseResult['allocations'][number]): LedgerCashEvent {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.allocation_date,
    event_type: 'stock_allocation',
    source_currency: 'USD',
    source_amount: fixedDecimal(String(row.amount), 10),
    usd_amount: fixedDecimal(String(row.amount), 10),
    source_action: row.source_action,
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function parseInput(input: ImportInput): SchwabParsedImport {
  const legacy = parseSchwabTransactions(input.text);
  const rows: ParsedImportRow[] = [
    ...legacy.rows.map((row) => ({
      source_index: row.source_index,
      action: row.side === 'buy' ? 'Buy' : 'Sell',
      category: 'trade' as const,
      default_status: 'import' as const,
      item: tradeFromRow(row),
    })),
    ...legacy.deposits.map((row) => ({
      source_index: row.source_index,
      action: row.source_action,
      category: 'cash_event' as const,
      default_status: 'import' as const,
      item: cashEventFromDeposit(row),
    })),
    ...legacy.allocations.map((row) => ({
      source_index: row.source_index,
      action: row.source_action,
      category: 'cash_event' as const,
      default_status: 'import' as const,
      item: cashEventFromAllocation(row),
    })),
    ...legacy.ignored.map((row) => ({
      source_index: row.sourceIndex,
      action: row.action,
      category: 'ignored' as const,
      default_status: 'ignore' as const,
      reason: '现有 Schwab 兼容规则忽略该操作',
    })),
    ...legacy.errors.map((error) => ({
      source_index: error.sourceIndex ?? 0,
      action: 'parse-error',
      category: 'error' as const,
      default_status: 'block' as const,
      reason: error.message,
    })),
  ].sort((left, right) => left.source_index - right.source_index);

  return {
    detection: detectionFrom(legacy),
    rows,
    warnings: [],
    legacy,
  };
}

export const schwabImportAdapter: PortfolioImportAdapter<SchwabParsedImport> = {
  source: 'schwab',

  detect(input) {
    return parseInput(input).detection;
  },

  parse: parseInput,

  normalize(parsed): NormalizedLedger {
    return rowsForItems(parsed.rows);
  },

  audit(input, options) {
    const parsed = parseInput(input);
    return buildImportPreview(parsed, schwabImportAdapter.normalize(parsed), options);
  },

  export(ledger) {
    const unsupported = ledger.cash_events.filter(
      (event) => event.event_type !== 'broker_deposit' && event.event_type !== 'stock_allocation',
    );
    if (unsupported.length > 0) {
      throw new Error('Schwab 八列导出无法表达股息、利息、税费或提款事件。');
    }
    return exportSchwabTransactions(
      ledger.trades.map((trade) => ({
        trade_date: trade.effective_date,
        side: trade.side,
        ticker: trade.ticker,
        source_description: trade.source_description,
        shares: trade.shares,
        price: trade.price,
        fees_usd: trade.fees_usd,
        settled_amount_usd: trade.usd_amount,
      })),
      ledger.cash_events.map((event) => ({
        usd_in_date: event.effective_date,
        usd_amount: event.usd_amount,
        source_action: event.source_action,
        source_description: event.source_description,
        cashflow_kind: event.event_type === 'stock_allocation'
          ? 'stock_allocation'
          : 'broker_deposit',
      })),
    );
  },
};
