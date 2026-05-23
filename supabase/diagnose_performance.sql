-- Diagnose performance cache issues.
-- Run this WHOLE FILE in Supabase SQL Editor.

-- 0. Find user IDs that have data
select 'Step 0: Users with data' as section;
select distinct user_id, 'has transactions' as source
from public.transactions
union all
select distinct user_id, 'has cashflows'
from public.cashflows
union all
select distinct user_id, 'has cache'
from public.performance_history_cache;

-- 1. Check which RPCs exist
select 'Step 1: RPC check' as section;
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

-- 2. Check ALL cache rows (not filtered by auth.uid())
select 'Step 2: Cache state (all users)' as section;
select
  user_id,
  benchmark,
  method,
  dirty,
  public._history_points_count(history) as points,
  generated_at,
  error
from public.performance_history_cache;

-- 3. Count your raw data
select 'Step 3: Raw data counts' as section;
select count(*) as transaction_count from public.transactions;
select count(*) as cashflow_count from public.cashflows;
select count(*) as price_count from public.daily_prices;
