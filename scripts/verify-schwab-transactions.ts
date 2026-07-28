import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSchwabDepositImportDiff,
  buildSchwabImportDiff,
  classifySchwabSymbol,
  exportSchwabTransactions,
  parseSchwabTransactions,
  SCHWAB_HEADERS,
} from '../src/lib/schwabTransactions.ts';

const tabFixture = [
  'Transactions for account XXX123',
  SCHWAB_HEADERS.join('\t'),
  '04/18/2025\tBuy\tVGT\tSYNTHETIC TECHNOLOGY ETF\t0.25\t$200.00\t\t-$50.00',
  '04/17/2025\tWire Received\t\tSYNTHETIC TEST DEPOSIT\t\t\t\t$125.40',
  '04/16/2025\tReinvest Shares\tVGT\tSYNTHETIC TECHNOLOGY ETF\t0.01\t$200.00\t\t-$2.00',
  '04/15/2025 as of 04/14/2025\tSell\tSGOV\tSYNTHETIC TREASURY ETF\t0.5\t$100.00\t\t$50.00',
  '04/15/2025 as of 04/14/2025\tMoneyLink Transfer\t\tSYNTHETIC LINKED BANK\t\t\t\t$25.00',
  '04/13/2025\tMoneyLink Transfer\t\tSYNTHETIC OUTBOUND TRANSFER\t\t\t\t-$5.00',
].join('\r\n');

const parsedTab = parseSchwabTransactions(`\uFEFF${tabFixture}`);
assert.equal(parsedTab.delimiter, '\t');
assert.equal(parsedTab.headerRow, 2);
assert.equal(parsedTab.rows.length, 2);
assert.equal(parsedTab.deposits.length, 2);
assert.equal(parsedTab.ignored.length, 2);
assert.equal(parsedTab.errors.length, 0);
assert.equal(parsedTab.rows[1].trade_date, '2025-04-14', '`as of` date is effective');
assert.equal(parsedTab.rows[0].fees_usd, 0, 'blank fee becomes zero');
assert.equal(parsedTab.deposits[0].source_action, 'Wire Received');
assert.equal(parsedTab.deposits[1].deposit_date, '2025-04-14', 'deposit uses the effective `as of` date');
assert.equal(parsedTab.deposits[1].amount, 25);
assert.equal(parsedTab.ignored[1].reason, 'non_positive_cashflow', 'outbound transfer is not a deposit');

const commaFixture = [
  SCHWAB_HEADERS.join(','),
  '06/05/2026,Buy,QQQM,"INVESCO NASDAQ, 100 ETF",0.2202,$295.1357,,-$64.99',
].join('\n');
const parsedComma = parseSchwabTransactions(commaFixture);
assert.equal(parsedComma.delimiter, ',');
assert.equal(parsedComma.rows[0].source_description, 'INVESCO NASDAQ, 100 ETF');

const malformedQuotes = parseSchwabTransactions([
  'Synthetic statement',
  SCHWAB_HEADERS.join(','),
  '06/05/2026,Buy,QQQM,"unterminated,0.2202,$295.1357,,-$64.99',
].join('\n'));
assert.equal(malformedQuotes.errors[0].sourceIndex, 3, 'quote errors use the physical file row');

const invalid = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '06/05/2026\tBuy\tSMH\tVANECK SEMICONDUCTOR ETF\t0.1\t$600\t\t-$1.00',
].join('\n'));
assert.equal(invalid.rows.length, 0);
assert.match(invalid.errors[0].message, /金额与成交明细不一致/);

const excessivePrecision = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '06/05/2026\tBuy\tSMH\tVANECK SEMICONDUCTOR ETF\t0.1234567\t$600\t\t-$74.07',
].join('\n'));
assert.equal(excessivePrecision.rows.length, 0);
assert.match(excessivePrecision.errors[0].message, /股数最多支持 6 位小数/);

