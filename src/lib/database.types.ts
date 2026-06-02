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
  as_of_timestamp: string | null;
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
  as_of_timestamp?: string | null;
  updated_at?: string;
}
export type QuoteSnapshotUpdate = Partial<QuoteSnapshotInsert>;

export interface TrackedSymbolRow {
  symbol: string;
  name: string | null;
  asset_type: string | null;
  enabled: boolean;
  source: string;
  first_trade_date: string | null;
  last_backfill_at: string | null;
  backfill_status: 'pending' | 'ok' | 'missing' | 'stale' | 'partial' | 'unsupported' | 'failed';
  backfill_error: string | null;
  created_at: string;
  updated_at: string;
}
export type TrackedSymbolInsert = Partial<Omit<TrackedSymbolRow, 'symbol'>> & { symbol: string };
export type TrackedSymbolUpdate = Partial<TrackedSymbolInsert>;

export interface ShareLinkRow {
  token: string;
  user_id: string;
  expires_at: string | null;
  revoked: boolean;
  created_at: string;
  access_count?: number;
  last_accessed_at?: string | null;
}
export interface ShareLinkInsert {
  token: string;
  user_id: string;
  expires_at?: string | null;
  revoked?: boolean;
  created_at?: string;
  access_count?: number;
  last_accessed_at?: string | null;
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
  benchmarks: string[];
  selected_benchmark: string;
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
  benchmarks?: string[];
  selected_benchmark?: string;
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
  has_snapshot_price: boolean;
  generated_at: string;
};

export type SharedHistory = {
  series: Array<{
    date: string;
    trading_date?: string;
    as_of_timestamp?: string | null;
    is_provisional?: boolean;
    return_pct_user: number;
    return_pct_spy: number;
  }>;
  generated_at: string;
  updated_at?: string;
  last_refresh_attempt_at?: string | null;
  refresh_ms?: number | null;
  benchmark?: string;
  method?: string;
  price_basis?: string;
  flow_basis?: string;
  date_basis?: string;
  trading_calendar?: string;
  trading_date_timezone?: string;
  excluded_non_trading_days?: boolean;
  dirty?: boolean;
};

export type PortfolioHistory = {
  series: Array<{
    date: string;
    trading_date?: string;
    as_of_timestamp?: string | null;
    is_provisional?: boolean;
    invested?: number;
    cost_basis?: number;
    nav_user?: number;
    nav_spy?: number;
    return_pct_user: number;
    return_pct_spy: number;
    pnl_user?: number;
    pnl_spy?: number;
    txns?: Array<{
      side: 'buy' | 'sell';
      ticker: string;
      shares: number;
      price: number;
      kind: 'dca' | 'lumpsum';
    }>;
  }>;
  generated_at: string;
  updated_at?: string;
  last_refresh_attempt_at?: string | null;
  refresh_ms?: number | null;
  benchmark?: string;
  method?: string;
  price_basis?: string;
  flow_basis?: string;
  date_basis?: string;
  trading_calendar?: string;
  trading_date_timezone?: string;
  excluded_non_trading_days?: boolean;
  dirty?: boolean;
};

export type PerformanceHistory = SharedHistory;

export type HistoryCacheRefresh = {
  ok: true;
  points: number;
  generated_at: string;
  updated_at?: string;
  benchmark?: string;
  method?: string;
  refresh_ms?: number | null;
};

export type PerformanceCacheStatus = {
  exists: boolean;
  benchmark?: string;
  method?: string;
  dirty?: boolean;
  points?: number;
  generated_at?: string;
  updated_at?: string;
  last_refresh_attempt_at?: string | null;
  refresh_ms?: number | null;
  error?: string | null;
};

export interface Database {
  public: {
    Tables: {
      funding_batches: { Row: FundingBatchRow; Insert: FundingBatchInsert; Update: FundingBatchUpdate };
      cashflows: { Row: CashflowRow; Insert: CashflowInsert; Update: CashflowUpdate };
      transactions: { Row: TransactionRow; Insert: TransactionInsert; Update: TransactionUpdate };
      quote_snapshots: { Row: QuoteSnapshotRow; Insert: QuoteSnapshotInsert; Update: QuoteSnapshotUpdate };
      tracked_symbols: { Row: TrackedSymbolRow; Insert: TrackedSymbolInsert; Update: TrackedSymbolUpdate };
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
      shared_performance_history: {
        Args: { p_token: string };
        Returns: PerformanceHistory | { error: string };
      };
      portfolio_history: {
        Args: Record<string, never>;
        Returns: PortfolioHistory | { error: string };
      };
      performance_history: {
        Args: { p_benchmark?: string | null };
        Returns: PerformanceHistory | { error: string };
      };
      refresh_portfolio_history_cache: {
        Args: Record<string, never>;
        Returns: HistoryCacheRefresh | { error: string };
      };
      refresh_performance_history_cache: {
        Args: { p_benchmark?: string | null };
        Returns: HistoryCacheRefresh | { error: string };
      };
      refresh_due_performance_caches: {
        Args: { p_limit?: number };
        Returns: { ok: true; refreshed: number; limit: number; generated_at: string } | { error: string };
      };
      daily_price_coverage: {
        Args: { p_tickers: string[]; p_earliest_date?: string | null };
        Returns: Array<{
          ticker: string;
          points: number;
          adjusted_points: number;
          first_date: string | null;
          last_date: string | null;
          updated_at: string | null;
        }>;
      };
      daily_price_coverage_v2: {
        Args: { p_items: Array<{ ticker: string; start_date?: string | null }> };
        Returns: Array<{
          ticker: string;
          points: number;
          adjusted_points: number;
          first_date: string | null;
          last_date: string | null;
          updated_at: string | null;
        }>;
      };
      add_tracked_symbol: {
        Args: {
          p_symbol: string;
          p_name?: string | null;
          p_asset_type?: string | null;
          p_source?: string;
          p_first_trade_date?: string | null;
        };
        Returns: TrackedSymbolRow;
      };
      tracked_symbol_coverage: {
        Args: Record<string, never>;
        Returns: Array<{
          symbol: string;
          name: string | null;
          asset_type: string | null;
          daily_rows: number;
          adjusted_rows: number;
          first_daily_date: string | null;
          last_daily_date: string | null;
          missing_days: number;
          backfill_status: TrackedSymbolRow['backfill_status'];
          last_backfill_at: string | null;
          backfill_error: string | null;
          first_trade_date: string | null;
        }>;
      };
      performance_cache_status: {
        Args: { p_benchmark?: string | null };
        Returns: PerformanceCacheStatus | { error: string };
      };
      refresh_shared_history_cache: {
        Args: { p_token: string };
        Returns: HistoryCacheRefresh | { error: string };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
