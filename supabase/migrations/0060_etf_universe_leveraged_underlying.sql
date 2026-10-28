-- Leveraged ETFs in the ETF holdings universe.
--
-- QLD (2x Nasdaq-100) has no constituent table of its own; the look-through
-- engine borrows the QQQ/QQQM holdings (src/data/etf-holdings.json
-- `_meta.leveraged`). Before this migration a user holding QLD but neither
-- QQQ nor QQQM never put QQQ in the refresh universe, so QLD stayed on the
-- static fallback snapshot and the weekly reconcile deleted QQQ's dynamic set
-- once its last direct holder sold.
--
-- Both universe functions now report QQQ for a net-long QLD position. The
-- holding tables, `replace_etf_holdings` and the supported-ticker check are
-- unchanged: QQQ is already supported, and nothing is stored under QLD.

create or replace function public.current_user_etf_universe()
returns table(etf_ticker text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select distinct case held.ticker when 'QLD' then 'QQQ' else held.ticker end as etf_ticker
    from (
        select upper(t.ticker) as ticker
        from public.transactions t
        where t.user_id = auth.uid()
          and upper(t.ticker) in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM', 'QLD')
        group by upper(t.ticker)
        having sum(case when lower(t.side) = 'buy' then t.shares else -t.shares end) > 0.000000001
    ) held;
$$;

revoke all on function public.current_user_etf_universe() from public, anon;
grant execute on function public.current_user_etf_universe() to authenticated;

create or replace function public.active_etf_universe()
returns table(etf_ticker text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select distinct case held.ticker when 'QLD' then 'QQQ' else held.ticker end as etf_ticker
    from (
        select upper(t.ticker) as ticker
        from public.transactions t
        where upper(t.ticker) in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM', 'QLD')
        group by upper(t.ticker)
        having sum(case when lower(t.side) = 'buy' then t.shares else -t.shares end) > 0.000000001
    ) held;
$$;

revoke all on function public.active_etf_universe() from public, anon, authenticated;
grant execute on function public.active_etf_universe() to service_role;
