import {
  addDuplicateOrdinals,
  buildImportPreview,
  decimalSubtract,
  fixedDecimal,
  isUsCurrency,
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

type IbkrColumn =
  | 'date'
  | 'action'
  | 'symbol'
  | 'quantity'
  | 'price'
  | 'fees'
  | 'amount'
  | 'currency'
  | 'description'
  | 'usd_amount';

interface IbkrParsedImport extends ParsedImport {
  columns: Partial<Record<IbkrColumn, number>>;
}

const COLUMN_ALIASES: Record<IbkrColumn, string[]> = {
  date: ['date/time', 'date', 'trade date', 'transaction date', 'settlement date', '日期/时间', '日期时间', '日期', '交易日期', '结算日期'],
  action: ['type', 'action', 'activity', 'activity type', 'transaction type', '类型', '操作', '活动', '交易类型'],
  symbol: ['symbol', 'ticker', 'code', '符号', '证券代码', '代码'],
  quantity: ['quantity', 'qty', 'shares', '数量', '股数'],
  price: ['t. price', 'trade price', 'price', 'unit price', '成交价', '成交价格', '价格'],
  fees: ['total comm/tax', 'total commission', 'tax/fee', 'comm/fee', 'fees & comm', 'fees', 'commission', 'fee', '总佣金/税费', '总佣金', '税/费', '手续费', '费用', '佣金'],
  amount: ['proceeds', 'net cash', 'net amount', 'amount', '收益', '净现金', '金额', '净金额'],
  currency: ['currency', 'ccy', '币种', '货币'],
  description: ['description', 'details', 'memo', '说明', '描述'],
  usd_amount: ['usd amount', 'usd settlement', 'usd net amount', '美元金额', '美元结算金额'],
};

const ACTION_ALIASES: Record<string, 'buy' | 'sell' | LedgerCashEventType | null> = {
  buy: 'buy',
  bought: 'buy',
  purchase: 'buy',
  买入: 'buy',
  sell: 'sell',
  sold: 'sell',
  sale: 'sell',
  卖出: 'sell',
  dividend: 'dividend',
  dividends: 'dividend',
  'cash dividend': 'dividend',
  股息: 'dividend',
  股息收入: 'dividend',
  'reinvest dividend': 'buy',
  'reinvest shares': 'buy',
  股息再投资: 'buy',
  入金: 'broker_deposit',
  deposit: 'broker_deposit',
  'cash deposit': 'broker_deposit',
  提款: 'broker_withdrawal',
  withdrawal: 'broker_withdrawal',
  'cash withdrawal': 'broker_withdrawal',
  利息: 'interest',
  interest: 'interest',
  'bank interest': 'interest',
  预扣税: 'tax',
  tax: 'tax',
  'withholding tax': 'tax',
  税: 'tax',
  费用: 'fee',
  fee: 'fee',
  fees: 'fee',
  commission: 'fee',
  手续费: 'fee',
  'fx transfer': 'fx_transfer',
  换汇: 'fx_transfer',
};

function findColumns(header: string[]): Partial<Record<IbkrColumn, number>> {
  const normalized = header.map(normalizeHeader);
  const columns: Partial<Record<IbkrColumn, number>> = {};
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES) as Array<[IbkrColumn, string[]]>) {
    const index = aliases.map((alias) => normalized.indexOf(alias)).find((candidate) => candidate >= 0) ?? -1;
    if (index >= 0) columns[column] = index;
  }
  return columns;
}

function valueAt(row: string[], columns: Partial<Record<IbkrColumn, number>>, column: IbkrColumn): string {
  const index = columns[column];
  return index === undefined ? '' : String(row[index] ?? '').trim();
}

function actionKind(value: string): 'buy' | 'sell' | LedgerCashEventType | null {
  const normalized = normalizeAction(value);
  return ACTION_ALIASES[normalized]
    ?? (normalized.includes('dividend') || normalized.includes('股息') ? 'dividend' : null)
    ?? (normalized.includes('interest') || normalized.includes('利息') ? 'interest' : null)
    ?? (normalized.includes('withholding') || normalized.includes('预扣') || normalized.includes('tax') || normalized.includes('税') ? 'tax' : null)
    ?? (normalized.includes('deposit') || normalized.includes('入金') ? 'broker_deposit' : null)
    ?? (normalized.includes('withdrawal') || normalized.includes('提款') ? 'broker_withdrawal' : null)
    ?? (normalized.includes('fee') || normalized.includes('commission') || normalized.includes('费用') || normalized.includes('手续费') ? 'fee' : null);
}

function tradeIdentity(
  date: string,
  action: string,
  ticker: string,
  shares: string,
  price: string,
  fees: string,
  amount: string,
): string {
  return makeImportKey(['ibkr', date, normalizeAction(action), ticker, shares, price, fees, amount]);
}

