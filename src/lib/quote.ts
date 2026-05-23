export interface Quote {
  ticker: string;
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  marketState: string | null;
  source: string;
  cachedAt: string;
}

export interface HistorySeries {
  ticker: string;
  points: Array<{ date: string; close: number; adjustedClose?: number }>;
}

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!WORKER_BASE) return [];
  if (symbols.length === 0) return [];
  const url = `${WORKER_BASE}/api/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`quote http ${r.status}`);
  const data = (await r.json()) as { quotes: Quote[] };
  return data.quotes ?? [];
}

export async function fetchChart(symbol: string, range = '1y', interval = '1d') {
  if (!WORKER_BASE) return null;
  const url = `${WORKER_BASE}/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`chart http ${r.status}`);
  return r.json();
}

export async function fetchHistory(symbols: string[], range = '10y'): Promise<HistorySeries[]> {
  if (!WORKER_BASE) return [];
  if (symbols.length === 0) return [];
  const url = `${WORKER_BASE}/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`history http ${r.status}`);
  const data = (await r.json()) as { series?: HistorySeries[] };
  return data.series ?? [];
}

/** Heuristic: is the US market currently open (regular hours)? Uses ET (NYC) wall-clock. */
export function isUsMarketOpen(now = new Date()): boolean {
  // Convert to ET (handles DST automatically via Intl)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  if (wd === 'Sat' || wd === 'Sun') return false;
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60; // 09:30 — 16:00 ET
}
