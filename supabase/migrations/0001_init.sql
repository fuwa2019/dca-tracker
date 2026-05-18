-- DCA Tracker — initial schema
-- Run in Supabase SQL editor (or `supabase db push`). Idempotent enough for first deploy.

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. funding_batches: optional grouping for a "build-up" event
-- ============================================================
create table if not exists public.funding_batches (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references auth.users(id) on delete cascade,
    label        text not null,
    kind         text not null check (kind in ('dca', 'lumpsum')),
    planned_usd  numeric(14, 2),
    created_at   timestamptz not null default now()
);
create index if not exists funding_batches_user_idx on public.funding_batches (user_id, created_at desc);

-- ============================================================
-- 2. cashflows: CNY out → USD in transfers
-- ============================================================
create table if not exists public.cashflows (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    batch_id      uuid references public.funding_batches(id) on delete set null,
    cny_out_date  date not null,
    cny_amount    numeric(14, 2) not null check (cny_amount > 0),
    usd_in_date   date,
    usd_amount    numeric(14, 2) check (usd_amount is null or usd_amount > 0),
    target_rate   numeric(10, 4) not null check (target_rate > 0),  -- USD/CNY ideal rate, user-entered
    fees_cny      numeric(14, 2) not null default 0,
    fees_usd      numeric(14, 2) not null default 0,
    note          text,
    created_at    timestamptz not null default now()
);
create index if not exists cashflows_user_idx on public.cashflows (user_id, cny_out_date desc);
create index if not exists cashflows_batch_idx on public.cashflows (batch_id);

-- ============================================================
-- 3. transactions: stock buys/sells
-- ============================================================
create table if not exists public.transactions (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    batch_id    uuid references public.funding_batches(id) on delete set null,
    trade_date  date not null,
    ticker      text not null,
    side        text not null check (side in ('buy', 'sell')),
    price       numeric(14, 4) not null check (price > 0),
    shares      numeric(14, 6) not null check (shares > 0),
    kind        text not null check (kind in ('dca', 'lumpsum')),
    note        text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, trade_date desc);
create index if not exists transactions_user_ticker_idx on public.transactions (user_id, ticker);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

-- ============================================================
-- 4. quote_snapshots: latest market data, ticker is primary key
--    Writable only by service-role (Workers); readable by anyone for the watchlist.
-- ============================================================
create table if not exists public.quote_snapshots (
    ticker        text primary key,
    price         numeric(14, 4),
    prev_close    numeric(14, 4),
    change        numeric(14, 4),
    change_pct    numeric(8, 4),
    market_state  text,
    source        text,
    updated_at    timestamptz not null default now()
);

-- ============================================================
-- 5. share_links: read-only public tokens
-- ============================================================
create table if not exists public.share_links (
    token       text primary key,
    user_id     uuid not null references auth.users(id) on delete cascade,
    expires_at  timestamptz,
    revoked     boolean not null default false,
    created_at  timestamptz not null default now()
);
create index if not exists share_links_user_idx on public.share_links (user_id);

-- ============================================================
-- 6. settings: per-user preferences
-- ============================================================
create table if not exists public.settings (
    user_id              uuid primary key references auth.users(id) on delete cascade,
    target_usd           numeric(14, 2) not null default 1000000,
    expected_annual_ret  numeric(6, 4)  not null default 0.08,
    monthly_dca_usd      numeric(14, 2),
    email_enabled        boolean not null default true,
    email_to             text,
    cost_basis_default   text not null default 'avg' check (cost_basis_default in ('avg', 'fifo')),
    watchlist            text[] not null default array['VOO', 'QQQM', 'SMH'],
    updated_at           timestamptz not null default now()
);

drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at
before update on public.settings
for each row execute function public.set_updated_at();

-- Auto-create settings row on user signup so the app always has defaults
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
    insert into public.settings (user_id, email_to) values (new.id, new.email)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 7. email_log: monthly dedupe for the reminder cron
-- ============================================================
create table if not exists public.email_log (
    user_id  uuid not null references auth.users(id) on delete cascade,
    ym       text not null,
    sent_at  timestamptz not null default now(),
    primary key (user_id, ym)
);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.funding_batches enable row level security;
alter table public.cashflows       enable row level security;
alter table public.transactions    enable row level security;
alter table public.share_links     enable row level security;
alter table public.settings        enable row level security;
alter table public.email_log       enable row level security;
alter table public.quote_snapshots enable row level security;

-- Owner-only policies (one table at a time to keep this readable)
do $$
declare
    t text;
begin
    foreach t in array array['funding_batches', 'cashflows', 'transactions', 'share_links', 'settings', 'email_log']
    loop
        execute format('drop policy if exists "%I_owner_select" on public.%I;', t, t);
        execute format('drop policy if exists "%I_owner_insert" on public.%I;', t, t);
        execute format('drop policy if exists "%I_owner_update" on public.%I;', t, t);
        execute format('drop policy if exists "%I_owner_delete" on public.%I;', t, t);
        execute format('create policy "%I_owner_select" on public.%I for select using (auth.uid() = user_id);', t, t);
        execute format('create policy "%I_owner_insert" on public.%I for insert with check (auth.uid() = user_id);', t, t);
        execute format('create policy "%I_owner_update" on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t, t);
        execute format('create policy "%I_owner_delete" on public.%I for delete using (auth.uid() = user_id);', t, t);
    end loop;
end $$;

-- quote_snapshots: public read (so anonymous /share/[token] can fetch prices), service-role write only
drop policy if exists "quote_snapshots_public_read" on public.quote_snapshots;
create policy "quote_snapshots_public_read"
on public.quote_snapshots for select to anon, authenticated using (true);

-- ============================================================
-- shared_portfolio(token): returns sanitized JSON for a share link.
-- SECURITY DEFINER so it can read the share owner's data while RLS is on.
-- Hides absolute USD amounts, cashflows, exchange losses — only %.
-- ============================================================
create or replace function public.shared_portfolio(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_result  jsonb;
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

    -- Aggregate net positions (avg cost only — share view is simplified)
    with pos as (
        select
            t.ticker,
            sum(case when t.side = 'buy' then t.shares else -t.shares end) as net_shares,
            -- weighted avg buy price (cost basis = avg for shared view)
            sum(case when t.side = 'buy' then t.shares * t.price else 0 end)
                / nullif(sum(case when t.side = 'buy' then t.shares else 0 end), 0) as avg_cost
        from public.transactions t
        where t.user_id = v_user_id
        group by t.ticker
        having sum(case when t.side = 'buy' then t.shares else -t.shares end) > 0
    ),
    enriched as (
        select
            p.ticker,
            p.net_shares,
            p.avg_cost,
            q.price as current_price,
            q.change_pct as day_change_pct,
            p.net_shares * coalesce(q.price, p.avg_cost) as market_value,
            case when p.avg_cost > 0
                 then (coalesce(q.price, p.avg_cost) - p.avg_cost) / p.avg_cost
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
            (select sum((return_pct) * (market_value / nullif((select total_mv from total), 0))) from enriched),
            0
        ),
        'generated_at', to_jsonb(now())
    ) into v_result;

    return v_result;
end;
$$;

-- Anonymous + authenticated callers may invoke this RPC
grant execute on function public.shared_portfolio(text) to anon, authenticated;
