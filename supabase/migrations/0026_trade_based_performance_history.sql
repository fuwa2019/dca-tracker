-- DCA Tracker - switch performance history to trade-based capital flows.
--
-- The performance chart now starts at the first transaction and ignores idle
-- deposits made before trading begins. External benchmark/user flows are
-- inferred from actual trade funding needs: sell proceeds fund later buys first;
-- only the unfunded portion of a buy becomes a new external flow.

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
    v_start date;
    v_benchmark text := upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'));
begin
    select min(trade_date)
    into v_start
    from public.transactions
    where user_id = p_user_id;

    if v_start is null then
        return jsonb_build_object(
            'series', '[]'::jsonb,
            'benchmark', v_benchmark,
            'method', 'TWR',
            'flow_basis', 'trade_funding',
            'price_basis', 'adjusted_close_total_return_proxy',
            'dirty', false,
            'warnings', '[]'::jsonb,
            'generated_at', to_jsonb(now())
        );
    end if;

    return (
        with recursive
        calendar as (
            select gs::date as date
            from generate_series(v_start, current_date, interval '1 day') as gs
        ),
        tickers as (
            select distinct upper(ticker) as ticker
            from public.transactions
            where user_id = p_user_id
        ),
        ordered_txns as (
            select
                row_number() over (order by trade_date, created_at, id) as n,
                trade_date as date,
                side,
                case when side = 'buy' then (shares * price)::numeric else 0::numeric end as buy_notional,
                case when side = 'sell' then (shares * price)::numeric else 0::numeric end as sell_notional
            from public.transactions
            where user_id = p_user_id
        ),
        trade_cash as (
            select
                n,
                date,
                side,
                buy_notional,
                sell_notional,
                case when side = 'buy' then buy_notional else 0::numeric end as flow,
                case when side = 'buy' then 0::numeric else sell_notional end as cash_after
            from ordered_txns
            where n = 1

            union all

            select
                o.n,
                o.date,
                o.side,
                o.buy_notional,
                o.sell_notional,
                case
                    when o.side = 'buy' then greatest(o.buy_notional - tc.cash_after, 0)
                    else 0::numeric
                end as flow,
                case
                    when o.side = 'buy' then greatest(tc.cash_after - o.buy_notional, 0)
                    else tc.cash_after + o.sell_notional
                end as cash_after
            from trade_cash tc
            join ordered_txns o on o.n = tc.n + 1
        ),
        flows as (
            select date, sum(flow) as flow
            from trade_cash
            where flow > 0
            group by date
        ),
        benchmark_lots as (
            select
                f.date as flow_date,
                f.flow,
                bpx.trade_date as buy_date,
                bpx.price as buy_price
            from flows f
            left join lateral (
                select
                    trade_date,
                    coalesce(adjusted_close, close) as price
                from public.daily_prices
                where ticker = v_benchmark
                  and trade_date >= f.date
                  and coalesce(adjusted_close, close) > 0
                order by trade_date
                limit 1
            ) bpx on true
        ),
        benchmark_cumulative as (
            select
                c.date,
                coalesce(sum(bl.flow) filter (where bl.flow_date <= c.date), 0) as invested,
                coalesce(
                    sum(bl.flow / bl.buy_price) filter (
                        where bl.flow_date <= c.date
                          and bl.buy_date <= c.date
                          and bl.buy_price > 0
                    ),
                    0
                ) as benchmark_units,
                coalesce(
                    sum(bl.flow) filter (
                        where bl.flow_date <= c.date
                          and (bl.buy_date is null or bl.buy_date > c.date)
                    ),
                    0
                ) as pending_benchmark
            from calendar c
            left join benchmark_lots bl on bl.flow_date <= c.date
            group by c.date
        ),
        txn_events as (
            select
                trade_date as date,
                upper(ticker) as ticker,
                (case when side = 'buy' then shares * price else -shares * price end)::numeric as notional_delta,
                price::numeric as trade_price
            from public.transactions
            where user_id = p_user_id
        ),
        txn_units as (
            select
                e.date,
                e.ticker,
                e.notional_delta,
                e.notional_delta / nullif(coalesce(tpx.price, e.trade_price), 0) as unit_delta
            from txn_events e
            left join lateral (
                select coalesce(adjusted_close, close) as price
                from public.daily_prices
                where ticker = e.ticker
                  and trade_date >= e.date
                  and coalesce(adjusted_close, close) > 0
                order by trade_date
                limit 1
            ) tpx on true
        ),
        txn_units_by_date as (
            select
                date,
                ticker,
                sum(coalesce(unit_delta, 0)) as unit_delta,
                sum(notional_delta) as cost_delta
            from txn_units
            group by date, ticker
        ),
        txn_cost_by_date as (
            select date, sum(cost_delta) as cost_delta
            from txn_units_by_date
            group by date
        ),
        cost_cumulative as (
            select
                c.date,
                sum(coalesce(t.cost_delta, 0)) over (order by c.date) as cost_basis
            from calendar c
            left join txn_cost_by_date t on t.date = c.date
        ),
        ticker_dates as (
            select c.date, t.ticker
            from calendar c
            cross join tickers t
        ),
        user_units as (
            select
                td.date,
                td.ticker,
                sum(coalesce(tu.unit_delta, 0)) over (
                    partition by td.ticker
                    order by td.date
                ) as units
            from ticker_dates td
            left join txn_units_by_date tu
              on tu.date = td.date
             and tu.ticker = td.ticker
        ),
        user_stock_values as (
            select
                uu.date,
                sum(uu.units * coalesce(upx.price, last_trade.price, 0)) as stock_value
            from user_units uu
            left join lateral (
                select coalesce(adjusted_close, close) as price
                from public.daily_prices
                where ticker = uu.ticker
                  and trade_date >= v_start
                  and trade_date <= uu.date
                  and coalesce(adjusted_close, close) > 0
                order by trade_date desc
                limit 1
            ) upx on true
            left join lateral (
                select price
                from public.transactions
                where user_id = p_user_id
                  and upper(ticker) = uu.ticker
                  and trade_date <= uu.date
                order by trade_date desc, created_at desc
                limit 1
            ) last_trade on true
            where abs(uu.units) > 0.000000001
            group by uu.date
        ),
        nav as (
            select
                c.date,
                coalesce(f.flow, 0) as flow,
                coalesce(bc.invested, 0) as invested,
                coalesce(usv.stock_value, 0)
                    + coalesce(bc.invested, 0)
                    - coalesce(cc.cost_basis, 0) as nav_user,
                coalesce(bc.benchmark_units, 0) * coalesce(bpx.price, 0)
                    + coalesce(bc.pending_benchmark, 0) as nav_benchmark
            from calendar c
            left join flows f on f.date = c.date
            left join benchmark_cumulative bc on bc.date = c.date
            left join cost_cumulative cc on cc.date = c.date
            left join user_stock_values usv on usv.date = c.date
            left join lateral (
                select coalesce(adjusted_close, close) as price
                from public.daily_prices
                where ticker = v_benchmark
                  and trade_date >= v_start
                  and trade_date <= c.date
                  and coalesce(adjusted_close, close) > 0
                order by trade_date desc
                limit 1
            ) bpx on true
        ),
        nav_with_prev as (
            select
                date,
                flow,
                nav_user,
                nav_benchmark,
                lag(nav_user) over (order by date) as prev_nav_user,
                lag(nav_benchmark) over (order by date) as prev_nav_benchmark
            from nav
        ),
        daily_factors as (
            select
                date,
                flow,
                nav_user,
                nav_benchmark,
                prev_nav_user,
                prev_nav_benchmark,
                case
                    when prev_nav_user > 0 and (nav_user - flow) > 0
                        then (nav_user - flow) / prev_nav_user
                    else null
                end as user_factor,
                case
                    when prev_nav_benchmark > 0 and (nav_benchmark - flow) > 0
                        then (nav_benchmark - flow) / prev_nav_benchmark
                    else null
                end as benchmark_factor
            from nav_with_prev
        ),
        warnings_source as (
            select
                date,
                case
                    when user_factor is null and prev_nav_user > 0 and (nav_user - flow) <= 0
                     and benchmark_factor is null and prev_nav_benchmark > 0 and (nav_benchmark - flow) <= 0
                    then 'both'
                    when user_factor is null and prev_nav_user > 0 and (nav_user - flow) <= 0
                    then 'user'
                    else 'benchmark'
                end as skip_type,
                nav_user,
                nav_benchmark,
                flow
            from daily_factors
            where date > v_start
              and (
                (user_factor is null and prev_nav_user > 0 and (nav_user - flow) <= 0)
                or
                (benchmark_factor is null and prev_nav_benchmark > 0 and (nav_benchmark - flow) <= 0)
              )
        ),
        cumulative as (
            select
                date,
                coalesce(
                    exp(sum(ln(user_factor)) filter (where user_factor > 0) over (order by date)) - 1,
                    null
                ) as return_pct_user,
                coalesce(
                    exp(sum(ln(benchmark_factor)) filter (where benchmark_factor > 0) over (order by date)) - 1,
                    null
                ) as return_pct_benchmark
            from daily_factors
        ),
        series_json as (
            select coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'date', date,
                        'return_pct_user', return_pct_user,
                        'return_pct_spy', return_pct_benchmark
                    )
                    order by date
                ),
                '[]'::jsonb
            ) as series
            from cumulative
        ),
        warnings_json as (
            select coalesce(
                (select jsonb_agg(
                    jsonb_build_object(
                        'date', date,
                        'type', skip_type,
                        'nav_user', nav_user,
                        'nav_benchmark', nav_benchmark,
                        'flow', flow
                    )
                    order by date
                ) from warnings_source),
                '[]'::jsonb
            ) as warnings
        )
        select jsonb_build_object(
            'series', s.series,
            'benchmark', v_benchmark,
            'method', 'TWR',
            'flow_basis', 'trade_funding',
            'price_basis', 'adjusted_close_total_return_proxy',
            'dirty', false,
            'warnings', w.warnings,
            'generated_at', to_jsonb(now())
        )
        from series_json s
        cross join warnings_json w
    );
end;
$$;

revoke all on function public._performance_history_for_user_fast(uuid, text) from public, anon, authenticated;

create or replace function public._performance_source_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select md5(coalesce((
        select string_agg(item, '|' order by item)
        from (
            select concat_ws(
                ':',
                'txn',
                id,
                trade_date,
                upper(ticker),
                side,
                price,
                shares,
                kind,
                updated_at
            ) as item
            from public.transactions
            where user_id = p_user_id

            union all

            select concat_ws(
                ':',
                'price',
                ticker,
                max(trade_date),
                count(*),
                max(updated_at)
            ) as item
            from public.daily_prices
            where ticker = 'SPY'
               or ticker in (
                   select distinct upper(ticker)
                   from public.transactions
                   where user_id = p_user_id
               )
            group by ticker
        ) src
    ), 'empty'));
$$;

revoke all on function public._performance_source_hash(uuid) from public, anon, authenticated;

drop trigger if exists cashflows_invalidate_history_cache on public.cashflows;

update public.performance_history_cache
set dirty = true,
    source_hash = null,
    updated_at = now();
