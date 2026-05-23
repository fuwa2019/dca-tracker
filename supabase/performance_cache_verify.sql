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
