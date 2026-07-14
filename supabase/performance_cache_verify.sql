-- Replace the token with a real public share token before running.
-- These checks intentionally return small payloads only.

select public.refresh_shared_history_cache('YOUR_SHARE_TOKEN_HERE') as refresh_result;

with h as (
    select public.shared_performance_history('YOUR_SHARE_TOKEN_HERE') as data
)
select
    data->>'error' as error,
    data->>'benchmark' as benchmark,
    data->>'method' as method,
    data->>'price_basis' as price_basis,
    data->>'dirty' as dirty,
    jsonb_typeof(data->'series') as series_type,
    case
        when jsonb_typeof(data->'series') = 'array'
            then jsonb_array_length(data->'series')
    end as points,
    data->'series'->0 as first_point,
    data->'series'->-1 as last_point
from h;

select
    user_id,
    benchmark,
    method,
    dirty,
    refresh_ms,
    error,
    public._history_points_count(history) as points,
    generated_at,
    updated_at
from public.performance_history_cache
where user_id = (
    select user_id
    from public.share_links
    where token = 'YOUR_SHARE_TOKEN_HERE'
    limit 1
);

select public.performance_cache_status() as cache_status;

select
    token,
    revoked,
    expires_at,
    access_count,
    last_accessed_at
from public.share_links
where token = 'YOUR_SHARE_TOKEN_HERE';

-- Private calendar isolation checks. Run as an authenticated user and replace
-- the dates with a month inside the user's cached performance range.
select public.performance_daily_pnl('2026-01-01', '2026-01-31', 'SPY') as private_daily_pnl;

select
    relrowsecurity as private_cache_rls_enabled,
    has_table_privilege('anon', 'public.performance_daily_pnl_cache', 'select') as anon_can_select_table,
    has_table_privilege('authenticated', 'public.performance_daily_pnl_cache', 'select') as authenticated_can_select_table,
    has_function_privilege('anon', 'public.performance_daily_pnl(date,date,text)', 'execute') as anon_can_execute_rpc,
    has_function_privilege('authenticated', 'public.performance_daily_pnl(date,date,text)', 'execute') as authenticated_can_execute_rpc
from pg_class
where oid = 'public.performance_daily_pnl_cache'::regclass;

-- Public payloads must stay percentage-only; these should be false/zero.
select
    (public.shared_performance_history('YOUR_SHARE_TOKEN_HERE')::text like '%daily_pnl%') as share_contains_daily_pnl,
    (public.shared_performance_history('YOUR_SHARE_TOKEN_HERE')::text like '%nav_user%') as share_contains_nav,
    (public.shared_performance_history('YOUR_SHARE_TOKEN_HERE')::text like '%flow%') as share_contains_flow;
