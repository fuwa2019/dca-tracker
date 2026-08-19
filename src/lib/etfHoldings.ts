import { supabase } from '@/lib/supabase';
import { WORKER_BASE } from '@/lib/quote';
import type { QueryClient } from '@tanstack/react-query';

export type EtfRefreshItem = {
  ticker: string;
  status: 'updated' | 'unchanged' | 'failed';
  mode?: 'live' | 'static-fallback';
  warning?: 'provider_unavailable' | 'provider_stale';
  asOf?: string;
  constituentCount?: number;
  error?: string;
};

export type EtfRefreshResponse = {
  status: 'ok' | 'partial' | 'failed';
  quotesRefreshed: boolean;
  results: EtfRefreshItem[];
  deleted: string[];
};

export async function refreshEtfHoldings(): Promise<EtfRefreshResponse> {
  if (!WORKER_BASE) throw new Error('未配置行情 Worker 地址。');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error('登录状态已失效，请重新登录。');
  const response = await fetch(`${WORKER_BASE}/api/etf-holdings/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null) as EtfRefreshResponse | { error?: string } | null;
  if (!response.ok || !body || !('results' in body)) {
    throw new Error(body && 'error' in body && body.error ? body.error : `ETF 成分刷新失败 (${response.status})`);
  }
  return body;
}

/** Reconcile newly opened/closed ETF positions after a transaction mutation. */
export async function coordinateEtfHoldings(queryClient: QueryClient): Promise<void> {
  try {
    await refreshEtfHoldings();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['etf_holdings'] }),
      queryClient.invalidateQueries({ queryKey: ['quotes'] }),
    ]);
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[etf-holdings] background coordination failed:', error);
  }
}
