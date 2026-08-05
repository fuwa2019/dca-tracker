import Papa from 'papaparse';

export const SCHWAB_HEADERS = [
  'Date',
  'Action',
  'Symbol',
  'Description',
  'Quantity',
  'Price',
  'Fees & Comm',
  'Amount',
] as const;

export const PORTFOLIO_CSV_HEADERS = [
  'Symbol',
  'Side',
  'Qty',
  'Fill Price',
  'Commission',
  'Closing Time',
] as const;

export type SchwabDelimiter = '\t' | ',';
export type SchwabImportKind = 'dca' | 'lumpsum';
export type SchwabSymbolClassification = 'etf' | 'stock' | 'unknown';

export interface SchwabImportRow {
  source_index: number;
  trade_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  source_description: string;
  shares: number;
  price: number;
  fees_usd: number;
  amount: number;
  duplicate_ordinal: number;
  import_key: string;
  kind: SchwabImportKind;
}

export interface SchwabDepositImportRow {
  source_index: number;
  deposit_date: string;
  source_action: string;
  source_description: string;
  amount: number;
  duplicate_ordinal: number;
  import_key: string;
}

export interface SchwabStockAllocationImportRow {
  source_index: number;
  allocation_date: string;
  source_action: 'Stock Allocation';
  source_description: string;
  /** Negative USD leaves the retained ETF sleeve on the stock trade date. */
  amount: number;
  duplicate_ordinal: number;
  import_key: string;
}

export interface SchwabIgnoredRow {
  sourceIndex: number;
  action: string;
  symbol: string;
  description: string;
  reason: 'unsupported_action';
}

export interface SchwabParseError {
  sourceIndex?: number;
  message: string;
}

export interface SchwabParseResult {
  delimiter: SchwabDelimiter | null;
  headerRow: number | null;
  rows: SchwabImportRow[];
  deposits: SchwabDepositImportRow[];
  allocations: SchwabStockAllocationImportRow[];
  ignored: SchwabIgnoredRow[];
  errors: SchwabParseError[];
}

export interface SchwabEtfCashPlan {
  deposits: SchwabDepositImportRow[];
  allocations: SchwabStockAllocationImportRow[];
  grossDeposits: number;
  excludedStockFunding: number;
  adjustedDeposits: number;
  endingCash: number;
  minimumCash: number;
  errors: SchwabParseError[];
  warnings: SchwabParseError[];
}

export interface ExistingTransactionLike {
  id: string;
  trade_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
}

export interface SchwabImportDiff {
  added: SchwabImportRow[];
  unchanged: Array<{ row: SchwabImportRow; existingId: string }>;
  removed: ExistingTransactionLike[];
}

export interface ExistingCashflowLike {
  id: string;
  usd_in_date: string | null;
  usd_amount: number | string | null;
  cashflow_kind?: 'fx_transfer' | 'broker_deposit' | 'stock_allocation';
  import_source?: string | null;
  import_key?: string | null;
}

export interface SchwabDepositImportDiff {
  added: SchwabDepositImportRow[];
  unchanged: Array<{ row: SchwabDepositImportRow; existingId: string }>;
  removed: ExistingCashflowLike[];
}

export interface SchwabExportTransaction {
  id?: string;
  created_at?: string;
  trade_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  source_description?: string | null;
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
  settled_amount_usd?: number | string | null;
}

export interface SchwabExportCashflow {
  id?: string;
  created_at?: string;
  usd_in_date: string;
  usd_amount: number | string;
  source_action: string;
  source_description?: string | null;
  cashflow_kind?: 'broker_deposit' | 'stock_allocation';
}

type ParsedTable = {
  delimiter: SchwabDelimiter;
  data: string[][];
  errors: Papa.ParseError[];
  headerIndex: number;
  format: 'schwab' | 'portfolio_csv';
};

const HEADER_SET = SCHWAB_HEADERS.map(normalizeHeader);
const PORTFOLIO_CSV_HEADER_SET = PORTFOLIO_CSV_HEADERS.map(normalizeHeader);
const SYMBOL_PATTERN = /^[A-Z0-9.^-]{1,15}$/;
const MAX_ROWS = 10_000;
const AMOUNT_TOLERANCE_USD = 0.0200001;
const SHARES_DECIMAL_PLACES = 10;
const PRICE_DECIMAL_PLACES = 12;
const FEES_DECIMAL_PLACES = 10;
const CASH_DECIMAL_PLACES = 10;
const CASH_TOLERANCE_USD = 0.00000001;
const STOCK_ALLOCATION_ACTION = 'stock allocation';
const SCHWAB_DEPOSIT_ACTIONS = new Set([
  'ach transfer',
  'cash deposit',
  'cash transfer',
  'deposit',
  'direct deposit',
  'electronic funds transfer',
  'funds received',
  'moneylink transfer',
  'wire received',
]);

