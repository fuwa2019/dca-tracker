-- DCA Tracker — read-through portfolio history cache
--
-- 0008 introduced the cache table, but portfolio_history() still refreshed on
-- every read. This migration makes reads use the cache and invalidates it when
-- source data changes.

create or replace function public._history_cache_has_points(p_history jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
    select case
        when jsonb_typeof(p_history->'series') = 'array'
            then jsonb_array_length(p_history->'series') > 0
        else false
    end;
$$;

revoke all on function public._history_cache_has_points(jsonb) from public, anon, authenticated;

delete from public.portfolio_history_cache
where not public._history_cache_has_points(full_history)
   or not public._history_cache_has_points(public_history);

create or replace function public.portfolio_history()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cached jsonb;
begin
    if auth.uid() is null then
        return jsonb_build_object('error', 'not_authenticated');
    end if;

    select full_history into v_cached
    from public.portfolio_history_cache
    where user_id = auth.uid();

    if public._history_cache_has_points(v_cached) then
        return v_cached;
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

    if public._history_cache_has_points(v_cached) then
        return v_cached;
    end if;

    v_full := public._refresh_portfolio_history_cache_for_user(v_user_id);
    return public._public_history_from_full(v_full);
end;
$$;

grant execute on function public.shared_history(text) to anon, authenticated;

create or replace function public._invalidate_portfolio_history_cache_for_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid;
begin
    v_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

    if v_user_id is not null then
        delete from public.portfolio_history_cache
        where user_id = v_user_id;
    end if;

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

revoke all on function public._invalidate_portfolio_history_cache_for_row() from public, anon, authenticated;

drop trigger if exists transactions_invalidate_history_cache on public.transactions;
create trigger transactions_invalidate_history_cache
after insert or update or delete on public.transactions
for each row execute function public._invalidate_portfolio_history_cache_for_row();

drop trigger if exists cashflows_invalidate_history_cache on public.cashflows;
create trigger cashflows_invalidate_history_cache
after insert or update or delete on public.cashflows
for each row execute function public._invalidate_portfolio_history_cache_for_row();

create or replace function public._invalidate_all_portfolio_history_cache()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.portfolio_history_cache;
    return null;
end;
$$;

revoke all on function public._invalidate_all_portfolio_history_cache() from public, anon, authenticated;

drop trigger if exists daily_prices_invalidate_history_cache on public.daily_prices;
create trigger daily_prices_invalidate_history_cache
after insert or update or delete on public.daily_prices
for each statement execute function public._invalidate_all_portfolio_history_cache();
