import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assumedBrokerCashBalance } from '../src/lib/calc/cashBalance.ts';
import { totalTradeFunding } from '../src/lib/calc/history.ts';
import {
  buildSchwabImportDiff,
  classifySchwabSymbol,
  exportSchwabTransactions,
  parseSchwabTransactions,
  PORTFOLIO_CSV_HEADERS,
  SCHWAB_HEADERS,
} from '../src/lib/schwabTransactions.ts';

const tabFixture = [
  'Transactions for account XXX123',
  SCHWAB_HEADERS.join('\t'),
  '04/18/2025\tBuy\tVGT\tSYNTHETIC TECHNOLOGY ETF\t0.25\t$200.00\t\t-$50.00',
  '04/18/2025\tBuy\tLITE\tSYNTHETIC COMMON STOCK\t1\t$10.00\t\t-$10.00',
  '04/17/2025\tWire Received\t\tSYNTHETIC TEST DEPOSIT\t\t\t\t$125.40',
  '04/16/2025\tReinvest Shares\tVGT\tSYNTHETIC TECHNOLOGY ETF\t0.01\t$200.00\t\t-$2.00',
  '04/15/2025 as of 04/14/2025\tSell\tSGOV\tSYNTHETIC TREASURY ETF\t0.5\t$100.00\t\t$50.00',
  '04/15/2025 as of 04/14/2025\tMoneyLink Transfer\t\tSYNTHETIC LINKED BANK\t\t\t\t$25.00',
  '04/13/2025\tMoneyLink Transfer\t\tSYNTHETIC OUTBOUND TRANSFER\t\t\t\t-$5.00',
].join('\r\n');

const parsedTab = parseSchwabTransactions(`\uFEFF${tabFixture}`);
assert.equal(parsedTab.delimiter, '\t');
assert.equal(parsedTab.headerRow, 2);
assert.equal(parsedTab.rows.length, 3, 'all standard Buy/Sell rows are imported, including stocks');
assert.equal(parsedTab.deposits.length, 0, 'brokerage transfer rows are intentionally not imported');
assert.equal(parsedTab.ignored.length, 4);
assert.equal(parsedTab.errors.length, 0);
assert.equal(parsedTab.rows[2].trade_date, '2025-04-14', '`as of` date is effective');
assert.equal(parsedTab.rows[0].fees_usd, 0, 'blank fee becomes zero');
assert.equal(parsedTab.rows[1].ticker, 'LITE');
assert.ok(
  parsedTab.ignored.some((row) => row.action === 'MoneyLink Transfer'),
  'brokerage transfers are ignored regardless of direction',
);

const portfolioCsvFixture = [
  PORTFOLIO_CSV_HEADERS.join(','),
  'NASDAQ:VGT,Buy,0.25,200,0.01,2026-08-04 16:30:00',
  'NYSEARCA:SGOV,Sell,0.5,100,0.50,2026-08-03 15:45:00',
  'NASDAQ:ACME,Buy,1,10,0,2026-08-02 09:00:00',
  'USD:USD,Deposit,,,,2026-08-01 00:00:00',
  'NASDAQ:VGT,Dividend,,,,2026-08-01 00:00:00',
  'NASDAQ:VGT,Taxes and fees,,,,2026-08-01 00:00:00',
].join('\n');
const parsedPortfolioCsv = parseSchwabTransactions(`\uFEFF${portfolioCsvFixture}`);
assert.equal(parsedPortfolioCsv.delimiter, ',');
assert.equal(parsedPortfolioCsv.headerRow, 1);
assert.equal(parsedPortfolioCsv.rows.length, 3);
assert.equal(parsedPortfolioCsv.deposits.length, 0, 'portfolio CSV non-trade rows remain ignored');
assert.equal(parsedPortfolioCsv.ignored.length, 3);
assert.equal(parsedPortfolioCsv.errors.length, 0);
assert.equal(parsedPortfolioCsv.rows[0].trade_date, '2026-08-04');
assert.equal(parsedPortfolioCsv.rows[0].fees_usd, 0.01);
assert.equal(parsedPortfolioCsv.rows[0].amount, -50.01);
assert.equal(parsedPortfolioCsv.rows[1].amount, 49.5);
assert.equal(parsedPortfolioCsv.rows[0].source_description, '');
assert.equal(
  parsedPortfolioCsv.rows[0].import_key,
  parseSchwabTransactions([
    SCHWAB_HEADERS.join('\t'),
    '08/04/2026\tBuy\tVGT\t\t0.25\t$200.00\t$0.01\t-$50.01',
  ].join('\n')).rows[0].import_key,
  'equivalent formats share the existing import identity',
);