export function parseSchwabTransactions(text: string): SchwabParseResult {
  const normalizedText = text.replace(/^\uFEFF/, '');
  const parsed = chooseParsedTable(normalizedText);
  if (!parsed) {
    return {
      delimiter: null,
      headerRow: null,
      rows: [],
      deposits: [],
      allocations: [],
      ignored: [],
      errors: [{ message: '未找到支持的交易文件表头。' }],
    };
  }

  const errors = parseTableErrors(parsed);
  if (parsed.format === 'portfolio_csv') {
    return parsePortfolioCsvTransactions(parsed, errors);
  }

  const ignored: SchwabIgnoredRow[] = [];
  const validRows: Omit<SchwabImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const validDeposits: Omit<SchwabDepositImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const validAllocations: Omit<SchwabStockAllocationImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const body = parsed.data.slice(parsed.headerIndex + 1);

  if (body.length > MAX_ROWS) {
    errors.push({ message: `文件超过 ${MAX_ROWS} 行上限。` });
  }

  for (let index = 0; index < Math.min(body.length, MAX_ROWS); index += 1) {
    const sourceIndex = parsed.headerIndex + index + 2;
    const cells = padRow(body[index], SCHWAB_HEADERS.length);
    if (cells.every((cell) => cell.trim() === '')) continue;

    const action = cells[1].trim();
    const side = parseSide(action);
    if (!side) {
      if (normalizeAction(action) === STOCK_ALLOCATION_ACTION) {
        const allocationDate = parseSchwabDate(cells[0]);
        const amount = parseMoneyNumber(cells[7]);
        const rowErrors: string[] = [];
        if (!allocationDate) rowErrors.push('日期无效');
        if (!Number.isFinite(amount) || amount >= 0) rowErrors.push('个股资金划转必须为负数');
        if (Math.abs(amount) >= 1_000_000_000_000) rowErrors.push('个股资金划转金额超出数据库精度');
        if (decimalPlaces(cells[7]) > CASH_DECIMAL_PLACES) {
          rowErrors.push(`个股资金划转金额最多支持 ${CASH_DECIMAL_PLACES} 位小数`);
        }
        if (rowErrors.length > 0 || !allocationDate) {
          errors.push({ sourceIndex, message: `第 ${sourceIndex} 行：${rowErrors.join('；')}` });
          continue;
        }
        validAllocations.push({
          source_index: sourceIndex,
          allocation_date: allocationDate,
          source_action: 'Stock Allocation',
          source_description: cells[3].trim(),
          amount,
        });
        continue;
      }
      if (isSchwabDepositAction(action)) {
        const depositDate = parseSchwabDate(cells[0]);
        const amount = parseMoneyNumber(cells[7]);
        const rowErrors: string[] = [];
        if (!depositDate) rowErrors.push('日期无效');
        if (!Number.isFinite(amount)) rowErrors.push('入金金额无效');
        if (amount >= 1_000_000_000_000) rowErrors.push('入金金额超出数据库精度');
        if (decimalPlaces(cells[7]) > CASH_DECIMAL_PLACES) {
          rowErrors.push(`入金金额最多支持 ${CASH_DECIMAL_PLACES} 位小数`);
        }

        if (Number.isFinite(amount) && amount <= 0) {
          ignored.push({
            sourceIndex,
            action,
            symbol: normalizeTicker(cells[2]),
            description: cells[3].trim(),
            reason: 'unsupported_action',
          });
          continue;
        }
        if (rowErrors.length > 0 || !depositDate) {
          errors.push({ sourceIndex, message: `第 ${sourceIndex} 行：${rowErrors.join('；')}` });
          continue;
        }
        validDeposits.push({
          source_index: sourceIndex,
          deposit_date: depositDate,
          source_action: action,
          source_description: cells[3].trim(),
          amount,
        });
        continue;
      }
      ignored.push({
        sourceIndex,
        action,
        symbol: normalizeTicker(cells[2]),
        description: cells[3].trim(),
        reason: 'unsupported_action',
      });
      continue;
    }

    const rowErrors: string[] = [];
    const tradeDate = parseSchwabDate(cells[0]);
    const ticker = normalizeTicker(cells[2]);
    const shares = parseMoneyNumber(cells[4]);
    const price = parseMoneyNumber(cells[5]);
    const feesUsd = cells[6].trim() === '' ? 0 : parseMoneyNumber(cells[6]);
    const amount = parseMoneyNumber(cells[7]);

    if (!tradeDate) rowErrors.push('日期无效');
    if (!SYMBOL_PATTERN.test(ticker)) rowErrors.push('证券代码无效');
    if (!isPositiveFinite(shares)) rowErrors.push('股数必须为正数');
    if (!isPositiveFinite(price)) rowErrors.push('成交价必须为正数');
    if (!Number.isFinite(feesUsd) || feesUsd < 0) rowErrors.push('手续费不能为负数');
    if (shares >= 100_000_000) rowErrors.push('股数超出数据库精度');
    if (price >= 10_000_000_000) rowErrors.push('成交价超出数据库精度');
    if (feesUsd >= 1_000_000_000_000) rowErrors.push('手续费超出数据库精度');
    if (!Number.isFinite(amount)) rowErrors.push('金额无效');
    if (Number.isFinite(amount) && Math.abs(amount) >= 1_000_000_000_000) {
      rowErrors.push('金额超出数据库精度');
    }
    if (side === 'buy' && Number.isFinite(amount) && amount >= 0) rowErrors.push('买入金额必须为负数');
    if (side === 'sell' && Number.isFinite(amount) && amount <= 0) rowErrors.push('卖出金额必须为正数');
    if (
      side === 'sell'
      && Number.isFinite(shares)
      && Number.isFinite(price)
      && Number.isFinite(feesUsd)
      && feesUsd >= shares * price
    ) {
      rowErrors.push('卖出手续费必须小于成交额');
    }
    if (decimalPlaces(cells[4]) > SHARES_DECIMAL_PLACES) {
      rowErrors.push(`股数最多支持 ${SHARES_DECIMAL_PLACES} 位小数`);
    }
    if (decimalPlaces(cells[5]) > PRICE_DECIMAL_PLACES) {
      rowErrors.push(`成交价最多支持 ${PRICE_DECIMAL_PLACES} 位小数`);
    }
    if (cells[6].trim() !== '' && decimalPlaces(cells[6]) > FEES_DECIMAL_PLACES) {
      rowErrors.push(`手续费最多支持 ${FEES_DECIMAL_PLACES} 位小数`);
    }
    if (decimalPlaces(cells[7]) > CASH_DECIMAL_PLACES) {
      rowErrors.push(`金额最多支持 ${CASH_DECIMAL_PLACES} 位小数`);
    }

    if (
      rowErrors.length === 0
      && tradeDate
      && Number.isFinite(shares)
      && Number.isFinite(price)
      && Number.isFinite(feesUsd)
      && Number.isFinite(amount)
    ) {
      const expected = side === 'buy'
        ? -(shares * price + feesUsd)
        : shares * price - feesUsd;
      if (Math.abs(amount - expected) > AMOUNT_TOLERANCE_USD) {
        rowErrors.push(`金额与成交明细不一致（应约为 ${formatSignedMoney(expected)}）`);
      }
    }

    if (rowErrors.length > 0 || !tradeDate) {
      errors.push({ sourceIndex, message: `第 ${sourceIndex} 行：${rowErrors.join('；')}` });
      continue;
    }

    validRows.push({
      source_index: sourceIndex,
      trade_date: tradeDate,
      side,
      ticker,
      source_description: cells[3].trim(),
      shares,
      price,
      fees_usd: feesUsd,
      amount,
      kind: 'dca',
    });
  }

  return finalizeParseResult(parsed, errors, ignored, validRows, validDeposits, validAllocations);
}

