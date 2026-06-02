-- DCA Tracker - ignore legacy synthetic SPY placeholders in health coverage.
--
-- Real provider candles have an as-of timestamp on the trading date or the
-- following UTC date. Older fixture rows used their import timestamp instead
-- and must not be counted as missing market sessions for newer ETFs.

create or replace function public.tracked_symbol_coverage()
returns table (
    symbol text,
    name text,
    asset_type text,
    daily_rows bigint,
    adjusted_rows bigint,
    first_daily_date date,
    last_daily_date date,
    missing_days bigint,
    backfill_status text,
    last_backfill_at timestamptz,
    backfill_error text,
    first_trade_date date
)
language sql
stable
security definer
set search_path = public
as $$
    with coverage as (
        select
            ts.symbol,
            ts.name,
            ts.asset_type,
            ts.first_trade_date,
            ts.backfill_status,
            ts.last_backfill_at,
            ts.backfill_error,
            count(dp.trade_date) as daily_rows,
            count(dp.trade_date) filter (where coalesce(dp.adjusted_close, 0) > 0) as adjusted_rows,
            min(dp.trade_date) as first_daily_date,
            max(dp.trade_date) as last_daily_date
        from public.tracked_symbols ts
        left join public.daily_prices dp on dp.ticker = ts.symbol
        where ts.enabled
        group by ts.symbol
    )
    select
        c.symbol,
        c.name,
        c.asset_type,
        c.daily_rows,
        c.adjusted_rows,
        c.first_daily_date,
        c.last_daily_date,
        (
            select count(*)
            from public.daily_prices calendar
            where calendar.ticker = 'SPY'
              and calendar.trade_date >= coalesce(c.first_trade_date, c.first_daily_date, current_date)
              and calendar.trade_date <= current_date
              and calendar.as_of_timestamp::date between calendar.trade_date and calendar.trade_date + 1
              and not exists (
                  select 1
                  from public.daily_prices own_price
                  where own_price.ticker = c.symbol
                    and own_price.trade_date = calendar.trade_date
              )
        ) as missing_days,
        case
            when c.daily_rows = 0 and c.backfill_status = 'ok' then 'missing'
            else c.backfill_status
        end as backfill_status,
        c.last_backfill_at,
        c.backfill_error,
        c.first_trade_date
    from coverage c
    order by c.symbol;
$$;

revoke all on function public.tracked_symbol_coverage() from public, anon;
grant execute on function public.tracked_symbol_coverage() to authenticated, service_role;
