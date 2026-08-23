-- Public share payload: project the cached TWR warnings down to an allowlist.
--
-- `shared_performance_history` returns the cached history payload wholesale, and
-- that payload's `warnings` array can carry `nav_user`, `nav_benchmark` and
-- `flow` — absolute USD figures — whenever a day is skipped because NAV net of
-- flow fell to zero or below. The skip warning is built in the cache writer
-- (`_performance_history_for_user_fast_base`, which every later migration
-- patches in place), so an anonymous share request could read those amounts.
-- That breaks the percentage-only public-share contract in PROJECT.md.
--
-- The fix belongs at the public boundary, not in the cache: the owner's
-- diagnostics keep their amounts, the dashboard and the share keep reading the
-- one cached TWR contract, and nothing has to be recomputed or rewritten.
--
-- The projection is an allowlist, not a blocklist. Any field a future migration
-- adds to a warning is dropped from the public payload unless it is added here
-- deliberately.

create or replace function public._public_share_sanitize_history(p_history jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
    select case
        when p_history is null then null
        when jsonb_typeof(p_history -> 'warnings') <> 'array' then p_history
        else jsonb_set(
            p_history,
            '{warnings}',
            coalesce(
                (
                    select jsonb_agg(
                        coalesce(
                            (
                                select jsonb_object_agg(entry.key, entry.value)
                                from jsonb_each(element.value) as entry
                                where entry.key in ('date', 'type', 'original_date', 'ticker')
                            ),
                            '{}'::jsonb
                        )
                        order by element.ordinality
                    )
                    from jsonb_array_elements(p_history -> 'warnings')
                        with ordinality as element(value, ordinality)
                ),
                '[]'::jsonb
            )
        )
    end;
$$;

comment on function public._public_share_sanitize_history(jsonb) is
    'Projects a cached history payload for anonymous readers: warning entries keep only date, type, original_date and ticker. Absolute amounts never leave the owner boundary.';

revoke all on function public._public_share_sanitize_history(jsonb) from public, anon, authenticated;

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
        return public._public_share_sanitize_history(v_cached)
            || jsonb_build_object('dirty', coalesce(v_dirty, false));
    end if;

    select public_history into v_legacy
    from public.portfolio_history_cache
    where user_id = v_user_id;

    if public._history_points_count(v_legacy) > 0 then
        return public._public_share_sanitize_history(v_legacy)
            || jsonb_build_object('dirty', true);
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

-- `shared_history` is a thin alias and already delegates here; it is re-granted
-- so the anonymous surface stays exactly the three documented entry points.
grant execute on function public.shared_history(text) to anon, authenticated;