function parsePortfolioCsvTransactions(
  parsed: ParsedTable,
  errors: SchwabParseError[],
): SchwabParseResult {
  const ignored: SchwabIgnoredRow[] = [];
  const validRows: Omit<SchwabImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const validDeposits: Omit<SchwabDepositImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const body = parsed.data.slice(parsed.headerIndex + 1);

  if (body.length > MAX_ROWS) {
    errors.push({ message: `文件超过 ${MAX_ROWS} 行上限。` });
  }

  for (let index = 0; index < Math.min(body.length, MAX_ROWS); index += 1) {
    const sourceIndex = parsed.headerIndex + index + 2;
    const cells = padRow(body[index], PORTFOLIO_CSV_HEADERS.length);
    if (cells.every((cell) => cell.trim() === '')) continue;

    const action = cells[1].trim();
    const side = parseSide(action);
    if (!side) {
      if (normalizeAction(action) === 'deposit') {
        const depositDate = parsePortfolioCsvDate(cells[5]);
        const amount = parseMoneyNumber(cells[2]);
        const rowErrors: string[] = [];
        if (!depositDate) rowErrors.push('日期无效');
        if (!isPositiveFinite(amount)) rowErrors.push('存款金额必须为正数');
        if (amount >= 1_000_000_000_000) rowErrors.push('存款金额超出数据库精度');
        if (decimalPlaces(cells[2]) > CASH_DECIMAL_PLACES) {
          rowErrors.push(`存款金额最多支持 ${CASH_DECIMAL_PLACES} 位小数`);
        }
        if (rowErrors.length > 0 || !depositDate) {
          errors.push({ sourceIndex, message: `第 ${sourceIndex} 行：${rowErrors.join('；')}` });
          continue;
        }
        validDeposits.push({
          source_index: sourceIndex,
          deposit_date: depositDate,
          source_action: 'Deposit',
          source_description: '',
          amount,
        });
        continue;
      }
      ignored.push({
        sourceIndex,
        action,
        symbol: normalizePortfolioTicker(cells[0]),
        description: '',
        reason: 'unsupported_action',
      });
      continue;
    }

    const rowErrors: string[] = [];
    const tradeDate = parsePortfolioCsvDate(cells[5]);
    const ticker = normalizePortfolioTicker(cells[0]);
    const shares = parseMoneyNumber(cells[2]);
    const price = parseMoneyNumber(cells[3]);
    const feesUsd = cells[4].trim() === '' ? 0 : parseMoneyNumber(cells[4]);

    if (!tradeDate) rowErrors.push('日期无效');
    if (!SYMBOL_PATTERN.test(ticker)) rowErrors.push('证券代码无效');
    if (!isPositiveFinite(shares)) rowErrors.push('股数必须为正数');
    if (!isPositiveFinite(price)) rowErrors.push('成交价必须为正数');
    if (!Number.isFinite(feesUsd) || feesUsd < 0) rowErrors.push('手续费不能为负数');
    if (shares >= 100_000_000) rowErrors.push('股数超出数据库精度');
    if (price >= 10_000_000_000) rowErrors.push('成交价超出数据库精度');
    if (feesUsd >= 1_000_000_000_000) rowErrors.push('手续费超出数据库精度');
    if (decimalPlaces(cells[2]) > SHARES_DECIMAL_PLACES) {
      rowErrors.push(`股数最多支持 ${SHARES_DECIMAL_PLACES} 位小数`);
    }
    if (decimalPlaces(cells[3]) > PRICE_DECIMAL_PLACES) {
      rowErrors.push(`成交价最多支持 ${PRICE_DECIMAL_PLACES} 位小数`);
    }
    if (cells[4].trim() !== '' && decimalPlaces(cells[4]) > FEES_DECIMAL_PLACES) {
      rowErrors.push(`手续费最多支持 ${FEES_DECIMAL_PLACES} 位小数`);
    }

    const amount = roundCash(side === 'buy'
      ? -(shares * price + feesUsd)
      : shares * price - feesUsd);
    if (!Number.isFinite(amount)) rowErrors.push('金额无效');
    if (Number.isFinite(amount) && Math.abs(amount) >= 1_000_000_000_000) {
      rowErrors.push('金额超出数据库精度');
    }
    if (side === 'sell' && Number.isFinite(feesUsd) && feesUsd >= shares * price) {
      rowErrors.push('卖出手续费必须小于成交额');
    }

    if (rowErrors.length > 0 || !tradeDate) {
      errors.push({ sourceIndex, message: `第 ${sourceIndex} 行：${rowErrors.join('；')}` });
      continue;
    }

    validRows.push({
      source_index: sourceIndex,
      trade_date: tradeDate,
      side,
      ticker,
      source_description: '',
      shares,
      price,
      fees_usd: feesUsd,
      amount,
      kind: 'dca',
    });
  }

  return finalizeParseResult(parsed, errors, ignored, validRows, validDeposits, []);
}

