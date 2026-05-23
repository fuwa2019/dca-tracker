-- DCA Tracker - performance operations and share auditing
--
-- Adds lightweight cache metadata, a limited service-role refresh entry point,
-- and access auditing for public share tokens.

alter table public.performance_history_cache
    add column if not exists source_hash text,
    add column if not exists refresh_ms integer,
    add column if not exists error text,
    add column if not exists last_refresh_attempt_at timestamptz;

alter table public.share_links
    add column if not exists access_count integer not null default 0,
    add column if not exists last_accessed_at timestamptz;

create index if not exists performance_history_cache_dirty_idx
    on public.performance_history_cache (dirty, updated_at);

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
                'cash',
                id,
                cny_out_date,
                usd_in_date,
                usd_amount,
                cny_amount,
                target_rate,
                created_at
            ) as item
            from public.cashflows
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
    v_source_hash text;
    v_refresh_ms integer;
begin
    v_source_hash := public._performance_source_hash(p_user_id);
    v_history := public._performance_history_for_user_fast(p_user_id, v_benchmark);
    v_refresh_ms := greatest(0, floor(extract(epoch from clock_timestamp() - v_started_at) * 1000)::integer);

    insert into public.performance_history_cache (
        user_id,
        benchmark,
        method,
        history,
        dirty,
        source_hash,
        refresh_ms,
        error,
        last_refresh_attempt_at,
        generated_at,
        updated_at
    )
    values (
        p_user_id,
        v_benchmark,
        'TWR',
        v_history,
        false,
        v_source_hash,
        v_refresh_ms,
        null,
        now(),
        now(),
        now()
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

    return v_history || jsonb_build_object('refresh_ms', v_refresh_ms);
exception when others then
    insert into public.performance_history_cache (
        user_id,
        benchmark,
        method,
        history,
        dirty,
        error,
        last_refresh_attempt_at,
        generated_at,
        updated_at
    )
    values (
        p_user_id,
        v_benchmark,
        'TWR',
        jsonb_build_object('series', '[]'::jsonb, 'generated_at', to_jsonb(now())),
        true,
        sqlerrm,
        now(),
        now(),
        now()
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

create or replace function public.refresh_due_performance_caches(p_limit integer default 25)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
    v_count integer := 0;
    r record;
begin
    for r in
        select user_id, benchmark
        from public.performance_history_cache
        where dirty = true
           or source_hash is distinct from public._performance_source_hash(user_id)
        order by updated_at
        limit v_limit
    loop
        perform public._refresh_performance_history_cache_for_user(r.user_id, r.benchmark);
        v_count := v_count + 1;
    end loop;

    return jsonb_build_object('ok', true, 'refreshed', v_count, 'limit', v_limit, 'generated_at', to_jsonb(now()));
end;
$$;

revoke all on function public.refresh_due_performance_caches(integer) from public, anon, authenticated;
grant execute on function public.refresh_due_performance_caches(integer) to service_role;

create or replace function public.performance_cache_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cache record;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    select
        benchmark,
        method,
        dirty,
        public._history_points_count(history) as points,
        generated_at,
        updated_at,
        last_refresh_attempt_at,
        refresh_ms,
        error,
        source_hash,
        public._performance_source_hash(auth.uid()) as current_source_hash
    into v_cache
    from public.performance_history_cache
    where user_id = auth.uid()
      and benchmark = 'SPY'
      and method = 'TWR';

    if not found then
        return jsonb_build_object('exists', false);
    end if;

    return jsonb_build_object(
        'exists', true,
        'benchmark', v_cache.benchmark,
        'method', v_cache.method,
        'dirty', (v_cache.dirty or v_cache.source_hash is distinct from v_cache.current_source_hash),
        'points', v_cache.points,
        'generated_at', to_jsonb(v_cache.generated_at),
        'updated_at', to_jsonb(v_cache.updated_at),
        'last_refresh_attempt_at', to_jsonb(v_cache.last_refresh_attempt_at),
        'refresh_ms', v_cache.refresh_ms,
        'error', v_cache.error
    );
end;
$$;

grant execute on function public.performance_cache_status() to authenticated;

create or replace function public._record_share_link_access(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.share_links
    set access_count = access_count + 1,
        last_accessed_at = now()
    where token = p_token
      and revoked = false
      and (expires_at is null or expires_at > now());
end;
$$;

revoke all on function public._record_share_link_access(text) from public, anon, authenticated;

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

    perform public._record_share_link_access(p_token);

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
