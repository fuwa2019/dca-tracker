-- DCA Tracker - one registry for every market-data symbol.
--
-- Health reads start from tracked_symbols, never from existing daily prices.
-- Database triggers are the last line of defense for settings, transactions,
-- quote snapshots, and daily-price writes that bypass the browser app.

create or replace function public.normalize_symbol(p_symbol text)
returns text
language sql
immutable
strict
as $$
    select upper(trim(p_symbol));
$$;

create table if not exists public.tracked_symbols (
    symbol            text primary key,
    name              text,
    asset_type        text,
    enabled           boolean not null default true,
    source            text not null default 'manual',
    first_trade_date  date,
    last_backfill_at  timestamptz,
    backfill_status   text not null default 'pending'
                      check (backfill_status in ('pending', 'ok', 'missing', 'stale', 'partial', 'unsupported', 'failed')),
    backfill_error    text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint tracked_symbols_symbol_normalized
      check (symbol <> '' and symbol = public.normalize_symbol(symbol))
);

alter table public.tracked_symbols enable row level security;

drop policy if exists "tracked_symbols_authenticated_read" on public.tracked_symbols;
create policy "tracked_symbols_authenticated_read"
on public.tracked_symbols for select to authenticated using (true);

create or replace function public._upsert_tracked_symbol(
    p_symbol text,
    p_name text default null,
    p_asset_type text default null,
    p_source text default 'manual',
    p_first_trade_date date default null
)
returns public.tracked_symbols
language plpgsql
security definer
set search_path = public
as $$
declare
    v_symbol text := public.normalize_symbol(p_symbol);
    v_row public.tracked_symbols;
begin
    if v_symbol = '' then
        raise exception 'symbol must not be empty' using errcode = '22023';
    end if;

    insert into public.tracked_symbols (
        symbol,
        name,
        asset_type,
        source,
        first_trade_date
    )
    values (
        v_symbol,
        nullif(trim(p_name), ''),
        nullif(trim(p_asset_type), ''),
        coalesce(nullif(trim(p_source), ''), 'manual'),
        p_first_trade_date
    )
    on conflict (symbol) do update set
        name = coalesce(excluded.name, public.tracked_symbols.name),
        asset_type = coalesce(excluded.asset_type, public.tracked_symbols.asset_type),
        enabled = true,
        source = excluded.source,
        first_trade_date = case
            when public.tracked_symbols.first_trade_date is null then excluded.first_trade_date
            when excluded.first_trade_date is null then public.tracked_symbols.first_trade_date
            else least(public.tracked_symbols.first_trade_date, excluded.first_trade_date)
        end,
        updated_at = now()
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function public._upsert_tracked_symbol(text, text, text, text, date) from public, anon, authenticated;

create or replace function public.add_tracked_symbol(
    p_symbol text,
    p_name text default null,
    p_asset_type text default null,
    p_source text default 'manual',
    p_first_trade_date date default null
)
returns public.tracked_symbols
language plpgsql
security definer
set search_path = public
as $$
begin
    return public._upsert_tracked_symbol(
        p_symbol,
        p_name,
        p_asset_type,
        p_source,
        p_first_trade_date
    );
end;
$$;

revoke all on function public.add_tracked_symbol(text, text, text, text, date) from public, anon;
grant execute on function public.add_tracked_symbol(text, text, text, text, date) to authenticated, service_role;

create or replace function public._normalize_transaction_symbol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.ticker := public.normalize_symbol(new.ticker);
    return new;
end;
$$;

drop trigger if exists transactions_normalize_symbol on public.transactions;
create trigger transactions_normalize_symbol
before insert or update of ticker on public.transactions
for each row execute function public._normalize_transaction_symbol();

create or replace function public._track_transaction_symbol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public._upsert_tracked_symbol(new.ticker, null, null, 'transaction', new.trade_date);
    return new;
end;
$$;

drop trigger if exists transactions_track_symbol on public.transactions;
create trigger transactions_track_symbol
after insert or update of ticker, trade_date on public.transactions
for each row execute function public._track_transaction_symbol();

create or replace function public._normalize_settings_symbols()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.watchlist := array(
        select distinct public.normalize_symbol(value)
        from unnest(coalesce(new.watchlist, '{}'::text[])) as symbols(value)
        where public.normalize_symbol(value) <> ''
        order by 1
    );
    new.benchmarks := array(
        select distinct public.normalize_symbol(value)
        from unnest(coalesce(new.benchmarks, array['SPY']::text[])) as symbols(value)
        where public.normalize_symbol(value) <> ''
        order by 1
    );
    if array_length(new.benchmarks, 1) is null then
        new.benchmarks := array['SPY']::text[];
    end if;
    new.selected_benchmark := public.normalize_symbol(coalesce(nullif(new.selected_benchmark, ''), new.benchmarks[1], 'SPY'));
    if not new.selected_benchmark = any(new.benchmarks) then
        new.benchmarks := array_append(new.benchmarks, new.selected_benchmark);
    end if;
    return new;
end;
$$;

drop trigger if exists settings_normalize_symbols on public.settings;
create trigger settings_normalize_symbols
before insert or update of watchlist, benchmarks, selected_benchmark on public.settings
for each row execute function public._normalize_settings_symbols();

create or replace function public._track_settings_symbols()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_symbol text;
begin
    foreach v_symbol in array coalesce(new.watchlist, '{}'::text[]) || coalesce(new.benchmarks, '{}'::text[]) || array[new.selected_benchmark]
    loop
        perform public._upsert_tracked_symbol(v_symbol, null, null, 'settings', null);
    end loop;
    return new;
