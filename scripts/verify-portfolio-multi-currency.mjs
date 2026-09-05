import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = new URL('../supabase/migrations/0054_portfolio_multi_currency.sql', import.meta.url);
const sql = readFileSync(migrationPath, 'utf8');

const requiredFragments = [
  'add column if not exists source_currency text not null default \'USD\'',
  'add column if not exists source_price numeric(22, 12)',
  'add column if not exists source_amount numeric(22, 10)',
  'add column if not exists fx_rate_to_usd numeric(22, 12)',
  'alter function public.import_portfolio_ledger(text, jsonb, jsonb, text)',
  'rename to _import_portfolio_ledger_legacy',
  'create or replace function public.import_portfolio_ledger(',
  'security invoker',
  'current_setting(\'dca.import_portfolio_ledger\', true) = \'1\'',
  'v_currency = \'USD\'',
  'invalid_multi_currency_conversion',
  'v_source_price * v_fx_rate',
  'grant execute on function public.import_portfolio_ledger(text, jsonb, jsonb, text)',
];

for (const fragment of requiredFragments) {
  assert.ok(sql.includes(fragment), `missing multi-currency migration contract: ${fragment}`);
}

const wrapperStart = sql.indexOf('create or replace function public.import_portfolio_ledger(');
assert.ok(wrapperStart >= 0, 'multi-currency wrapper is present');
const wrapper = sql.slice(wrapperStart);
assert.match(wrapper, /security invoker/);
assert.doesNotMatch(wrapper, /security definer/);
assert.match(
  sql,
  /revoke all on function public\.import_portfolio_ledger\(text, jsonb, jsonb, text\)\s+from public, anon, authenticated;/,
);
assert.match(
  sql,
  /grant execute on function public\.import_portfolio_ledger\(text, jsonb, jsonb, text\)\s+to authenticated;/,
);
assert.match(sql, /set source_currency = v_currency/);
assert.match(sql, /source_price = v_source_price/);
assert.match(sql, /fx_rate_to_usd = v_fx_rate/);
assert.ok(!sql.includes('/Users/'));

console.log('portfolio multi-currency migration contract checks passed');
