-- DCA Tracker — transaction timeline validation and TWR factor handling
--
-- 1. Sell validation: full timeline-based running-shares check.
--    Replaces the simpler net-shares query in 0015 with a row-by-row
--    walk that catches any point in time where shares go negative.
--    Three separate branches (INSERT/UPDATE/DELETE) — never cross-
--    reference OLD/NEW incorrectly.
--
-- 2. TWR factor: replaces greatest(...,0) clamp and bool_or(factor=0)→-1
--    cascade. Factors <= 0 or non-finite become null and are skipped
--    (no-change day). Returns structured warnings for skipped days.

-- ============================================================================
-- PART 1: Sell validation — timeline-based running shares
-- ============================================================================

create or replace function public._check_sell_shares()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_txn record;
    v_running numeric := 0;
    v_uid uuid;
    v_ticker text;
begin
    -- Three separate branches — never reference OLD during INSERT,
    -- never reference NEW during DELETE.
    if tg_op = 'INSERT' then
        v_uid := new.user_id;
        v_ticker := upper(new.ticker);

        for v_txn in
            select id, side, shares, trade_date, created_at
            from (
                select id, side, shares, trade_date, created_at
                from public.transactions
                where user_id = v_uid
                  and upper(ticker) = v_ticker

                union all

                select new.id, new.side, new.shares, new.trade_date, coalesce(new.created_at, now())
            ) t
            order by trade_date, created_at, id
        loop
            v_running := v_running
                + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

            if v_running < -1e-9 then
                raise exception 'oversell: running shares became negative (%) at % % of % on %',
                    v_running, v_txn.side, v_txn.shares, v_ticker, v_txn.trade_date;
            end if;
        end loop;

    elsif tg_op = 'UPDATE' then
        v_uid := new.user_id;
        v_ticker := upper(new.ticker);

        for v_txn in
            select id, side, shares, trade_date, created_at
            from (
                -- existing rows, excluding the row being updated
                select id, side, shares, trade_date, created_at
                from public.transactions
                where user_id = v_uid
                  and upper(ticker) = v_ticker
                  and id <> old.id

                union all

                -- NEW version of the row
                select new.id, new.side, new.shares, new.trade_date, coalesce(new.created_at, now())
            ) t
            order by trade_date, created_at, id
        loop
            v_running := v_running
                + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

            if v_running < -1e-9 then
                raise exception 'oversell: running shares became negative (%) at % % of % on %',
                    v_running, v_txn.side, v_txn.shares, v_ticker, v_txn.trade_date;
            end if;
        end loop;

    else  -- DELETE
        v_uid := old.user_id;
        v_ticker := upper(old.ticker);

        for v_txn in
            select id, side, shares, trade_date, created_at
            from public.transactions
            where user_id = v_uid
              and upper(ticker) = v_ticker
              and id <> old.id
            order by trade_date, created_at, id
        loop
            v_running := v_running
                + case when v_txn.side = 'buy' then v_txn.shares else -v_txn.shares end;

            if v_running < -1e-9 then
                raise exception 'cannot delete: removing this row would cause negative shares (%) at % % of % on %',
                    v_running, v_txn.side, v_txn.shares, v_ticker, v_txn.trade_date;
            end if;
        end loop;
        return old;
    end if;

    return new;
end;
$$;

revoke all on function public._check_sell_shares() from public, anon, authenticated;

-- Replace trigger to include DELETE
drop trigger if exists transactions_check_sell_shares on public.transactions;
create trigger transactions_check_sell_shares
before insert or update or delete on public.transactions
for each row execute function public._check_sell_shares();

-- ============================================================================
-- PART 2: TWR factor — skip invalid factors instead of -100% cascade
-- ============================================================================

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
    v_result jsonb;
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
            'warnings', '[]'::jsonb,
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
        'warnings',
        coalesce(max(warnings_arr), '[]'::jsonb),
        'generated_at',
        to_jsonb(now())
    ) into v_result
    from (
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
        -- Structured warnings: record each skipped day with context
        warnings_rows as (
            select jsonb_agg(
                jsonb_build_object(
                    'date', date,
                    'type', case
                        when user_factor is null and prev_nav_user > 0 and (nav_user - flow) <= 0
                         and benchmark_factor is null and prev_nav_benchmark > 0 and (nav_benchmark - flow) <= 0
                        then 'both'
                        when user_factor is null and prev_nav_user > 0 and (nav_user - flow) <= 0
                        then 'user'
                        else 'benchmark'
                    end,
                    'nav_user', nav_user,
                    'nav_benchmark', nav_benchmark,
                    'flow', flow
                )
                order by date
            ) as items
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
        warnings_arr as (
            select coalesce((select items from warnings_rows), '[]'::jsonb) as val
        )
        select date, return_pct_user, return_pct_benchmark,
               (select val from warnings_arr) as warnings_arr
        from cumulative
    ) cum;

    return v_result;
end;
$$;

revoke all on function public._performance_history_for_user_fast(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- PART 3: shared_portfolio — add has_snapshot_price flag
-- ============================================================================

create or replace function public.shared_portfolio(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_result  jsonb;
    v_has_snapshot boolean;
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

    -- Check whether quote_snapshots has any prices for this user's tickers
    select exists (
        select 1
        from public.transactions t
        join public.quote_snapshots q on q.ticker = upper(t.ticker)
        where t.user_id = v_user_id
          and q.price is not null
    ) into v_has_snapshot;

    with stats as (
        select
            t.ticker,
            sum(case when t.side = 'buy' then t.shares else 0 end)               as buy_shares,
            sum(case when t.side = 'buy' then t.shares * t.price else 0 end)     as buy_notional,
            sum(case when t.side = 'sell' then t.shares else 0 end)              as sell_shares,
            sum(case when t.side = 'buy' then t.shares else -t.shares end)       as net_shares
        from public.transactions t
        where t.user_id = v_user_id
        group by t.ticker
    ),
    pos as (
        select
            ticker,
            net_shares,
            case when buy_shares > 0 then buy_notional / buy_shares else 0 end as avg_buy_price,
            case when buy_shares > 0
                 then (buy_notional / buy_shares) * net_shares
                 else 0 end as remaining_cost
        from stats
        where net_shares > 0
    ),
    enriched as (
        select
            p.ticker,
            p.net_shares,
            p.avg_buy_price,
            q.price as current_price,
            q.change_pct as day_change_pct,
            p.net_shares * coalesce(q.price, p.avg_buy_price) as market_value,
            case when p.remaining_cost > 0
                 then (p.net_shares * coalesce(q.price, p.avg_buy_price) - p.remaining_cost) / p.remaining_cost
                 else 0 end as return_pct
        from pos p
        left join public.quote_snapshots q on q.ticker = p.ticker
    ),
    total as (
        select sum(market_value) as total_mv from enriched
    )
    select jsonb_build_object(
        'positions', coalesce(
            (select jsonb_agg(jsonb_build_object(
                'ticker', ticker,
                'weight_pct', case when (select total_mv from total) > 0
                                   then market_value / (select total_mv from total)
                                   else 0 end,
                'return_pct', return_pct,
                'day_change_pct', day_change_pct
            ) order by market_value desc) from enriched),
            '[]'::jsonb
        ),
        'total_return_pct', coalesce(
            (select sum(return_pct * (market_value / nullif((select total_mv from total), 0))) from enriched),
            0
        ),
        'has_snapshot_price', v_has_snapshot,
        'generated_at', to_jsonb(now())
    ) into v_result;

    return v_result;
end;
$$;

grant execute on function public.shared_portfolio(text) to anon, authenticated;
