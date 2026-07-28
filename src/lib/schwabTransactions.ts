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

export interface SchwabIgnoredRow {
  sourceIndex: number;
  action: string;
  symbol: string;
  description: string;
  reason: 'unsupported_action' | 'non_positive_cashflow';
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
  ignored: SchwabIgnoredRow[];
  errors: SchwabParseError[];
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
  cashflow_kind?: 'fx_transfer' | 'broker_deposit';
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
}

export interface SchwabExportDeposit {
  id?: string;
  created_at?: string;
  usd_in_date: string;
  usd_amount: number | string;
  source_action: string;
  source_description?: string | null;
}

type ParsedTable = {
  delimiter: SchwabDelimiter;
  data: string[][];
  errors: Papa.ParseError[];
  headerIndex: number;
};

const HEADER_SET = SCHWAB_HEADERS.map(normalizeHeader);
const SYMBOL_PATTERN = /^[A-Z0-9.^-]{1,15}$/;
const MAX_ROWS = 10_000;
const AMOUNT_TOLERANCE_USD = 0.0200001;
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
      ignored: [],
      errors: [{ message: '未找到嘉信交易文件的八列表头。' }],
    };
  }

  const errors: SchwabParseError[] = parsed.errors
    .filter((error) => error.type === 'Quotes')
    .map((error) => ({
      sourceIndex: typeof error.row === 'number' ? error.row + 1 : undefined,
      message: `CSV 引号格式错误：${error.message}`,
    }));
  const ignored: SchwabIgnoredRow[] = [];
  const validRows: Omit<SchwabImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const validDeposits: Omit<SchwabDepositImportRow, 'duplicate_ordinal' | 'import_key'>[] = [];
  const body = parsed.data.slice(parsed.headerIndex + 1);

  if (body.length > MAX_ROWS) {
    errors.push({ message: `文件超过 ${MAX_ROWS} 行上限。` });
  }

  for (let index = 0; index < Math.min(body.length, MAX_ROWS); index += 1) {
    const sourceIndex = parsed.headerIndex + index + 2;
    const cells = padRow(body[index]);
    if (cells.every((cell) => cell.trim() === '')) continue;

    const action = cells[1].trim();
    const side = parseSide(action);
    if (!side) {
      if (isSchwabDepositAction(action)) {
        const depositDate = parseSchwabDate(cells[0]);
        const amount = parseMoneyNumber(cells[7]);
        const rowErrors: string[] = [];
        if (!depositDate) rowErrors.push('日期无效');
        if (!Number.isFinite(amount)) rowErrors.push('入金金额无效');
        if (amount >= 1_000_000_000_000) rowErrors.push('入金金额超出数据库精度');
        if (decimalPlaces(cells[7]) > 2) rowErrors.push('入金金额最多支持 2 位小数');

        if (Number.isFinite(amount) && amount <= 0) {
          ignored.push({
            sourceIndex,
            action,
            symbol: normalizeTicker(cells[2]),
            description: cells[3].trim(),
            reason: 'non_positive_cashflow',
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
    if (decimalPlaces(cells[4]) > 6) rowErrors.push('股数最多支持 6 位小数');
    if (decimalPlaces(cells[5]) > 4) rowErrors.push('成交价最多支持 4 位小数');
    if (cells[6].trim() !== '' && decimalPlaces(cells[6]) > 2) rowErrors.push('手续费最多支持 2 位小数');

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
  const depositDuplicateCounts = new Map<string, number>();
  const deposits = validDeposits.map((row) => {
    const identity = schwabDepositIdentity(row);
    const duplicateOrdinal = (depositDuplicateCounts.get(identity) ?? 0) + 1;
    depositDuplicateCounts.set(identity, duplicateOrdinal);
    return {
      ...row,
      duplicate_ordinal: duplicateOrdinal,
      import_key: schwabDepositImportKey(row, duplicateOrdinal),
    };
  });

  return {
    delimiter: parsed.delimiter,
    headerRow: parsed.headerIndex + 1,
    rows,
    deposits,
    ignored,
    errors,
  };
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

export function buildSchwabImportDiff(
  incoming: SchwabImportRow[],
  existing: ExistingTransactionLike[],
  resetEtfSymbols: ReadonlySet<string>,
  mode: 'append' | 'reset_etf',
): SchwabImportDiff {
  if (mode === 'reset_etf') {
    return {
      added: incoming,
      unchanged: [],
      removed: existing.filter((transaction) =>
        resetEtfSymbols.has(normalizeTicker(transaction.ticker))),
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
  mode: 'append' | 'reset_etf',
): SchwabDepositImportDiff {
  const existingByImportKey = new Map<string, ExistingCashflowLike[]>();
  const existingByIdentity = new Map<string, ExistingCashflowLike[]>();
  for (const cashflow of existing) {
    const isResetRemovedDeposit = mode === 'reset_etf'
      && cashflow.cashflow_kind === 'broker_deposit'
      && cashflow.import_source === 'schwab';
    if (isResetRemovedDeposit) continue;

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

  const removed = mode === 'reset_etf'
    ? existing.filter((cashflow) =>
        cashflow.cashflow_kind === 'broker_deposit'
        && cashflow.import_source === 'schwab')
    : [];
  return { added, unchanged, removed };
}

export function exportSchwabTransactions(
  transactions: SchwabExportTransaction[],
  deposits: SchwabExportDeposit[] = [],
): string {
  const transactionRows = transactions.map((transaction, index) => {
    const shares = Number(transaction.shares);
    const price = Number(transaction.price);
    const fee = Math.max(0, Number(transaction.fees_usd ?? 0) || 0);
    const amount = transaction.side === 'buy'
      ? -(shares * price + fee)
      : shares * price - fee;
    return {
      date: transaction.trade_date,
      createdAt: transaction.created_at ?? '',
      id: transaction.id ?? '',
      sourceOrder: index,
      cells: [
        formatSchwabDate(transaction.trade_date),
        transaction.side === 'buy' ? 'Buy' : 'Sell',
        normalizeTicker(transaction.ticker),
        transaction.source_description?.trim() || `${normalizeTicker(transaction.ticker)} ETF`,
        formatDecimal(shares, 6),
        `$${formatDecimal(price, 4)}`,
        fee > 0 ? `$${fee.toFixed(2)}` : '',
        formatSignedMoney(amount),
      ],
    };
  });
  const depositRows = deposits.map((deposit, index) => ({
    date: deposit.usd_in_date,
    createdAt: deposit.created_at ?? '',
    id: deposit.id ?? '',
    sourceOrder: transactions.length + index,
    cells: [
      formatSchwabDate(deposit.usd_in_date),
      deposit.source_action.trim(),
      '',
      deposit.source_description?.trim() ?? '',
      '',
      '',
      '',
      formatSignedMoney(Number(deposit.usd_amount)),
    ],
  }));
  const body = [...transactionRows, ...depositRows]
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
    Number(input.price).toFixed(4),
    Number(input.shares).toFixed(6),
    Number(input.fees_usd ?? 0).toFixed(2),
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
    Number(input.amount).toFixed(2),
  ].join('|');
}

export function schwabDepositImportKey(
  input: Parameters<typeof schwabDepositIdentity>[0],
  duplicateOrdinal: number,
): string {
  return `${schwabDepositIdentity(input)}|${duplicateOrdinal}`;
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
    const headerIndex = data.findIndex(isSchwabHeader);
    if (headerIndex >= 0) {
      candidates.push({ delimiter, data, errors: result.errors, headerIndex });
    }
  }
  return candidates.sort((left, right) => left.headerIndex - right.headerIndex)[0] ?? null;
}

function isSchwabHeader(row: string[]): boolean {
  if (row.length < SCHWAB_HEADERS.length) return false;
  return HEADER_SET.every((header, index) => normalizeHeader(row[index]) === header);
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function padRow(row: string[]): string[] {
  return Array.from({ length: SCHWAB_HEADERS.length }, (_, index) => String(row[index] ?? ''));
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

function formatSignedMoney(value: number): string {
  const absolute = `$${Math.abs(value).toFixed(2)}`;
  return value < 0 ? `-${absolute}` : absolute;
}

function schwabDepositAmountIdentity(input: {
  deposit_date: string;
  amount: number | string;
}): string {
  return `${input.deposit_date}|${Number(input.amount).toFixed(2)}`;
}

function existingDepositIdentity(input: ExistingCashflowLike): string {
  return `${input.usd_in_date}|${Number(input.usd_amount).toFixed(2)}`;
}