end;
$$;

drop trigger if exists settings_track_symbols on public.settings;
create trigger settings_track_symbols
after insert or update of watchlist, benchmarks, selected_benchmark on public.settings
for each row execute function public._track_settings_symbols();

create or replace function public._normalize_market_data_symbol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.ticker := public.normalize_symbol(new.ticker);
    return new;
end;
$$;

drop trigger if exists daily_prices_normalize_symbol on public.daily_prices;
create trigger daily_prices_normalize_symbol
before insert or update of ticker on public.daily_prices
for each row execute function public._normalize_market_data_symbol();

drop trigger if exists quote_snapshots_normalize_symbol on public.quote_snapshots;
create trigger quote_snapshots_normalize_symbol
before insert or update of ticker on public.quote_snapshots
for each row execute function public._normalize_market_data_symbol();

create or replace function public._track_market_data_symbol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    perform public._upsert_tracked_symbol(new.ticker, null, null, tg_table_name, null);
    if tg_table_name = 'daily_prices' then
        update public.tracked_symbols
        set
            backfill_status = 'ok',
            backfill_error = null,
            last_backfill_at = now(),
            updated_at = now()
        where symbol = public.normalize_symbol(new.ticker);
    end if;
    return new;
end;
$$;

drop trigger if exists daily_prices_track_symbol on public.daily_prices;
create trigger daily_prices_track_symbol
after insert or update of ticker on public.daily_prices
for each row execute function public._track_market_data_symbol();

drop trigger if exists quote_snapshots_track_symbol on public.quote_snapshots;
create trigger quote_snapshots_track_symbol
after insert or update of ticker on public.quote_snapshots
for each row execute function public._track_market_data_symbol();

update public.transactions set ticker = public.normalize_symbol(ticker)
where ticker is distinct from public.normalize_symbol(ticker);

update public.daily_prices set ticker = public.normalize_symbol(ticker)
where ticker is distinct from public.normalize_symbol(ticker);

update public.quote_snapshots set ticker = public.normalize_symbol(ticker)
where ticker is distinct from public.normalize_symbol(ticker);

insert into public.tracked_symbols (
    symbol,
    source,
    first_trade_date,
    backfill_status,
    last_backfill_at
)
select
    symbol,
    'migration',
    min(first_trade_date),
    case when sum(daily_rows) > 0 then 'ok' else 'pending' end,
    max(last_backfill_at)
from (
    select public.normalize_symbol(ticker) as symbol, min(trade_date) as first_trade_date, 0::bigint as daily_rows, null::timestamptz as last_backfill_at
    from public.transactions
    group by public.normalize_symbol(ticker)
    union all
    select public.normalize_symbol(ticker), null, count(*), max(updated_at)
    from public.daily_prices
    group by public.normalize_symbol(ticker)
    union all
    select public.normalize_symbol(value), null, 0, null
    from public.settings, unnest(watchlist || benchmarks || array[selected_benchmark]) as symbols(value)
) seeded
where symbol <> ''
group by symbol
on conflict (symbol) do update set
    first_trade_date = coalesce(public.tracked_symbols.first_trade_date, excluded.first_trade_date),
    updated_at = now();

alter table public.daily_prices
    drop constraint if exists daily_prices_ticker_normalized;
alter table public.daily_prices
    add constraint daily_prices_ticker_normalized
    check (ticker <> '' and ticker = public.normalize_symbol(ticker));

create unique index if not exists daily_prices_ticker_trade_date_unique
    on public.daily_prices (ticker, trade_date);

create or replace function public.tracked_symbol_coverage()
returns table (
    symbol text,
    name text,
    asset_type text,
    daily_rows bigint,
    adjusted_rows bigint,
    first_daily_date date,
    last_daily_date date,
    missing_days bigint,
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
    with coverage as (
        select
            ts.symbol,
            ts.name,
            ts.asset_type,
            ts.first_trade_date,
            ts.backfill_status,
            ts.last_backfill_at,
            ts.backfill_error,
            count(dp.trade_date) as daily_rows,
            count(dp.trade_date) filter (where coalesce(dp.adjusted_close, 0) > 0) as adjusted_rows,
            min(dp.trade_date) as first_daily_date,
            max(dp.trade_date) as last_daily_date
        from public.tracked_symbols ts
        left join public.daily_prices dp on dp.ticker = ts.symbol
        where ts.enabled
        group by ts.symbol
    )
    select
        c.symbol,
        c.name,
        c.asset_type,
        c.daily_rows,
        c.adjusted_rows,
        c.first_daily_date,
        c.last_daily_date,
        (
            select count(*)
            from public.daily_prices calendar
            where calendar.ticker = 'SPY'
              and calendar.trade_date >= coalesce(c.first_trade_date, c.first_daily_date, current_date)
              and calendar.trade_date <= current_date
              and not exists (
                  select 1
                  from public.daily_prices own_price
                  where own_price.ticker = c.symbol
                    and own_price.trade_date = calendar.trade_date
              )
        ) as missing_days,
        case
            when c.daily_rows = 0 and c.backfill_status = 'ok' then 'missing'
            else c.backfill_status
        end as backfill_status,
        c.last_backfill_at,
        c.backfill_error,
        c.first_trade_date
    from coverage c
    order by c.symbol;
$$;

revoke all on function public.tracked_symbol_coverage() from public, anon;
grant execute on function public.tracked_symbol_coverage() to authenticated, service_role;
