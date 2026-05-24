import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  HistoryCacheRefresh,
  PerformanceCacheStatus,
  PerformanceHistory,
  PortfolioHistory,
} from '@/lib/database.types';

const REFRESH_MS_PRESERVE_WINDOW_MS = 30_000;

function isMissingRpc(error: { code?: string; message?: string; status?: number }) {
  return (
    error.code === 'PGRST202' ||
    error.code === '404' ||
    (error as { status?: number }).status === 404 ||
    /function .* does not exist|could not find .* function|Not Found/i.test(error.message ?? '')
  );
}

export function usePerformanceCacheStatus() {
  const qc = useQueryClient();
  return useQuery<PerformanceCacheStatus | null>({
    queryKey: ['performance_cache_status'],
    queryFn: async () => {
      const previous = qc.getQueryData<PerformanceCacheStatus | null>(['performance_cache_status']);
      const { data, error } = await supabase.rpc('performance_cache_status');
      if (error) {
        if (isMissingRpc(error)) {
          const fallback = await readHistoryStatusFallback();
          return fallback ? preserveRefreshMs(fallback, previous) : fallback;
        }
        throw error;
      }
      if (!data || 'error' in data) {
        const fallback = await readHistoryStatusFallback();
        return fallback ? preserveRefreshMs(fallback, previous) : fallback;
      }
      return preserveRefreshMs(data as PerformanceCacheStatus, previous);
    },
    staleTime: 60_000,
  });
}

function preserveRefreshMs(
  next: PerformanceCacheStatus,
  previous: PerformanceCacheStatus | null | undefined,
): PerformanceCacheStatus {
  if (next.refresh_ms != null || previous?.refresh_ms == null) return next;
  if (!next.exists || next.error) return next;

  const nextAttemptMs = statusAttemptTimeMs(next);
  const previousAttemptMs = statusAttemptTimeMs(previous);
  if (
    nextAttemptMs != null &&
    previousAttemptMs != null &&
    nextAttemptMs > previousAttemptMs + REFRESH_MS_PRESERVE_WINDOW_MS
  ) {
    return next;
  }

  return { ...next, refresh_ms: previous.refresh_ms };
}

function statusAttemptTimeMs(status: PerformanceCacheStatus): number | null {
  return (
    parseTimeMs(status.last_refresh_attempt_at) ??
    parseTimeMs(status.updated_at) ??
    parseTimeMs(status.generated_at)
  );
}

function parseTimeMs(value?: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function useRefreshPerformanceCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const startedAt = performance.now();
      const { data, error } = await supabase.rpc('refresh_performance_history_cache');
      const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt));
      if (error) {
        if (!isMissingRpc(error)) throw error;
        const legacyStartedAt = performance.now();
        const legacy = await supabase.rpc('refresh_portfolio_history_cache');
        const legacyElapsedMs = Math.max(0, Math.round(performance.now() - legacyStartedAt));
        if (legacy.error) throw legacy.error;
        if (legacy.data && 'error' in legacy.data) throw new Error(String(legacy.data.error));
        return withRefreshMsFallback(legacy.data, legacyElapsedMs);
      }
      if (data && 'error' in data) throw new Error(String(data.error));
      return withRefreshMsFallback(data, elapsedMs);
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

function withRefreshMsFallback(
  data: HistoryCacheRefresh | { error: string } | null,
  elapsedMs: number,
): HistoryCacheRefresh | { error: string } | null {
  if (!data || 'error' in data || data.refresh_ms != null) return data;
  return { ...data, refresh_ms: elapsedMs };
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
