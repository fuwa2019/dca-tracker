-- DCA Tracker — cache-only shared history reads
--
-- Anonymous share pages should read the sanitized history saved by the owner
-- dashboard. They should not synchronously rebuild a 10-year curve on page
-- load, because that can exceed Supabase/API/browser request timeouts.

create or replace function public._history_points_count(p_history jsonb)
returns integer
language sql
stable
set search_path = public
as $$
    select case
        when jsonb_typeof(p_history->'series') = 'array'
            then jsonb_array_length(p_history->'series')
        else 0
    end;
$$;

revoke all on function public._history_points_count(jsonb) from public, anon, authenticated;

create or replace function public.refresh_portfolio_history_cache()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_full jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    v_full := public._refresh_portfolio_history_cache_for_user(auth.uid());

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_full),
        'generated_at', coalesce(v_full->'generated_at', to_jsonb(now()))
    );
end;
$$;

grant execute on function public.refresh_portfolio_history_cache() to authenticated;

create or replace function public.shared_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_cached jsonb;
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

    if public._history_points_count(v_cached) > 0 then
        return v_cached;
    end if;

    return jsonb_build_object(
        'error', 'history_cache_missing',
        'series', '[]'::jsonb,
        'generated_at', to_jsonb(now())
    );
end;
$$;

grant execute on function public.shared_history(text) to anon, authenticated;

create or replace function public.refresh_shared_history_cache(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
    v_full jsonb;
    v_public jsonb;
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

    v_full := public._refresh_portfolio_history_cache_for_user(v_user_id);

    select public_history into v_public
    from public.portfolio_history_cache
    where user_id = v_user_id;

    return jsonb_build_object(
        'ok', true,
        'points', public._history_points_count(v_public),
        'updated_at', to_jsonb(now()),
        'generated_at', coalesce(v_full->'generated_at', to_jsonb(now()))
    );
end;
$$;

revoke all on function public.refresh_shared_history_cache(text) from public, anon, authenticated;
grant execute on function public.refresh_shared_history_cache(text) to authenticated;
