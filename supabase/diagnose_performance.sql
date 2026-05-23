-- Diagnose performance cache issues.
-- Run this in Supabase SQL Editor to check RPC existence and cache state.

-- 1. Check which RPCs exist
select proname, pronargs
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'performance_cache_status',
    'performance_history',
    'refresh_performance_history_cache',
    'shared_portfolio',
    'shared_performance_history',
    'portfolio_history',
    '_performance_history_for_user_fast',
    '_refresh_performance_history_cache_for_user'
  )
order by proname;

-- 2. Check your cache state
select
  benchmark,
  method,
  dirty,
  public._history_points_count(history) as points,
  generated_at,
  updated_at,
  error,
  refresh_ms
from public.performance_history_cache
where user_id = auth.uid()
  and benchmark = 'SPY'
  and method = 'TWR';

-- 3. Run the TWR computation directly and sample the output
-- Replace 'YOUR_USER_ID' with your actual user UUID.
select
  jsonb_array_length((result->'series')::jsonb) as series_points,
  result->>'dirty' as dirty,
  jsonb_array_length((result->'warnings')::jsonb) as warning_count,
  result->'series'->0 as first_point,
  result->'series'->(jsonb_array_length((result->'series')::jsonb) - 1) as last_point
from (
  select public._performance_history_for_user_fast(
    'YOUR_USER_ID'::uuid, 'SPY'
  ) as result
) t;
