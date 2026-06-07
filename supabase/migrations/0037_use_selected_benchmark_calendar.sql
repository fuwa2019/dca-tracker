-- DCA Tracker - report benchmark trading calendar dynamically.
--
-- The performance payload should identify the selected benchmark as the
-- trading calendar. This keeps dashboard/share labels and cache metadata
-- aligned when the user selects QQQ or another benchmark instead of SPY.

do $$
declare
    v_def text;
    v_next_def text;
begin
    select pg_get_functiondef('public._performance_history_for_user_fast_base(uuid,text)'::regprocedure)
    into v_def;

    if v_def is null then
        raise exception 'public._performance_history_for_user_fast_base(uuid,text) is missing';
    end if;

    if v_def ~ 'v_trading_calendar\s+text\s*:=\s*v_benchmark;' then
        v_next_def := v_def;
    else
        v_next_def := regexp_replace(
            v_def,
            'v_trading_calendar\s+text\s*:=\s*''SPY'';',
            'v_trading_calendar text := v_benchmark;'
        );
    end if;

    if v_next_def = v_def and v_def !~ 'v_trading_calendar\s+text\s*:=\s*v_benchmark;' then
        raise exception 'could not update trading calendar declaration in _performance_history_for_user_fast_base';
    end if;

    execute v_next_def;
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
    v_benchmark text := upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'));
    v_trading_calendar text;
    v_new_york_today date := (now() at time zone 'America/New_York')::date;
begin
    v_history := public._performance_history_for_user_fast_base(p_user_id, v_benchmark);
    v_trading_calendar := upper(coalesce(nullif(v_history->>'trading_calendar', ''), v_benchmark));

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
      on calendar_price.ticker = v_trading_calendar
     and calendar_price.trade_date = (point->>'date')::date
     and coalesce(calendar_price.adjusted_close, calendar_price.close) > 0
    left join lateral (
        select
            max(dp.as_of_timestamp) as as_of_timestamp,
            coalesce(bool_or(dp.is_provisional), false) as is_provisional
        from public.daily_prices dp
        where dp.trade_date = calendar_price.trade_date
          and (
            dp.ticker in (v_trading_calendar, v_benchmark)
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
            'trading_calendar', v_trading_calendar,
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
