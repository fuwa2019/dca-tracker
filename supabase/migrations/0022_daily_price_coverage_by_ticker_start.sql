-- DCA Tracker: daily_prices coverage with per-ticker start dates.
--
-- Keeps the original daily_price_coverage RPC for compatibility while allowing
-- callers to avoid applying a global account start date to every ticker.

create or replace function public.daily_price_coverage_v2(p_items jsonb)
returns table (
    ticker text,
    points bigint,
    adjusted_points bigint,
    first_date date,
    last_date date,
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    with items as (
        select
            upper(trim(ticker)) as ticker,
            start_date
        from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as r(
            ticker text,
            start_date date
        )
        where trim(ticker) <> ''
    )
    select
        item.ticker,
        count(dp.trade_date) as points,
        count(dp.trade_date) filter (where coalesce(dp.adjusted_close, 0) > 0) as adjusted_points,
        min(dp.trade_date) as first_date,
        max(dp.trade_date) as last_date,
        max(dp.updated_at) as updated_at
    from items item
    left join public.daily_prices dp
      on dp.ticker = item.ticker
     and (item.start_date is null or dp.trade_date >= item.start_date)
    group by item.ticker
    order by item.ticker;
$$;

revoke all on function public.daily_price_coverage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.daily_price_coverage_v2(jsonb) to authenticated;
