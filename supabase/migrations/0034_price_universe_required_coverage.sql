-- DCA Tracker - required price coverage and active monitor universe.
--
-- Price health must be driven by business requirements, not by the oldest
-- price already present in daily_prices.

create or replace function public._current_price_universe(p_benchmark text default null)
returns table (
    symbol text,
    current_position text,
    required_start date,
    required_end date
)
language sql
stable
security definer
set search_path = public
as $$
    with
    normalized_settings as (
        select
            coalesce(
                nullif(public.normalize_symbol(p_benchmark), ''),
                nullif(public.normalize_symbol(selected_benchmark), ''),
                'SPY'
            ) as benchmark,
            coalesce(watchlist, '{}'::text[]) as watchlist
        from public.settings
    ),
    selected as (
        select coalesce((select benchmark from normalized_settings limit 1), 'SPY') as benchmark
    ),
    portfolio_start as (
        select min(trade_date) as first_calc_date
        from public.transactions
    ),
    tx_positions as (
        select
            public.normalize_symbol(ticker) as symbol,
            min(trade_date) as first_trade_date,
            sum(case when side = 'buy' then shares else -shares end) as shares
        from public.transactions
        group by public.normalize_symbol(ticker)
    ),
    watchlist_symbols as (
        select distinct public.normalize_symbol(value) as symbol
        from normalized_settings, unnest(watchlist) as symbols(value)
        where public.normalize_symbol(value) <> ''
    ),
    requested as (
        select
            t.symbol,
            case when abs(coalesce(t.shares, 0)) > 1e-9 then 'active' else 'closed' end as current_position,
            t.first_trade_date as required_start,
            10 as priority
        from tx_positions t

        union all

        select
            s.benchmark,
            'benchmark',
            coalesce(p.first_calc_date, current_date - interval '1 year')::date,
            1
        from selected s
        cross join portfolio_start p
        where s.benchmark <> ''

        union all

        select
            w.symbol,
            'watchlist',
            coalesce(ts.created_at::date, current_date - interval '1 year')::date,
            5
        from watchlist_symbols w
        left join public.tracked_symbols ts on ts.symbol = w.symbol
    ),
    ranked as (
        select
            r.*,
            row_number() over (
                partition by r.symbol
                order by
                    case r.current_position
                        when 'benchmark' then 1
                        when 'active' then 2
                        when 'watchlist' then 3
                        else 4
                    end,
                    r.required_start nulls last
            ) as rn
        from requested r
        where r.symbol <> ''
    ),
    calendar_end as (
        select coalesce(
            (
                select max(dp.trade_date)
                from public.daily_prices dp
                join selected s on s.benchmark = dp.ticker
                where dp.trade_date <= current_date
            ),
            (
                select max(dp.trade_date)
                from public.daily_prices dp
                where dp.ticker = 'SPY'
                  and dp.trade_date <= current_date
            ),
            current_date
        ) as required_end
    )
    select
        ranked.symbol,
        ranked.current_position,
        ranked.required_start,
        calendar_end.required_end
    from ranked
    cross join calendar_end
    where ranked.rn = 1
    order by ranked.symbol;
$$;

revoke all on function public._current_price_universe(text) from public, anon;

create or replace function public.active_monitor_universe(p_benchmark text default null)
returns table (
    symbol text,
    current_position text
)
language sql
stable
security definer
set search_path = public
as $$
    select u.symbol, u.current_position
    from public._current_price_universe(p_benchmark) u
    where u.current_position in ('active', 'benchmark', 'watchlist')
    order by u.symbol;
$$;

revoke all on function public.active_monitor_universe(text) from public, anon;
grant execute on function public.active_monitor_universe(text) to authenticated, service_role;

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
            when coalesce(ps.daily_rows, 0) = 0 and coalesce(ts.backfill_status, 'pending') = 'ok' then 'missing'
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
