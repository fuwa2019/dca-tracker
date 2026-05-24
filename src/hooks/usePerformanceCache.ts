import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  HistoryCacheRefresh,
  PerformanceCacheStatus,
  PerformanceHistory,
  PortfolioHistory,
} from '@/lib/database.types';

function isMissingRpc(error: { code?: string; message?: string; status?: number }) {
  return (
    error.code === 'PGRST202' ||
    error.code === '404' ||
    (error as { status?: number }).status === 404 ||
    /function .* does not exist|could not find .* function|Not Found/i.test(error.message ?? '')
  );
}

export function usePerformanceCacheStatus() {
  return useQuery<PerformanceCacheStatus | null>({
    queryKey: ['performance_cache_status'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('performance_cache_status');
      if (error) {
        if (isMissingRpc(error)) return readHistoryStatusFallback();
        throw error;
      }
      if (!data || 'error' in data) return readHistoryStatusFallback();
      return data as PerformanceCacheStatus;
    },
    staleTime: 60_000,
  });
}

export function useRefreshPerformanceCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('refresh_performance_history_cache');
      if (error) {
        if (!isMissingRpc(error)) throw error;
        const legacy = await supabase.rpc('refresh_portfolio_history_cache');
        if (legacy.error) throw legacy.error;
        if (legacy.data && 'error' in legacy.data) throw new Error(String(legacy.data.error));
        return legacy.data;
      }
      if (data && 'error' in data) throw new Error(String(data.error));
      return data;
    },
    onSuccess: async (data) => {
      if (data && !('error' in data)) {
        qc.setQueryData<PerformanceCacheStatus | null>(['performance_cache_status'], (current) => {
          const refresh = data as HistoryCacheRefresh;
          if (refresh.refresh_ms == null) return current ?? null;
          return {
            ...(current ?? { exists: true }),
            exists: true,
            benchmark: refresh.benchmark ?? current?.benchmark ?? 'SPY',
            method: refresh.method ?? current?.method ?? 'TWR',
            points: refresh.points ?? current?.points,
            dirty: false,
            generated_at: refresh.generated_at ?? current?.generated_at,
            updated_at: refresh.updated_at ?? refresh.generated_at ?? current?.updated_at,
            last_refresh_attempt_at: refresh.updated_at ?? refresh.generated_at ?? current?.last_refresh_attempt_at,
            refresh_ms: refresh.refresh_ms,
            error: null,
          };
        });
      }
      await qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      await qc.invalidateQueries({ queryKey: ['portfolio_history'] });
      await qc.invalidateQueries({ queryKey: ['share', 'history'] });
      await qc.invalidateQueries({ queryKey: ['price_coverage'] });
      await qc.refetchQueries({ queryKey: ['performance_cache_status'] });
    },
    onError: async () => {
      await qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      await qc.invalidateQueries({ queryKey: ['price_coverage'] });
      await qc.refetchQueries({ queryKey: ['performance_cache_status'] });
    },
  });
}

async function readHistoryStatusFallback(): Promise<PerformanceCacheStatus | null> {
  const performance = await supabase.rpc('performance_history');
  if (!performance.error && performance.data && !('error' in performance.data)) {
    return statusFromHistory(performance.data as PerformanceHistory);
  }
  if (performance.error && !isMissingRpc(performance.error)) throw performance.error;

  const legacy = await supabase.rpc('portfolio_history');
  if (!legacy.error && legacy.data && !('error' in legacy.data)) {
    return statusFromHistory(legacy.data as PortfolioHistory);
  }
  if (legacy.error && !isMissingRpc(legacy.error)) throw legacy.error;

  return null;
}

function statusFromHistory(history: PerformanceHistory | PortfolioHistory): PerformanceCacheStatus {
  const points = Array.isArray(history.series) ? history.series.length : 0;
  return {
    exists: points > 0,
    benchmark: history.benchmark ?? 'SPY',
    method: history.method ?? 'TWR',
    dirty: history.dirty ?? false,
    points,
    generated_at: history.generated_at,
    updated_at: history.generated_at,
    error: null,
  };
}
