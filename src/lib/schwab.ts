import { WORKER_BASE } from '@/lib/quote';

// Schwab market-data token health, surfaced on the data-health page.
//
// The quote Worker has no read-only status endpoint, so we probe
// `/api/schwab/oauth/refresh`: a 200 `{ ok: true }` means the refresh token is
// still valid; a 500 carrying an `invalid_grant` / expired / revoked message
// means the 7-day refresh token has lapsed and the user must re-authorize.
export type SchwabAuthState = 'ok' | 'invalid_grant' | 'error' | 'unconfigured';

export interface SchwabAuthStatus {
  state: SchwabAuthState;
  message?: string;
  expiresIn?: number | null;
}

const NEEDS_REAUTH = /invalid_grant|expired|revoked|unsupported_token_type|no.?refresh.?token/i;

export async function fetchSchwabAuthStatus(): Promise<SchwabAuthStatus> {
  if (!WORKER_BASE) return { state: 'unconfigured' };
  try {
    const res = await fetch(`${WORKER_BASE}/api/schwab/oauth/refresh`);
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; message?: string; expiresIn?: number | null }
      | null;
    if (res.ok && body?.ok) {
      return { state: 'ok', expiresIn: body.expiresIn ?? null };
    }
    const message = body?.message ?? body?.error ?? `HTTP ${res.status}`;
    return { state: NEEDS_REAUTH.test(message) ? 'invalid_grant' : 'error', message };
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchSchwabAuthorizeUrl(): Promise<string> {
  if (!WORKER_BASE) throw new Error('行情 Worker 未配置（VITE_QUOTE_WORKER_URL）');
  const res = await fetch(`${WORKER_BASE}/api/schwab/oauth/url`);
  const body = (await res.json().catch(() => null)) as { authorizationUrl?: string } | null;
  if (!res.ok || !body?.authorizationUrl) {
    throw new Error('获取授权链接失败，请稍后重试');
  }
  return body.authorizationUrl;
}