const invalidSellFee = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '06/05/2026\tSell\tSMH\tVANECK SEMICONDUCTOR ETF\t0.1\t$10\t$1.00\t$0.00',
].join('\n'));
assert.equal(invalidSellFee.rows.length, 0);
assert.match(invalidSellFee.errors[0].message, /卖出金额必须为正数|卖出手续费必须小于成交额/);

const invalidDeposit = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '04/10/2025\tWire Received\t\tSYNTHETIC TEST DEPOSIT\t\t\t\t$125.401',
].join('\n'));
assert.equal(invalidDeposit.deposits.length, 0);
assert.match(invalidDeposit.errors[0].message, /入金金额最多支持 2 位小数/);

const duplicateDeposits = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '04/10/2025\tMoneyLink Transfer\t\tSYNTHETIC LINKED BANK\t\t\t\t$75.00',
  '04/10/2025\tMoneyLink Transfer\t\tSYNTHETIC LINKED BANK\t\t\t\t$75.00',
].join('\n'));
assert.equal(duplicateDeposits.deposits.length, 2);
assert.equal(duplicateDeposits.deposits[0].duplicate_ordinal, 1);
assert.equal(duplicateDeposits.deposits[1].duplicate_ordinal, 2);
assert.notEqual(duplicateDeposits.deposits[0].import_key, duplicateDeposits.deposits[1].import_key);

const duplicate = parseSchwabTransactions([
  SCHWAB_HEADERS.join('\t'),
  '06/05/2026\tBuy\tSMH\tVANECK SEMICONDUCTOR ETF\t0.1\t$600\t\t-$60.00',
  '06/05/2026\tBuy\tSMH\tVANECK SEMICONDUCTOR ETF\t0.1\t$600\t\t-$60.00',
].join('\n'));
assert.equal(duplicate.rows.length, 2);
assert.equal(duplicate.rows[0].duplicate_ordinal, 1);
assert.equal(duplicate.rows[1].duplicate_ordinal, 2);
assert.notEqual(duplicate.rows[0].import_key, duplicate.rows[1].import_key);

const known = new Set(['QQQM']);
assert.equal(classifySchwabSymbol({ ticker: 'VGT', description: 'VANGUARD ETF' }), 'etf');
assert.equal(classifySchwabSymbol({ ticker: 'QQQM', knownEtfSymbols: known }), 'etf');
assert.equal(classifySchwabSymbol({ ticker: 'IWM', providerType: 'ETF' }), 'etf');
assert.equal(classifySchwabSymbol({ ticker: 'LITE', providerType: 'EQUITY' }), 'stock');
assert.equal(classifySchwabSymbol({ ticker: 'MYSTERY' }), 'unknown');

const existing = [{
  id: 'existing-1',
  trade_date: duplicate.rows[0].trade_date,
  side: duplicate.rows[0].side,
  ticker: duplicate.rows[0].ticker,
  shares: duplicate.rows[0].shares,
  price: duplicate.rows[0].price,
  fees_usd: duplicate.rows[0].fees_usd,
}];
const appendDiff = buildSchwabImportDiff(duplicate.rows, existing, new Set(['SMH']), 'append');
assert.equal(appendDiff.unchanged.length, 1);
assert.equal(appendDiff.added.length, 1);
assert.equal(appendDiff.removed.length, 0);

const resetDiff = buildSchwabImportDiff(
  [duplicate.rows[0]],
  [
    ...existing,
    {
      id: 'old-etf-row',
      trade_date: '2026-05-01',
      side: 'buy',
      ticker: 'SMH',
      shares: 0.2,
      price: 500,
      fees_usd: 0,
    },
    {
      id: 'stock-row',
      trade_date: '2026-05-01',
      side: 'buy',
      ticker: 'LITE',
      shares: 1,
      price: 100,
      fees_usd: 0,
    },
  ],
  new Set(['SMH']),
  'reset_etf',
);
assert.equal(resetDiff.unchanged.length, 0);
assert.equal(resetDiff.added.length, 1);
assert.deepEqual(resetDiff.removed.map((row) => row.id), ['existing-1', 'old-etf-row']);
assert.ok(!resetDiff.removed.some((row) => row.id === 'stock-row'), 'ETF reset preserves stocks');

