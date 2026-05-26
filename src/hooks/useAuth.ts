import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const DEV_BYPASS_AUTH = import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH !== '0';
const DEV_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'local-preview@dca.dev',
} as User;

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? (DEV_BYPASS_AUTH ? DEV_USER : null));
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? (DEV_BYPASS_AUTH ? DEV_USER : null));
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user, loading };
}

/**
 * Send a 6-digit OTP to the user's email. Supabase actually sends BOTH a magic
 * link and an OTP `{{ .Token }}` in the same email — but mail-provider link
 * scanners (Gmail, iCloud) often consume the magic link before the user clicks,
 * leaving the link "expired". OTP codes can't be scanner-consumed, so we use
 * those exclusively.
 *
 * Tweak Supabase → Authentication → Email Templates → Magic Link to display
 * the token: `Your verification code is: {{ .Token }}`.
 */
export async function sendOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
}

export async function verifyEmailOtp(email: string, token: string) {
  return supabase.auth.verifyOtp({ email, token, type: 'email' });
}

export async function signOut() {
  return supabase.auth.signOut();
}
