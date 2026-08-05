import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import type { EtfHoldingsData } from '@/lib/calc/lookThrough';
import etfHoldingsFallback from '@/data/etf-holdings.json';

const FALLBACK = etfHoldingsFallback as unknown as EtfHoldingsData;

export interface EtfHoldingSourceMeta {
  provider: string;
  asOf: string;
  fetchedAt: string | null;
  sourceUrl: string | null;
  constituentCount: number;
}

export interface EtfHoldingsModel {
  data: EtfHoldingsData;
  sources: Record<string, EtfHoldingSourceMeta>;
  isFallback: boolean;
  isLoading: boolean;
  isError: boolean;
}

type SetRow = {
  etf_ticker: string;
  provider: string;
  source_url: string;
  as_of: string;
  fetched_at: string;
  constituent_count: number;
};
type HoldingRow = { etf_ticker: string; constituent_ticker: string; weight: number | string };

export function useEtfHoldings(): EtfHoldingsModel {
  const query = useQuery({
    queryKey: ['etf_holdings'],
    queryFn: async () => {
      if (LOCAL_MODE) return null;
      const [sets, rows] = await Promise.all([
        supabase.from('etf_holding_sets').select('etf_ticker,provider,source_url,as_of,fetched_at,constituent_count'),
        supabase.from('etf_holdings').select('etf_ticker,constituent_ticker,weight'),
      ]);
      if (sets.error) throw sets.error;
      if (rows.error) throw rows.error;
      return { sets: (sets.data ?? []) as SetRow[], rows: (rows.data ?? []) as HoldingRow[] };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const sets = query.data?.sets ?? [];
  const rows = query.data?.rows ?? [];
  const hasRemoteData = sets.length > 0 && rows.length > 0;
  if (!hasRemoteData) {
    const sources = Object.fromEntries(Object.entries(FALLBACK._meta?.asOf ?? {}).map(([ticker, asOf]) => [ticker, {
      provider: 'static', asOf: String(asOf), fetchedAt: null, sourceUrl: null,
      constituentCount: FALLBACK.etfs[ticker]?.length ?? 0,
    }]));
    return { data: FALLBACK, sources, isFallback: true, isLoading: query.isLoading, isError: query.isError };
  }

  const etfs: EtfHoldingsData['etfs'] = Object.fromEntries(
    Object.entries(FALLBACK.etfs).map(([ticker, constituents]) => [ticker, [...constituents]]),
  );
  const remoteTickers = new Set(sets.map((row) => row.etf_ticker));
  for (const ticker of remoteTickers) etfs[ticker] = [];
  for (const row of rows) {
    const list = etfs[row.etf_ticker] ?? [];
    list.push({ ticker: row.constituent_ticker, weight: Number(row.weight) });
    etfs[row.etf_ticker] = list;
  }
  const sources: Record<string, EtfHoldingSourceMeta> = Object.fromEntries(
    Object.entries(FALLBACK._meta?.asOf ?? {}).map(([ticker, asOf]) => [ticker, {
      provider: 'static', asOf: String(asOf), fetchedAt: null, sourceUrl: null,
      constituentCount: FALLBACK.etfs[ticker]?.length ?? 0,
    }]),
  );
  for (const row of sets) sources[row.etf_ticker] = {
    provider: row.provider,
    asOf: row.as_of,
    fetchedAt: row.fetched_at,
    sourceUrl: row.source_url,
    constituentCount: row.constituent_count,
  };
  return {
    data: { _meta: { ...FALLBACK._meta, asOf: Object.fromEntries(Object.entries(sources).map(([ticker, source]) => [ticker, source.asOf])) }, etfs },
    sources,
    isFallback: Object.values(sources).some((source) => source.provider === 'static'),
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
