import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Surface this in dev — production build will have the values baked in via CF Pages env vars.
  // eslint-disable-next-line no-console
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing; using stub.');
}

// Note: we intentionally do not pass a `Database` generic. supabase-js v2's
// schema type is strict and conflicts with our hand-rolled types. We get
// type safety at call sites by typing returned rows directly (see
// `lib/database.types.ts`).
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
