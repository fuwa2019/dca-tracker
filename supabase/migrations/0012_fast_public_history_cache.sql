-- DCA Tracker — fast set-based public history cache
--
-- The chart only needs date + cumulative return percentages. Build that shape
-- directly for cached dashboard/share reads instead of materializing the full
-- amount-heavy history JSON.

create index if not exists transactions_user_upper_ticker_date_idx
    on public.transactions (user_id, (upper(ticker)), trade_date desc, created_at desc);

create or replace function public._history_points_count(p_history jsonb)
returns integer
language sql
stable
set search_path = public
as $$
    select case
        when jsonb_typeof(p_history->'series') = 'array'
            then jsonb_array_length(p_history->'series')
        else 0
    end;
$$;

revoke all on function public._history_points_count(jsonb) from public, anon, authenticated;

create or replace function public._public_history_for_user_fast(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_start date;
    v_has_recorded_cashflows boolean;
begin
    select least(
        (select min(usd_in_date) from public.cashflows where user_id = p_user_id and usd_in_date is not null),
        (select min(trade_date) from public.transactions where user_id = p_user_id)
    ) into v_start;

    if v_start is null then
        return jsonb_build_object('series', '[]'::jsonb, 'generated_at', to_jsonb(now()));
    end if;

    select exists(
        select 1
        from public.cashflows
        where user_id = p_user_id
          and usd_in_date is not null
          and usd_amount > 0
    ) into v_has_recorded_cashflows;

    return (
        with calendar as (
            select gs::date as date
            from generate_series(v_start, current_date, interval '1 day') as gs
        ),
        tickers as (
            select distinct upper(ticker) as ticker
            from public.transactions
            where user_id = p_user_id
        ),
        flows_raw as (
            select usd_in_date as date, usd_amount::numeric as amount
            from public.cashflows
            where v_has_recorded_cashflows
              and user_id = p_user_id
              and usd_in_date is not null
              and usd_amount > 0

            union all

            select trade_date as date, (shares * price)::numeric as amount
            from public.transactions
            where not v_has_recorded_cashflows
              and user_id = p_user_id
              and side = 'buy'
        ),
        flows as (
            select date, sum(amount) as flow
            from flows_raw
            group by date
        ),
        flow_lots as (
            select
                f.date as flow_date,
                f.flow,
                spy_buy.trade_date as spy_buy_date,
                spy_buy.close as spy_buy_close
            from flows f
            left join lateral (
                select trade_date, close
                from public.daily_prices
                where ticker = 'SPY'
                  and trade_date >= f.date
                  and close > 0
                order by trade_date
                limit 1
            ) spy_buy on true
        ),
        flow_cumulative as (
            select
                c.date,
                coalesce(sum(fl.flow) filter (where fl.flow_date <= c.date), 0) as invested,
                coalesce(
                    sum(fl.flow / fl.spy_buy_close) filter (
                        where fl.flow_date <= c.date
                          and fl.spy_buy_date <= c.date
                          and fl.spy_buy_close > 0
                    ),
                    0
                ) as spy_shares,
                coalesce(
                    sum(fl.flow) filter (
                        where fl.flow_date <= c.date
                          and (fl.spy_buy_date is null or fl.spy_buy_date > c.date)
                    ),
                    0
                ) as pending_spy
            from calendar c
            left join flow_lots fl on fl.flow_date <= c.date
            group by c.date
        ),
        txn_by_date as (
            select
                trade_date as date,
                sum(case when side = 'buy' then shares * price else -shares * price end)::numeric as cost_delta
            from public.transactions
            where user_id = p_user_id
            group by trade_date
        ),
        cost_cumulative as (
            select
                c.date,
                sum(coalesce(t.cost_delta, 0)) over (order by c.date) as cost_basis
            from calendar c
            left join txn_by_date t on t.date = c.date
        ),
        ticker_dates as (
            select c.date, t.ticker
            from calendar c
            cross join tickers t
        ),
        txn_by_ticker_date as (
            select
                trade_date as date,
                upper(ticker) as ticker,
                sum(case when side = 'buy' then shares else -shares end)::numeric as share_delta
            from public.transactions
            where user_id = p_user_id
            group by trade_date, upper(ticker)
        ),
        holdings as (
            select
                td.date,
                td.ticker,
                sum(coalesce(tx.share_delta, 0)) over (
                    partition by td.ticker
                    order by td.date
                ) as shares
            from ticker_dates td
            left join txn_by_ticker_date tx
              on tx.date = td.date
             and tx.ticker = td.ticker
        ),
        stock_values as (
            select
                h.date,
                sum(h.shares * coalesce(dp.close, last_trade.price, 0)) as stock_mv
            from holdings h
            left join lateral (
                select close
                from public.daily_prices
                where ticker = h.ticker
                  and trade_date >= v_start
                  and trade_date <= h.date
                order by trade_date desc
                limit 1
            ) dp on true
            left join lateral (
                select price
                from public.transactions
                where user_id = p_user_id
                  and upper(ticker) = h.ticker
                  and trade_date <= h.date
                order by trade_date desc, created_at desc
                limit 1
            ) last_trade on true
            where abs(h.shares) > 0.000000001
            group by h.date
        ),
        nav as (
            select
                c.date,
                coalesce(f.flow, 0) as flow,
                coalesce(fc.invested, 0) as invested,
                coalesce(sv.stock_mv, 0) + coalesce(fc.invested, 0) - coalesce(cc.cost_basis, 0) as nav_user,
                coalesce(fc.spy_shares, 0) * coalesce(spy_px.close, 0) + coalesce(fc.pending_spy, 0) as nav_spy
            from calendar c
            left join flows f on f.date = c.date
            left join flow_cumulative fc on fc.date = c.date
            left join cost_cumulative cc on cc.date = c.date
            left join stock_values sv on sv.date = c.date
            left join lateral (
                select close
                from public.daily_prices
                where ticker = 'SPY'
                  and trade_date >= v_start
                  and trade_date <= c.date
                order by trade_date desc
                limit 1
            ) spy_px on true
        ),
        daily_returns as (
            select
                date,
                case
                    when lag(nav_user) over (order by date) > 0
                        then greatest((nav_user - flow) / lag(nav_user) over (order by date), 0)
                    else null
                end as user_factor,
                case
                    when lag(nav_spy) over (order by date) > 0
                        then greatest((nav_spy - flow) / lag(nav_spy) over (order by date), 0)
                    else null
                end as spy_factor
            from nav
        ),
        cumulative as (
            select
                date,
                case
                    when bool_or(user_factor = 0) over (order by date) then -1
                    else coalesce(exp(sum(ln(user_factor)) filter (where user_factor > 0) over (order by date)) - 1, 0)
                end as return_pct_user,
                case
                    when bool_or(spy_factor = 0) over (order by date) then -1
                    else coalesce(exp(sum(ln(spy_factor)) filter (where spy_factor > 0) over (order by date)) - 1, 0)
                end as return_pct_spy
            from daily_returns
        )
        select jsonb_build_object(
            'series',
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'date', date,
                        'return_pct_user', return_pct_user,
                        'return_pct_spy', return_pct_spy
                    )
                    order by date
                ),
                '[]'::jsonb
            ),
            'generated_at',
            to_jsonb(now())
        )
        from cumulative
    );
