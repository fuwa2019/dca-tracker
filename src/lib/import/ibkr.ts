import {
  addDuplicateOrdinals,
  buildImportPreview,
  decimalMultiply,
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
  ImportDelimiter,
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
  | 'gross_amount'
  | 'net_amount'
  | 'amount'
  | 'currency'
  | 'description'
  | 'usd_amount'
  | 'fx_rate'
  | 'exchange';

interface IbkrParsedImport extends ParsedImport {
  columns: Partial<Record<IbkrColumn, number>>;
}

interface IbkrRowContext {
  amountIsGrossProceeds: boolean;
  defaultCurrency: string;
}

const IBKR_DELIMITERS: ImportDelimiter[] = [',', '\t', ';'];

const COLUMN_ALIASES: Record<IbkrColumn, string[]> = {
  date: [
    'date/time', 'date time', 'datetime', 'date', 'trade date', 'tradedate',
    'transaction date', 'transactiondate', 'settlement date', 'settlementdate',
    '日期/时间', '日期时间', '日期', '交易日期', '结算日期',
  ],
  action: [
    'type', 'action', 'activity', 'activity type', 'activitytype',
    'transaction type', 'transactiontype', 'buy/sell', 'buy sell', 'instruction',
    '类型', '操作', '活动', '交易类型',
  ],
  symbol: ['symbol', 'ticker', 'code', 'local symbol', 'localsymbol', '符号', '证券代码', '代码'],
  quantity: ['quantity', 'qty', 'shares', '数量', '股数'],
  price: ['t. price', 't.price', 'trade price', 'tradeprice', 'unit price', 'unitprice', 'price', '成交价', '成交价格', '价格'],
  fees: [
    'total comm/tax', 'total comm tax', 'total commission', 'total commission/tax',
    'totalcom/tax', 'totalcomm/tax', 'tax/fee', 'tax fee', 'comm/fee', 'comm fee',
    'fees & comm', 'fees and comm', 'commissions', 'commission', 'ibcommission', 'other fees', 'otherfees',
    'taxes', 'fees', 'fee',
    '总佣金/税费', '总佣金', '税/费', '手续费', '费用', '佣金',
  ],
  gross_amount: [
    'gross amount', 'grossamount', 'gross proceeds', 'grossproceeds', 'proceeds',
    '收益', '成交金额', '毛金额',
  ],
  net_amount: [
    'net amount', 'netamount', 'net cash', 'netcash', 'net proceeds', 'netproceeds',
    'net cash amount', 'netcashamount', '净现金', '净金额', '净收益',
  ],
  amount: ['trade money', 'trademoney', 'net cash', 'netcash', 'amount', 'total amount', '总额', '金额'],
  currency: ['currency', 'currency primary', 'currencyprimary', 'currency of trade', 'ccy', '币种', '货币'],
  description: ['description', 'security description', 'securitydescription', 'details', 'memo', '说明', '描述'],
  usd_amount: [
    'usd', 'usd amount', 'usd settlement', 'usd net amount', 'usd net cash', 'usd amount settled',
    '美元金额', '美元结算金额',
  ],
  fx_rate: ['exchange rate', 'exchange rate to usd', 'fx rate', 'fxrate', 'fx rate to usd', '汇率', '美元汇率'],
  exchange: ['exchange', 'market', 'listing exchange', 'listingexchange', '交易所', '市场'],
};

const ACTION_ALIASES: Record<string, 'buy' | 'sell' | LedgerCashEventType | null> = {
  buy: 'buy',
  bought: 'buy',
  purchase: 'buy',
  'buy to open': 'buy',
  'buy to cover': 'buy',
  'dividend reinvestment': 'buy',
  'reinvest dividend': 'buy',
  'reinvest shares': 'buy',
  股息再投资: 'buy',
  买入: 'buy',
  sell: 'sell',
  sold: 'sell',
  sale: 'sell',
  'sell to close': 'sell',
  卖出: 'sell',
  dividend: 'dividend',
  dividends: 'dividend',
  'cash dividend': 'dividend',
  'payment in lieu': 'dividend',
  'payment in lieu of dividend': 'dividend',
  股息: 'dividend',
  股息收入: 'dividend',
  入金: 'broker_deposit',
  deposit: 'broker_deposit',
  'cash deposit': 'broker_deposit',
  'wire received': 'broker_deposit',
  提款: 'broker_withdrawal',
  withdrawal: 'broker_withdrawal',
  'cash withdrawal': 'broker_withdrawal',
  'wire sent': 'broker_withdrawal',
  利息: 'interest',
  interest: 'interest',
  'bank interest': 'interest',
  'credit interest': 'interest',
  'debit interest': 'interest',
  预扣税: 'tax',
  tax: 'tax',
  'withholding tax': 'tax',
  withholding: 'tax',
  'foreign tax withholding': 'tax',
  税: 'tax',
  费用: 'fee',
  fee: 'fee',
  fees: 'fee',
  commission: 'fee',
  手续费: 'fee',
  'fx transfer': 'fx_transfer',
  'forex trade component': 'fx_transfer',
  forex: 'fx_transfer',
  换汇: 'fx_transfer',
};

const EXCHANGE_SUFFIXES: Record<string, string> = {
  ASX: 'AX',
  ASX24: 'AX',
  SEHK: 'HK',
  HKEX: 'HK',
  LSE: 'L',
  LSEETF: 'L',
  TSEJ: 'T',
  TSEJAPAN: 'T',
  TSE: 'TO',
  TSX: 'TO',
  TSXV: 'V',
  SIX: 'SW',
  FWB: 'DE',
  IBIS: 'DE',
  XETRA: 'DE',
  EPA: 'PA',
  EURONEXT: 'PA',
  AMS: 'AS',
  BME: 'MC',
  MIL: 'MI',
  BOVESPA: 'SA',
  BVMF: 'SA',
  NSE: 'NS',
  BSE: 'BO',
  KRX: 'KS',
  TWSE: 'TW',
  SGX: 'SI',
};

const CURRENCY_SUFFIXES: Record<string, string> = {
  AUD: 'AX',
  CAD: 'TO',
  HKD: 'HK',
  GBP: 'L',
  JPY: 'T',
  KRW: 'KS',
  SGD: 'SI',
  TWD: 'TW',
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

function isPlaceholder(value: string | undefined): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '' || normalized === '-' || normalized === '—' || normalized === '–'
    || normalized === 'n/a' || normalized === 'na' || normalized === 'null';
}

function firstValue(...values: string[]): string {
  return values.find((value) => !isPlaceholder(value)) ?? '';
}

function absoluteDecimal(value: string): string {
  return value.startsWith('-') ? value.slice(1) : value;
}

function parseNumericField(value: string | undefined, places: number, label: string, errors: string[]): string | null {
  if (isPlaceholder(value)) return null;
  const parsed = parseDecimal(value, places);
  if (parsed === null) errors.push(`${label}无效`);
  return parsed;
}

function sourceSymbol(value: string): string {
  if (isPlaceholder(value)) return '';
  return normalizeTicker(value);
}

function exchangeKey(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function qualifyTicker(value: string, exchange: string, currency: string, useCurrencyFallback = true): string {
  const raw = sourceSymbol(value);
  if (!raw || raw.includes('.') || raw.includes(':')) return raw;
  const suffix = EXCHANGE_SUFFIXES[exchangeKey(exchange)]
    ?? (useCurrencyFallback && !isUsCurrency(currency) ? CURRENCY_SUFFIXES[currency] : undefined);
  return suffix ? `${raw}.${suffix}` : raw;
}

function validCurrency(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function inferCurrency(raw: string, description: string, fallback: string, errors: string[]): string {
  if (!isPlaceholder(raw)) {
    const explicit = raw.trim().toUpperCase();
    if (!validCurrency(explicit)) errors.push('币种无效');
    else return explicit;
  }
  const contextual = description.match(/(?:currency|ccy|settled in|in)\s*[:=]?\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase();
  if (contextual && validCurrency(contextual)) return contextual;
  const fallbackCurrency = fallback.trim().toUpperCase();
  return validCurrency(fallbackCurrency) ? fallbackCurrency : 'USD';
}

function actionKind(value: string, amount?: string): 'buy' | 'sell' | LedgerCashEventType | null {
  const normalized = normalizeAction(value);
  return ACTION_ALIASES[normalized]
    ?? ((normalized.includes('dividend reinvest') || normalized.includes('reinvest')) ? 'buy' : null)
    ?? (normalized.includes('dividend') || normalized.includes('payment in lieu') || normalized.includes('股息') ? 'dividend' : null)
    ?? (normalized.includes('interest') || normalized.includes('利息') ? 'interest' : null)
    ?? (normalized.includes('withholding') || normalized.includes('预扣') || normalized.includes('tax') || normalized.includes('税') ? 'tax' : null)
    ?? (normalized.includes('deposit') || normalized.includes('wire received') || normalized.includes('入金') ? 'broker_deposit' : null)
    ?? (normalized.includes('withdrawal') || normalized.includes('wire sent') || normalized.includes('提款') ? 'broker_withdrawal' : null)
    ?? (normalized.includes('forex') || normalized.includes('fx') || normalized.includes('换汇') ? 'fx_transfer' : null)
    ?? (normalized.includes('fee') || normalized.includes('commission') || normalized.includes('费用') || normalized.includes('手续费') ? 'fee' : null)
    ?? (normalized.includes('transfer') ? (amount && Number(amount) < 0 ? 'broker_withdrawal' : 'broker_deposit') : null);
}

function ratioToFx(usdAmount: string, sourceAmount: string): string | null {
  const usd = Math.abs(Number(usdAmount));
  const source = Math.abs(Number(sourceAmount));
  if (!Number.isFinite(usd) || !Number.isFinite(source) || source <= 0) return null;
  return fixedDecimal(String(usd / source), 12);
}

function conversionFor(
  currency: string,
  sourceAmount: string,
  explicitUsdAmount: string | null,
  rawFxRate: string | undefined,
  errors: string[],
): { usdAmount: string; fxRate: string } | null {
  const parsedFx = parseNumericField(rawFxRate, 12, '汇率', errors);
  if (parsedFx !== null && Number(parsedFx) <= 0) errors.push('汇率必须为正数');
  if (isUsCurrency(currency)) {
    if (parsedFx !== null && Math.abs(Number(parsedFx) - 1) > 0.0000001) errors.push('USD 行汇率必须为 1');
    return {
      usdAmount: explicitUsdAmount ?? sourceAmount,
      fxRate: '1',
    };
  }

  let fxRate = parsedFx;
  if (!fxRate && explicitUsdAmount) fxRate = ratioToFx(explicitUsdAmount, sourceAmount);
  if (!fxRate) {
    errors.push('非 USD 行缺少 USD 结算金额或汇率');
    return null;
  }
  const usdAmount = explicitUsdAmount ?? decimalMultiply(sourceAmount, fxRate, 10);
  return { usdAmount, fxRate };
}

function tradeIdentity(
  date: string,
  action: string,
  ticker: string,
  shares: string,
  price: string,
  fees: string,
  amount: string,
  currency: string,
  sourcePrice: string,
  sourceAmount: string,
  fxRate: string,
): string {
  const base = ['ibkr', date, normalizeAction(action), ticker, shares, price, fees, amount];
  return isUsCurrency(currency)
    ? makeImportKey(base)
    : makeImportKey([...base, currency, sourcePrice, sourceAmount, fxRate]);
}

function cashIdentity(
  date: string,
  action: string,
  ticker: string,
  amount: string,
  currency: string,
  sourceAmount: string,
  fxRate: string,
): string {
  const base = ['ibkr', date, normalizeAction(action), ticker, amount, currency];
  return isUsCurrency(currency)
    ? makeImportKey(base)
    : makeImportKey([...base, sourceAmount, fxRate]);
}

type IbkrFields = Partial<Record<ImportRowField, string>>;

const GROSS_PROCEEDS_CONTEXT_KEY = 'amount_is_gross_proceeds';
const BASE_CURRENCY_CONTEXT_KEY = 'base_currency';
const HEADER_DATA_CONTEXT_KEY = 'header_data';

function rowContextFrom(detection: ImportDetection): IbkrRowContext {
  return {
    amountIsGrossProceeds: detection.context?.[GROSS_PROCEEDS_CONTEXT_KEY] === '1',
    defaultCurrency: detection.context?.[BASE_CURRENCY_CONTEXT_KEY] ?? 'USD',
  };
}

function parseIbkrRow(sourceIndex: number, fields: IbkrFields, context: IbkrRowContext): ParsedImportRow {
  const description = (fields.description ?? '').trim();
  const actionText = (fields.action ?? '').trim() || description;
  const rawAmount = (fields.amount ?? '').trim();
  const rawUsdAmount = (fields.usd_amount ?? '').trim();
  const errors: string[] = [];
  const date = parseDate(fields.date ?? '');
  const rawActionAmount = parseNumericField(firstValue(rawAmount, rawUsdAmount), 10, '金额', []);
  const kind = actionKind(actionText, rawActionAmount ?? undefined);
  const currency = inferCurrency(fields.currency ?? '', description, context.defaultCurrency, errors);
  const explicitUsdAmount = parseNumericField(rawUsdAmount, 10, 'USD 金额', errors);
  const sourceAmountCandidate = parseNumericField(rawAmount, 10, '金额', errors) ?? explicitUsdAmount;

  if (!date) errors.push('日期无效');
  if (!kind) errors.push('操作类型无法映射');
  if (sourceAmountCandidate === null) errors.push('缺少金额');

  if (!date || !kind || sourceAmountCandidate === null) {
    return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
  }

  let sourceAmount = sourceAmountCandidate!;
  const parsedFees = parseNumericField(fields.fees, 10, '手续费', errors) ?? '0';
  const feesSource = absoluteDecimal(parsedFees);
  if (Number(feesSource) < 0) errors.push('手续费不能为负数');

  const amountIsGross = context.amountIsGrossProceeds && !explicitUsdAmount;
  if (amountIsGross) sourceAmount = decimalSubtract(sourceAmount, feesSource, 10);

  const conversion = conversionFor(currency, sourceAmount, explicitUsdAmount, fields.fx_rate, errors);
  if (!conversion) {
    return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
  }
  const usdAmount = conversion.usdAmount;
  const fxRate = conversion.fxRate;

  if (kind === 'buy' || kind === 'sell') {
    const parsedShares = parseNumericField(fields.quantity, 10, '股数', errors);
    const sourcePrice = parseNumericField(fields.price, 12, '成交价', errors);
    const ticker = qualifyTicker(fields.symbol ?? '', fields.exchange ?? '', currency);
    const shares = parsedShares ? absoluteDecimal(parsedShares) : null;
    if (!ticker) errors.push('交易缺少证券代码');
    if (!shares || Number(shares) <= 0) errors.push('股数必须为正数');
    if (!sourcePrice || Number(sourcePrice) <= 0) errors.push('成交价必须为正数');
    if (ticker && !/^[A-Z0-9.^-]{1,15}$/.test(ticker)) errors.push('证券代码无效或过长');
    if (Number(feesSource) >= 1000000000000) errors.push('手续费超出数据库精度');
    if (shares && Number(shares) >= 100000000) errors.push('股数超出数据库精度');
    if (sourcePrice && Number(sourcePrice) >= 10000000000) errors.push('成交价超出数据库精度');
    if (Number(usdAmount) === 0) errors.push('交易金额不能为零');

    const canonicalPrice = sourcePrice && !isUsCurrency(currency)
      ? decimalMultiply(sourcePrice, fxRate, 12)
      : sourcePrice;
    const feesUsd = isUsCurrency(currency) ? feesSource : decimalMultiply(feesSource, fxRate, 10);
    const computedAmount = shares && canonicalPrice ? signedTradeAmount(kind, shares, canonicalPrice, feesUsd) : null;
    if (computedAmount && Math.abs(Number(decimalSubtract(usdAmount, computedAmount, 10))) > 0.0200001) {
      errors.push(`金额与成交明细不一致（应约为 ${computedAmount} USD）`);
    }
    if ((kind === 'buy' && Number(usdAmount) >= 0) || (kind === 'sell' && Number(usdAmount) <= 0)) {
      errors.push('交易结算金额方向无效');
    }
    if (errors.length > 0 || !date || !shares || !sourcePrice || !canonicalPrice) {
      return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
    }

    const trade: LedgerTrade = {
      source: 'ibkr',
      source_index: sourceIndex,
      effective_date: date,
      side: kind,
      ticker,
      shares: fixedDecimal(shares, 10),
      price: fixedDecimal(canonicalPrice, 12),
      fees_usd: fixedDecimal(feesUsd, 10),
      usd_amount: fixedDecimal(usdAmount, 10),
      source_currency: currency,
      source_price: fixedDecimal(sourcePrice, 12),
      source_amount: fixedDecimal(sourceAmount, 10),
      fx_rate_to_usd: fixedDecimal(fxRate, 12),
      source_action: actionText,
      source_description: description,
      duplicate_ordinal: 0,
      import_key: tradeIdentity(
        date,
        actionText,
        ticker,
        shares,
        canonicalPrice,
        feesUsd,
        usdAmount,
        currency,
        sourcePrice,
        sourceAmount,
        fxRate,
      ),
    };
    return { source_index: sourceIndex, action: actionText, category: 'trade', default_status: 'import', item: trade };
  }

  const ticker = qualifyTicker(fields.symbol ?? '', fields.exchange ?? '', currency, false);
  const signed = Number(usdAmount);
  if (!Number.isFinite(signed) || signed === 0) errors.push('现金事件金额不能为零');
  if (kind === 'broker_deposit' && signed <= 0) errors.push('入金金额必须为正数');
  if (kind === 'broker_withdrawal' && signed >= 0) errors.push('提款金额必须为负数');
  if ((kind === 'tax' || kind === 'fee') && signed >= 0) errors.push('税费金额必须为负数');
  if (ticker && !/^[A-Z0-9.^-]{1,15}$/.test(ticker)) errors.push('证券代码无效或过长');
  if (errors.length > 0 || !date) {
    return { source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') };
  }

  const cashEvent: LedgerCashEvent = {
    source: 'ibkr',
    source_index: sourceIndex,
    effective_date: date,
    event_type: kind,
    ...(ticker ? { ticker } : {}),
    source_currency: currency,
    source_amount: fixedDecimal(sourceAmount, 10),
    usd_amount: fixedDecimal(usdAmount, 10),
    fx_rate_to_usd: fixedDecimal(fxRate, 12),
    source_action: actionText,
    source_description: description,
    duplicate_ordinal: 0,
    import_key: cashIdentity(date, actionText, ticker, usdAmount, currency, sourceAmount, fxRate),
  };
  return { source_index: sourceIndex, action: actionText, category: 'cash_event', default_status: 'import', item: cashEvent };
}

function isHeaderCandidate(row: string[]): boolean {
  const columns = findColumns(row);
  const hasIbkrMarker = columns.currency !== undefined
    || columns.gross_amount !== undefined
    || columns.net_amount !== undefined
    || columns.fx_rate !== undefined
    || headerMarker(row) !== null
    || row.some((cell) => ['account', 'asset category', 'transaction history', 'trades'].includes(normalizeHeader(cell)));
  return hasIbkrMarker
    && columns.date !== undefined
    && columns.action !== undefined
    && (columns.net_amount !== undefined
      || columns.gross_amount !== undefined
      || columns.amount !== undefined
      || columns.usd_amount !== undefined);
}

function headerMarker(row: string[]): { index: number; section: string } | null {
  const index = row.findIndex((cell) => normalizeHeader(cell) === 'header');
  if (index <= 0) return null;
  return { index, section: normalizeHeader(row[index - 1] ?? '') };
}

function rowMatchesSegment(row: string[], marker: { index: number; section: string } | null): boolean {
  if (!marker) return true;
  return normalizeHeader(row[marker.index] ?? '') === 'data'
    && normalizeHeader(row[marker.index - 1] ?? '') === marker.section;
}

function hasRowSignal(row: string[], columns: Partial<Record<IbkrColumn, number>>): boolean {
  return [
    valueAt(row, columns, 'date'),
    valueAt(row, columns, 'action'),
    valueAt(row, columns, 'symbol'),
    valueAt(row, columns, 'quantity'),
    valueAt(row, columns, 'price'),
    valueAt(row, columns, 'gross_amount'),
    valueAt(row, columns, 'net_amount'),
    valueAt(row, columns, 'amount'),
    valueAt(row, columns, 'usd_amount'),
    valueAt(row, columns, 'description'),
  ].some((value) => !isPlaceholder(value));
}

function isFooterRow(row: string[]): boolean {
  const first = normalizeHeader(row[0] ?? '');
  return first === 'total' || first === 'totals' || first === 'trailer' || first === 'footer';
}

function baseCurrencyFrom(rows: string[][]): string {
  for (const row of rows) {
    const normalized = row.map(normalizeHeader);
    for (let index = 0; index < normalized.length; index += 1) {
      if (normalized[index] === 'base currency' || normalized[index] === 'basecurrency' || normalized[index] === '基础货币' || normalized[index] === '基准币种') {
        const candidate = String(row[index + 1] ?? '').trim().toUpperCase();
        if (validCurrency(candidate)) return candidate;
        const next = String(row[index + 2] ?? '').trim().toUpperCase();
        if (validCurrency(next)) return next;
      }
    }
  }
  return 'USD';
}

function chooseTable(text: string): { table: ReturnType<typeof parseDelimited>; headerIndex: number; columns: Partial<Record<IbkrColumn, number>> } {
  const candidates = IBKR_DELIMITERS.map((delimiter) => {
    const table = parseDelimited(text, delimiter);
    const headerIndex = table.rows.findIndex(isHeaderCandidate);
    return { table, headerIndex, columns: headerIndex >= 0 ? findColumns(table.rows[headerIndex]) : {} };
  });
  return candidates.sort((left, right) => {
    const leftScore = left.headerIndex >= 0 ? 100000 - left.headerIndex * 100 + (left.table.rows[left.headerIndex]?.length ?? 0) : 0;
    const rightScore = right.headerIndex >= 0 ? 100000 - right.headerIndex * 100 + (right.table.rows[right.headerIndex]?.length ?? 0) : 0;
    return rightScore - leftScore;
  })[0];
}

function parseInput(input: ImportInput): IbkrParsedImport {
  const selected = chooseTable(input.text);
  const { table, headerIndex, columns } = selected;
  const headerIndices = table.rows
    .map((row, index) => (isHeaderCandidate(row) ? index : -1))
    .filter((index) => index >= 0);
  const segmented = headerIndex >= 0 && headerIndices.some((index) => !!headerMarker(table.rows[index]));
  const defaultCurrency = baseCurrencyFrom(table.rows);
  const amountHeader = headerIndex >= 0
    ? normalizeHeader(table.rows[headerIndex][columns.net_amount ?? columns.gross_amount ?? columns.amount ?? columns.usd_amount ?? -1] ?? '')
    : '';
  const amountIsGrossProceeds = columns.net_amount === undefined
    && (columns.gross_amount !== undefined || amountHeader === 'proceeds' || amountHeader === '收益');
  const detection: ImportDetection = {
    supported: headerIndex >= 0,
    source: 'ibkr',
    format: segmented ? 'ibkr-transaction-history-header-data' : 'ibkr-activity-statement-or-transaction-history',
    confidence: headerIndex >= 0 ? 'high' : 'low',
    delimiter: table.delimiter,
    header_row: headerIndex >= 0 ? headerIndex + 1 : undefined,
    warnings: headerIndex < 0
      ? []
      : [
        ...(segmented ? ['检测到 IBKR Header/Data 多段文件，已按交易和现金事件分段读取。'] : []),
        ...(columns.currency === undefined ? ['文件未提供独立 Currency 列，未声明币种的行按 Base Currency 或 USD 处理。'] : []),
      ],
    context: {
      [GROSS_PROCEEDS_CONTEXT_KEY]: amountIsGrossProceeds ? '1' : '0',
      [BASE_CURRENCY_CONTEXT_KEY]: defaultCurrency,
      [HEADER_DATA_CONTEXT_KEY]: segmented ? '1' : '0',
    },
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

  for (let segmentIndex = 0; segmentIndex < headerIndices.length; segmentIndex += 1) {
    const segmentHeaderIndex = headerIndices[segmentIndex];
    const segmentColumns = findColumns(table.rows[segmentHeaderIndex]);
    const marker = headerMarker(table.rows[segmentHeaderIndex]);
    const segmentEnd = headerIndices[segmentIndex + 1] ?? table.rows.length;
    const segmentContext: IbkrRowContext = {
      amountIsGrossProceeds: segmentColumns.net_amount === undefined && segmentColumns.gross_amount !== undefined,
      defaultCurrency,
    };
    for (let index = segmentHeaderIndex + 1; index < segmentEnd; index += 1) {
      const row = table.rows[index];
      if (row.every((cell) => cell.trim() === '') || !rowMatchesSegment(row, marker) || isFooterRow(row) || !hasRowSignal(row, segmentColumns)) continue;
      const sourceIndex = index + 1;
      const fields: IbkrFields = {
        date: valueAt(row, segmentColumns, 'date'),
        action: valueAt(row, segmentColumns, 'action'),
        symbol: valueAt(row, segmentColumns, 'symbol'),
        quantity: valueAt(row, segmentColumns, 'quantity'),
        price: valueAt(row, segmentColumns, 'price'),
        fees: valueAt(row, segmentColumns, 'fees'),
        amount: firstValue(
          valueAt(row, segmentColumns, 'net_amount'),
          valueAt(row, segmentColumns, 'amount'),
          valueAt(row, segmentColumns, 'gross_amount'),
        ),
        usd_amount: valueAt(row, segmentColumns, 'usd_amount'),
        currency: valueAt(row, segmentColumns, 'currency'),
        fx_rate: valueAt(row, segmentColumns, 'fx_rate'),
        description: valueAt(row, segmentColumns, 'description'),
      };
      const parsedRow = parseIbkrRow(sourceIndex, fields, segmentContext);
      parsedRow.source_fields = fields;
      if (parsedRow.item) items.push(parsedRow.item);
      rows.push(parsedRow);
    }
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
    const row = parseIbkrRow(sourceIndex, fields, rowContextFrom(detection));
    row.source_fields = fields;
    if (row.item) addDuplicateOrdinals([row.item]);
    return row;
  },
};
