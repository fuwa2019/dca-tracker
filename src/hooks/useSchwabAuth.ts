import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchSchwabAuthStatus,
  fetchSchwabAuthorizeUrl,
  type SchwabAuthStatus,
} from '@/lib/schwab';
import { LOCAL_MODE } from '@/lib/localMode';
import { READ_ONLY_SHARE } from '@/lib/shareSession';

export function useSchwabAuthStatus() {
  return useQuery<SchwabAuthStatus>({
    queryKey: ['schwab_auth_status'],
    queryFn: async () => {
      if (LOCAL_MODE) {
        return { state: 'unconfigured', message: '本地 Debug 模式不连接 Schwab / Quote Worker。' } as SchwabAuthStatus;
      }
      return fetchSchwabAuthStatus();
    },
    // Provider authorization is owner maintenance; a read-only share skips it.
    enabled: !READ_ONLY_SHARE,
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