end;
$$;

revoke all on function public._public_history_for_user_fast(uuid) from public, anon, authenticated;

create or replace function public._refresh_portfolio_history_cache_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_history jsonb;
begin
    v_history := public._public_history_for_user_fast(p_user_id);

    insert into public.portfolio_history_cache (
        user_id,
        full_history,
        public_history,
        generated_at,
        updated_at
    )
    values (
        p_user_id,
        v_history,
        v_history,
        now(),
        now()
    )
    on conflict (user_id) do update set
        full_history = excluded.full_history,
        public_history = excluded.public_history,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at;

    return v_history;
end;
$$;

revoke all on function public._refresh_portfolio_history_cache_for_user(uuid) from public, anon, authenticated;

create or replace function public.refresh_portfolio_history_cache()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_history jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_history := public._refresh_portfolio_history_cache_for_user(auth.uid());

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

grant execute on function public.refresh_portfolio_history_cache() to authenticated;

create or replace function public.refresh_shared_history_cache(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_history jsonb;
begin
    select user_id into v_user_id
    from public.share_links
    where token = p_token
      and revoked = false
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_user_id is null then
        return jsonb_build_object('error', 'invalid_or_expired_token');
    end if;

    v_history := public._refresh_portfolio_history_cache_for_user(v_user_id);

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'updated_at', to_jsonb(now()),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

revoke all on function public.refresh_shared_history_cache(text) from public, anon, authenticated;
grant execute on function public.refresh_shared_history_cache(text) to authenticated;

update public.portfolio_history_cache
set
    full_history = public_history,
    updated_at = now()
where public._history_points_count(public_history) > 0;
