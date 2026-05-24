-- DCA Tracker: make daily_prices dirty-mark trigger compatible with safe-update guards.
--
-- Supabase's safeupdate extension rejects UPDATE statements without a WHERE
-- clause. The daily_prices statement trigger intentionally marks every
-- performance cache dirty after price changes, but it still needs an explicit
-- predicate to run when safeupdate is enabled.

create or replace function public._mark_all_performance_history_cache_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.performance_history_cache
    set dirty = true,
        updated_at = now()
    where dirty is distinct from true;

    return null;
end;
$$;

revoke all on function public._mark_all_performance_history_cache_dirty() from public, anon, authenticated;
