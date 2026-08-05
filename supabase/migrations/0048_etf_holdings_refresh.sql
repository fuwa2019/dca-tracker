-- Dynamic, provider-backed ETF constituent snapshots for look-through exposure.

create table public.etf_holding_sets (
    etf_ticker text primary key,
    provider text not null,
    source_url text not null,
    as_of date not null,
    fetched_at timestamptz not null default now(),
    constituent_count integer not null check (constituent_count > 0),
    weight_total numeric(12,10) not null check (weight_total > 0 and weight_total <= 1.05),
    status text not null default 'ready' check (status in ('ready')),
    updated_at timestamptz not null default now(),
    constraint etf_holding_sets_supported_ticker check (etf_ticker in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM'))
);

create table public.etf_holdings (
    etf_ticker text not null references public.etf_holding_sets(etf_ticker) on delete cascade,
    constituent_ticker text not null,
    weight numeric(12,10) not null check (weight > 0 and weight <= 1),
    primary key (etf_ticker, constituent_ticker),
    constraint etf_holdings_ticker_format check (constituent_ticker ~ '^[A-Z0-9][A-Z0-9.-]{0,19}$')
);

alter table public.etf_holding_sets enable row level security;
alter table public.etf_holdings enable row level security;

create policy etf_holding_sets_public_read on public.etf_holding_sets
    for select to anon, authenticated using (true);
create policy etf_holdings_public_read on public.etf_holdings
    for select to anon, authenticated using (true);

grant select on public.etf_holding_sets, public.etf_holdings to anon, authenticated;
revoke insert, update, delete, truncate on public.etf_holding_sets, public.etf_holdings from anon, authenticated;

create or replace function public.current_user_etf_universe()
returns table(etf_ticker text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select upper(t.ticker) as etf_ticker
    from public.transactions t
    where t.user_id = auth.uid()
      and upper(t.ticker) in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM')
    group by upper(t.ticker)
    having sum(case when lower(t.side) = 'buy' then t.shares else -t.shares end) > 0.000000001;
$$;

revoke all on function public.current_user_etf_universe() from public, anon;
grant execute on function public.current_user_etf_universe() to authenticated;

create or replace function public.active_etf_universe()
returns table(etf_ticker text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select upper(t.ticker) as etf_ticker
    from public.transactions t
    where upper(t.ticker) in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM')
    group by upper(t.ticker)
    having sum(case when lower(t.side) = 'buy' then t.shares else -t.shares end) > 0.000000001;
$$;

revoke all on function public.active_etf_universe() from public, anon, authenticated;
grant execute on function public.active_etf_universe() to service_role;

create or replace function public.reconcile_etf_holding_sets()
returns table(deleted_ticker text)
language sql
security definer
set search_path = public, pg_temp
as $$
    delete from public.etf_holding_sets s
    where not exists (
        select 1 from public.active_etf_universe() a where a.etf_ticker = s.etf_ticker
    )
    returning s.etf_ticker;
$$;

revoke all on function public.reconcile_etf_holding_sets() from public, anon, authenticated;
grant execute on function public.reconcile_etf_holding_sets() to service_role;

create or replace function public.replace_etf_holdings(
    p_etf_ticker text,
    p_provider text,
    p_source_url text,
    p_as_of date,
    p_holdings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_ticker text := upper(trim(p_etf_ticker));
    v_count integer;
    v_total numeric;
    v_existing date;
begin
    if v_ticker not in ('VOO', 'VGT', 'SMH', 'QQQ', 'QQQM') then
        raise exception 'unsupported_etf';
    end if;
    if jsonb_typeof(p_holdings) <> 'array' or jsonb_array_length(p_holdings) = 0 then
        raise exception 'empty_holdings';
    end if;

    perform pg_advisory_xact_lock(hashtext('etf_holdings:' || v_ticker));

    create temporary table tmp_etf_holdings(ticker text primary key, weight numeric) on commit drop;
    insert into tmp_etf_holdings(ticker, weight)
    select upper(trim(row->>'ticker')), (row->>'weight')::numeric
    from jsonb_array_elements(p_holdings) row;

    select count(*), sum(weight) into v_count, v_total from tmp_etf_holdings;
    if v_count = 0 or v_total < 0.80 or v_total > 1.05
       or exists (select 1 from tmp_etf_holdings where ticker !~ '^[A-Z0-9][A-Z0-9.-]{0,19}$' or weight <= 0 or weight > 1) then
        raise exception 'invalid_holdings';
    end if;

    select as_of into v_existing from public.etf_holding_sets where etf_ticker = v_ticker for update;
    if v_existing is not null and v_existing > p_as_of then
        return jsonb_build_object('status', 'unchanged', 'as_of', v_existing, 'constituent_count', v_count);
    end if;

    insert into public.etf_holding_sets(
        etf_ticker, provider, source_url, as_of, fetched_at, constituent_count, weight_total, status, updated_at
    ) values (v_ticker, p_provider, p_source_url, p_as_of, now(), v_count, v_total, 'ready', now())
    on conflict (etf_ticker) do update set
        provider = excluded.provider,
        source_url = excluded.source_url,
        as_of = excluded.as_of,
        fetched_at = excluded.fetched_at,
        constituent_count = excluded.constituent_count,
        weight_total = excluded.weight_total,
        status = excluded.status,
        updated_at = excluded.updated_at;

    delete from public.etf_holdings where etf_ticker = v_ticker;
    insert into public.etf_holdings(etf_ticker, constituent_ticker, weight)
    select v_ticker, ticker, weight from tmp_etf_holdings;

    return jsonb_build_object('status', case when v_existing = p_as_of then 'unchanged' else 'updated' end,
        'as_of', p_as_of, 'constituent_count', v_count, 'weight_total', v_total);
end;
$$;

revoke all on function public.replace_etf_holdings(text, text, text, date, jsonb) from public, anon, authenticated;
grant execute on function public.replace_etf_holdings(text, text, text, date, jsonb) to service_role;