function finalizeParseResult(
  parsed: ParsedTable,
  errors: SchwabParseError[],
  ignored: SchwabIgnoredRow[],
  validRows: Omit<SchwabImportRow, 'duplicate_ordinal' | 'import_key'>[],
  validDeposits: Omit<SchwabDepositImportRow, 'duplicate_ordinal' | 'import_key'>[],
  validAllocations: Omit<SchwabStockAllocationImportRow, 'duplicate_ordinal' | 'import_key'>[],
): SchwabParseResult {
  const duplicateCounts = new Map<string, number>();
  const rows = validRows.map((row) => {
    const identity = schwabIdentity(row);
    const duplicateOrdinal = (duplicateCounts.get(identity) ?? 0) + 1;
    duplicateCounts.set(identity, duplicateOrdinal);
    return {
      ...row,
      duplicate_ordinal: duplicateOrdinal,
      import_key: schwabImportKey(row, duplicateOrdinal),
    };
  });
  const deposits = finalizeDepositRows(validDeposits);
  const allocations = finalizeAllocationRows(validAllocations);

  return {
    delimiter: parsed.delimiter,
    headerRow: parsed.headerIndex + 1,
    rows,
    deposits,
    allocations,
    ignored,
    errors,
  };
}

function parseTableErrors(parsed: ParsedTable): SchwabParseError[] {
  return parsed.errors
    .filter((error) => error.type === 'Quotes')
    .map((error) => ({
      sourceIndex: typeof error.row === 'number' ? error.row + 1 : undefined,
      message: `CSV 引号格式错误：${error.message}`,
    }));
}

export function classifySchwabSymbol(input: {
  description?: string | null;
  ticker: string;
  knownEtfSymbols?: ReadonlySet<string>;
  providerType?: string | null;
}): SchwabSymbolClassification {
  if (/\bETF\b/i.test(input.description ?? '')) return 'etf';
  if (input.knownEtfSymbols?.has(normalizeTicker(input.ticker))) return 'etf';
  const providerType = (input.providerType ?? '').trim().toUpperCase();
  if (providerType === 'ETF' || providerType.includes('EXCHANGE TRADED FUND')) return 'etf';
  if (
    providerType === 'EQUITY'
    || providerType === 'STOCK'
    || providerType === 'COMMON STOCK'
    || providerType.includes('COMMON EQUITY')
  ) {
    return 'stock';
  }
  return 'unknown';
}