const precisePortfolioCsv = parseSchwabTransactions([
  PORTFOLIO_CSV_HEADERS.join(','),
  'NASDAQ:QQQM,Buy,0.123456789,123.123456789012,0.0000000001,2026-08-04 16:30:00',
].join('\n'));
assert.equal(precisePortfolioCsv.errors.length, 0);
assert.equal(precisePortfolioCsv.rows.length, 1);
assert.equal(precisePortfolioCsv.rows[0].shares, 0.123456789);
assert.equal(precisePortfolioCsv.rows[0].price, 123.123456789012);
assert.equal(precisePortfolioCsv.rows[0].fees_usd, 0.0000000001);

const preciseIdentityRows = parseSchwabTransactions([
  PORTFOLIO_CSV_HEADERS.join(','),
  'NASDAQ:QQQM,Buy,0.123456789,100.000000000001,0.0000000001,2026-08-04 16:30:00',
  'NASDAQ:QQQM,Buy,0.123456789,100.000000000002,0.0000000001,2026-08-04 16:31:00',
].join('\n'));
assert.equal(preciseIdentityRows.errors.length, 0);
assert.notEqual(
  preciseIdentityRows.rows[0].import_key,
  preciseIdentityRows.rows[1].import_key,
  'values that differ beyond the former four-decimal price precision remain distinct',
);

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
  '06/05/2026\tBuy\tSMH\tVANECK SEMICONDUCTOR ETF\t0.12345678901\t$600\t\t-$74.07',
].join('\n'));
assert.equal(excessivePrecision.rows.length, 0);
assert.match(excessivePrecision.errors[0].message, /股数最多支持 10 位小数/);

const excessivePortfolioPrecision = parseSchwabTransactions([
  PORTFOLIO_CSV_HEADERS.join(','),
  'NASDAQ:SMH,Buy,0.1,600.1234567890123,0,2026-06-05 16:30:00',
  'NASDAQ:SMH,Buy,0.1,600,0.00000000001,2026-06-05 16:31:00',
].join('\n'));
assert.equal(excessivePortfolioPrecision.rows.length, 0);
assert.match(excessivePortfolioPrecision.errors[0].message, /成交价最多支持 12 位小数/);
assert.match(excessivePortfolioPrecision.errors[1].message, /手续费最多支持 10 位小数/);

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
assert.equal(invalidDeposit.errors.length, 0, 'ignored transfer rows do not block trade import');
assert.equal(invalidDeposit.ignored.length, 1);

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
const appendDiff = buildSchwabImportDiff(duplicate.rows, existing, 'append');
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
  'reset_all',
);
assert.equal(resetDiff.unchanged.length, 0);
assert.equal(resetDiff.added.length, 1);
assert.deepEqual(
  resetDiff.removed.map((row) => row.id),
  ['existing-1', 'old-etf-row', 'stock-row'],
);

const exported = exportSchwabTransactions([
  {
    trade_date: '2025-04-11',
    side: 'buy',
    ticker: 'QQQM',
    source_description: 'SYNTHETIC HIGH PRECISION ETF',
    shares: 0.123456789,
    price: 123.123456789012,
    fees_usd: 0.0000000001,
    created_at: '2025-04-11T10:00:00Z',
  },
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
]);
assert.ok(exported.startsWith('\uFEFF'));
assert.match(exported, /Date\tAction\tSymbol\tDescription\tQuantity\tPrice\tFees & Comm\tAmount/);
assert.match(exported, /0\.123456789\t\$123\.123456789012\t\$0\.0000000001/);
assert.match(exported, /-\$50\.01/);
assert.match(exported, /\t\$50\.00\r\n$/);
assert.doesNotMatch(exported, /Wire Received|MoneyLink Transfer/);

const roundTrip = parseSchwabTransactions(exported);
assert.equal(roundTrip.errors.length, 0);
assert.equal(roundTrip.rows.length, 3);
assert.equal(roundTrip.deposits.length, 0);
assert.equal(roundTrip.rows[0].shares, 0.123456789);
assert.equal(roundTrip.rows[0].price, 123.123456789012);
assert.equal(roundTrip.rows[0].fees_usd, 0.0000000001);
assert.equal(roundTrip.rows[1].fees_usd, 0.01);
assert.equal(roundTrip.rows[1].source_description, 'SYNTHETIC\t"TECH" ETF');
assert.equal(roundTrip.rows[2].source_description, 'SGOV');

const inferredFundingRows = [
  syntheticTransaction('funding-1', '2026-07-01', 'VOO', 10, 100),
  syntheticTransaction('funding-2', '2026-07-02', 'QQQ', 1, 477),
];
assert.equal(totalTradeFunding(inferredFundingRows), 1477);
assert.equal(
  assumedBrokerCashBalance(),
  0,
  'a partial transfer history never creates synthetic idle cash',
);