function cashIdentity(
  date: string,
  action: string,
  ticker: string,
  amount: string,
  currency: string,
): string {
  return makeImportKey(['ibkr', date, normalizeAction(action), ticker, amount, currency]);
}

type IbkrFields = Partial<Record<ImportRowField, string>>;

/** `ImportDetection.context` key for the amount column's gross-vs-net shape. */
const GROSS_PROCEEDS_CONTEXT_KEY = 'amount_is_gross_proceeds';

function amountIsGrossProceedsFrom(detection: ImportDetection): boolean {
  return detection.context?.[GROSS_PROCEEDS_CONTEXT_KEY] === '1';
}

/**
 * Parses one row from its conceptual fields. Used both by the full-file loop
 * below and by `reparseRow`, which re-runs this on a single row's corrected
 * values so an inline fix goes through the exact same rules. `amountIsGrossProceeds`
 * is file-level context (which header the amount column actually was),
 * carried on `ImportDetection.context` because a single row can't re-derive it.
 */
function parseIbkrRow(sourceIndex: number, fields: IbkrFields, amountIsGrossProceeds: boolean): ParsedImportRow {
  const description = (fields.description ?? '').trim();
  const actionText = (fields.action ?? '').trim() || description;
  const kind = actionKind(actionText);
  const ticker = normalizeTicker(fields.symbol ?? '');
  const date = parseDate(fields.date ?? '');
  const currency = (fields.currency || 'USD').toUpperCase();
  const amount = parseDecimal(fields.amount, 10);
  const usdAmount = parseDecimal(fields.usd_amount, 10);
  const sourceAmount = amount ?? usdAmount;
  const errors: string[] = [];
  if (!date) errors.push('日期无效');
  if (!kind) errors.push('操作类型无法映射');
  if (!sourceAmount) errors.push('缺少金额');
  if (!isUsCurrency(currency) && !usdAmount) {
    errors.push('非 USD 行缺少明确 USD 结算值');
  }
  if ((kind === 'buy' || kind === 'sell') && !isUsCurrency(currency)) {
    errors.push('非 USD 交易缺少可核对的 USD 成交价');
  }
  if (errors.length > 0 || !date || !kind || !sourceAmount) {
    return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
  }

  const effectiveAmount = usdAmount ?? sourceAmount;
  if (kind === 'buy' || kind === 'sell') {
    const shares = parseDecimal(fields.quantity, 10);
    const price = parseDecimal(fields.price, 12);
    const parsedFees = parseDecimal(fields.fees, 10) ?? '0';
    const fees = parsedFees.startsWith('-') ? parsedFees.slice(1) : parsedFees;
    if (!ticker) errors.push('交易缺少证券代码');
    if (!shares || Number(shares) <= 0) errors.push('股数必须为正数');
    if (!price || Number(price) <= 0) errors.push('成交价必须为正数');
    if (Number(fees) < 0) errors.push('手续费不能为负数');
    if (errors.length > 0 || !shares || !price) {
      return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
    }
    const settlementAmount = amountIsGrossProceeds && !usdAmount
      ? decimalSubtract(effectiveAmount, fees, 10)
      : effectiveAmount;
    const computedAmount = signedTradeAmount(kind, shares, price, fees);
    if (isUsCurrency(currency) && Math.abs(Number(decimalSubtract(settlementAmount, computedAmount, 10))) > 0.0200001) {
      errors.push(`金额与成交明细不一致（应约为 ${computedAmount}）`);
    }
    if ((kind === 'buy' && Number(settlementAmount) >= 0) || (kind === 'sell' && Number(settlementAmount) <= 0)) {
      errors.push('交易结算金额方向无效');
    }
    if (errors.length > 0) {
      return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
    }
    const trade: LedgerTrade = {
      source: 'ibkr',
      source_index: sourceIndex,
      effective_date: date,
      side: kind,
      ticker,
      shares: fixedDecimal(shares, 10),
      price: fixedDecimal(price, 12),
      fees_usd: fixedDecimal(fees, 10),
      usd_amount: fixedDecimal(settlementAmount, 10),
      source_currency: currency,
      source_action: actionText,
      source_description: description,
      duplicate_ordinal: 0,
      import_key: tradeIdentity(date, actionText, ticker, shares, price, fees, settlementAmount),
    };
    return { source_index: sourceIndex, action: actionText, category: 'trade', default_status: 'import', item: trade };
  }

  const eventType = kind;
  const signed = Number(effectiveAmount);
  if (eventType === 'broker_deposit' && signed <= 0) errors.push('入金金额必须为正数');
  if (eventType === 'broker_withdrawal' && signed >= 0) errors.push('提款金额必须为负数');
  if ((eventType === 'tax' || eventType === 'fee') && signed >= 0) errors.push('税费金额必须为负数');
  if (errors.length > 0) {
    return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
  }
  const cashEvent: LedgerCashEvent = {
    source: 'ibkr',
    source_index: sourceIndex,
    effective_date: date,
    event_type: eventType,
    ...(ticker ? { ticker } : {}),
    source_currency: currency,
    source_amount: fixedDecimal(sourceAmount, 10),
    usd_amount: fixedDecimal(effectiveAmount, 10),
    source_action: actionText,
    source_description: description,
    duplicate_ordinal: 0,
    import_key: cashIdentity(date, actionText, ticker, effectiveAmount, currency),
  };
  return { source_index: sourceIndex, action: actionText, category: 'cash_event', default_status: 'import', item: cashEvent };
}

