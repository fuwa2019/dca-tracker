-- DCA Tracker - remove ambiguous default from _performance_source_hash overload.
--
-- The one-argument wrapper is the default-SPY entry point. The two-argument
-- form must not also define a default value, otherwise Postgres cannot resolve
-- calls like public._performance_source_hash(user_id).

drop function if exists public._performance_source_hash(uuid);
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
            where ticker in (
                'SPY',
                upper(coalesce(nullif(trim(p_benchmark), ''), 'SPY'))
            )
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

create function public._performance_source_hash(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select public._performance_source_hash(p_user_id, 'SPY');
$$;

revoke all on function public._performance_source_hash(uuid) from public, anon, authenticated;
