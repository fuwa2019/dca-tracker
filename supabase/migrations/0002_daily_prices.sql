-- DCA Tracker — daily_prices for equity-curve history & SPY benchmark comparison
-- Run in Supabase SQL editor.

create table if not exists public.daily_prices (
    ticker      text not null,
    trade_date  date not null,
    close       numeric(14, 4) not null,
    source      text default 'yahoo',
    updated_at  timestamptz not null default now(),
    primary key (ticker, trade_date)
);

create index if not exists daily_prices_ticker_date_desc
    on public.daily_prices (ticker, trade_date desc);

alter table public.daily_prices enable row level security;

-- Public read so anonymous /share/[token] views can compute returns
drop policy if exists "daily_prices_public_read" on public.daily_prices;
create policy "daily_prices_public_read"
on public.daily_prices for select to anon, authenticated using (true);
-- No insert/update/delete policies → only service-role can write, by design.