/** Rebuild the retained ETF sleeve cash ledger without moving cash across dates. */
export function buildSchwabEtfCashPlan(input: {
  deposits: SchwabDepositImportRow[];
  etfRows: SchwabImportRow[];
  stockRows: SchwabImportRow[];
  allocations?: SchwabStockAllocationImportRow[];
}): SchwabEtfCashPlan {
  if (input.deposits.length === 0 && input.stockRows.length === 0 && !input.allocations?.length) {
    return {
      deposits: [],
      allocations: [],
      grossDeposits: 0,
      excludedStockFunding: 0,
      adjustedDeposits: 0,
      endingCash: 0,
      minimumCash: 0,
      errors: [],
      warnings: [],
    };
  }

  const deposits = finalizeDepositRows(input.deposits);
  const grossDeposits = sumCash(deposits.map((row) => row.amount));
  const errors: SchwabParseError[] = [];
  const warnings: SchwabParseError[] = [];
  if (input.stockRows.length > 0 && input.allocations?.length) {
    errors.push({ message: '文件同时包含个股交易和已生成的个股资金划转，无法避免重复扣款。' });
  }

  const stockByDate = new Map<string, { buys: number; sells: number }>();
  const stockSourceIndexByDate = new Map<string, number>();
  for (const row of input.stockRows) {
    const totals = stockByDate.get(row.trade_date) ?? { buys: 0, sells: 0 };
    if (row.side === 'buy') totals.buys = roundCash(totals.buys - row.amount);
    else totals.sells = roundCash(totals.sells + row.amount);
    stockByDate.set(row.trade_date, totals);
    stockSourceIndexByDate.set(
      row.trade_date,
      Math.min(stockSourceIndexByDate.get(row.trade_date) ?? row.source_index, row.source_index),
    );
  }
  const stockDates = [...stockByDate.keys()].sort();
  const stockFundingByDate = new Map<string, number>();
  let stockCash = 0;

  for (const date of stockDates) {
    const totals = stockByDate.get(date)!;
    stockCash = roundCash(stockCash + totals.sells);
    const funding = roundCash(Math.max(totals.buys - stockCash, 0));
    stockCash = roundCash(Math.max(stockCash - totals.buys, 0));
    if (funding > CASH_TOLERANCE_USD) stockFundingByDate.set(date, funding);
  }
  const generatedAllocations = finalizeAllocationRows([...stockFundingByDate].map(([date, funding], index) => ({
    source_index: stockSourceIndexByDate.get(date) ?? MAX_ROWS + index + 1,
    allocation_date: date,
    source_action: 'Stock Allocation' as const,
    source_description: '排除个股净投入',
    amount: roundCash(-funding),
  })));
  const allocations = input.stockRows.length > 0
    ? generatedAllocations
    : finalizeAllocationRows(input.allocations ?? []);
  const excludedStockFunding = roundCash(-sumCash(allocations.map((row) => row.amount)));
  const adjustedDeposits = roundCash(grossDeposits - excludedStockFunding);

  const depositByDate = new Map<string, number>();
  for (const row of deposits) {
    depositByDate.set(row.deposit_date, roundCash((depositByDate.get(row.deposit_date) ?? 0) + row.amount));
  }
  const allocationByDate = new Map<string, number>();
  for (const row of allocations) {
    allocationByDate.set(
      row.allocation_date,
      roundCash((allocationByDate.get(row.allocation_date) ?? 0) + row.amount),
    );
  }
  const validationDates = [...new Set([
    ...depositByDate.keys(),
    ...allocationByDate.keys(),
  ])].sort();
  let availableDeposits = 0;
  for (const date of validationDates) {
    availableDeposits = roundCash(
      availableDeposits
      + (depositByDate.get(date) ?? 0)
      + (allocationByDate.get(date) ?? 0),
    );
    if (availableDeposits < -CASH_TOLERANCE_USD) {
      errors.push({
        message: `${date} 的个股净投入缺少 ${formatCash(-availableDeposits)} 已到账存款，无法重建 ETF 现金。`,
      });
      break;
    }
  }

  const etfByDate = new Map<string, number>();
  for (const row of input.etfRows) {
    etfByDate.set(row.trade_date, roundCash((etfByDate.get(row.trade_date) ?? 0) + row.amount));
  }

  const ledgerDates = [...new Set([
    ...depositByDate.keys(),
    ...allocationByDate.keys(),
    ...etfByDate.keys(),
  ])].sort();
  let cash = 0;
  let minimumCash = 0;
  let minimumCashDate: string | null = null;
  for (const date of ledgerDates) {
    cash = roundCash(
      cash
      + (depositByDate.get(date) ?? 0)
      + (allocationByDate.get(date) ?? 0)
      + (etfByDate.get(date) ?? 0),
    );
    if (cash < minimumCash) {
      minimumCash = cash;
      minimumCashDate = date;
    }
  }
  if (minimumCash < -CASH_TOLERANCE_USD && minimumCashDate) {
    warnings.push({
      message: `${minimumCashDate} 的可重建现金最低为 ${formatCash(minimumCash)}。`
        + '文件只把 Deposit 作为现金，未计入的股息、利息等事件可能造成暂时缺口；该提示不阻止导入。',
    });
  }

  return {
    deposits,
    allocations,
    grossDeposits,
    excludedStockFunding,
    adjustedDeposits,
    endingCash: cash,
    minimumCash,
    errors,
    warnings,
  };
}