const existingCashflows = [
  {
    id: 'manual-fx',
    usd_in_date: '2025-04-10',
    usd_amount: 75,
    cashflow_kind: 'fx_transfer' as const,
    import_source: null,
    import_key: null,
  },
  {
    id: 'old-schwab-deposit',
    usd_in_date: '2026-05-01',
    usd_amount: 20,
    cashflow_kind: 'broker_deposit' as const,
    import_source: 'schwab',
    import_key: 'old-key',
  },
];
const appendDepositDiff = buildSchwabDepositImportDiff(
  duplicateDeposits.deposits,
  existingCashflows,
  'append',
);
assert.equal(appendDepositDiff.unchanged.length, 1, 'matching manual cashflow is preserved');
assert.equal(appendDepositDiff.added.length, 1, 'a second identical real deposit can coexist');
assert.equal(appendDepositDiff.removed.length, 0);
const resetDepositDiff = buildSchwabDepositImportDiff(
  [duplicateDeposits.deposits[0]],
  [
    ...existingCashflows,
    {
      id: 'matching-schwab-deposit',
      usd_in_date: duplicateDeposits.deposits[0].deposit_date,
      usd_amount: duplicateDeposits.deposits[0].amount,
      cashflow_kind: 'broker_deposit' as const,
      import_source: 'schwab',
      import_key: duplicateDeposits.deposits[0].import_key,
    },
  ],
  'reset_etf',
);
assert.equal(resetDepositDiff.unchanged[0].existingId, 'manual-fx');
assert.deepEqual(
  resetDepositDiff.removed.map((row) => row.id),
  ['old-schwab-deposit', 'matching-schwab-deposit'],
);
assert.ok(!resetDepositDiff.removed.some((row) => row.id === 'manual-fx'), 'reset preserves manual cashflows');

const exported = exportSchwabTransactions([
  {
    trade_date: '2025-04-10',
    side: 'buy',
    ticker: 'VGT',
    source_description: 'SYNTHETIC\t"TECH" ETF',
    shares: 0.25,
    price: 200,
    fees_usd: 0.01,
    created_at: '2025-04-10T10:00:00Z',
  },
  {
    trade_date: '2025-04-09',
    side: 'sell',
    ticker: 'SGOV',
    shares: 0.5,
    price: 100,
    fees_usd: 0,
    created_at: '2025-04-09T10:00:00Z',
  },
], [
  {
    id: 'wire-deposit',
    created_at: '2025-04-11T10:00:00Z',
    usd_in_date: '2025-04-11',
    usd_amount: 125.4,
    source_action: 'Wire Received',
    source_description: 'SYNTHETIC FOREIGN CURRENCY DEPOSIT',
  },
  {
    id: 'moneylink-deposit',
    created_at: '2025-04-10T11:00:00Z',
    usd_in_date: '2025-04-10',
    usd_amount: 75,
    source_action: 'MoneyLink Transfer',
    source_description: 'SYNTHETIC LINKED BANK',
  },
]);
assert.ok(exported.startsWith('\uFEFF'));
assert.match(exported, /Date\tAction\tSymbol\tDescription\tQuantity\tPrice\tFees & Comm\tAmount/);
assert.match(exported, /-\$50\.01/);
assert.match(exported, /\t\$50\.00\r\n$/);
assert.match(
  exported,
  /04\/11\/2025\tWire Received\t\tSYNTHETIC FOREIGN CURRENCY DEPOSIT\t\t\t\t\$125\.40/,
);
assert.match(
  exported,
  /04\/10\/2025\tMoneyLink Transfer\t\tSYNTHETIC LINKED BANK\t\t\t\t\$75\.00/,
);

