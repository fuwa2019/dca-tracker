export const SUPPORTED_ETFS = ['VOO', 'VGT', 'SMH', 'QQQ', 'QQQM'] as const;
export type SupportedEtf = typeof SUPPORTED_ETFS[number];

export interface EtfConstituentRow {
  ticker: string;
  weight: number;
}

export interface EtfHoldingSnapshot {
  etfTicker: SupportedEtf;
  provider: 'vanguard' | 'vaneck' | 'invesco';
  sourceUrl: string;
  asOf: string;
  holdings: EtfConstituentRow[];
}

export type EtfHoldingFetchMode = 'live' | 'static-fallback';

export interface EtfHoldingFetchResult {
  snapshot: EtfHoldingSnapshot;
  mode: EtfHoldingFetchMode;
}

type EtfHoldingSource = {
  provider: EtfHoldingSnapshot['provider'];
  url: string;
  headers?: Record<string, string>;
};

const VANECK_SMH_PAGE_URL = 'https://www.vaneck.com/us/en/investments/semiconductor-etf-smh/';

const SOURCES: Record<SupportedEtf, EtfHoldingSource> = {
  VOO: { provider: 'vanguard', url: 'https://investor.vanguard.com/vmf/api/VOO/portfolio-holding/stock.json?start=1&count=20000&asOfType=DAILY' },
  VGT: { provider: 'vanguard', url: 'https://investor.vanguard.com/vmf/api/VGT/portfolio-holding/stock.json?start=1&count=20000&asOfType=DAILY' },
  SMH: {
    provider: 'vaneck',
    url: 'https://www.vaneck.com/Main/HoldingsBlock/GetDataset/?blockId=144458&pageId=233107&ticker=SMH',
    headers: { Referer: VANECK_SMH_PAGE_URL, 'X-Requested-With': 'XMLHttpRequest' },
  },
  QQQ: { provider: 'invesco', url: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/QQQ/holdings/fund?idType=ticker&productType=ETF' },
  QQQM: { provider: 'invesco', url: 'https://dng-api.invesco.com/cache/v1/accounts/en_US/shareclasses/46138G649/holdings/fund?idType=cusip&productType=ETF' },
};

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const SMH_STATIC_FALLBACK_AS_OF = '2026-08-18';
const SMH_STATIC_FALLBACK_HOLDINGS: EtfConstituentRow[] = [
  { ticker: 'NVDA', weight: 0.2218 },
  { ticker: 'TSM', weight: 0.0928 },
  { ticker: 'AVGO', weight: 0.0611 },
  { ticker: 'AMD', weight: 0.0542 },
  { ticker: 'MU', weight: 0.0534 },
  { ticker: 'ASML', weight: 0.0526 },
  { ticker: 'AMAT', weight: 0.0471 },
  { ticker: 'LRCX', weight: 0.0464 },
  { ticker: 'TXN', weight: 0.0439 },
  { ticker: 'ADI', weight: 0.0437 },
  { ticker: 'KLAC', weight: 0.0415 },
  { ticker: 'INTC', weight: 0.0411 },
  { ticker: 'MRVL', weight: 0.0389 },
  { ticker: 'QCOM', weight: 0.0374 },
  { ticker: 'CDNS', weight: 0.0209 },
  { ticker: 'SNPS', weight: 0.0187 },
  { ticker: 'TER', weight: 0.0144 },
  { ticker: 'MPWR', weight: 0.0135 },
  { ticker: 'NXPI', weight: 0.0107 },
  { ticker: 'STM', weight: 0.0101 },
  { ticker: 'ARM', weight: 0.0096 },
  { ticker: 'ALAB', weight: 0.0092 },
  { ticker: 'MCHP', weight: 0.0089 },
  { ticker: 'ON', weight: 0.0056 },
  { ticker: 'SWKS', weight: 0.0018 },
];

export async function fetchEtfHoldingSnapshot(etfTicker: SupportedEtf): Promise<EtfHoldingSnapshot> {
  const source = SOURCES[etfTicker];
  const response = await fetch(source.url, {
    headers: {
      Accept: 'application/json,text/csv;q=0.9,text/html;q=0.8',
      'User-Agent': 'DCA-Tracker/1.0 ETF holdings refresh',
      ...source.headers,
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_SOURCE_BYTES) throw new Error('provider_response_too_large');
  const body = await response.text();
  if (body.length > MAX_SOURCE_BYTES) throw new Error('provider_response_too_large');
  return parseEtfHoldingSource(etfTicker, source.provider, source.url, body);
}

/**
 * Keep the last verified official SMH snapshot usable when VanEck's edge
 * rejects the Worker request. Parser and database errors still fail loudly.
 */
export async function fetchEtfHoldingSnapshotWithFallback(etfTicker: SupportedEtf): Promise<EtfHoldingFetchResult> {
  try {
    return { snapshot: await fetchEtfHoldingSnapshot(etfTicker), mode: 'live' };
  } catch (error) {
    const fallback = staticEtfHoldingSnapshot(etfTicker);
    if (!fallback || !isProviderTransportFailure(error)) throw error;
    console.warn(`[etf-holdings] ${etfTicker} using static official snapshot after provider transport failure`);
    return { snapshot: fallback, mode: 'static-fallback' };
  }
}

export function staticEtfHoldingSnapshot(etfTicker: SupportedEtf): EtfHoldingSnapshot | null {
  if (etfTicker !== 'SMH') return null;
  return {
    etfTicker,
    provider: 'vaneck',
    sourceUrl: SOURCES.SMH.url,
    asOf: SMH_STATIC_FALLBACK_AS_OF,
    holdings: SMH_STATIC_FALLBACK_HOLDINGS.map((row) => ({ ...row })),
  };
}

function isProviderTransportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof TypeError
    || /fetch failed|connection reset|network|timed out|timeout|provider_http_(401|403|408|425|429|5\d\d)/i.test(message);
}

export function parseEtfHoldingSource(
  etfTicker: SupportedEtf,
  provider: EtfHoldingSnapshot['provider'],
  sourceUrl: string,
  body: string,
): EtfHoldingSnapshot {
  const asOf = extractAsOf(body);
  const rows = body.trimStart().startsWith('{') || body.trimStart().startsWith('[')
    ? rowsFromJson(body)
    : body.includes('<tr') || body.includes('<table')
      ? rowsFromHtml(body)
      : rowsFromDelimited(body);
  const holdings = normalizeRows(rows);
  validateHoldings(asOf, holdings);
  return { etfTicker, provider, sourceUrl, asOf, holdings };
}

type RawRow = { ticker: string; weight: string | number };

function rowsFromJson(body: string): RawRow[] {
  const root = JSON.parse(body) as unknown;
  const arrays: unknown[][] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      arrays.push(value);
      for (const child of value.slice(0, 5)) visit(child, depth + 1);
    } else if (typeof value === 'object') {
      for (const child of Object.values(value as Record<string, unknown>)) visit(child, depth + 1);
    }
  };
  visit(root, 0);
  for (const array of arrays.sort((a, b) => b.length - a.length)) {
    const parsed = array.map(rowFromObject).filter((row): row is RawRow => row != null);
    if (parsed.length >= 5) return parsed;
  }
  return [];
}

