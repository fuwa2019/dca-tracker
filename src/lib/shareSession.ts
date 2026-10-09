// Read-only share session. Opening a full-scope link (`/share/<token>` whose
// scope is 'full', migration 0059) stores the token for this tab and reloads
// into the normal pages; every data hook then reads the owner's rows through
// `shared_full_ledger` instead of the signed-in tables, and every write
// control is hidden. `?share=off` ends the session.
//
// Development builds also accept `?sharePreview=full` to preview the same
// layout over local data without a token.
const TOKEN_KEY = 'dca-share-token';
const PREVIEW_KEY = 'dca-share-preview';

function sessionValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function readShareSession(): { token: string | null; preview: boolean } {
  if (typeof window === 'undefined') return { token: null, preview: false };
  const params = new URLSearchParams(window.location.search);
  try {
    if (params.get('share') === 'off') {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(PREVIEW_KEY);
    }
    if (import.meta.env.DEV) {
      if (params.get('sharePreview') === 'full') window.sessionStorage.setItem(PREVIEW_KEY, 'full');
      if (params.get('sharePreview') === 'off') window.sessionStorage.removeItem(PREVIEW_KEY);
    }
  } catch {
    // Storage blocked: no session survives a reload, so the share page falls
    // back to the report view.
  }
  const token = sessionValue(TOKEN_KEY);
  return {
    token: token && /^[a-z0-9]{32}$/i.test(token) ? token : null,
    preview: import.meta.env.DEV && sessionValue(PREVIEW_KEY) === 'full',
  };
}

const session = readShareSession();

/** Token of the full-scope link this tab is viewing, or null. */
export const SHARE_TOKEN = session.token;

/** True while the pages are shown as a read-only share. */
export const READ_ONLY_SHARE = SHARE_TOKEN !== null || session.preview;

/**
 * Remember a full-scope token for this tab. Returns false when storage is
 * unavailable, in which case the caller keeps the report view.
 */
export function beginFullShare(token: string): boolean {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
    return window.sessionStorage.getItem(TOKEN_KEY) === token;
  } catch {
    return false;
  }
}

/** Forget any full-scope token, e.g. when this tab opens a report link. */
export function endFullShare() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
}