const migration = readFileSync(
  new URL('../supabase/migrations/0043_schwab_transaction_import.sql', import.meta.url),
  'utf8',
);
const fullResetMigration = readFileSync(
  new URL('../supabase/migrations/0044_full_reset_schwab_import.sql', import.meta.url),
  'utf8',
);
const precisionMigration = readFileSync(
  new URL('../supabase/migrations/0045_transaction_numeric_precision.sql', import.meta.url),
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
assert.match(
  fullResetMigration,
  /set schema dca_private[\s\S]*?rename to _import_schwab_transactions_v1/,
  'full reset wrapper moves the applied implementation behind a private helper',
);
assert.match(
  fullResetMigration,
  /p_mode not in \('append', 'reset_all', 'reset_etf'\)/,
  'RPC exposes a distinct full-reset mode while retaining rolling-deploy compatibility',
);
assert.match(
  fullResetMigration,
  /select count\(\*\)::integer[\s\S]*?from public\.transactions transaction[\s\S]*?where transaction\.user_id = v_user_id/,
  'full reset counts every existing user transaction',
);
assert.match(
  fullResetMigration,
  /delete from public\.cashflows cashflow\s+where cashflow\.user_id = v_user_id/,
  'full reset deletes every user cashflow',
);
assert.match(
  fullResetMigration,
  /delete from public\.funding_batches batch\s+where batch\.user_id = v_user_id/,
  'full reset deletes every user funding batch',
);
assert.match(
  fullResetMigration,
  /dca_private\._import_schwab_transactions_v1\([\s\S]*?'append'[\s\S]*?\)/,
  'full reset rebuilds from the validated append path after clearing data',
);
assert.match(
  fullResetMigration,
  /'funding_batches_removed', v_funding_batches_removed/,
  'RPC reports removed funding batches',
);
assert.match(fullResetMigration, /security invoker/, 'full reset wrapper keeps caller privileges');
assert.match(
  fullResetMigration,
  /revoke all on schema dca_private from public, anon, authenticated/,
  'the helper schema is not exposed by default role privileges',
);
assert.match(
  fullResetMigration,
  /grant execute on function dca_private\._import_schwab_transactions_v1\(jsonb, jsonb, text\[\], text\)\s+to authenticated/,
  'the security-invoker wrapper can execute its private implementation',
);
assert.match(
  fullResetMigration,
  /grant execute on function public\.import_schwab_transactions\(jsonb, jsonb, text\[\], text\)\s+to authenticated/,
  'authenticated users retain access to the corrected RPC',
);
assert.match(
  precisionMigration,
  /alter column shares type numeric\(18, 10\)[\s\S]*?alter column price type numeric\(22, 12\)[\s\S]*?alter column fees_usd type numeric\(22, 10\)/,
  'the transaction table preserves Portfolio CSV quantity, price, and commission precision',
);
for (const sourcePattern of [
  "to_char(row_data.price, 'FM999999999999990.0000')",
  "to_char(row_data.shares, 'FM999999999999990.000000')",
  "to_char(coalesce(row_data.fees_usd, 0), 'FM999999999999990.00')",
  'shares <> round(shares, 6)',
  'price <> round(price, 4)',
  'fees_usd <> round(fees_usd, 2)',
]) {
  assert.ok(
    migration.includes(sourcePattern),
    `the applied helper still contains the expected precision patch source: ${sourcePattern}`,
  );
}
assert.match(
  precisionMigration,
  /pg_get_functiondef\([\s\S]*?dca_private\._import_schwab_transactions_v1/,
  'the precision migration upgrades the private helper moved by migration 0044',
);
assert.match(precisionMigration, /round\(shares, 10\)/);
assert.match(precisionMigration, /round\(price, 12\)/);
assert.match(precisionMigration, /round\(fees_usd, 10\)/);
assert.match(precisionMigration, /FM999999999999990\.000000000000/);
assert.match(precisionMigration, /FM999999999999990\.0000000000/);
assert.match(
  precisionMigration,
  /alter function dca_private\._import_schwab_transactions_v1\(jsonb, jsonb, text\[\], text\)\s+security invoker/,
  'the upgraded private helper remains security-invoker',
);
assert.doesNotMatch(precisionMigration, /security definer/i);
assert.match(
  precisionMigration,
  /revoke all on function dca_private\._import_schwab_transactions_v1\(jsonb, jsonb, text\[\], text\)\s+from public, anon, authenticated/,
  'the upgraded helper is not exposed to public or anonymous roles',
);
assert.match(
  precisionMigration,
  /grant execute on function dca_private\._import_schwab_transactions_v1\(jsonb, jsonb, text\[\], text\)\s+to authenticated/,
  'the authenticated security-invoker wrapper can still execute the upgraded helper',
);

function syntheticTransaction(
  id: string,
  tradeDate: string,
  ticker: string,
  shares: number,
  price: number,
) {
  return {
    id,
    user_id: 'synthetic-user',
    batch_id: null,
    trade_date: tradeDate,
    ticker,
    side: 'buy' as const,
    price,
    shares,
    fees_usd: 0,
    kind: 'dca' as const,
    note: null,
    source_description: null,
    import_source: null,
    import_key: null,
    created_at: `${tradeDate}T12:00:00.000Z`,
    updated_at: `${tradeDate}T12:00:00.000Z`,
  };
}

console.log('Schwab transaction import/export checks passed');
