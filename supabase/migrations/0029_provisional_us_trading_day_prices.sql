-- DCA Tracker - provisional US trading-day prices and explicit as-of timestamps.
--
-- Historical daily candles can lag after the US close. The quote Worker writes
-- a provisional close for the completed America/New_York session, then replaces
-- it with the provider's final daily candle on a later sync.

alter table public.daily_prices
    add column if not exists as_of_timestamp timestamptz,
    add column if not exists is_provisional boolean not null default false;

update public.daily_prices
set as_of_timestamp = updated_at
where as_of_timestamp is null;

alter table public.quote_snapshots
    add column if not exists as_of_timestamp timestamptz;

update public.quote_snapshots
set as_of_timestamp = updated_at
where as_of_timestamp is null;

create or replace function public.upsert_daily_prices(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_updated bigint := 0;
    v_inserted bigint := 0;
begin
    create temporary table tmp_daily_prices_upsert (
        ticker text not null,
        trade_date date not null,
        close numeric not null,
        adjusted_close numeric,
        source text,
        as_of_timestamp timestamptz not null,
        is_provisional boolean not null,
        updated_at timestamptz not null
    ) on commit drop;

    insert into tmp_daily_prices_upsert (
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        as_of_timestamp,
        is_provisional,
        updated_at
    )
    select distinct on (ticker, trade_date)
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        coalesce(as_of_timestamp, updated_at, now()),
        coalesce(is_provisional, false),
        coalesce(updated_at, now())
    from (
        select
            upper(trim(ticker)) as ticker,
            trade_date,
            close,
            adjusted_close,
            source,
            as_of_timestamp,
            is_provisional,
            updated_at
        from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
            ticker text,
            trade_date date,
            close numeric,
            adjusted_close numeric,
            source text,
            as_of_timestamp timestamptz,
            is_provisional boolean,
            updated_at timestamptz
        )
    ) parsed
    where ticker <> ''
      and trade_date is not null
      and close > 0
    order by ticker, trade_date, updated_at desc nulls last;

    update public.daily_prices dp
    set
        close = d.close,
        adjusted_close = d.adjusted_close,
        source = d.source,
        as_of_timestamp = d.as_of_timestamp,
        is_provisional = d.is_provisional,
        updated_at = d.updated_at
    from tmp_daily_prices_upsert d
    where dp.ticker = d.ticker
      and dp.trade_date = d.trade_date
      and (
        (dp.is_provisional and not d.is_provisional)
        or (
          dp.is_provisional = d.is_provisional
          and (
            dp.close is distinct from d.close
            or dp.adjusted_close is distinct from d.adjusted_close
            or dp.source is distinct from d.source
            or dp.as_of_timestamp is distinct from d.as_of_timestamp
          )
        )
      );

    get diagnostics v_updated = row_count;

    insert into public.daily_prices (
        ticker,
        trade_date,
        close,
        adjusted_close,
        source,
        as_of_timestamp,
        is_provisional,
        updated_at
    )
    select
        d.ticker,
        d.trade_date,
        d.close,
        d.adjusted_close,
        d.source,
        d.as_of_timestamp,
        d.is_provisional,
        d.updated_at
    from tmp_daily_prices_upsert d
    where not exists (
        select 1
        from public.daily_prices dp
        where dp.ticker = d.ticker
          and dp.trade_date = d.trade_date
    )
    on conflict (ticker, trade_date) do nothing;

    get diagnostics v_inserted = row_count;

    return jsonb_build_object(
        'ok', true,
        'updated', v_updated,
        'inserted', v_inserted,
        'rows', v_updated + v_inserted
    );
end;
$$;

revoke all on function public.upsert_daily_prices(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_daily_prices(jsonb) to service_role;

do $$
begin
    if to_regprocedure('public._performance_history_for_user_fast_base(uuid,text)') is null
       and to_regprocedure('public._performance_history_for_user_fast(uuid,text)') is not null then
        alter function public._performance_history_for_user_fast(uuid, text)
            rename to _performance_history_for_user_fast_base;
    end if;
end;
$$;

create or replace function public._performance_history_for_user_fast(
    p_user_id uuid,
    p_benchmark text default 'SPY'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_history jsonb;
    v_series jsonb;
    v_new_york_today date := (now() at time zone 'America/New_York')::date;
begin
    v_history := public._performance_history_for_user_fast_base(p_user_id, p_benchmark);

    select coalesce(
        jsonb_agg(
            point
            || jsonb_build_object(
                'trading_date', point->>'date',
                'as_of_timestamp', point_prices.as_of_timestamp,
                'is_provisional', point_prices.is_provisional
            )
            order by point->>'date'
        ),
        '[]'::jsonb
    )
    into v_series
    from jsonb_array_elements(coalesce(v_history->'series', '[]'::jsonb)) as points(point)
    join public.daily_prices calendar_price
      on calendar_price.ticker = 'SPY'
     and calendar_price.trade_date = (point->>'date')::date
     and coalesce(calendar_price.adjusted_close, calendar_price.close) > 0
    left join lateral (
        select
            max(dp.as_of_timestamp) as as_of_timestamp,
            coalesce(bool_or(dp.is_provisional), false) as is_provisional
        from public.daily_prices dp
        where dp.trade_date = calendar_price.trade_date
          and (
            dp.ticker in ('SPY', upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY')))
            or dp.ticker in (
                select distinct upper(ticker)
                from public.transactions
                where user_id = p_user_id
            )
          )
    ) point_prices on true
    where calendar_price.trade_date <= v_new_york_today;

    return jsonb_set(v_history, '{series}', v_series, true)
        || jsonb_build_object(
            'trading_date_timezone', 'America/New_York'
        );
end;
$$;

revoke all on function public._performance_history_for_user_fast_base(uuid, text) from public, anon, authenticated;
revoke all on function public._performance_history_for_user_fast(uuid, text) from public, anon, authenticated;

update public.performance_history_cache
set dirty = true,
    source_hash = null,
    updated_at = now();
