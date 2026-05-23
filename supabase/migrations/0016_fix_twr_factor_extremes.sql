-- DCA Tracker — fix TWR factor extreme handling
--
-- The previous daily_factors used greatest(..., 0) to clamp factors, and
-- bool_or(factor = 0) cascaded a single zero into -100% for all subsequent
-- days. This replaces the cascade with null-skip: factors <= 0 become null
-- and are treated as missing days (no change), preventing silent -100% curves.

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
    v_has_recorded_cashflows boolean;
begin
    select least(
        (select min(usd_in_date) from public.cashflows where user_id = p_user_id and usd_in_date is not null),
        (select min(trade_date) from public.transactions where user_id = p_user_id)
    ) into v_start;

    if v_start is null then
        return jsonb_build_object(
            'series', '[]'::jsonb,
            'benchmark', v_benchmark,
            'method', 'TWR',
            'price_basis', 'adjusted_close_total_return_proxy',
            'dirty', false,
            'generated_at', to_jsonb(now())
        );
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
        )
        select jsonb_build_object(
            'series',
            coalesce(
                jsonb_agg(
                    jsonb_build_object(
                        'date', date,
                        'return_pct_user', return_pct_user,
                        'return_pct_spy', return_pct_benchmark
                    )
                    order by date
                ),
                '[]'::jsonb
            ),
            'benchmark',
            v_benchmark,
            'method',
            'TWR',
            'price_basis',
            'adjusted_close_total_return_proxy',
            'dirty',
            false,
            'generated_at',
            to_jsonb(now())
        )
        from cumulative
    );
end;
$$;

revoke all on function public._performance_history_for_user_fast(uuid, text) from public, anon, authenticated;
