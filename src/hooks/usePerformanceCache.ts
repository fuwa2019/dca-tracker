import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PerformanceCacheStatus } from '@/lib/database.types';

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
        if (isMissingRpc(error)) return null;
        throw error;
      }
      if (!data || 'error' in data) return null;
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
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['performance_cache_status'] });
      qc.invalidateQueries({ queryKey: ['portfolio_history'] });
    },
  });
}
