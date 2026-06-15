import { useMutation, useQuery } from '@tanstack/react-query';
import {
  fetchSchwabAuthStatus,
  fetchSchwabAuthorizeUrl,
  type SchwabAuthStatus,
} from '@/lib/schwab';

export function useSchwabAuthStatus() {
  return useQuery<SchwabAuthStatus>({
    queryKey: ['schwab_auth_status'],
    queryFn: fetchSchwabAuthStatus,
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
