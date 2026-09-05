-- DCA Tracker - restore the unambiguous _performance_source_hash overload pair.
--
-- 0028 removed the default from the two-argument form on purpose: the
-- one-argument wrapper also exists, so a two-argument form carrying
-- `default 'SPY'` makes `_performance_source_hash(user_id)` unresolvable.
-- 0043 reintroduced that default and 0047 carried it forward, so every
-- one-argument call has failed since 0043 was applied with
--
--     42725  function public._performance_source_hash(uuid) is not unique
--
-- The only live one-argument caller is `refresh_due_performance_caches`
-- (0014), which the quote Worker calls after each daily price sync. The Worker
-- catches and logs that failure instead of rethrowing, so the nightly cache
-- warm-up has been a no-op without surfacing anywhere.
--
-- `create or replace function` cannot remove a parameter default, so the
-- two-argument form has to be dropped and recreated. The body below is the
-- 0047 body unchanged; only the default is gone. The one-argument wrapper is
-- left in place — its body resolves the two-argument call at runtime, so it
-- needs no rewrite.

drop function if exists public._performance_source_hash(uuid, text);

create function public._performance_source_hash(
    p_user_id uuid,
    p_benchmark text
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
                fees_usd,
                settled_amount_usd,
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
        ) source_rows
    ), 'empty'));
$$;

revoke all on function public._performance_source_hash(uuid, text)
    from public, anon, authenticated;

-- Resolve a one-argument call here so a reintroduced default fails this
-- migration loudly instead of failing silently in the nightly cron.
do $$
begin
    perform public._performance_source_hash('00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;
