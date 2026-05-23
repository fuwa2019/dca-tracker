import { useQuery } from '@tanstack/react-query';
import { fetchQuotes, isUsMarketDataActive, type Quote } from '@/lib/quote';

export function useQuotes(symbols: string[]) {
  const uniqSorted = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
  return useQuery<Quote[]>({
    queryKey: ['quotes', uniqSorted.join(',')],
    queryFn: () => fetchQuotes(uniqSorted),
    enabled: uniqSorted.length > 0,
    refetchInterval: () => (isUsMarketDataActive() ? 60_000 : false),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
