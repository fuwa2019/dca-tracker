-- DCA Tracker - formal performance history cache
--
-- This migration separates IBKR-style performance curves from amount-heavy
-- portfolio history. The chart cache stores only public-safe TWR percentages,
-- while dashboard NAV/PnL remains computed from transactions, cashflows, and
-- latest quotes.

alter table public.daily_prices
    add column if not exists adjusted_close numeric(14, 4);

update public.daily_prices
set adjusted_close = close
where adjusted_close is null;

create index if not exists daily_prices_ticker_date_price_idx
    on public.daily_prices (ticker, trade_date desc)
    include (close, adjusted_close);

create table if not exists public.performance_history_cache (
    user_id      uuid not null references auth.users(id) on delete cascade,
    benchmark    text not null default 'SPY',
    method       text not null default 'TWR',
    history      jsonb not null,
    dirty        boolean not null default false,
    generated_at timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (user_id, benchmark, method)
);

alter table public.performance_history_cache enable row level security;

drop policy if exists "performance_history_cache_owner_read" on public.performance_history_cache;
create policy "performance_history_cache_owner_read"
on public.performance_history_cache for select to authenticated
using (auth.uid() = user_id);

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
                    when prev_nav_user > 0
                        then greatest((nav_user - flow) / prev_nav_user, 0)
                    else null
                end as user_factor,
                case
                    when prev_nav_benchmark > 0
                        then greatest((nav_benchmark - flow) / prev_nav_benchmark, 0)
                    else null
                end as benchmark_factor
            from nav_with_prev
        ),
        cumulative as (
            select
                date,
                case
                    when bool_or(user_factor = 0) over (order by date) then -1
                    else coalesce(
                        exp(sum(ln(user_factor)) filter (where user_factor > 0) over (order by date)) - 1,
                        0
                    )
                end as return_pct_user,
                case
                    when bool_or(benchmark_factor = 0) over (order by date) then -1
                    else coalesce(
                        exp(sum(ln(benchmark_factor)) filter (where benchmark_factor > 0) over (order by date)) - 1,
                        0
                    )
                end as return_pct_benchmark
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
begin
    v_history := public._performance_history_for_user_fast(p_user_id, v_benchmark);

    insert into public.performance_history_cache (
        user_id,
        benchmark,
        method,
        history,
        dirty,
        generated_at,
        updated_at
    )
    values (
        p_user_id,
        v_benchmark,
        'TWR',
        v_history,
        false,
        now(),
        now()
    )
    on conflict (user_id, benchmark, method) do update set
        history = excluded.history,
        dirty = false,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at;

    -- Keep legacy RPCs and already-deployed frontend bundles compatible.
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

revoke all on function public._refresh_performance_history_cache_for_user(uuid, text) from public, anon, authenticated;

create or replace function public.performance_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cached jsonb;
    v_dirty boolean;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    select history, dirty into v_cached, v_dirty
    from public.performance_history_cache
    where user_id = auth.uid()
      and benchmark = 'SPY'
      and method = 'TWR';

    if public._history_points_count(v_cached) > 0 then
        return v_cached || jsonb_build_object('dirty', coalesce(v_dirty, false));
    end if;

    return public._refresh_performance_history_cache_for_user(auth.uid(), 'SPY');
end;
$$;

grant execute on function public.performance_history() to authenticated;

create or replace function public.refresh_performance_history_cache()
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

    v_history := public._refresh_performance_history_cache_for_user(auth.uid(), 'SPY');

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'benchmark', coalesce(v_history->>'benchmark', 'SPY'),
        'method', coalesce(v_history->>'method', 'TWR'),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

grant execute on function public.refresh_performance_history_cache() to authenticated;

create or replace function public.shared_performance_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_cached jsonb;
    v_dirty boolean;
    v_legacy jsonb;
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

    select history, dirty into v_cached, v_dirty
    from public.performance_history_cache
    where user_id = v_user_id
      and benchmark = 'SPY'
      and method = 'TWR';

    if public._history_points_count(v_cached) > 0 then
        return v_cached || jsonb_build_object('dirty', coalesce(v_dirty, false));
    end if;

    select public_history into v_legacy
    from public.portfolio_history_cache
    where user_id = v_user_id;

    if public._history_points_count(v_legacy) > 0 then
        return v_legacy || jsonb_build_object('dirty', true);
    end if;

    return jsonb_build_object(
        'error', 'history_cache_missing',
        'series', '[]'::jsonb,
        'generated_at', to_jsonb(now())
    );
end;
$$;

grant execute on function public.shared_performance_history(text) to anon, authenticated;

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

    v_history := public._refresh_performance_history_cache_for_user(v_user_id, 'SPY');

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'benchmark', coalesce(v_history->>'benchmark', 'SPY'),
        'method', coalesce(v_history->>'method', 'TWR'),
        'updated_at', to_jsonb(now()),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

revoke all on function public.refresh_shared_history_cache(text) from public, anon, authenticated;
grant execute on function public.refresh_shared_history_cache(text) to authenticated;

-- Legacy RPC names now delegate to the formal performance cache.
create or replace function public.portfolio_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    return public.performance_history();
end;
$$;

grant execute on function public.portfolio_history() to authenticated;

create or replace function public.shared_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    return public.shared_performance_history(p_token);
end;
$$;

grant execute on function public.shared_history(text) to anon, authenticated;

create or replace function public._mark_performance_history_cache_dirty_for_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
begin
    v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

    if v_user_id is not null then
        update public.performance_history_cache
        set dirty = true,
            updated_at = now()
        where user_id = v_user_id;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public._mark_performance_history_cache_dirty_for_row() from public, anon, authenticated;

drop trigger if exists transactions_invalidate_history_cache on public.transactions;
create trigger transactions_invalidate_history_cache
after insert or update or delete on public.transactions
for each row execute function public._mark_performance_history_cache_dirty_for_row();

drop trigger if exists cashflows_invalidate_history_cache on public.cashflows;
create trigger cashflows_invalidate_history_cache
after insert or update or delete on public.cashflows
for each row execute function public._mark_performance_history_cache_dirty_for_row();

create or replace function public._mark_all_performance_history_cache_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.performance_history_cache
    set dirty = true,
        updated_at = now();
    return null;
end;
$$;

revoke all on function public._mark_all_performance_history_cache_dirty() from public, anon, authenticated;

drop trigger if exists daily_prices_invalidate_history_cache on public.daily_prices;
drop trigger if exists daily_prices_mark_performance_cache_dirty on public.daily_prices;
create trigger daily_prices_mark_performance_cache_dirty
after insert or update or delete on public.daily_prices
for each statement execute function public._mark_all_performance_history_cache_dirty();

insert into public.performance_history_cache (
    user_id,
    benchmark,
    method,
    history,
    dirty,
    generated_at,
    updated_at
)
select
    user_id,
    'SPY',
    'TWR',
    public_history || jsonb_build_object(
        'benchmark', coalesce(public_history->>'benchmark', 'SPY'),
        'method', coalesce(public_history->>'method', 'TWR'),
        'dirty', true
    ),
    true,
    generated_at,
    updated_at
from public.portfolio_history_cache
where public._history_points_count(public_history) > 0
on conflict (user_id, benchmark, method) do nothing;
