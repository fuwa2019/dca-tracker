-- Find the user_id from data
with uid as (
  select user_id from public.transactions limit 1
)
select
  'Step 1: direct function call' as section,
  jsonb_array_length((result->'series')::jsonb) as series_points,
  result->>'dirty' as dirty,
  result->>'benchmark' as benchmark,
  result->'series'->0 as first_point,
  result->'series'->(jsonb_array_length((result->'series')::jsonb) - 1) as last_point
from uid, lateral (
  select public._performance_history_for_user_fast(uid.user_id, 'SPY') as result
) t;

-- Step 2: trace v_start
select 'Step 2: trace v_start' as section,
  (select min(usd_in_date) from public.cashflows where usd_in_date is not null) as min_cashflow,
  (select min(trade_date) from public.transactions) as min_trade,
  least(
    (select min(usd_in_date) from public.cashflows where usd_in_date is not null),
    (select min(trade_date) from public.transactions)
  ) as v_start;

-- Step 3: check SPY prices (needed for benchmark)
select 'Step 3: SPY price check' as section,
  count(*) as spy_price_count,
  min(trade_date) as spy_first,
  max(trade_date) as spy_last
from public.daily_prices
where ticker = 'SPY';

-- Step 4: check user ticker prices
select 'Step 4: user ticker prices' as section,
  upper(ticker) as ticker,
  count(*) as points,
  min(trade_date) as first_date,
  max(trade_date) as last_date
from public.transactions
group by upper(ticker)
order by count(*) desc
limit 5;
