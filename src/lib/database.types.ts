// Hand-rolled Database types matching supabase/migrations/0001_init.sql.
// Regenerate via `supabase gen types typescript --project-id <id>` once the project exists.

export interface FundingBatchRow {
  id: string;
  user_id: string;
  label: string;
  kind: 'dca' | 'lumpsum';
  planned_usd: number | null;
  created_at: string;
}
export interface FundingBatchInsert {
  id?: string;
  user_id: string;
  label: string;
  kind: 'dca' | 'lumpsum';
  planned_usd?: number | null;
  created_at?: string;
}
export type FundingBatchUpdate = Partial<FundingBatchInsert>;

export interface CashflowRow {
  id: string;
  user_id: string;
  batch_id: string | null;
  cny_out_date: string;
  cny_amount: number;
  usd_in_date: string | null;
  usd_amount: number | null;
  target_rate: number;
  fees_cny: number;
  fees_usd: number;
  note: string | null;
  created_at: string;
}
export interface CashflowInsert {
  id?: string;
  user_id: string;
  batch_id?: string | null;
  cny_out_date: string;
  cny_amount: number;
  usd_in_date?: string | null;
  usd_amount?: number | null;
  target_rate: number;
  fees_cny?: number;
  fees_usd?: number;
  note?: string | null;
  created_at?: string;
}
export type CashflowUpdate = Partial<CashflowInsert>;

export interface TransactionRow {
  id: string;
  user_id: string;
  batch_id: string | null;
  trade_date: string;
  ticker: string;
  side: 'buy' | 'sell';
  price: number;
  shares: number;
  kind: 'dca' | 'lumpsum';
  note: string | null;
  created_at: string;
  updated_at: string;
}
export interface TransactionInsert {
  id?: string;
  user_id: string;
  batch_id?: string | null;
  trade_date: string;
  ticker: string;
  side: 'buy' | 'sell';
  price: number;
  shares: number;
  kind: 'dca' | 'lumpsum';
  note?: string | null;
  created_at?: string;
  updated_at?: string;
}
export type TransactionUpdate = Partial<TransactionInsert>;

export interface QuoteSnapshotRow {
  ticker: string;
  price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  market_state: string | null;
  source: string | null;
  updated_at: string;
}
export interface QuoteSnapshotInsert {
  ticker: string;
  price?: number | null;
  prev_close?: number | null;
  change?: number | null;
  change_pct?: number | null;
  market_state?: string | null;
  source?: string | null;
  updated_at?: string;
}
export type QuoteSnapshotUpdate = Partial<QuoteSnapshotInsert>;

export interface ShareLinkRow {
  token: string;
  user_id: string;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
}
export interface ShareLinkInsert {
  token: string;
  user_id: string;
  expires_at?: string | null;
  revoked?: boolean;
  created_at?: string;
}
export type ShareLinkUpdate = Partial<ShareLinkInsert>;

export interface SettingsRow {
  user_id: string;
  target_usd: number;
  expected_annual_ret: number;
  monthly_dca_usd: number | null;
  email_enabled: boolean;
  email_to: string | null;
  cost_basis_default: 'avg' | 'fifo';
  watchlist: string[];
  updated_at: string;
}
export interface SettingsInsert {
  user_id: string;
  target_usd?: number;
  expected_annual_ret?: number;
  monthly_dca_usd?: number | null;
  email_enabled?: boolean;
  email_to?: string | null;
  cost_basis_default?: 'avg' | 'fifo';
  watchlist?: string[];
  updated_at?: string;
}
export type SettingsUpdate = Partial<SettingsInsert>;

export interface EmailLogRow {
  user_id: string;
  ym: string;
  sent_at: string;
}
export interface EmailLogInsert {
  user_id: string;
  ym: string;
  sent_at?: string;
}
export type EmailLogUpdate = Partial<EmailLogInsert>;

export type SharedPortfolio = {
  positions: Array<{
    ticker: string;
    weight_pct: number;
    return_pct: number;
    day_change_pct: number | null;
  }>;
  total_return_pct: number;
  generated_at: string;
};

export type SharedHistory = {
  series: Array<{
    date: string;
    return_pct_user: number;
    return_pct_spy: number;
  }>;
  generated_at: string;
};

export type PortfolioHistory = {
  series: Array<{
    date: string;
    invested: number;
    cost_basis: number;
    nav_user: number;
    nav_spy: number;
    return_pct_user: number;
    return_pct_spy: number;
    pnl_user: number;
    pnl_spy: number;
    txns: Array<{
      side: 'buy' | 'sell';
      ticker: string;
      shares: number;
      price: number;
      kind: 'dca' | 'lumpsum';
    }>;
  }>;
  generated_at: string;
};

export interface Database {
  public: {
    Tables: {
      funding_batches: { Row: FundingBatchRow; Insert: FundingBatchInsert; Update: FundingBatchUpdate };
      cashflows: { Row: CashflowRow; Insert: CashflowInsert; Update: CashflowUpdate };
      transactions: { Row: TransactionRow; Insert: TransactionInsert; Update: TransactionUpdate };
      quote_snapshots: { Row: QuoteSnapshotRow; Insert: QuoteSnapshotInsert; Update: QuoteSnapshotUpdate };
      share_links: { Row: ShareLinkRow; Insert: ShareLinkInsert; Update: ShareLinkUpdate };
      settings: { Row: SettingsRow; Insert: SettingsInsert; Update: SettingsUpdate };
      email_log: { Row: EmailLogRow; Insert: EmailLogInsert; Update: EmailLogUpdate };
    };
    Views: Record<string, never>;
    Functions: {
      shared_portfolio: {
        Args: { p_token: string };
        Returns: SharedPortfolio | { error: string };
      };
      shared_history: {
        Args: { p_token: string };
        Returns: SharedHistory | { error: string };
      };
      portfolio_history: {
        Args: Record<string, never>;
        Returns: PortfolioHistory | { error: string };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