function rowFromObject(value: unknown): RawRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const ticker = findValue(row, /ticker|symbol|holdingTicker|securityTicker/i);
  const weight = findValue(row, /weight|percent|pct|percentOfFund|percentageOfFund|percentage.*net.*asset/i);
  // Provider JSON fields are percentage points, including values below 1.
  if (ticker == null || weight == null) return null;
  const percentagePoints = String(weight).trim();
  return { ticker: String(ticker), weight: percentagePoints.endsWith('%') ? percentagePoints : `${percentagePoints}%` };
}

function findValue(row: Record<string, unknown>, pattern: RegExp): unknown {
  const key = Object.keys(row).find((candidate) => pattern.test(candidate));
  return key ? row[key] : null;
}

function rowsFromHtml(body: string): RawRow[] {
  const rows: RawRow[] = [];
  let headerTickerIndex = -1;
  let headerWeightIndex = -1;
  for (const match of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => decodeHtml(stripTags(cell[1])).trim());
    const lower = cells.map((cell) => cell.toLowerCase());
    const possibleTickerHeader = lower.findIndex((cell) => /ticker|symbol/.test(cell));
    const possibleWeightHeader = lower.findIndex((cell) => /weight|% of.*asset|percent/.test(cell));
    if (possibleTickerHeader >= 0 && possibleWeightHeader >= 0) {
      headerTickerIndex = possibleTickerHeader;
      headerWeightIndex = possibleWeightHeader;
      continue;
    }
    if (headerTickerIndex >= 0 && headerWeightIndex >= 0 && cells[headerTickerIndex] && cells[headerWeightIndex]) {
      rows.push({ ticker: cells[headerTickerIndex], weight: cells[headerWeightIndex].includes('%') ? cells[headerWeightIndex] : `${cells[headerWeightIndex]}%` });
      continue;
    }
    const tickerIndex = cells.findIndex((cell) => /^[A-Z][A-Z0-9./-]{0,19}$/.test(cell));
    const weightIndex = cells.findIndex((cell, index) => index > tickerIndex && /^-?[\d,.]+\s*%$/.test(cell));
    if (tickerIndex >= 0 && weightIndex > tickerIndex) rows.push({ ticker: cells[tickerIndex], weight: cells[weightIndex] });
  }
  if (rows.length >= 5) return rows;

  // Several provider pages serialize the holdings table into JSON inside HTML.
  for (const match of body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = decodeHtml(match[1]).trim();
    if (!script.startsWith('{') && !script.startsWith('[')) continue;
    try {
      const parsed = rowsFromJson(script);
      if (parsed.length >= 5) return parsed;
    } catch { /* Ignore unrelated script blocks. */ }
  }
  return rows;
}

