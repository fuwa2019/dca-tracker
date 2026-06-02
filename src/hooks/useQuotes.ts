import { useQuery } from '@tanstack/react-query';
import { fetchQuotes, isUsMarketDataActive, type Quote } from '@/lib/quote';
import { apiLimitConfigFromEnv, calculateRefreshInterval } from '@/lib/apiRateLimit';
import { normalizeSymbols } from '@/lib/symbols';

const API_LIMIT_CONFIG = apiLimitConfigFromEnv(import.meta.env);

export function useQuotes(symbols: string[]) {
  const uniqSorted = normalizeSymbols(symbols);
  return useQuery<Quote[]>({
    queryKey: ['quotes', uniqSorted.join(',')],
    queryFn: () => fetchQuotes(uniqSorted),
    enabled: uniqSorted.length > 0,
    refetchInterval: () => {
      if (!isUsMarketDataActive()) return false;
      if (typeof document !== 'undefined' && document.hidden) {
        return calculateRefreshInterval(uniqSorted.length, API_LIMIT_CONFIG) * API_LIMIT_CONFIG.hiddenRefreshMultiplier;
      }
      return calculateRefreshInterval(uniqSorted.length, API_LIMIT_CONFIG);
    },
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(120_000, 15_000 * 2 ** attempt),
    staleTime: 30_000,
  });
}
