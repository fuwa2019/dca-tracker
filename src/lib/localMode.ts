import type { User } from '@supabase/supabase-js';

/**
 * "Local version" flag. When the app is built (or dev-served) with
 * `VITE_LOCAL_MODE=1`, the SPA runs fully offline:
 *
 *  - no email/OTP login is required (a synthetic local user is injected),
 *  - no Supabase or Quote Worker calls are made,
 *  - all read hooks return a bundled 10-year QQQ DCA simulation
 *    (see `src/lib/localData.ts` + `src/data/local-dataset.json`).
 *
 * The normal cloud build leaves this `false`, so behavior is unchanged.
 */
export const LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === '1';

/** Synthetic user so `RequireAuth` lets the local build straight through. */
export const LOCAL_USER = {
  id: '00000000-0000-4000-8000-000000000c0a',
  email: 'local@dca.offline',
  aud: 'local',
  app_metadata: {},
  user_metadata: { local: true },
  created_at: new Date(0).toISOString(),
} as unknown as User;
