-- DCA Tracker: aggregate daily_prices coverage without PostgREST row limits.

create or replace function public.daily_price_coverage(
    p_tickers text[],
    p_earliest_date date default null
)
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
    with requested as (
        select distinct upper(trim(raw_ticker)) as ticker
        from unnest(coalesce(p_tickers, array[]::text[])) as u(raw_ticker)
        where trim(raw_ticker) <> ''
    )
    select
        r.ticker,
        count(dp.trade_date) as points,
        count(dp.trade_date) filter (where coalesce(dp.adjusted_close, 0) > 0) as adjusted_points,
        min(dp.trade_date) as first_date,
        max(dp.trade_date) as last_date,
        max(dp.updated_at) as updated_at
    from requested r
    left join public.daily_prices dp
      on dp.ticker = r.ticker
     and (p_earliest_date is null or dp.trade_date >= p_earliest_date)
    group by r.ticker
    order by r.ticker;
$$;

revoke all on function public.daily_price_coverage(text[], date) from public, anon, authenticated;
grant execute on function public.daily_price_coverage(text[], date) to authenticated;
