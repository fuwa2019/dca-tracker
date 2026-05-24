-- DCA Tracker: keep the last cache refresh duration visible after a browser reload.
-- The refresh duration is stored on performance_history_cache; expose it from
-- both the status RPC and the history fallback RPC used by older deployments.

alter table public.performance_history_cache
    add column if not exists refresh_ms integer,
    add column if not exists last_refresh_attempt_at timestamptz;

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

create or replace function public.performance_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cached jsonb;
    v_dirty boolean;
    v_updated_at timestamptz;
    v_last_refresh_attempt_at timestamptz;
    v_refresh_ms integer;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

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
      and benchmark = 'SPY'
      and method = 'TWR';

    if public._history_points_count(v_cached) > 0 then
        return v_cached || jsonb_build_object(
            'dirty', coalesce(v_dirty, false),
            'updated_at', to_jsonb(v_updated_at),
            'last_refresh_attempt_at', to_jsonb(v_last_refresh_attempt_at),
            'refresh_ms', v_refresh_ms
        );
    end if;

    return public._refresh_performance_history_cache_for_user(auth.uid(), 'SPY');
end;
$$;

grant execute on function public.performance_history() to authenticated;
