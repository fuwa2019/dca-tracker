import {
  addDuplicateOrdinals,
  buildImportPreview,
  decimalSubtract,
  fixedDecimal,
  makeImportKey,
  normalizeAction,
  normalizeHeader,
  normalizeTicker,
  parseDate,
  parseDecimal,
  parseDelimited,
  rowsForItems,
  signedTradeAmount,
} from './common.ts';
import {
  exportSchwabTransactions,
  parseSchwabTransactions,
  SCHWAB_HEADERS,
  schwabDepositIdentity,
  schwabIdentity,
  schwabStockAllocationIdentity,
  type SchwabParseResult,
} from '../schwabTransactions.ts';
import type {
  ImportDetection,
  ImportInput,
  ImportRowField,
  LedgerCashEvent,
  LedgerCashEventType,
  LedgerTrade,
  NormalizedLedger,
  ParsedImport,
  ParsedImportRow,
  PortfolioImportAdapter,
} from './types.ts';

type SchwabFields = Partial<Record<ImportRowField, string>>;
type SchwabRowKind = 'buy' | 'sell' | LedgerCashEventType;

interface SchwabTable {
  delimiter: ',' | '\t';
  rows: string[][];
  errors: ReturnType<typeof parseDelimited>['errors'];
  headerIndex: number;
}

interface SchwabParsedImport extends ParsedImport {
  legacy?: SchwabParseResult;
}

const SYMBOL_PATTERN = /^[A-Z0-9.^-]{1,15}$/;
const MAX_ROWS = 10_000;
const AMOUNT_TOLERANCE_USD = 0.0200001;
const SHARES_DECIMAL_PLACES = 10;
const PRICE_DECIMAL_PLACES = 12;
const FEES_DECIMAL_PLACES = 10;
const CASH_DECIMAL_PLACES = 10;

const DEPOSIT_ACTIONS = new Set([
  'ach transfer',
  'cash deposit',
  'deposit',
  'direct deposit',
  'electronic funds transfer',
  'funds received',
  'wire received',
]);

const WITHDRAWAL_ACTIONS = new Set([
  'ach withdrawal',
  'cash withdrawal',
  'funds sent',
  'wire sent',
  'withdrawal',
]);

function detectionFromTable(table: SchwabTable): ImportDetection {
  return {
    supported: true,
    source: 'schwab',
    format: table.delimiter === ',' ? 'schwab-or-portfolio-csv' : 'schwab-tsv',
    confidence: 'high',
    delimiter: table.delimiter,
    header_row: table.headerIndex + 1,
    warnings: [],
  };
}