export function buildSchwabImportDiff(
  incoming: SchwabImportRow[],
  existing: ExistingTransactionLike[],
  mode: 'append' | 'reset_all',
): SchwabImportDiff {
  if (mode === 'reset_all') {
    return {
      added: incoming,
      unchanged: [],
      removed: existing,
    };
  }

  const existingByIdentity = new Map<string, ExistingTransactionLike[]>();
  for (const transaction of existing) {
    const key = schwabIdentity(transaction);
    const rows = existingByIdentity.get(key) ?? [];
    rows.push(transaction);
    existingByIdentity.set(key, rows);
  }
  for (const rows of existingByIdentity.values()) {
    rows.sort((left, right) => left.id.localeCompare(right.id));
  }

  const matchedIds = new Set<string>();
  const added: SchwabImportRow[] = [];
  const unchanged: Array<{ row: SchwabImportRow; existingId: string }> = [];
  for (const row of incoming) {
    const candidates = existingByIdentity.get(schwabIdentity(row)) ?? [];
    const match = candidates.find((candidate) => !matchedIds.has(candidate.id));
    if (match) {
      matchedIds.add(match.id);
      unchanged.push({ row, existingId: match.id });
    } else {
      added.push(row);
    }
  }

  return { added, unchanged, removed: [] };
}

export function buildSchwabDepositImportDiff(
  incoming: SchwabDepositImportRow[],
  existing: ExistingCashflowLike[],
  mode: 'append' | 'reset_all',
): SchwabDepositImportDiff {
  if (mode === 'reset_all') {
    return {
      added: incoming,
      unchanged: [],
      removed: existing,
    };
  }

  const existingByImportKey = new Map<string, ExistingCashflowLike[]>();
  const existingByIdentity = new Map<string, ExistingCashflowLike[]>();
  for (const cashflow of existing) {
    if (cashflow.import_source === 'schwab' && cashflow.import_key) {
      const keyed = existingByImportKey.get(cashflow.import_key) ?? [];
      keyed.push(cashflow);
      existingByImportKey.set(cashflow.import_key, keyed);
    }
    if (cashflow.usd_in_date && Number(cashflow.usd_amount) > 0) {
      const identity = existingDepositIdentity(cashflow);
      const rows = existingByIdentity.get(identity) ?? [];
      rows.push(cashflow);
      existingByIdentity.set(identity, rows);
    }
  }
  for (const rows of [...existingByImportKey.values(), ...existingByIdentity.values()]) {
    rows.sort((left, right) => left.id.localeCompare(right.id));
  }

  const matchedIds = new Set<string>();
  const added: SchwabDepositImportRow[] = [];
  const unchanged: Array<{ row: SchwabDepositImportRow; existingId: string }> = [];
  for (const row of incoming) {
    const keyedCandidates = existingByImportKey.get(row.import_key) ?? [];
    const identityCandidates = existingByIdentity.get(schwabDepositAmountIdentity(row)) ?? [];
    const match = keyedCandidates.find((candidate) => !matchedIds.has(candidate.id))
      ?? identityCandidates.find((candidate) => !matchedIds.has(candidate.id));
    if (match) {
      matchedIds.add(match.id);
      unchanged.push({ row, existingId: match.id });
    } else {
      added.push(row);
    }
  }

  return { added, unchanged, removed: [] };
}

