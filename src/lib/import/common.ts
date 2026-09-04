import Papa from 'papaparse';
import type {
  AuditOptions,
  ImportPreview,
  ImportRowStatus,
  LedgerCashEvent,
  ImportReconciliation,
  LedgerTrade,
  NormalizedLedger,
  ParsedImport,
  ParsedImportRow,
  ImportDelimiter,
} from './types.ts';

export interface CsvTable {
  rows: string[][];
  errors: Papa.ParseError[];
  delimiter: ImportDelimiter;
}

export function parseDelimited(text: string, delimiter: ImportDelimiter): CsvTable {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    delimiter,
    skipEmptyLines: false,
  });
  return {
    rows: result.data.map((row) => row.map((cell) => String(cell ?? ''))),
    errors: result.errors,
    delimiter,
  };
}

export function findHeader(
  rows: string[][],
  matches: (row: string[]) => boolean,
): number {
  return rows.findIndex(matches);
}

export function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAction(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeTradingViewSymbol(value: string): {
  ticker: string;
  currency: string;
  isCash: boolean;
} {
  const normalized = normalizeTicker(value);
  const separator = normalized.indexOf(':');
  if (separator < 0) {
    return { ticker: normalized, currency: 'USD', isCash: false };
  }
  const prefix = normalized.slice(0, separator) || 'USD';
  const ticker = normalized.slice(separator + 1);
  const isCash = prefix === ticker;
  if (isCash) return { ticker: '', currency: prefix, isCash: true };
  // TradingView uses the exchange as the prefix for securities (for example
  // NASDAQ:VGT); those US exchange-qualified symbols settle in USD.
  return { ticker, currency: 'USD', isCash: false };
}

export function parseDate(value: string): string | null {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validDate(iso[1], iso[2], iso[3]);
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return validDate(compact[1], compact[2], compact[3]);
  const slashIso = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slashIso) return validDate(slashIso[1], slashIso[2].padStart(2, '0'), slashIso[3].padStart(2, '0'));
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return validDate(us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0'));
  return null;
}

function validDate(year: string, month: string, day: string): string | null {
  const candidate = `${year}-${month}-${day}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate
    ? null
    : candidate;
}

export function parseDecimal(value: string | undefined, maxPlaces: number): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[,$£€]/g, '')
    .replace(/\s+/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const unsigned = normalized.replace(/^[+-]/, '');
  const [, fraction = ''] = unsigned.split('.');
  if (fraction.length > maxPlaces) return null;
  const negative = normalized.startsWith('-');
  const [whole, fractional = ''] = unsigned.split('.');
  const cleanWhole = whole.replace(/^0+(?=\d)/, '') || '0';
  const cleanFraction = fractional.replace(/0+$/, '');
  if (cleanWhole === '0' && cleanFraction === '') return '0';
  return `${negative ? '-' : ''}${cleanWhole}${cleanFraction ? `.${cleanFraction}` : ''}`;
}

export function fixedDecimal(value: string, places: number): string {
  const parsed = parseDecimal(value, places);
  if (parsed === null) throw new Error(`invalid decimal: ${value}`);
  const negative = parsed.startsWith('-');
  const unsigned = parsed.replace(/^-/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return `${negative ? '-' : ''}${whole}.${fraction.padEnd(places, '0')}`;
}

interface DecimalParts {
  negative: boolean;
  digits: bigint;
  scale: number;
}

function decimalParts(value: string): DecimalParts {
  const parsed = parseDecimal(value, 30);
  if (parsed === null) throw new Error(`invalid decimal: ${value}`);
  const negative = parsed.startsWith('-');
  const unsigned = parsed.replace(/^-/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  return { negative, digits: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function formatScaled(digits: bigint, scale: number, places: number): string {
  const negative = digits < 0n;
  const absolute = negative ? -digits : digits;
  const target = 10n ** BigInt(places);
  let rounded = absolute;
  if (scale > places) {
    const divisor = 10n ** BigInt(scale - places);
    const remainder = rounded % divisor;
    rounded /= divisor;
    if (remainder * 2n >= divisor) rounded += 1n;
  } else if (scale < places) {
    rounded *= 10n ** BigInt(places - scale);
  }
  const whole = rounded / target;
  const fraction = String(rounded % target).padStart(places, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function decimalAdd(left: string, right: string, places = 10): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.scale, b.scale);
  const leftDigits = (a.negative ? -a.digits : a.digits) * 10n ** BigInt(scale - a.scale);
  const rightDigits = (b.negative ? -b.digits : b.digits) * 10n ** BigInt(scale - b.scale);
  return formatScaled(leftDigits + rightDigits, scale, places);
}

export function decimalSubtract(left: string, right: string, places = 10): string {
  return decimalAdd(left, right.startsWith('-') ? right.slice(1) : `-${right}`, places);
}

export function decimalMultiply(left: string, right: string, places = 10): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const digits = a.digits * b.digits * (a.negative === b.negative ? 1n : -1n);
  return formatScaled(digits, a.scale + b.scale, places);
}

export function decimalDivide(left: string, right: string, places = 10): string {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (b.digits === 0n) throw new Error('division by zero');

  const denominator = b.digits * 10n ** BigInt(a.scale);
  const numerator = a.digits * 10n ** BigInt(b.scale + places);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) quotient += 1n;

  const target = 10n ** BigInt(places);
  const whole = quotient / target;
  const fraction = String(quotient % target).padStart(places, '0');
  const negative = a.negative !== b.negative && quotient !== 0n;
  return places > 0
    ? `${negative ? '-' : ''}${whole}.${fraction}`
    : `${negative ? '-' : ''}${whole}`;
}

export function signedTradeAmount(
  side: 'buy' | 'sell',
  shares: string,
  price: string,
  fees: string,
): string {
  const gross = decimalMultiply(shares, price, 10);
  return side === 'buy'
    ? decimalSubtract('0', decimalAdd(gross, fees, 10), 10)
    : decimalSubtract(gross, fees, 10);
}

export function makeImportKey(parts: Array<string | number>): string {
  return parts.map((part) => String(part).trim()).join('|');
}

/**
 * Appends a running per-key ordinal to every item's import key, so two rows
 * that normalize to the same identity (a genuine in-file repeat, or a fixed
 * row whose corrected content now matches another row) stay distinguishable.
 * Always appends `|ordinal`, including `|1` for the first occurrence, to
 * match the keys already written by earlier imports.
 */
export function addDuplicateOrdinals(items: Array<LedgerTrade | LedgerCashEvent>): void {
  const counts = new Map<string, number>();
  for (const item of items) {
    const base = item.import_key;
    const ordinal = (counts.get(base) ?? 0) + 1;
    counts.set(base, ordinal);
    item.duplicate_ordinal = ordinal;
    item.import_key = `${base}|${ordinal}`;
  }
}

export function isUsCurrency(value: string | undefined): boolean {
  return (value ?? 'USD').trim().toUpperCase() === 'USD';
}

export function buildImportPreview(
  parsed: ParsedImport,
  normalized: NormalizedLedger,
  options: AuditOptions = {},
): ImportPreview {
  const existing = options.existing_import_keys ?? new Set<string>();
  const rows = parsed.rows.map((row) => {
    const duplicate = row.default_status === 'import'
      && !!row.item
      && existing.has(row.item.import_key);
    return {
      ...row,
      status: duplicate ? 'duplicate' : row.default_status,
    } as const;
  });
  const statusCounts: Record<ImportRowStatus, number> = {
    import: 0,
    duplicate: 0,
    ignore: 0,
    block: 0,
  };
  for (const row of rows) statusCounts[row.status] += 1;
  const errors = rows
    .filter((row) => row.status === 'block')
    .map((row) => `第 ${row.source_index} 行：${row.reason ?? '无法导入'}`);
  const inFileDuplicateWarnings = rows
    .filter((row) => row.item && row.item.duplicate_ordinal > 1)
    .map((row) => `第 ${row.source_index} 行与文件内前一行身份相同，保留第 ${row.item!.duplicate_ordinal} 次 source ordinal 以避免丢失重复执行。`);
  const reconciliation = buildReconciliation(normalized);
  const reconciliationWarnings = Number(reconciliation.ending_cash_usd) < -0.00000001
    ? [`按当前保留行计算的期末现金为 ${reconciliation.ending_cash_usd} USD，请检查遗漏的入金、提款或被忽略的现金事件。`]
    : [];
  return {
    source: parsed.detection.source,
    format: parsed.detection.format,
    mode: options.mode ?? 'append',
    detection: parsed.detection,
    trades: normalized.trades,
    cash_events: normalized.cash_events,
    reconciliation,
    rows,
    warnings: [...parsed.detection.warnings, ...parsed.warnings, ...inFileDuplicateWarnings, ...reconciliationWarnings],
    errors,
    can_commit: errors.length === 0 && (statusCounts.import + statusCounts.duplicate) > 0,
    status_counts: statusCounts,
  };
}

export function buildReconciliation(ledger: NormalizedLedger): ImportReconciliation {
  const endingShares = new Map<string, string>();
  const cashByKind = new Map<LedgerCashEvent['event_type'], string>();
  let endingCash = '0.0000000000';
  let investorInflows = '0.0000000000';
  let investorOutflows = '0.0000000000';
  const externalKinds = new Set<LedgerCashEvent['event_type']>([
    'fx_transfer',
    'broker_deposit',
    'broker_withdrawal',
    'stock_allocation',
  ]);

  for (const trade of ledger.trades) {
    endingCash = decimalAdd(endingCash, trade.usd_amount, 10);
    const signedShares = trade.side === 'buy' ? trade.shares : `-${trade.shares}`;
    endingShares.set(
      trade.ticker,
      decimalAdd(endingShares.get(trade.ticker) ?? '0', signedShares, 10),
    );
  }
  for (const event of ledger.cash_events) {
    endingCash = decimalAdd(endingCash, event.usd_amount, 10);
    cashByKind.set(
      event.event_type,
      decimalAdd(cashByKind.get(event.event_type) ?? '0', event.usd_amount, 10),
    );
    if (externalKinds.has(event.event_type)) {
      if (event.usd_amount.startsWith('-')) investorOutflows = decimalAdd(investorOutflows, event.usd_amount.slice(1), 10);
      else investorInflows = decimalAdd(investorInflows, event.usd_amount, 10);
    }
  }

  return {
    ending_shares: Object.fromEntries(
      [...endingShares.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ticker, shares]) => [ticker, fixedDecimal(shares, 10)]),
    ),
    cash_by_kind: Object.fromEntries(
      [...cashByKind.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    ending_cash_usd: fixedDecimal(endingCash, 10),
    investor_inflows_usd: fixedDecimal(investorInflows, 10),
    investor_outflows_usd: fixedDecimal(investorOutflows, 10),
  };
}

export function rowsForItems(
  rows: ParsedImportRow[],
): { trades: LedgerTrade[]; cash_events: LedgerCashEvent[] } {
  const trades: LedgerTrade[] = [];
  const cash_events: LedgerCashEvent[] = [];
  for (const row of rows) {
    if (!row.item) continue;
    const item = row.item;
    if ('side' in item) trades.push(item);
    else cash_events.push(item);
  }
  return { trades, cash_events };
}