const roundTrip = parseSchwabTransactions(exported);
assert.equal(roundTrip.errors.length, 0);
assert.equal(roundTrip.rows.length, 2);
assert.equal(roundTrip.deposits.length, 2);
assert.equal(roundTrip.rows[0].fees_usd, 0.01);
assert.equal(roundTrip.rows[0].source_description, 'SYNTHETIC\t"TECH" ETF');
assert.equal(roundTrip.rows[1].source_description, 'SGOV ETF');
assert.equal(roundTrip.deposits[0].source_action, 'Wire Received');
assert.equal(roundTrip.deposits[0].source_description, 'SYNTHETIC FOREIGN CURRENCY DEPOSIT');
assert.equal(roundTrip.deposits[1].source_action, 'MoneyLink Transfer');
assert.equal(roundTrip.deposits[1].amount, 75);

const migration = readFileSync(
  new URL('../supabase/migrations/0043_schwab_transaction_import.sql', import.meta.url),
  'utf8',
);
assert.match(migration, /security invoker/, 'import RPC uses caller privileges');
assert.match(migration, /v_user_id uuid := auth\.uid\(\)/, 'import RPC derives the current user');
assert.doesNotMatch(
  migration.match(/create or replace function public\.import_schwab_transactions[\s\S]*?\$\$;/)?.[0] ?? '',
  /p_user_id/,
  'import RPC never accepts a caller-supplied user id',
);
assert.match(
  migration,
  /unique \(user_id, import_source, import_key\)/,
  'database enforces per-user import idempotency',
);
assert.match(
  migration,
  /grant execute on function public\.import_schwab_transactions\(jsonb, jsonb, text\[\], text\)\s+to authenticated/,
  'only authenticated users receive import RPC execution',
);
assert.match(
  migration,
  /revoke all on function public\.import_schwab_transactions\(jsonb, jsonb, text\[\], text\)\s+from public, anon, authenticated/,
  'public and anonymous roles cannot execute the import RPC',
);
assert.match(migration, /cashflow_kind text not null default 'fx_transfer'/, 'cashflows distinguish FX transfers and broker deposits');
assert.match(
  migration,
  /cashflow_kind = 'broker_deposit'[\s\S]*?cny_amount is null[\s\S]*?usd_amount > 0/,
  'broker deposits require positive USD without fake CNY',
);
assert.match(
  migration,
  /cashflow\.cashflow_kind = 'broker_deposit'[\s\S]*?cashflow\.import_source = 'schwab'/,
  'reset deletes only Schwab broker deposits',
);
assert.match(
  migration,
  /cashflow\.cashflow_kind = 'fx_transfer'[\s\S]*?cashflow\.import_source = 'schwab'/,
  'reset clears stale Schwab identity while preserving manual FX cashflows',
);
assert.match(
  migration,
  /update public\.cashflows cashflow[\s\S]*?set import_source = 'schwab'[\s\S]*?from tmp_schwab_cashflow_matches/,
  'matching manual cashflows receive exportable Schwab source identity',
);
assert.match(migration, /'cashflows_added', v_cashflow_added/, 'RPC reports deposit changes separately');
assert.match(migration, /fees_usd,\s+kind,\s+updated_at/, 'performance source hash includes fees');
assert.match(migration, /if p_mode = 'append' then[\s\S]*?tmp_schwab_matches/, 'only append mode preserves matching transactions');
assert.match(migration, /transaction\.side = 'sell'/, 'strict reset removes all confirmed ETF sells');
assert.match(migration, /transaction\.side = 'buy'/, 'strict reset removes all confirmed ETF buys');
const deleteOldSellsAt = migration.indexOf("and transaction.side = 'sell'");
const insertNewRowsAt = migration.indexOf('insert into public.transactions (');
const deleteOldBuysAt = migration.indexOf("and transaction.side = 'buy'", deleteOldSellsAt + 1);
assert.ok(
  deleteOldSellsAt >= 0 && deleteOldSellsAt < insertNewRowsAt,
  'strict reset removes old sells before inserting replacements',
);
assert.ok(
  deleteOldBuysAt >= 0 && deleteOldBuysAt < insertNewRowsAt,
  'strict reset removes old buys before inserting replacements',
);

console.log('Schwab transaction import/export checks passed');