export function exportSchwabTransactions(
  transactions: SchwabExportTransaction[],
  cashflows: SchwabExportCashflow[] = [],
): string {
  const transactionRows = transactions.map((transaction, index) => {
    const shares = Number(transaction.shares);
    const price = Number(transaction.price);
    const fee = Math.max(0, Number(transaction.fees_usd ?? 0) || 0);
    const fallbackAmount = transaction.side === 'buy'
      ? -(shares * price + fee)
      : shares * price - fee;
    const settledAmount = Number(transaction.settled_amount_usd);
    const hasSettledAmount = Number.isFinite(settledAmount)
      && ((transaction.side === 'buy' && settledAmount < 0)
        || (transaction.side === 'sell' && settledAmount > 0));
    const amount = hasSettledAmount ? settledAmount : fallbackAmount;
    return {
      date: transaction.trade_date,
      createdAt: transaction.created_at ?? '',
      id: transaction.id ?? '',
      sourceOrder: index,
      cells: [
        formatSchwabDate(transaction.trade_date),
        transaction.side === 'buy' ? 'Buy' : 'Sell',
        normalizeTicker(transaction.ticker),
        transaction.source_description?.trim() || normalizeTicker(transaction.ticker),
        formatDecimal(shares, SHARES_DECIMAL_PLACES),
        `$${formatDecimal(price, PRICE_DECIMAL_PLACES)}`,
        fee > 0 ? `$${formatDecimal(fee, FEES_DECIMAL_PLACES)}` : '',
        formatSignedMoney(amount, CASH_DECIMAL_PLACES),
      ],
    };
  });
  const cashflowRows = cashflows.map((cashflow, index) => ({
    date: cashflow.usd_in_date,
    createdAt: cashflow.created_at ?? '',
    id: cashflow.id ?? '',
    sourceOrder: transactions.length + index,
    cells: [
      formatSchwabDate(cashflow.usd_in_date),
      cashflow.cashflow_kind === 'stock_allocation'
        ? 'Stock Allocation'
        : cashflow.source_action.trim(),
      '',
      cashflow.source_description?.trim() ?? '',
      '',
      '',
      '',
      formatSignedMoney(Number(cashflow.usd_amount), CASH_DECIMAL_PLACES),
    ],
  }));
  const body = [...transactionRows, ...cashflowRows]
    .sort((left, right) =>
      right.date.localeCompare(left.date)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id)
      || left.sourceOrder - right.sourceOrder)
    .map((row) => row.cells);

  return `\uFEFF${Papa.unparse([Array.from(SCHWAB_HEADERS), ...body], {
    delimiter: '\t',
    newline: '\r\n',
    quotes: false,
  })}\r\n`;
}

export function schwabIdentity(input: {
  trade_date: string;
  side: 'buy' | 'sell';
  ticker: string;
  shares: number | string;
  price: number | string;
  fees_usd?: number | string | null;
}): string {
  return [
    input.trade_date,
    input.side,
    normalizeTicker(input.ticker),
    Number(input.price).toFixed(PRICE_DECIMAL_PLACES),
    Number(input.shares).toFixed(SHARES_DECIMAL_PLACES),
    Number(input.fees_usd ?? 0).toFixed(FEES_DECIMAL_PLACES),
  ].join('|');
}

export function schwabImportKey(
  input: Parameters<typeof schwabIdentity>[0],
  duplicateOrdinal: number,
): string {
  return `${schwabIdentity(input)}|${duplicateOrdinal}`;
}

export function schwabDepositIdentity(input: {
  deposit_date: string;
  source_action: string;
  source_description?: string | null;
  amount: number | string;
}): string {
  return [
    input.deposit_date,
    normalizeAction(input.source_action),
    (input.source_description ?? '').trim(),
    Number(input.amount).toFixed(CASH_DECIMAL_PLACES),
  ].join('|');
}

export function schwabDepositImportKey(
  input: Parameters<typeof schwabDepositIdentity>[0],
  duplicateOrdinal: number,
): string {
  return `${schwabDepositIdentity(input)}|${duplicateOrdinal}`;
}

export function schwabStockAllocationIdentity(input: {
  allocation_date: string;
  source_description?: string | null;
  amount: number | string;
}): string {
  return [
    input.allocation_date,
    STOCK_ALLOCATION_ACTION,
    (input.source_description ?? '').trim(),
    Number(input.amount).toFixed(CASH_DECIMAL_PLACES),
  ].join('|');
}

export function schwabStockAllocationImportKey(
  input: Parameters<typeof schwabStockAllocationIdentity>[0],
  duplicateOrdinal: number,
): string {
  return `${schwabStockAllocationIdentity(input)}|${duplicateOrdinal}`;
}

export function isSchwabDepositAction(action: string): boolean {
  return SCHWAB_DEPOSIT_ACTIONS.has(normalizeAction(action));
}

function chooseParsedTable(text: string): ParsedTable | null {
  const candidates: ParsedTable[] = [];
  for (const delimiter of ['\t', ','] as const) {
    const result = Papa.parse<string[]>(text, {
      delimiter,
      skipEmptyLines: false,
    });
    const data = result.data.map((row) => row.map((cell) => String(cell ?? '')));
    const headerIndex = data.findIndex((row) => getHeaderFormat(row) !== null);
    const format = headerIndex >= 0 ? getHeaderFormat(data[headerIndex]) : null;
    if (format) {
      candidates.push({
        delimiter,
        data,
        errors: result.errors,
        headerIndex,
        format,
      });
    }
  }
  return candidates.sort((left, right) => left.headerIndex - right.headerIndex)[0] ?? null;
}

