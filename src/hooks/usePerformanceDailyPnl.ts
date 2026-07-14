import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { LOCAL_MODE } from '@/lib/localMode';
import { normalizeSymbol } from '@/lib/symbols';
import type { PerformanceDailyPnl } from '@/lib/database.types';

export function usePerformanceDailyPnl({
  benchmark,
  startDate,
  endDate,
  enabled = true,
}: {
  benchmark?: string;
  startDate?: string;
  endDate?: string;
  enabled?: boolean;
}) {
  const normalizedBenchmark = normalizeSymbol(benchmark ?? '') || 'SPY';
  return useQuery<PerformanceDailyPnl>({
    queryKey: ['performance_daily_pnl', normalizedBenchmark, startDate ?? '', endDate ?? ''],
    enabled: enabled && !LOCAL_MODE && !!startDate && !!endDate,
    queryFn: async () => {
      if (!startDate || !endDate) throw new Error('缺少金额日历日期范围');
      const { data, error } = await supabase.rpc('performance_daily_pnl', {
        p_start_date: startDate,
        p_end_date: endDate,
        p_benchmark: normalizedBenchmark,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || 'error' in data) {
        throw new Error(String((data as { error?: string } | null)?.error ?? '金额数据不可用'));
      }
      const payload = data as {
        benchmark?: string;
        generated_at?: string;
        series?: Array<{ date?: string; daily_pnl_user?: number | string | null }>;
      };
      return {
        benchmark: payload.benchmark ?? normalizedBenchmark,
        currency: 'USD' as const,
        generated_at: payload.generated_at ?? new Date().toISOString(),
        series: (payload.series ?? [])
          .filter((row) => !!row.date)
          .map((row) => ({
            date: row.date as string,
            daily_pnl_user: row.daily_pnl_user == null ? null : Number(row.daily_pnl_user),
          })),
      };
    },
    staleTime: 5 * 60 * 1000,
  });
}
