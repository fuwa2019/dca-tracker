import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PerformanceCacheStatus, PerformanceHistory, PortfolioHistory } from '@/lib/database.types';

function isMissingRpc(error: { code?: string; message?: string }) {
  return (
    error.code === 'PGRST202' ||
    /function .* does not exist|could not find .* function/i.test(error.message ?? '')
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
      const refreshedStatus = statusFromRefreshResult(data);
      if (refreshedStatus) {
        qc.setQueryData<PerformanceCacheStatus | null>(['performance_cache_status'], refreshedStatus);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['portfolio_history'] }),
        qc.invalidateQueries({ queryKey: ['share', 'history'] }),
      ]);
      if (!refreshedStatus) {
        await qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      }
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

function statusFromRefreshResult(data: unknown): PerformanceCacheStatus | null {
  if (!data || typeof data !== 'object' || 'error' in data) return null;
  const record = data as {
    points?: unknown;
    series?: unknown;
    benchmark?: unknown;
    method?: unknown;
    generated_at?: unknown;
    updated_at?: unknown;
    refresh_ms?: unknown;
  };
  const points = typeof record.points === 'number'
    ? record.points
    : Array.isArray(record.series)
      ? record.series.length
      : undefined;
  const generatedAt = typeof record.generated_at === 'string' ? record.generated_at : new Date().toISOString();
  const updatedAt = typeof record.updated_at === 'string' ? record.updated_at : generatedAt;
  return {
    exists: (points ?? 0) > 0,
    benchmark: typeof record.benchmark === 'string' ? record.benchmark : 'SPY',
    method: typeof record.method === 'string' ? record.method : 'TWR',
    dirty: false,
    points,
    generated_at: generatedAt,
    updated_at: updatedAt,
    refresh_ms: typeof record.refresh_ms === 'number' ? record.refresh_ms : null,
    error: null,
  };
}
