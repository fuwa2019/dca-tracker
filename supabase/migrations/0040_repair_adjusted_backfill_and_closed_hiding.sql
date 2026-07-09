-- DCA Tracker - repair adjusted-close backfill and closed-symbol hiding.
--
-- History read-through previously treated a row with close > 0 as complete
-- even when adjusted_close was still null or the row was quote-provisional.
-- Data Health could therefore keep showing "missing adjusted close" after
-- "backfill daily prices". The missing-range RPC now asks the Worker to refetch
-- those rows so final adjusted candles replace provisional data.
--
-- Closed tickers are derived from transactions, not from tracked_symbols alone,
-- so physically deleting tracked_symbols rows cannot hide them. Instead, hide a
-- closed ticker by setting tracked_symbols.enabled = false. Active positions are
-- always monitored again, and _upsert_tracked_symbol re-enables a ticker on a
-- future buy.

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
            max(trade_date) as last_trade_date,
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
            case when abs(coalesce(t.shares, 0)) > 1e-9 then null::date else t.last_trade_date end as required_end,
            10 as priority
        from tx_positions t
        left join public.tracked_symbols ts on ts.symbol = t.symbol
        where abs(coalesce(t.shares, 0)) > 1e-9
           or coalesce(ts.enabled, true)

        union all

        select
            s.benchmark,
            'benchmark',
            coalesce(p.first_calc_date, current_date - interval '1 year')::date,
            null::date,
            1
        from selected s
        cross join portfolio_start p
        where s.benchmark <> ''

        union all

        select
            w.symbol,
            'watchlist',
            coalesce(ts.created_at::date, current_date - interval '1 year')::date,
            null::date,
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
        case
            when ranked.current_position = 'closed'
                then coalesce(ranked.required_end, calendar_end.required_end)
            else calendar_end.required_end
        end as required_end
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

create or replace function public.hide_closed_tracked_symbol(
    p_symbol text,
    p_benchmark text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_symbol text := public.normalize_symbol(p_symbol);
    v_user_id uuid := auth.uid();
    v_shares numeric;
begin
    if v_user_id is null then
        raise exception 'login required' using errcode = '28000';
    end if;

    if v_symbol = '' then
        raise exception 'symbol is required' using errcode = '22023';
    end if;

    select sum(case when side = 'buy' then shares else -shares end)
    into v_shares
    from public.transactions
    where user_id = v_user_id
      and public.normalize_symbol(ticker) = v_symbol;

    if v_shares is null then
        raise exception 'symbol has no transaction history' using errcode = '22023';
    end if;

    if abs(coalesce(v_shares, 0)) > 1e-9 then
        raise exception 'only closed symbols can be hidden' using errcode = '22023';
    end if;

    insert into public.tracked_symbols (
        symbol,
        enabled,
        source,
        backfill_status,
        updated_at
    )
    values (
        v_symbol,
        false,
        'transaction',
        'ok',
        now()
    )
    on conflict (symbol) do update set
        enabled = false,
        updated_at = excluded.updated_at;

    perform public._upsert_tracked_symbol(
        coalesce(nullif(public.normalize_symbol(p_benchmark), ''), 'SPY'),
        null,
        null,
        'benchmark',
        null
    );

    return true;
end;
$$;

revoke all on function public.hide_closed_tracked_symbol(text, text) from public, anon;
grant execute on function public.hide_closed_tracked_symbol(text, text) to authenticated, service_role;

create or replace function public.daily_price_missing_ranges(
    p_items jsonb,
    p_calendar_symbol text default 'SPY'
)
returns table (
    symbol text,
    start_date date,
    end_date date
)
language sql
stable
security definer
set search_path = public
as $$
    with items as (
        select
            public.normalize_symbol(r.symbol) as symbol,
            r.start_date,
            r.end_date
        from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as r(
            symbol text,
            start_date date,
            end_date date
        )
        where public.normalize_symbol(r.symbol) <> ''
          and r.start_date is not null
          and r.end_date is not null
          and r.start_date <= r.end_date
    ),
    calendar_symbol as (
        select coalesce(nullif(public.normalize_symbol(p_calendar_symbol), ''), 'SPY') as symbol
    ),
    calendar_days as (
        select dp.trade_date
        from public.daily_prices dp
        join calendar_symbol c on c.symbol = dp.ticker
        where dp.close > 0
    ),
    item_calendar_counts as (
        select
            i.symbol,
            count(c.trade_date) as calendar_days
        from items i
        left join calendar_days c
          on c.trade_date between i.start_date and i.end_date
        group by i.symbol
    ),
    whole_missing as (
        select i.symbol, i.start_date as trade_date, i.start_date, i.end_date
        from items i
        join item_calendar_counts c on c.symbol = i.symbol
        where c.calendar_days = 0
    ),
    missing_days as (
        select
            i.symbol,
            c.trade_date,
            null::date as start_date,
            null::date as end_date
        from items i
        join item_calendar_counts counts on counts.symbol = i.symbol and counts.calendar_days > 0
        join calendar_days c on c.trade_date between i.start_date and i.end_date
        left join public.daily_prices dp
          on dp.ticker = i.symbol
         and dp.trade_date = c.trade_date
        where dp.trade_date is null
           or coalesce(dp.close, 0) <= 0
           or coalesce(dp.adjusted_close, 0) <= 0
           or coalesce(dp.is_provisional, false)
    ),
    all_missing as (
        select * from whole_missing
        union all
        select * from missing_days
    ),
    numbered as (
        select
            m.*,
            row_number() over (partition by m.symbol order by m.trade_date) as rn
        from all_missing m
    ),
    grouped as (
        select
            n.*,
            n.trade_date - (n.rn::int * interval '1 day') as grp
        from numbered n
    )
    select
        g.symbol,
        coalesce(min(g.start_date), min(g.trade_date)) as start_date,
        coalesce(max(g.end_date), max(g.trade_date)) as end_date
    from grouped g
    group by g.symbol, g.grp
    order by g.symbol, 2;
$$;

revoke all on function public.daily_price_missing_ranges(jsonb, text) from public, anon, authenticated;
grant execute on function public.daily_price_missing_ranges(jsonb, text) to service_role;
