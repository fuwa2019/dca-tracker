-- DCA Tracker — cached portfolio history
--
-- Dashboard refreshes and stores the full history. Public share links read the
-- sanitized cached series first, avoiding a full day-by-day recompute on every
-- anonymous page load.

create index if not exists daily_prices_trade_date_ticker_idx
    on public.daily_prices (trade_date, ticker);

create index if not exists cashflows_user_usd_in_date_idx
    on public.cashflows (user_id, usd_in_date)
    where usd_in_date is not null;

create table if not exists public.portfolio_history_cache (
    user_id        uuid primary key references auth.users(id) on delete cascade,
    full_history   jsonb not null,
    public_history jsonb not null,
    generated_at   timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

alter table public.portfolio_history_cache enable row level security;

drop policy if exists "portfolio_history_cache_owner_read" on public.portfolio_history_cache;
create policy "portfolio_history_cache_owner_read"
on public.portfolio_history_cache for select to authenticated
using (auth.uid() = user_id);

create or replace function public._public_history_from_full(p_full jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
    select jsonb_build_object(
        'series',
        coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'date', point.value->>'date',
                        'return_pct_user', coalesce((point.value->>'return_pct_user')::numeric, 0),
                        'return_pct_spy', coalesce((point.value->>'return_pct_spy')::numeric, 0)
                    )
                    order by point.value->>'date'
                )
                from jsonb_array_elements(coalesce(p_full->'series', '[]'::jsonb)) as point(value)
                where point.value ? 'date'
            ),
            '[]'::jsonb
        ),
        'generated_at',
        coalesce(p_full->'generated_at', to_jsonb(now()))
    );
$$;

revoke all on function public._public_history_from_full(jsonb) from public, anon, authenticated;

create or replace function public._refresh_portfolio_history_cache_for_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_full jsonb;
    v_public jsonb;
begin
    v_full := public._history_for_user(p_user_id, true);
    v_public := public._public_history_from_full(v_full);

    insert into public.portfolio_history_cache (
        user_id,
        full_history,
        public_history,
        generated_at,
        updated_at
    )
    values (
        p_user_id,
        v_full,
        v_public,
        now(),
        now()
    )
    on conflict (user_id) do update set
        full_history = excluded.full_history,
        public_history = excluded.public_history,
        generated_at = excluded.generated_at,
        updated_at = excluded.updated_at;

    return v_full;
end;
$$;

revoke all on function public._refresh_portfolio_history_cache_for_user(uuid) from public, anon, authenticated;

create or replace function public.refresh_portfolio_history_cache()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    return public._refresh_portfolio_history_cache_for_user(auth.uid());
end;
$$;

grant execute on function public.refresh_portfolio_history_cache() to authenticated;

create or replace function public.portfolio_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    return public._refresh_portfolio_history_cache_for_user(auth.uid());
end;
$$;

grant execute on function public.portfolio_history() to authenticated;

create or replace function public.shared_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_cached jsonb;
    v_full jsonb;
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

    select public_history into v_cached
    from public.portfolio_history_cache
    where user_id = v_user_id;

    if v_cached is not null then
        return v_cached;
    end if;

    v_full := public._refresh_portfolio_history_cache_for_user(v_user_id);
    return public._public_history_from_full(v_full);
end;
$$;

grant execute on function public.shared_history(text) to anon, authenticated;