function getHeaderFormat(row: string[]): ParsedTable['format'] | null {
  if (
    row.length >= SCHWAB_HEADERS.length
    && HEADER_SET.every((header, index) => normalizeHeader(row[index]) === header)
  ) {
    return 'schwab';
  }
  if (
    row.length >= PORTFOLIO_CSV_HEADERS.length
    && PORTFOLIO_CSV_HEADER_SET.every((header, index) => normalizeHeader(row[index]) === header)
  ) {
    return 'portfolio_csv';
  }
  return null;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function padRow(row: string[], length: number): string[] {
  return Array.from({ length }, (_, index) => String(row[index] ?? ''));
}

function parseSide(action: string): 'buy' | 'sell' | null {
  const normalized = normalizeAction(action);
  if (normalized === 'buy') return 'buy';
  if (normalized === 'sell') return 'sell';
  return null;
}

function normalizeAction(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function normalizePortfolioTicker(value: string): string {
  const normalized = normalizeTicker(value);
  return normalized.match(/^[A-Z][A-Z0-9._-]*:([A-Z0-9.^-]{1,15})$/)?.[1] ?? normalized;
}

function parseMoneyNumber(value: string): number {
  const normalized = value
    .trim()
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (normalized === '') return Number.NaN;
  return Number(normalized);
}

function decimalPlaces(value: string): number {
  const normalized = value.trim().replace(/\$/g, '').replace(/,/g, '').replace(/^\((.*)\)$/, '$1');
  const match = normalized.match(/\.(\d+)/);
  return match?.[1].length ?? 0;
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function parseSchwabDate(value: string): string | null {
  const trimmed = value.trim();
  const asOf = trimmed.match(/\bas\s+of\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*$/i);
  const rawDate = asOf?.[1] ?? trimmed.match(/^(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1];
  if (!rawDate) return null;
  const [month, day, year] = rawDate.split('/').map(Number);
  return formatValidatedDate(year, month, day);
}

function parsePortfolioCsvDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return formatValidatedDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function formatValidatedDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatSchwabDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`invalid_trade_date:${isoDate}`);
  return `${match[2]}/${match[3]}/${match[1]}`;
}

function formatDecimal(value: number, maximumFractionDigits: number): string {
  if (!Number.isFinite(value)) throw new Error('invalid_numeric_value');
  return value.toFixed(maximumFractionDigits).replace(/\.?0+$/, '');
}

function formatSignedMoney(value: number, maximumFractionDigits = 2): string {
  const absolute = maximumFractionDigits === 2
    ? `$${Math.abs(value).toFixed(2)}`
    : `$${formatDecimal(Math.abs(value), maximumFractionDigits)}`;
  return value < 0 ? `-${absolute}` : absolute;
}

function formatCash(value: number): string {
  return formatSignedMoney(value, CASH_DECIMAL_PLACES);
}

function roundCash(value: number): number {
  return Number(value.toFixed(CASH_DECIMAL_PLACES));
}

function sumCash(values: number[]): number {
  return roundCash(values.reduce((sum, value) => sum + value, 0));
}

function finalizeDepositRows(
  rows: Array<Omit<SchwabDepositImportRow, 'duplicate_ordinal' | 'import_key'>
    | SchwabDepositImportRow>,
): SchwabDepositImportRow[] {
  const duplicateCounts = new Map<string, number>();
  return rows.map((row) => {
    const identity = schwabDepositIdentity(row);
    const duplicateOrdinal = (duplicateCounts.get(identity) ?? 0) + 1;
    duplicateCounts.set(identity, duplicateOrdinal);
    return {
      ...row,
      duplicate_ordinal: duplicateOrdinal,
      import_key: schwabDepositImportKey(row, duplicateOrdinal),
    };
  });
}

function finalizeAllocationRows(
  rows: Array<Omit<SchwabStockAllocationImportRow, 'duplicate_ordinal' | 'import_key'>
    | SchwabStockAllocationImportRow>,
): SchwabStockAllocationImportRow[] {
  const duplicateCounts = new Map<string, number>();
  return rows.map((row) => {
    const identity = schwabStockAllocationIdentity(row);
    const duplicateOrdinal = (duplicateCounts.get(identity) ?? 0) + 1;
    duplicateCounts.set(identity, duplicateOrdinal);
    return {
      ...row,
      source_action: 'Stock Allocation',
      duplicate_ordinal: duplicateOrdinal,
      import_key: schwabStockAllocationImportKey(row, duplicateOrdinal),
    };
  });
}

function schwabDepositAmountIdentity(input: {
  deposit_date: string;
  amount: number | string;
}): string {
  return `${input.deposit_date}|${Number(input.amount).toFixed(CASH_DECIMAL_PLACES)}`;
}

function existingDepositIdentity(input: ExistingCashflowLike): string {
  return `${input.usd_in_date}|${Number(input.usd_amount).toFixed(CASH_DECIMAL_PLACES)}`;
}