function rowsFromDelimited(body: string): RawRow[] {
  const lines = body.split(/\r?\n/).filter((line) => line.trim());
  for (let headerIndex = 0; headerIndex < Math.min(lines.length, 30); headerIndex += 1) {
    const delimiter = lines[headerIndex].includes('\t') ? '\t' : ',';
    const headers = parseDelimitedLine(lines[headerIndex], delimiter).map((cell) => cell.toLowerCase());
    const tickerIndex = headers.findIndex((cell) => /ticker|symbol/.test(cell));
    const weightIndex = headers.findIndex((cell) => /weight|% of.*asset|percent/.test(cell));
    if (tickerIndex < 0 || weightIndex < 0) continue;
    return lines.slice(headerIndex + 1).map((line) => {
      const cells = parseDelimitedLine(line, delimiter);
      return { ticker: cells[tickerIndex] ?? '', weight: cells[weightIndex] ?? '' };
    });
  }
  return [];
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"' && quoted) { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function normalizeRows(rows: RawRow[]): EtfConstituentRow[] {
  const byTicker = new Map<string, number>();
  for (const row of rows) {
    const ticker = normalizeConstituentTicker(row.ticker);
    const weight = parseWeight(row.weight);
    if (!ticker || weight <= 0 || weight > 1) continue;
    if (byTicker.has(ticker)) throw new Error(`duplicate_ticker_${ticker}`);
    byTicker.set(ticker, weight);
  }
  return [...byTicker].map(([ticker, weight]) => ({ ticker, weight })).sort((a, b) => b.weight - a.weight);
}

export function normalizeConstituentTicker(input: string): string | null {
  const ticker = decodeHtml(input).trim().toUpperCase().replace(/^\$+/, '').replace(/\//g, '.');
  if (!ticker || /CASH|OTHER|FUTURE|SWAP|TOTAL/.test(ticker)) return null;
  return /^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(ticker) ? ticker : null;
}

function parseWeight(value: string | number): number {
  if (typeof value === 'number') return value > 1 ? value / 100 : value;
  const cleaned = value.replace(/[%,$\s]/g, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return 0;
  return value.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function extractAsOf(body: string): string {
  const patterns = [
    /(?:holdings|portfolio composition)[\s\S]{0,160}?as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /"(?:asOf|asOfDate|as_of|effectiveDate)"\s*:\s*"(\d{4}-\d{2}-\d{2})/i,
    /(?:asOf|asOfDate|as_of|effectiveDate)[^\d]{0,10}(\d{4}-\d{2}-\d{2})/i,
    /"(?:asOf|asOfDate|as_of|effectiveDate)"\s*:\s*"(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern)?.[1];
    if (!match) continue;
    if (/^\d{4}-/.test(match)) return match;
    const [month, day, year] = match.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  throw new Error('missing_as_of');
}

function validateHoldings(asOf: string, holdings: EtfConstituentRow[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) throw new Error('invalid_as_of');
  if (holdings.length < 5) throw new Error('insufficient_holdings');
  const total = holdings.reduce((sum, row) => sum + row.weight, 0);
  if (total < 0.80 || total > 1.05) throw new Error(`invalid_weight_total_${total.toFixed(6)}`);
}

function stripTags(value: string) { return value.replace(/<[^>]+>/g, ' '); }
function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
