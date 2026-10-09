import { supabase } from '@/lib/supabase';
import { SHARE_TOKEN } from '@/lib/shareSession';
import type { AccountRow, CashflowRow, SettingsRow, TransactionRow } from '@/lib/database.types';

/**
 * The owner's rows for a full-scope share, from `shared_full_ledger`
 * (migration 0059). The function builds every row from a column allowlist, so
 * fields it never sends (user id, import key, batch id, reminder email) are
 * filled with neutral values here to keep the private row types.
 */
export interface SharedLedger {
  settings: SettingsRow | null;
  accounts: AccountRow[];
  transactions: TransactionRow[];
  cashflows: CashflowRow[];
}

type Payload = {
  error?: string;
  settings?: Omit<SettingsRow, 'user_id' | 'email_enabled' | 'email_to'> | null;
  accounts?: Array<Omit<AccountRow, 'user_id'>>;
  transactions?: Array<Omit<TransactionRow, 'user_id' | 'batch_id' | 'import_key'>>;
  cashflows?: Array<Omit<CashflowRow, 'user_id' | 'batch_id' | 'import_key'>>;
};

let pending: Promise<SharedLedger> | null = null;

/** One request per page load; every hook that needs the ledger shares it. */
export function fetchSharedLedger(): Promise<SharedLedger> {
  if (!SHARE_TOKEN) return Promise.reject(new Error('没有分享会话'));
  pending ??= load(SHARE_TOKEN).catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}

async function load(token: string): Promise<SharedLedger> {
  const { data, error } = await supabase.rpc('shared_full_ledger', { p_token: token });
  if (error) throw error;
  const payload = (data ?? {}) as Payload;
  if (payload.error) throw new Error('分享链接无效、已撤销或已过期');
  return {
    settings: payload.settings
      ? { ...payload.settings, user_id: '', email_enabled: false, email_to: null }
      : null,
    accounts: (payload.accounts ?? []).map((row) => ({ ...row, user_id: '' })),
    transactions: (payload.transactions ?? []).map((row) => ({ ...row, user_id: '', batch_id: null, import_key: null })),
    cashflows: (payload.cashflows ?? []).map((row) => ({ ...row, user_id: '', batch_id: null, import_key: null })),
  };
}
