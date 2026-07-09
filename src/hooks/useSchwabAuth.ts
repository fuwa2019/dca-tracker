import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchSchwabAuthStatus,
  fetchSchwabAuthorizeUrl,
  type SchwabAuthStatus,
} from '@/lib/schwab';
import { LOCAL_MODE } from '@/lib/localMode';

export function useSchwabAuthStatus() {
  return useQuery<SchwabAuthStatus>({
    queryKey: ['schwab_auth_status'],
    queryFn: async () => {
      if (LOCAL_MODE) {
        return { state: 'unconfigured', message: '本地 Debug 模式不连接 Schwab / Quote Worker。' } as SchwabAuthStatus;
      }
      return fetchSchwabAuthStatus();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useSchwabReauthorize() {
  return useMutation({
    mutationFn: async () => {
      const url = await fetchSchwabAuthorizeUrl();
      window.location.assign(url);
      return url;
    },
  });
}
