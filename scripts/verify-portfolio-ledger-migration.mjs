import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../supabase/migrations/0050_portfolio_ledger_import.sql', import.meta.url);
const sql = readFileSync(path, 'utf8');
const sourceOrderFix = readFileSync(
  new URL('../supabase/migrations/0055_fix_portfolio_import_source_order.sql', import.meta.url),
  'utf8',
);

const requiredFragments = [
  'add column if not exists effective_date date',
  'add column if not exists ticker text',
  'add column if not exists source_currency text',
  'add column if not exists source_amount numeric(22, 10)',
  'cashflow_kind in (\'dividend\', \'interest\')',
  'cashflow_kind in (\'broker_withdrawal\', \'stock_allocation\', \'tax\', \'fee\')',
  'create or replace function public.import_portfolio_ledger(',
  'security invoker',
  'auth.uid()',
  'pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0))',
  "v_source not in ('schwab', 'ibkr', 'tradingview')",
  "v_mode not in ('append', 'replace_source', 'reset_all')",
  "import_source = v_source",
  'grant execute on function public.import_portfolio_ledger(text, jsonb, jsonb, text)',
  'create or replace function public.import_schwab_transactions(',
  "return public.import_portfolio_ledger('schwab', v_trades, v_cash_events, 'reset_all');",
  'create trigger cashflows_invalidate_history_cache',
  'execute function public._mark_performance_history_cache_dirty_for_row()',
  'create or replace function public._clear_performance_daily_pnl_cache_for_user(',
  'grant execute on function public._clear_performance_daily_pnl_cache_for_user(uuid)',
];

for (const fragment of requiredFragments) {
  assert.ok(sql.includes(fragment), `missing migration contract: ${fragment}`);
}

assert.ok(!/create\s+or\s+replace\s+function\s+public\.import_portfolio_ledger[\s\S]{0,400}\bsecurity\s+definer\b/i.test(sql));
assert.match(sql, /delete\s+from\s+public\.cashflows\s+where\s+user_id\s*=\s*v_user_id\s+and\s+import_source\s*=\s*v_source;/);
assert.match(sql, /delete\s+from\s+public\.funding_batches\s+where\s+user_id\s*=\s*v_user_id;/);
assert.match(sql, /perform\s+public\._clear_performance_daily_pnl_cache_for_user\(v_user_id\);/);
assert.ok(sql.includes('source_amount <> round(source_amount, 10)'));
assert.ok(sql.includes('usd_amount <> round(usd_amount, 10)'));

assert.match(sourceOrderFix, /_import_portfolio_ledger_legacy\(text,jsonb,jsonb,text\)/);
assert.match(
  sourceOrderFix,
  /transaction_timestamp\(\) - \(v_row\.source_index \* interval ''1 microsecond''\)/,
);
assert.match(
  sourceOrderFix,
  /transaction_timestamp\(\) \+ \(v_row\.source_index \* interval ''1 microsecond''\)/,
);
assert.match(sourceOrderFix, /<> 2/);
assert.doesNotMatch(sourceOrderFix, /alter\s+table\s+public\.transactions/i);

console.log('portfolio ledger migration contract checks passed');
