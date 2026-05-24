-- DCA Tracker: expose refresh duration from the public cache refresh RPC.

create or replace function public.refresh_performance_history_cache()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_history jsonb;
    v_refresh_ms integer;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_history := public._refresh_performance_history_cache_for_user(auth.uid(), 'SPY');
    v_refresh_ms := nullif(v_history->>'refresh_ms', '')::integer;

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'benchmark', coalesce(v_history->>'benchmark', 'SPY'),
        'method', coalesce(v_history->>'method', 'TWR'),
        'refresh_ms', v_refresh_ms,
        'updated_at', to_jsonb(now()),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

grant execute on function public.refresh_performance_history_cache() to authenticated;

create or replace function public.refresh_shared_history_cache(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_history jsonb;
    v_refresh_ms integer;
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
    v_refresh_ms := nullif(v_history->>'refresh_ms', '')::integer;

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_history),
        'benchmark', coalesce(v_history->>'benchmark', 'SPY'),
        'method', coalesce(v_history->>'method', 'TWR'),
        'refresh_ms', v_refresh_ms,
        'updated_at', to_jsonb(now()),
        'generated_at', coalesce(v_history->'generated_at', to_jsonb(now()))
    );
end;
$$;

revoke all on function public.refresh_shared_history_cache(text) from public, anon, authenticated;
grant execute on function public.refresh_shared_history_cache(text) to authenticated;
