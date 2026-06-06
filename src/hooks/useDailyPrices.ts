import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isoDateInNewYork } from '@/lib/nyse-calendar';
import { normalizeSymbol, normalizeSymbols } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';
import { localPriceMap } from '@/lib/localData';

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';

export type PriceMap = Map<string, Map<string, number>>; // ticker → date → close

interface DailyPriceRow {
  ticker: string;
  trade_date: string;
  close: number;
  adjusted_close: number | null;
}

interface WorkerHistoryResponse {
  series?: Array<{
    ticker: string;
    points: Array<{ date: string; close: number; adjustedClose?: number | null }>;
  }>;
}

async function readFromSupabase(symbols: string[], earliestDate: string): Promise<PriceMap> {
  const { data, error } = await supabase
    .from('daily_prices')
    .select('ticker,trade_date,close,adjusted_close')
    .in('ticker', symbols)
    .gte('trade_date', earliestDate)
    .order('trade_date', { ascending: true });
  if (error) throw error;
  const map: PriceMap = new Map();
  for (const row of (data as DailyPriceRow[]) ?? []) {
    let m = map.get(row.ticker);
    if (!m) {
      m = new Map();
      map.set(row.ticker, m);
    }
    m.set(row.trade_date, Number(row.adjusted_close ?? row.close));
  }
  return map;
}

/** Returns true when Supabase already has a usable daily series for charting.
 *  A single close near the event date is not enough for PortfolioAnalyst-style
 *  performance: we need enough closes after the start date to draw a line. */
function coverageOk(map: PriceMap, symbols: string[], earliestDate: string): boolean {
  const todayIso = isoDateInNewYork(new Date());
  const needsMultiPointSeries = addDays(earliestDate, 7) < todayIso;
  const freshEnoughDate = addDays(todayIso, -10);

  for (const s of symbols) {
    const m = map.get(s);
    if (!m || m.size === 0) return false;
    const dates = [...m.keys()].sort();
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    if (firstDate > addDays(earliestDate, 7)) return false;
    if (needsMultiPointSeries && m.size < 2) return false;
    if (needsMultiPointSeries && lastDate < freshEnoughDate) return false;
  }
  return true;
}

function mergePriceMaps(base: PriceMap, extra: PriceMap): PriceMap {
  const merged: PriceMap = new Map();
  for (const [ticker, prices] of base) merged.set(ticker, new Map(prices));
  for (const [ticker, prices] of extra) {
    let out = merged.get(ticker);
    if (!out) {
      out = new Map();
      merged.set(ticker, out);
    }
    for (const [date, close] of prices) out.set(date, close);
  }
  return merged;
}

function workerHistoryToMap(data: WorkerHistoryResponse): PriceMap {
  const map: PriceMap = new Map();
  for (const row of data.series ?? []) {
    const ticker = normalizeSymbol(row.ticker);
    let prices = map.get(ticker);
    if (!prices) {
      prices = new Map();
      map.set(ticker, prices);
    }
    for (const point of row.points ?? []) {
      const px = point.adjustedClose ?? point.close;
      if (point.date && Number.isFinite(px)) prices.set(point.date, Number(px));
    }
  }
  return map;
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Pick a Yahoo `range` slug that covers earliestDate → today with some margin. */
function pickRange(earliestDate: string): string {
  const earliest = new Date(earliestDate + 'T00:00:00Z').getTime();
  const now = Date.now();
  const days = (now - earliest) / 86_400_000;
  if (days <= 30) return '3mo';
  if (days <= 90) return '6mo';
  if (days <= 200) return '1y';
  if (days <= 500) return '2y';
  if (days <= 1500) return '5y';
  if (days <= 3650) return '10y';
  return 'max';
}

async function backfillViaWorker(symbols: string[], earliestDate: string): Promise<PriceMap> {
  if (!WORKER_BASE) return new Map();
  const range = pickRange(earliestDate);
  const url = `${WORKER_BASE}/api/history?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`worker /api/history ${r.status}`);
  const workerMap = workerHistoryToMap((await r.json()) as WorkerHistoryResponse);
  // Give the waitUntil a moment to land before re-querying.
  await new Promise((resolve) => setTimeout(resolve, 800));
  return workerMap;
}

/**
 * Returns daily close prices for the requested symbols starting from earliestDate.
 * Reads from Supabase first; if any symbol's coverage falls short, triggers a
 * one-shot backfill via the quote worker, then re-reads.
 */
export function useDailyPrices(symbols: string[], earliestDate: string | null) {
  const uniqSorted = normalizeSymbols(symbols);
  const enabled = uniqSorted.length > 0 && !!earliestDate;
  return useQuery<PriceMap>({
    queryKey: ['daily_prices', uniqSorted.join(','), earliestDate],
    enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (LOCAL_MODE) {
        const map: PriceMap = new Map();
        for (const s of uniqSorted) {
          const m = localPriceMap.get(s);
          if (m) map.set(s, new Map(m));
        }
        return map;
      }
      const ed = earliestDate as string;
      let map = await readFromSupabase(uniqSorted, ed);
      if (!coverageOk(map, uniqSorted, ed)) {
        const workerMap = await backfillViaWorker(uniqSorted, ed);
        map = await readFromSupabase(uniqSorted, ed);
        map = mergePriceMaps(map, workerMap);
      }
      return map;
    },
  });
}
