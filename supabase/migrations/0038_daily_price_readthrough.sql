-- DCA Tracker - service-role daily price read-through helpers.
--
-- The quote Worker uses these RPCs to prefer persisted daily_prices and only
-- fetch provider history for missing date ranges.

create or replace function public.daily_price_readthrough(p_items jsonb)
returns table (
    symbol text,
    trade_date date,
    close numeric,
    adjusted_close numeric,
    source text,
    as_of_timestamp timestamptz,
    is_provisional boolean,
    updated_at timestamptz
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
    )
    select
        i.symbol,
        dp.trade_date,
        dp.close,
        dp.adjusted_close,
        dp.source,
        dp.as_of_timestamp,
        dp.is_provisional,
        dp.updated_at
    from items i
    join public.daily_prices dp
      on dp.ticker = i.symbol
     and dp.trade_date between i.start_date and i.end_date
    where dp.close > 0
    order by i.symbol, dp.trade_date;
$$;

revoke all on function public.daily_price_readthrough(jsonb) from public, anon, authenticated;
grant execute on function public.daily_price_readthrough(jsonb) to service_role;

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
         and dp.close > 0
        where dp.trade_date is null
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
