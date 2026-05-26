-- DCA Tracker - dynamic benchmark settings and benchmark-aware performance RPCs.
--
-- Idempotent: safe to run after any deployed 0026-style schema.

alter table public.settings
  add column if not exists benchmarks text[] not null default array['SPY']::text[],
  add column if not exists selected_benchmark text not null default 'SPY';

update public.settings
set
  benchmarks = case
    when benchmarks is null or array_length(benchmarks, 1) is null then array['SPY']::text[]
    else (
      select array_agg(distinct upper(t))
      from unnest(benchmarks || array[selected_benchmark, 'SPY']::text[]) as u(t)
      where nullif(trim(t), '') is not null
    )
  end,
  selected_benchmark = upper(coalesce(nullif(trim(selected_benchmark), ''), 'SPY')),
  updated_at = now();

create or replace function public._selected_benchmark_for_user(
    p_user_id uuid,
    p_benchmark text default null
)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select upper(coalesce(
      nullif(trim(p_benchmark), ''),
      (
        select nullif(trim(selected_benchmark), '')
        from public.settings
        where user_id = p_user_id
      ),
      (
        select nullif(trim(benchmarks[1]), '')
        from public.settings
        where user_id = p_user_id
          and array_length(benchmarks, 1) > 0
      ),
      'SPY'
    ));
$$;

revoke all on function public._selected_benchmark_for_user(uuid, text) from public, anon, authenticated;

create or replace function public._performance_source_hash(
    p_user_id uuid,
    p_benchmark text default 'SPY'
)
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
                'price',
                ticker,
                max(trade_date),
                count(*),
                max(updated_at)
            ) as item
            from public.daily_prices
            where ticker = upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'))
               or ticker in (
                   select distinct upper(ticker)
                   from public.transactions
                   where user_id = p_user_id
               )
            group by ticker
        ) src
    ), 'empty'));
$$;

revoke all on function public._performance_source_hash(uuid, text) from public, anon, authenticated;

create or replace function public._performance_source_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public._performance_source_hash(p_user_id, 'SPY');
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
    v_source_hash := public._performance_source_hash(p_user_id, v_benchmark);
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

create or replace function public.performance_history(p_benchmark text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text;
    v_cached jsonb;
    v_dirty boolean;
    v_updated_at timestamptz;
    v_last_refresh_attempt_at timestamptz;
    v_refresh_ms integer;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_benchmark := public._selected_benchmark_for_user(auth.uid(), p_benchmark);

    select
        history,
        dirty,
        updated_at,
        last_refresh_attempt_at,
        refresh_ms
    into
        v_cached,
        v_dirty,
        v_updated_at,
        v_last_refresh_attempt_at,
        v_refresh_ms
    from public.performance_history_cache
    where user_id = auth.uid()
      and benchmark = v_benchmark
      and method = 'TWR';

    if public._history_points_count(v_cached) > 0 then
        return v_cached || jsonb_build_object(
            'dirty', coalesce(v_dirty, false),
            'updated_at', to_jsonb(v_updated_at),
            'last_refresh_attempt_at', to_jsonb(v_last_refresh_attempt_at),
            'refresh_ms', v_refresh_ms
        );
    end if;

    return public._refresh_performance_history_cache_for_user(auth.uid(), v_benchmark);
end;
$$;

grant execute on function public.performance_history(text) to authenticated;

create or replace function public.performance_history()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select public.performance_history(null::text);
$$;

grant execute on function public.performance_history() to authenticated;

create or replace function public.refresh_performance_history_cache(p_benchmark text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_history jsonb;
    v_benchmark text;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_benchmark := public._selected_benchmark_for_user(auth.uid(), p_benchmark);
    v_history := public._refresh_performance_history_cache_for_user(auth.uid(), v_benchmark);
    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'generated_at', coalesce(v_history->>'generated_at', now()::text),
        'benchmark', coalesce(v_history->>'benchmark', v_benchmark),
        'method', coalesce(v_history->>'method', 'TWR'),
        'refresh_ms', (v_history->>'refresh_ms')::integer
    );
end;
$$;

grant execute on function public.refresh_performance_history_cache(text) to authenticated;

create or replace function public.refresh_performance_history_cache()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select public.refresh_performance_history_cache(null::text);
$$;

grant execute on function public.refresh_performance_history_cache() to authenticated;

create or replace function public.performance_cache_status(p_benchmark text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_benchmark text;
    v_cache record;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_benchmark := public._selected_benchmark_for_user(auth.uid(), p_benchmark);

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
        public._performance_source_hash(auth.uid(), v_benchmark) as current_source_hash
    into v_cache
    from public.performance_history_cache
    where user_id = auth.uid()
      and benchmark = v_benchmark
      and method = 'TWR';

    if not found then
        return jsonb_build_object('exists', false, 'benchmark', v_benchmark, 'method', 'TWR');
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

grant execute on function public.performance_cache_status(text) to authenticated;

create or replace function public.performance_cache_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
    select public.performance_cache_status(null::text);
$$;

grant execute on function public.performance_cache_status() to authenticated;

create or replace function public.shared_performance_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_benchmark text;
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

    v_benchmark := public._selected_benchmark_for_user(v_user_id, null);
    perform public._record_share_link_access(p_token);

    select history, dirty into v_cached, v_dirty
    from public.performance_history_cache
    where user_id = v_user_id
      and benchmark = v_benchmark
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
        'benchmark', v_benchmark,
        'series', '[]'::jsonb,
        'generated_at', to_jsonb(now())
    );
end;
$$;

grant execute on function public.shared_performance_history(text) to anon, authenticated;

update public.performance_history_cache
set dirty = true,
    source_hash = null,
    updated_at = now();
