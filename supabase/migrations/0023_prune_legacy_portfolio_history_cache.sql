-- DCA Tracker: stop duplicating performance history into the legacy cache.
--
-- The formal cache is public.performance_history_cache. The older
-- portfolio_history_cache duplicated the same JSONB payload and can grow large
-- through TOAST churn, so keep legacy RPC compatibility without storing a
-- second copy.

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

truncate table public.portfolio_history_cache;

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

create or replace function public.refresh_portfolio_history_cache()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    return public.refresh_performance_history_cache();
end;
$$;

revoke all on function public.refresh_portfolio_history_cache() from public, anon, authenticated;
grant execute on function public.refresh_portfolio_history_cache() to authenticated;
