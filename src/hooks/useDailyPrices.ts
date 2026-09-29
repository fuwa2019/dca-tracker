import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isoDateInNewYork } from '@/lib/nyse-calendar';
import { normalizeSymbol, normalizeSymbols } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';
import { localPriceMap } from '@/lib/localData';
import { fetchHistoryPages, symbolsNeedingBackfill, type PriceBounds, type PriceMap } from '@/lib/priceBackfill';

export type { PriceBounds, PriceMap } from '@/lib/priceBackfill';

const WORKER_BASE = import.meta.env.VITE_QUOTE_WORKER_URL?.replace(/\/$/, '') ?? '';
const REQUEST_TIMEOUT_MS = 12_000;

/**
 * `adjusted` is the total-return proxy used for benchmarks and the legacy
 * curve. `close` is the ordinary close the ledger values positions at:
 * dividends are explicit cash events there, so adjusted prices would count
 * them twice.
 */
export type PriceBasis = 'adjusted' | 'close';

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

async function readFromSupabase(symbols: string[], earliestDate: string, basis: PriceBasis): Promise<PriceMap> {
  const { data, error } = await supabase
    .from('daily_prices')
    .select('ticker,trade_date,close,adjusted_close')
    .in('ticker', symbols)
    .gte('trade_date', earliestDate)
    .order('trade_date', { ascending: true })
    .abortSignal(AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  if (error) throw error;
  const map: PriceMap = new Map();
  for (const row of (data as DailyPriceRow[]) ?? []) {
    let m = map.get(row.ticker);
    if (!m) {
      m = new Map();
      map.set(row.ticker, m);
    }
    m.set(row.trade_date, Number(basis === 'close' ? row.close : (row.adjusted_close ?? row.close)));
  }
  return map;
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

function workerHistoryToMap(data: WorkerHistoryResponse, basis: PriceBasis): PriceMap {
  const map: PriceMap = new Map();
  for (const row of data.series ?? []) {
    const ticker = normalizeSymbol(row.ticker);
    let prices = map.get(ticker);
    if (!prices) {
      prices = new Map();
      map.set(ticker, prices);
    }
    for (const point of row.points ?? []) {
      const px = basis === 'close' ? point.close : (point.adjustedClose ?? point.close);
      if (point.date && Number.isFinite(px)) prices.set(point.date, Number(px));
    }
  }
  return map;
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

async function backfillViaWorker(symbols: string[], earliestDate: string, basis: PriceBasis): Promise<PriceMap> {
  if (!WORKER_BASE) throw new Error('历史价格服务未配置');
  const range = pickRange(earliestDate);
  const map: PriceMap = new Map();
  const pages = await fetchHistoryPages(symbols, range, async (params) => {
    const r = await fetch(`${WORKER_BASE}/api/history?${params}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`历史价格服务返回 ${r.status}`);
    return (await r.json()) as WorkerHistoryResponse;
  });
  for (const page of pages) {
    const workerMap = workerHistoryToMap(page, basis);
    for (const [symbol, prices] of workerMap) map.set(symbol, prices);
  }
  return map;
}

/**
 * Returns daily close prices for the requested symbols starting from earliestDate.
 * Stored closes settle the initial read. Missing coverage is filled in a
 * separate cached query so a slow provider cannot hold the whole page open.
 */
export function useDailyPrices(symbols: string[], earliestDate: string | null, basis: PriceBasis = 'adjusted', bounds?: PriceBounds) {
  const uniqSorted = normalizeSymbols(symbols);
  const enabled = uniqSorted.length > 0 && !!earliestDate;
  const boundsKey = bounds ? JSON.stringify([...bounds]) : '';
  const stored = useQuery<PriceMap>({
    queryKey: ['daily_prices', uniqSorted.join(','), earliestDate, basis],
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
      return readFromSupabase(uniqSorted, earliestDate as string, basis);
    },
  });
  const missing = stored.data && earliestDate
    ? symbolsNeedingBackfill(stored.data, uniqSorted, earliestDate, isoDateInNewYork(new Date()), bounds)
    : [];
  const backfill = useQuery<PriceMap>({
    queryKey: ['daily_prices_backfill', missing.join(','), earliestDate, basis, boundsKey],
    enabled: !LOCAL_MODE && stored.isSuccess && missing.length > 0,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: () => backfillViaWorker(missing, earliestDate as string, basis),
  });
  const data = useMemo(
    () => stored.data && backfill.data ? mergePriceMaps(stored.data, backfill.data) : stored.data,
    [stored.data, backfill.data],
  );
  const stillMissing = data && earliestDate ? symbolsNeedingBackfill(data, uniqSorted, earliestDate, isoDateInNewYork(new Date()), bounds) : [];
  return {
    data,
    isPending: enabled && stored.isPending,
    isError: stored.isError || backfill.isError,
    backfillPending: backfill.isFetching,
    coverageComplete: LOCAL_MODE || stillMissing.length === 0,
    retry: () => stored.isError ? stored.refetch() : backfill.refetch(),
  };
}
