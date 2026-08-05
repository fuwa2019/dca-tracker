-- Keep public ETF constituent snapshots strictly read-only.

revoke all privileges on public.etf_holding_sets, public.etf_holdings from anon, authenticated;
grant select on public.etf_holding_sets, public.etf_holdings to anon, authenticated;
