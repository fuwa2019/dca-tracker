-- DCA Tracker - private daily PnL cache for the authenticated performance calendar.
--
-- The public performance cache remains percentage-only. This table stores no NAV,
-- cashflow, transaction, or holding detail; it contains only the owner's daily
-- USD PnL value keyed by user, benchmark, and benchmark trading date.

create table if not exists public.performance_daily_pnl_cache (
    user_id        uuid not null references auth.users(id) on delete cascade,
    benchmark      text not null,
    trade_date     date not null,
    daily_pnl_user numeric,
    generated_at   timestamptz not null default now(),
    primary key (user_id, benchmark, trade_date),
    check (benchmark = upper(trim(benchmark)) and benchmark <> '')
);

create index if not exists performance_daily_pnl_cache_lookup_idx
    on public.performance_daily_pnl_cache (user_id, benchmark, trade_date desc);

alter table public.performance_daily_pnl_cache enable row level security;

revoke all on table public.performance_daily_pnl_cache from public, anon, authenticated;
grant select on table public.performance_daily_pnl_cache to authenticated;

drop policy if exists "performance_daily_pnl_cache_owner_read" on public.performance_daily_pnl_cache;
create policy "performance_daily_pnl_cache_owner_read"
on public.performance_daily_pnl_cache for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Rebuild the user's daily PnL from the same benchmark-calendar and trade-funding
-- NAV inputs used by _performance_history_for_user_fast. Only the final PnL is
-- exposed to the caller; intermediate NAV and flow values never enter the cache.
create or replace function public._performance_daily_pnl_for_user(
    p_user_id uuid,
    p_benchmark text default 'SPY'
)
returns table (
    trade_date date,
    daily_pnl_user numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with recursive
    params as (
        select
            upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY')) as benchmark,
            (select min(trade_date) from public.transactions where user_id = p_user_id) as start_date,
            (now() at time zone 'America/New_York')::date as end_date
    ),
    calendar as (
        select dp.trade_date as date
        from public.daily_prices dp
        cross join params p
        where dp.ticker = p.benchmark
          and dp.trade_date >= p.start_date
          and dp.trade_date <= p.end_date
          and coalesce(dp.adjusted_close, dp.close) > 0
        group by dp.trade_date
    ),
    tickers as (
        select distinct upper(ticker) as ticker
        from public.transactions
        where user_id = p_user_id
    ),
    txns_with_effective_date as (
        select
            tx.*,
            next_benchmark_day.trade_date as effective_date
        from public.transactions tx
        cross join params p
        left join lateral (
            select dp.trade_date
            from public.daily_prices dp
            where dp.ticker = p.benchmark
              and dp.trade_date >= tx.trade_date
              and coalesce(dp.adjusted_close, dp.close) > 0
            order by dp.trade_date
            limit 1
        ) next_benchmark_day on true
        where tx.user_id = p_user_id
    ),
    ordered_txns as (
        select
            row_number() over (order by trade_date, created_at, id) as n,
            effective_date as date,
            side,
            case when side = 'buy' then (shares * price)::numeric else 0::numeric end as buy_notional,
            case when side = 'sell' then (shares * price)::numeric else 0::numeric end as sell_notional
        from txns_with_effective_date
        where effective_date is not null
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
    invested_by_date as (
        select
            c.date,
            coalesce(f.flow, 0::numeric) as flow,
            sum(coalesce(f.flow, 0::numeric)) over (order by c.date) as invested
        from calendar c
        left join flows f on f.date = c.date
    ),
    txn_events as (
        select
            effective_date as date,
            upper(ticker) as ticker,
            (case when side = 'buy' then shares * price else -shares * price end)::numeric as notional_delta,
            price::numeric as trade_price
        from txns_with_effective_date
        where effective_date is not null
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
        cross join params p
        left join lateral (
            select coalesce(adjusted_close, close) as price
            from public.daily_prices
            where ticker = uu.ticker
              and trade_date >= p.start_date
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
            i.date,
            i.flow,
            coalesce(usv.stock_value, 0)
                + coalesce(i.invested, 0)
                - coalesce(cc.cost_basis, 0) as nav_user
        from invested_by_date i
        left join cost_cumulative cc on cc.date = i.date
        left join user_stock_values usv on usv.date = i.date
    ),
    nav_with_prev as (
        select
            date,
            flow,
            nav_user,
            lag(nav_user) over (order by date) as prev_nav_user
        from nav
    )
    select
        date as trade_date,
        case
            when prev_nav_user is null then null::numeric
            else nav_user - flow - prev_nav_user
        end as daily_pnl_user
    from nav_with_prev
    order by date;
$$;

revoke all on function public._performance_daily_pnl_for_user(uuid, text) from public, anon, authenticated;

-- Keep the public TWR cache and private amount cache in the same refresh transaction.
create or replace function public._refresh_performance_history_cache_for_user(
    p_user_id uuid,
    p_benchmark text default 'SPY'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text := upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'));
    v_history jsonb;
    v_started_at timestamptz := clock_timestamp();
    v_generated_at timestamptz := now();
    v_source_hash text;
    v_refresh_ms integer;
begin
    v_source_hash := public._performance_source_hash(p_user_id, v_benchmark);
    v_history := public._performance_history_for_user_fast(p_user_id, v_benchmark);
    -- Warnings in older TWR builders contained NAV/flow diagnostics. They are
    -- internal troubleshooting data, not part of the public cache contract.
    v_history := v_history - 'warnings';
    v_refresh_ms := greatest(0, floor(extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);

    insert into public.performance_history_cache (
        user_id, benchmark, method, history, dirty, source_hash, refresh_ms,
        error, last_refresh_attempt_at, generated_at, updated_at
    )
    values (
        p_user_id, v_benchmark, 'TWR', v_history, false, v_source_hash, v_refresh_ms,
        null, v_generated_at, v_generated_at, v_generated_at
    )
    on conflict (user_id, benchmark, method) do update set
        history = excluded.history,
        dirty = false,
        source_hash = excluded.source_hash,
        refresh_ms = excluded.refresh_ms,
        error = null,
        last_refresh_attempt_at = excluded.last_refresh_attempt_at,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at;

    delete from public.performance_daily_pnl_cache
    where user_id = p_user_id
      and benchmark = v_benchmark;

    insert into public.performance_daily_pnl_cache (
        user_id, benchmark, trade_date, daily_pnl_user, generated_at
    )
    select
        p_user_id, v_benchmark, daily.trade_date, daily.daily_pnl_user, v_generated_at
    from public._performance_daily_pnl_for_user(p_user_id, v_benchmark) daily;

    return v_history || jsonb_build_object('refresh_ms', v_refresh_ms);
exception when others then
    insert into public.performance_history_cache (
        user_id, benchmark, method, history, dirty, error,
        last_refresh_attempt_at, generated_at, updated_at
    )
    values (
        p_user_id, v_benchmark, 'TWR',
        jsonb_build_object('series', '[]'::jsonb, 'generated_at', to_jsonb(now())),
        true, sqlerrm, now(), now(), now()
    )
    on conflict (user_id, benchmark, method) do update set
        dirty = true,
        error = excluded.error,
        last_refresh_attempt_at = excluded.last_refresh_attempt_at,
        updated_at = excluded.updated_at;
    raise;
end;
$$;

revoke all on function public._refresh_performance_history_cache_for_user(uuid, text) from public, anon, authenticated;

-- Remove any legacy diagnostic warnings from already-materialized public cache
-- rows so the privacy invariant holds before the next user refresh.
update public.performance_history_cache
set history = history - 'warnings',
    updated_at = now()
where history ? 'warnings';

create or replace function public.performance_daily_pnl(
    p_start_date date,
    p_end_date date,
    p_benchmark text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text;
    v_series jsonb;
    v_generated_at timestamptz;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
        return jsonb_build_object('error', 'invalid_date_range');
    end if;

    if p_end_date - p_start_date > 41 then
        return jsonb_build_object('error', 'date_range_too_long');
    end if;

    v_benchmark := public._selected_benchmark_for_user(auth.uid(), p_benchmark);

    select
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'date', trade_date,
                    'daily_pnl_user', daily_pnl_user
                ) order by trade_date
            ),
            '[]'::jsonb
        ),
        max(generated_at)
    into v_series, v_generated_at
    from public.performance_daily_pnl_cache
    where user_id = auth.uid()
      and benchmark = v_benchmark
      and trade_date between p_start_date and p_end_date;

    return jsonb_build_object(
        'benchmark', v_benchmark,
        'currency', 'USD',
        'generated_at', to_jsonb(coalesce(v_generated_at, now())),
        'series', v_series
    );
end;
$$;

revoke all on function public.performance_daily_pnl(date, date, text) from public, anon, authenticated;
grant execute on function public.performance_daily_pnl(date, date, text) to authenticated;