function detectionFromLegacy(legacy: SchwabParseResult): ImportDetection {
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

function legacyTrade(row: SchwabParseResult['rows'][number]): LedgerTrade {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.trade_date,
    side: row.side,
    ticker: row.ticker,
    shares: fixedDecimal(String(row.shares), SHARES_DECIMAL_PLACES),
    price: fixedDecimal(String(row.price), PRICE_DECIMAL_PLACES),
    fees_usd: fixedDecimal(String(row.fees_usd), FEES_DECIMAL_PLACES),
    usd_amount: fixedDecimal(String(row.amount), CASH_DECIMAL_PLACES),
    source_currency: 'USD',
    source_action: row.side === 'buy' ? 'Buy' : 'Sell',
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function legacyDeposit(row: SchwabParseResult['deposits'][number]): LedgerCashEvent {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.deposit_date,
    event_type: 'broker_deposit',
    source_currency: 'USD',
    source_amount: fixedDecimal(String(row.amount), CASH_DECIMAL_PLACES),
    usd_amount: fixedDecimal(String(row.amount), CASH_DECIMAL_PLACES),
    source_action: row.source_action,
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function legacyAllocation(row: SchwabParseResult['allocations'][number]): LedgerCashEvent {
  return {
    source: 'schwab',
    source_index: row.source_index,
    effective_date: row.allocation_date,
    event_type: 'stock_allocation',
    source_currency: 'USD',
    source_amount: fixedDecimal(String(row.amount), CASH_DECIMAL_PLACES),
    usd_amount: fixedDecimal(String(row.amount), CASH_DECIMAL_PLACES),
    source_action: row.source_action,
    source_description: row.source_description,
    duplicate_ordinal: row.duplicate_ordinal,
    import_key: row.import_key,
  };
}

function parseLegacy(legacy: SchwabParseResult): SchwabParsedImport {
  const rows: ParsedImportRow[] = [
    ...legacy.rows.map((row) => ({
      source_index: row.source_index,
      action: row.side === 'buy' ? 'Buy' : 'Sell',
      category: 'trade' as const,
      default_status: 'import' as const,
      item: legacyTrade(row),
    })),
    ...legacy.deposits.map((row) => ({
      source_index: row.source_index,
      action: row.source_action,
      category: 'cash_event' as const,
      default_status: 'import' as const,
      item: legacyDeposit(row),
    })),
    ...legacy.allocations.map((row) => ({
      source_index: row.source_index,
      action: row.source_action,
      category: 'cash_event' as const,
      default_status: 'import' as const,
      item: legacyAllocation(row),
    })),
    ...legacy.ignored.map((row) => ({
      source_index: row.sourceIndex,
      action: row.action,
      category: 'ignored' as const,
      default_status: 'ignore' as const,
      reason: '嘉信操作暂不支持，未写入账本。',
    })),
    ...legacy.errors.map((error) => ({
      source_index: error.sourceIndex ?? 0,
      action: 'parse-error',
      category: 'error' as const,
      default_status: 'block' as const,
      reason: error.message,
    })),
  ].sort((left, right) => left.source_index - right.source_index);

  return { detection: detectionFromLegacy(legacy), rows, warnings: [], legacy };
}

function parseSchwabDate(value: string): string | null {
  const asOf = value.match(/\bas\s+of\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*$/i);
  return parseDate(asOf?.[1] ?? value);
}

function parseActionKind(action: string, amount: string | null): SchwabRowKind | null {
  const normalized = normalizeAction(action);
  if (normalized === 'buy' || normalized === 'purchase' || normalized === 'reinvest shares') return 'buy';
  if (normalized === 'sell' || normalized === 'sale') return 'sell';
  if (normalized === 'stock allocation') return 'stock_allocation';

  // Schwab emits a dividend credit and a matching Reinvest Shares buy for DRIP.
  if (
    normalized.includes('dividend')
    || normalized.includes('div reinvest')
    || normalized.includes('capital gain')
    || normalized.includes('cap gain')
  ) return 'dividend';
  if (normalized.includes('interest')) return 'interest';
  if (normalized.includes('withholding') || normalized.includes('tax')) return 'tax';
  if (normalized.includes('fee') || normalized.includes('commission')) return 'fee';

  // MoneyLink transfers are sign-sensitive: positive in, negative out.
  if (normalized === 'moneylink transfer' || normalized === 'cash transfer' || normalized === 'transfer') {
    return amount !== null && Number(amount) < 0 ? 'broker_withdrawal' : 'broker_deposit';
  }
  if (DEPOSIT_ACTIONS.has(normalized)) return 'broker_deposit';
  if (WITHDRAWAL_ACTIONS.has(normalized)) return 'broker_withdrawal';
  return null;
}

function decimalPlaces(value: string): number {
  const normalized = value.trim().replace(/[$,]/g, '').replace(/^\((.*)\)$/, '$1');
  const match = normalized.match(/\.(\d+)/);
  return match?.[1].length ?? 0;
}

function parseDecimalField(
  value: string | undefined,
  places: number,
  label: string,
  errors: string[],
): string | null {
  const raw = value?.trim() ?? '';
  const parsed = parseDecimal(raw, places);
  if (parsed === null && raw !== '') {
    if (decimalPlaces(raw) > places) errors.push(label + '最多支持 ' + places + ' 位小数');
    else errors.push(label + '无效');
  }
  return parsed;
}

function parseSchwabRow(sourceIndex: number, fields: SchwabFields): ParsedImportRow {
  const action = (fields.action ?? '').trim();
  const description = (fields.description ?? '').trim();
  const amountRaw = fields.amount ?? '';
  const amount = parseDecimal(amountRaw, CASH_DECIMAL_PLACES);
  const kind = parseActionKind(action, amount);

  if (!kind) {
    return {
      source_index: sourceIndex,
      action,
      category: 'ignored',
      default_status: 'ignore',
      reason: '嘉信操作暂不支持，未写入账本。',
    };
  }

  const errors: string[] = [];
  const date = parseSchwabDate(fields.date ?? '');
  const ticker = normalizeTicker(fields.symbol ?? '');
  if (!date) errors.push('日期无效');
  if (ticker && !SYMBOL_PATTERN.test(ticker)) errors.push('证券代码无效');
  if (amount === null) {
    if (amountRaw.trim() !== '' && decimalPlaces(amountRaw) > CASH_DECIMAL_PLACES) {
      errors.push('金额最多支持 ' + CASH_DECIMAL_PLACES + ' 位小数');
    } else {
      errors.push('金额无效');
    }
  }

  if (kind === 'buy' || kind === 'sell') {
    const shares = parseDecimalField(fields.quantity, SHARES_DECIMAL_PLACES, '股数', errors);
    const price = parseDecimalField(fields.price, PRICE_DECIMAL_PLACES, '成交价', errors);
    const fees = fields.fees?.trim() === ''
      ? '0'
      : parseDecimalField(fields.fees, FEES_DECIMAL_PLACES, '手续费', errors);

    if (!ticker) errors.push('证券代码无效');
    if (!shares || Number(shares) <= 0) errors.push('股数必须为正数');
    if (!price || Number(price) <= 0) errors.push('成交价必须为正数');
    if (!fees || Number(fees) < 0) errors.push('手续费不能为负数');
    if (shares && Number(shares) >= 100_000_000) errors.push('股数超出数据库精度');
    if (price && Number(price) >= 10_000_000_000) errors.push('成交价超出数据库精度');
    if (fees && Number(fees) >= 1_000_000_000_000) errors.push('手续费超出数据库精度');
    if (amount && Number(amount) === 0) errors.push('交易金额不能为零');
    if (kind === 'buy' && amount && Number(amount) >= 0) errors.push('买入金额必须为负数');
    if (kind === 'sell' && amount && Number(amount) <= 0) errors.push('卖出金额必须为正数');
    if (
      kind === 'sell'
      && shares
      && price
      && fees
      && Number(fees) >= Number(shares) * Number(price)
    ) {
      errors.push('卖出手续费必须小于成交额');
    }

    if (errors.length === 0 && date && shares && price && fees && amount) {
      const expected = signedTradeAmount(kind, shares, price, fees);
      if (Math.abs(Number(decimalSubtract(amount, expected, CASH_DECIMAL_PLACES))) > AMOUNT_TOLERANCE_USD) {
        errors.push('金额与成交明细不一致（应约为 ' + expected + '）');
      }
    }

    if (errors.length > 0 || !date || !shares || !price || !fees || !amount) {
      return {
        source_index: sourceIndex,
        action,
        category: 'error',
        default_status: 'block',
        reason: errors.join('；'),
      };
    }

    const trade: LedgerTrade = {
      source: 'schwab',
      source_index: sourceIndex,
      effective_date: date,
      side: kind,
      ticker,
      shares: fixedDecimal(shares, SHARES_DECIMAL_PLACES),
      price: fixedDecimal(price, PRICE_DECIMAL_PLACES),
      fees_usd: fixedDecimal(fees, FEES_DECIMAL_PLACES),
      usd_amount: fixedDecimal(amount, CASH_DECIMAL_PLACES),
      source_currency: 'USD',
      source_action: action,
      source_description: description,
      duplicate_ordinal: 0,
      import_key: schwabIdentity({
        trade_date: date,
        side: kind,
        ticker,
        shares,
        price,
        fees_usd: fees,
      }),
    };
    return { source_index: sourceIndex, action, category: 'trade', default_status: 'import', item: trade };
  }

  const positiveEvent = kind === 'broker_deposit' || kind === 'dividend' || kind === 'interest';
  const negativeEvent = kind === 'broker_withdrawal'
    || kind === 'stock_allocation'
    || kind === 'tax'
    || kind === 'fee';
  if (amount && Number(amount) === 0) errors.push('现金事件金额不能为零');
  if (positiveEvent && amount && Number(amount) <= 0) errors.push('该现金事件金额必须为正数');
  if (negativeEvent && amount && Number(amount) >= 0) errors.push('该现金事件金额必须为负数');

  if (errors.length > 0 || !date || !amount) {
    return {
      source_index: sourceIndex,
      action,
      category: 'error',
      default_status: 'block',
      reason: errors.join('；'),
    };
  }

  const fixedAmount = fixedDecimal(amount, CASH_DECIMAL_PLACES);
  const baseImportKey = kind === 'broker_deposit'
    ? schwabDepositIdentity({
      deposit_date: date,
      source_action: action,
      source_description: description,
      amount: fixedAmount,
    })
    : kind === 'stock_allocation'
      ? schwabStockAllocationIdentity({
        allocation_date: date,
        source_description: description,
        amount: fixedAmount,
      })
      : makeImportKey([date, normalizeAction(action), ticker, description, fixedAmount]);
  const cashEvent: LedgerCashEvent = {
    source: 'schwab',
    source_index: sourceIndex,
    effective_date: date,
    event_type: kind,
    ...(ticker ? { ticker } : {}),
    source_currency: 'USD',
    source_amount: fixedAmount,
    usd_amount: fixedAmount,
    source_action: action,
    source_description: description,
    duplicate_ordinal: 0,
    import_key: baseImportKey,
  };
  return { source_index: sourceIndex, action, category: 'cash_event', default_status: 'import', item: cashEvent };
}

function sourceFields(cells: string[]): SchwabFields {
  return {
    date: cells[0] ?? '',
    action: cells[1] ?? '',
    symbol: cells[2] ?? '',
    description: cells[3] ?? '',
    quantity: cells[4] ?? '',
    price: cells[5] ?? '',
    fees: cells[6] ?? '',
    amount: cells[7] ?? '',
  };
}

function parseTable(table: SchwabTable): SchwabParsedImport {
  const detection = detectionFromTable(table);
  const rows: ParsedImportRow[] = table.errors
    .filter((error) => error.type === 'Quotes')
    .map((error) => ({
      source_index: typeof error.row === 'number' ? error.row + 1 : 0,
      action: 'parse-error',
      category: 'error' as const,
      default_status: 'block' as const,
      reason: 'CSV 引号格式错误：' + error.message,
    }));
  const items: Array<LedgerTrade | LedgerCashEvent> = [];
  const body = table.rows.slice(table.headerIndex + 1);

  if (body.length > MAX_ROWS) {
    rows.push({
      source_index: 0,
      action: 'parse-error',
      category: 'error',
      default_status: 'block',
      reason: '文件超过 ' + MAX_ROWS + ' 行上限。',
    });
  }

  for (let index = 0; index < Math.min(body.length, MAX_ROWS); index += 1) {
    const sourceIndex = table.headerIndex + index + 2;
    const cells = Array.from(
      { length: SCHWAB_HEADERS.length },
      (_, cellIndex) => body[index][cellIndex] ?? '',
    );
    if (cells.every((cell) => cell.trim() === '')) continue;
    const fields = sourceFields(cells);
    const parsedRow = parseSchwabRow(sourceIndex, fields);
    parsedRow.source_fields = fields;
    if (parsedRow.item) items.push(parsedRow.item);
    rows.push(parsedRow);
  }

  addDuplicateOrdinals(items);
  const itemBySource = new Map(items.map((item) => [item.source_index, item]));
  for (const row of rows) {
    const item = itemBySource.get(row.source_index);
    if (item) row.item = item;
  }
  return {
    detection,
    rows: rows.sort((left, right) => left.source_index - right.source_index),
    warnings: [],
  };
}

function chooseTable(text: string): SchwabTable | null {
  const candidates: SchwabTable[] = [];
  for (const delimiter of ['\t', ','] as const) {
    const parsed = parseDelimited(text, delimiter);
    const headerIndex = parsed.rows.findIndex((row) => SCHWAB_HEADERS.every(
      (header, index) => normalizeHeader(row[index] ?? '') === normalizeHeader(header),
    ));
    if (headerIndex >= 0) {
      candidates.push({
        delimiter,
        rows: parsed.rows,
        errors: parsed.errors,
        headerIndex,
      });
    }
  }
  return candidates.sort((left, right) => left.headerIndex - right.headerIndex)[0] ?? null;
}

function parseInput(input: ImportInput): SchwabParsedImport {
  const table = chooseTable(input.text);
  if (table) return parseTable(table);
  // Keep direct-call compatibility for the six-column Portfolio CSV shape.
  return parseLegacy(parseSchwabTransactions(input.text));
}

export const schwabLedgerImportAdapter: PortfolioImportAdapter<SchwabParsedImport> = {
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
    return buildImportPreview(parsed, schwabLedgerImportAdapter.normalize(parsed), options);
  },

  reparseRow(sourceIndex, fields) {
    const row = parseSchwabRow(sourceIndex, fields);
    row.source_fields = fields;
    if (row.item) addDuplicateOrdinals([row.item]);
    return row;
  },

  export(ledger) {
    return exportSchwabTransactions(
      ledger.trades.map((trade) => ({
        trade_date: trade.effective_date,
        side: trade.side,
        ticker: trade.ticker,
        source_action: trade.source_action,
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
        cashflow_kind: event.event_type,
      })),
    );
  },
};
