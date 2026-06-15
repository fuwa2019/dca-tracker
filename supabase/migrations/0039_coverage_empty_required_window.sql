-- DCA Tracker - do not flag freshly opened positions as missing prices.
--
-- A position opened intraday (before that day's daily close has synced) has
-- required_start = first_trade_date later than required_end = latest settled
-- benchmark close. The required window [required_start, required_end] is then
-- empty/inverted, so daily_rows counts to 0 even though the symbol may have a
-- full price history outside that window. The previous backfill_status CASE
-- flipped such symbols to 'missing' purely on daily_rows = 0, surfacing a false
-- "缺价格" alarm in data-health that no backfill could clear.
--
-- Fix: only report 'missing' when the required window actually contains
-- benchmark trading days (required_days > 0). When the window is empty there is
-- nothing to cover yet, so report the symbol's real tracked_symbols status.

create or replace function public.tracked_symbol_coverage(p_benchmark text default null)
returns table (
    symbol text,
    name text,
    asset_type text,
    daily_rows bigint,
    adjusted_rows bigint,
    first_daily_date date,
    last_daily_date date,
    price_min_date date,
    price_max_date date,
    required_start date,
    required_end date,
    coverage numeric,
    missing_days bigint,
    current_position text,
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
    with
    selected as (
        select coalesce(nullif(public.normalize_symbol(p_benchmark), ''), 'SPY') as benchmark
    ),
    universe as (
        select *
        from public._current_price_universe((select benchmark from selected))
    ),
    price_stats as (
        select
            u.symbol,
            count(dp.trade_date) filter (
                where dp.trade_date between u.required_start and u.required_end
            ) as daily_rows,
            count(dp.trade_date) filter (
                where dp.trade_date between u.required_start and u.required_end
                  and coalesce(dp.adjusted_close, 0) > 0
            ) as adjusted_rows,
            min(dp.trade_date) filter (
                where dp.trade_date between u.required_start and u.required_end
            ) as first_daily_date,
            max(dp.trade_date) filter (
                where dp.trade_date between u.required_start and u.required_end
            ) as last_daily_date,
            min(dp.trade_date) as price_min_date,
            max(dp.trade_date) as price_max_date
        from universe u
        left join public.daily_prices dp on dp.ticker = u.symbol
        group by u.symbol
    ),
    calendar as (
        select
            u.symbol,
            count(c.trade_date) as required_days
        from universe u
        left join public.daily_prices c
          on c.ticker = (select benchmark from selected)
         and c.trade_date between u.required_start and u.required_end
        group by u.symbol
    )
    select
        u.symbol,
        ts.name,
        ts.asset_type,
        coalesce(ps.daily_rows, 0) as daily_rows,
        coalesce(ps.adjusted_rows, 0) as adjusted_rows,
        ps.first_daily_date,
        ps.last_daily_date,
        ps.price_min_date,
        ps.price_max_date,
        u.required_start,
        u.required_end,
        case
            when coalesce(c.required_days, 0) = 0 then 1
            else round(coalesce(ps.daily_rows, 0)::numeric / c.required_days::numeric, 4)
        end as coverage,
        greatest(coalesce(c.required_days, 0) - coalesce(ps.daily_rows, 0), 0) as missing_days,
        u.current_position,
        case
            when coalesce(ps.daily_rows, 0) = 0
                 and coalesce(c.required_days, 0) > 0
                 and coalesce(ts.backfill_status, 'pending') = 'ok' then 'missing'
            else coalesce(ts.backfill_status, 'pending')
        end as backfill_status,
        ts.last_backfill_at,
        ts.backfill_error,
        ts.first_trade_date
    from universe u
    left join public.tracked_symbols ts on ts.symbol = u.symbol
    left join price_stats ps on ps.symbol = u.symbol
    left join calendar c on c.symbol = u.symbol
    order by u.symbol;
$$;

revoke all on function public.tracked_symbol_coverage(text) from public, anon;
grant execute on function public.tracked_symbol_coverage(text) to authenticated, service_role;