function parseInput(input: ImportInput): IbkrParsedImport {
  const table = parseDelimited(input.text, ',');
  const headerIndex = table.rows.findIndex((row) => {
    const columns = findColumns(row);
    return columns.date !== undefined && columns.action !== undefined && columns.amount !== undefined;
  });
  const columns = headerIndex >= 0 ? findColumns(table.rows[headerIndex]) : {};
  const amountHeader = headerIndex >= 0 && columns.amount !== undefined
    ? normalizeHeader(table.rows[headerIndex][columns.amount] ?? '')
    : '';
  const amountIsGrossProceeds = amountHeader === 'proceeds' || amountHeader === '收益';
  const detection: ImportDetection = {
    supported: headerIndex >= 0,
    source: 'ibkr',
    format: 'ibkr-activity-statement-or-transaction-history',
    confidence: headerIndex >= 0 ? 'high' : 'low',
    delimiter: ',',
    header_row: headerIndex >= 0 ? headerIndex + 1 : undefined,
    warnings: [],
    context: { [GROSS_PROCEEDS_CONTEXT_KEY]: amountIsGrossProceeds ? '1' : '0' },
  };
  const rows: ParsedImportRow[] = [];
  const items: Array<LedgerTrade | LedgerCashEvent> = [];

  if (headerIndex < 0) {
    rows.push({
      source_index: 0,
      action: 'parse-error',
      category: 'error',
      default_status: 'block',
      reason: '未找到包含日期、操作和金额字段的 IBKR 表头。',
    });
    return { detection, rows, warnings: [], columns };
  }

  for (const error of table.errors.filter((entry) => entry.type === 'Quotes')) {
    rows.push({
      source_index: (error.row ?? 0) + 1,
      action: 'parse-error',
      category: 'error',
      default_status: 'block',
      reason: `CSV 引号格式错误：${error.message}`,
    });
  }

  const body = table.rows.slice(headerIndex + 1);
  for (let index = 0; index < body.length; index += 1) {
    const sourceIndex = headerIndex + index + 2;
    const row = body[index];
    if (row.every((cell) => cell.trim() === '')) continue;
    const fields: IbkrFields = {
      date: valueAt(row, columns, 'date'),
      action: valueAt(row, columns, 'action'),
      symbol: valueAt(row, columns, 'symbol'),
      quantity: valueAt(row, columns, 'quantity'),
      price: valueAt(row, columns, 'price'),
      fees: valueAt(row, columns, 'fees'),
      amount: valueAt(row, columns, 'amount'),
      usd_amount: valueAt(row, columns, 'usd_amount'),
      currency: valueAt(row, columns, 'currency'),
      description: valueAt(row, columns, 'description'),
    };
    const parsedRow = parseIbkrRow(sourceIndex, fields, amountIsGrossProceeds);
    parsedRow.source_fields = fields;
    if (parsedRow.item) items.push(parsedRow.item);
    rows.push(parsedRow);
  }

  addDuplicateOrdinals(items);
  const itemBySource = new Map(items.map((item) => [item.source_index, item]));
  for (const row of rows) {
    const item = itemBySource.get(row.source_index);
    if (item) {
      row.item = item;
      row.default_status = 'import';
    }
  }
  return { detection, rows: rows.sort((left, right) => left.source_index - right.source_index), warnings: [], columns };
}

export const ibkrImportAdapter: PortfolioImportAdapter<IbkrParsedImport> = {
  source: 'ibkr',

  detect(input) {
    return parseInput(input).detection;
  },

  parse: parseInput,

  normalize(parsed): NormalizedLedger {
    return rowsForItems(parsed.rows);
  },

  audit(input, options) {
    const parsed = parseInput(input);
    return buildImportPreview(parsed, ibkrImportAdapter.normalize(parsed), options);
  },

  reparseRow(sourceIndex, fields, detection) {
    const row = parseIbkrRow(sourceIndex, fields, amountIsGrossProceedsFrom(detection));
    row.source_fields = fields;
    if (row.item) addDuplicateOrdinals([row.item]);
    return row;
  },
};
