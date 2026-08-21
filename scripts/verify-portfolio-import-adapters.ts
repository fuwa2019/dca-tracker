import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyRowFix,
  detectPortfolioImportAdapter,
  ibkrImportAdapter,
  isRowFixable,
  rebuildPreviewAfterRowFix,
  rowFieldEdits,
  schwabImportAdapter,
  tradingViewImportAdapter,
} from '../src/lib/import/index.ts';

const fixtureDir = 'docs/research/competitive/2026-08/fixtures';
const read = (name: string) => readFileSync(`${fixtureDir}/${name}`, 'utf8');

const schwabText = read('schwab-synthetic.tsv');
const ibkrEnglishText = read('ibkr-transaction-history-en.csv');
const ibkrChineseText = read('ibkr-transaction-history-zh.csv');
const tradingViewText = read('tradingview-portfolio.csv');

const schwabPreview = schwabImportAdapter.audit({ text: schwabText, fileName: 'schwab-synthetic.tsv' });
assert.equal(schwabPreview.detection.supported, true);
assert.ok(schwabPreview.trades.length >= 3);
assert.ok(schwabPreview.cash_events.length >= 1);
assert.ok(schwabPreview.status_counts.ignore >= 1);
assert.ok(schwabPreview.status_counts.block >= 1);
assert.ok(schwabPreview.warnings.some((warning) => warning.includes('source ordinal')));
assert.ok(schwabPreview.reconciliation.ending_shares.VGT);
assert.ok(schwabPreview.reconciliation.ending_cash_usd);
assert.equal(schwabPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.match(schwabImportAdapter.export?.({ trades: schwabPreview.trades, cash_events: schwabPreview.cash_events }) ?? '', /Date\tAction\tSymbol/);

const ibkrPreview = ibkrImportAdapter.audit({ text: ibkrEnglishText, fileName: 'ibkr-transaction-history-en.csv' });
assert.equal(ibkrPreview.detection.supported, true);
assert.ok(ibkrPreview.trades.some((row) => row.ticker === 'SMH'));
assert.ok(ibkrPreview.cash_events.some((row) => row.event_type === 'dividend'));
assert.ok(ibkrPreview.cash_events.some((row) => row.event_type === 'tax'));
assert.ok(ibkrPreview.status_counts.block >= 2, 'non-USD and malformed rows must block');
assert.equal(ibkrPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.ok(ibkrPreview.reconciliation.cash_by_kind.dividend);

const ibkrChinesePreview = ibkrImportAdapter.audit({ text: ibkrChineseText, fileName: 'ibkr-transaction-history-zh.csv' });
assert.equal(ibkrChinesePreview.detection.supported, true);
assert.ok(ibkrChinesePreview.trades.some((row) => row.ticker === 'VGT'));
assert.ok(ibkrChinesePreview.cash_events.some((row) => row.event_type === 'interest'));
assert.ok(ibkrChinesePreview.status_counts.block >= 2);

const officialIbkrShape = read('ibkr-activity-statement-official-en.csv');
const officialIbkrPreview = ibkrImportAdapter.audit({ text: officialIbkrShape, fileName: 'activity-statement-trades.csv' });
assert.equal(officialIbkrPreview.errors.length, 0, 'official IBKR Trades aliases should parse');
assert.equal(officialIbkrPreview.trades[0]?.usd_amount, '-200.3703703670', 'Proceeds plus commission becomes net settlement');
const officialIbkrChineseShape = read('ibkr-activity-statement-official-zh.csv');
const officialIbkrChinesePreview = ibkrImportAdapter.audit({ text: officialIbkrChineseShape, fileName: 'activity-statement-trades-zh.csv' });
assert.equal(officialIbkrChinesePreview.errors.length, 0, 'official Chinese IBKR aliases should parse');
assert.equal(officialIbkrChinesePreview.trades[0]?.usd_amount, '-200.3703703670');

const tradingViewPreview = tradingViewImportAdapter.audit({ text: tradingViewText, fileName: 'tradingview-portfolio.csv' });
assert.equal(tradingViewPreview.detection.supported, true);
assert.ok(tradingViewPreview.trades.some((row) => row.ticker === 'VGT'));
assert.ok(tradingViewPreview.cash_events.some((row) => row.event_type === 'broker_withdrawal'));
assert.ok(tradingViewPreview.cash_events.some((row) => row.source_action === 'Taxes and fees'));
assert.ok(tradingViewPreview.status_counts.block >= 1);
assert.ok(tradingViewPreview.warnings.some((warning) => warning.includes('没有独立 Amount')));
assert.equal(tradingViewPreview.trades.find((row) => row.ticker === 'VGT')?.usd_amount, '-200.3703703670');
assert.ok(tradingViewPreview.reconciliation.investor_outflows_usd.startsWith('100.'));
const tradingViewExport = tradingViewImportAdapter.export?.({
  trades: tradingViewPreview.trades,
  cash_events: tradingViewPreview.cash_events,
});
assert.match(tradingViewExport ?? '', /^Symbol,Side,Qty,Fill Price,Commission,Closing Time/);
assert.match(tradingViewExport ?? '', /Taxes and fees/);
assert.match(tradingViewExport ?? '', /Withdrawal/);
const tradingViewRoundTrip = tradingViewImportAdapter.audit({ text: tradingViewExport ?? '' });
assert.equal(tradingViewRoundTrip.errors.length, 0, 'TradingView export must re-import without blocked rows');
assert.equal(tradingViewRoundTrip.trades.length, tradingViewPreview.trades.length);
assert.equal(tradingViewRoundTrip.cash_events.length, tradingViewPreview.cash_events.length);

const duplicateKey = ibkrPreview.trades.find((row) => row.ticker === 'VGT')?.import_key;
assert.ok(duplicateKey);
const duplicatePreview = ibkrImportAdapter.audit(
  { text: ibkrEnglishText },
  { existing_import_keys: new Set([duplicateKey!]) },
);
assert.ok(duplicatePreview.status_counts.duplicate >= 1, 'existing source identity must become duplicate');

assert.equal(
  detectPortfolioImportAdapter({ text: tradingViewText })?.source,
  'tradingview',
  'six-column TradingView must win before the legacy Schwab-compatible parser',
);
assert.equal(detectPortfolioImportAdapter({ text: ibkrEnglishText })?.source, 'ibkr');
assert.equal(detectPortfolioImportAdapter({ text: schwabText })?.source, 'schwab');

// Inline row fixing: the fixture carries exactly one blocked TradingView row
// (a Withdrawal with a non-numeric amount) alongside 13 importable rows.
const fixablePreview = tradingViewImportAdapter.audit({ text: tradingViewText, fileName: 'tradingview-portfolio.csv' });
assert.equal(fixablePreview.status_counts.block, 1, 'fixture keeps exactly one blocked row');
const blockedRow = fixablePreview.rows.find((row) => row.status === 'block');
assert.ok(blockedRow, 'fixture must produce a blocked row');
assert.equal(blockedRow!.source_fields?.quantity, 'not-a-number', 'source_fields captures the raw offending value');
assert.equal(isRowFixable(tradingViewImportAdapter, blockedRow!), true, 'a parse-error TradingView row is fixable');
assert.equal(isRowFixable(schwabImportAdapter, blockedRow!), false, 'fixability is adapter-specific, not row-only');

const edits = rowFieldEdits(blockedRow!);
assert.ok(edits.some((edit) => edit.field === 'quantity' && edit.original === 'not-a-number'), 'edit view exposes the original raw text');

const fixedPreview = rebuildPreviewAfterRowFix(
  tradingViewImportAdapter,
  fixablePreview,
  blockedRow!.source_index,
  { quantity: '-50' },
  { mode: 'append' },
);
assert.ok(fixedPreview, 'a valid correction produces a rebuilt preview');
assert.equal(fixedPreview!.status_counts.block, 0, 'the fixed row is no longer blocked');
assert.equal(fixedPreview!.status_counts.import, fixablePreview.status_counts.import + 1, 'the fixed row becomes importable');
assert.equal(fixedPreview!.rows.length, fixablePreview.rows.length, 'total row count is unchanged by a fix');
const fixedRow = fixedPreview!.rows.find((row) => row.source_index === blockedRow!.source_index);
assert.equal(fixedRow?.source_fields?.quantity, 'not-a-number', 'the original source text stays visible after a fix, never overwritten');
assert.equal((fixedRow?.item as { usd_amount?: string } | undefined)?.usd_amount, '-50.0000000000');

// A fix that reproduces another row's identity is refused, not silently
// merged: the row stays blocked with a reason naming the collision.
const collidingRow = fixablePreview.rows.find((row) => row.item && 'side' in row.item && row.item.ticker === 'VGT' && row.item.side === 'buy');
assert.ok(collidingRow?.item, 'fixture has a VGT buy row to collide with');
const collisionResult = applyRowFix(tradingViewImportAdapter, fixablePreview, blockedRow!.source_index, {
  symbol: 'NASDAQ:VGT',
  action: 'Buy',
  quantity: (collidingRow!.item as { shares: string }).shares,
  price: (collidingRow!.item as { price: string }).price,
  fees: (collidingRow!.item as { fees_usd: string }).fees_usd,
  date: '2026-01-02 09:01:00',
});
assert.equal(collisionResult?.collision_source_index, collidingRow!.source_index, 'a fix reproducing another row is flagged as a collision, not applied');
assert.equal(collisionResult?.row.default_status, 'block', 'a colliding fix stays blocked rather than reaching the RPC payload');
assert.equal(collisionResult?.row.source_fields?.quantity, 'not-a-number', 'the pristine source text survives even a refused fix');

// IBKR blocked rows are fixable too, and reparseRow must honor the same
// file-level gross-vs-net amount context a full parse used (carried on
// ImportDetection.context, since a single row can't re-derive it).
const badDateRow = ibkrPreview.rows.find((row) => row.status === 'block' && row.source_fields?.date === 'bad-date');
assert.ok(badDateRow, 'IBKR fixture has a malformed-date blocked row');
assert.equal(isRowFixable(ibkrImportAdapter, badDateRow!), true);
const ibkrFixed = rebuildPreviewAfterRowFix(
  ibkrImportAdapter,
  ibkrPreview,
  badDateRow!.source_index,
  { date: '2026-01-16' },
  { mode: 'append' },
);
assert.ok(ibkrFixed);
const ibkrFixedRow = ibkrFixed!.rows.find((row) => row.source_index === badDateRow!.source_index);
assert.equal(ibkrFixedRow?.status, 'import', 'a corrected date makes the IBKR row importable');
assert.equal(ibkrFixedRow?.source_fields?.date, 'bad-date', 'the original malformed date stays visible after the fix');
assert.equal((ibkrFixedRow?.item as { effective_date?: string } | undefined)?.effective_date, '2026-01-16');

// Schwab's legacy per-row parser has no per-field source capture, so its
// blocked rows are honestly not fixable inline — the same "fix the source
// file" path as before this feature existed.
const schwabBlockedRow = schwabPreview.rows.find((row) => row.status === 'block');
assert.ok(schwabBlockedRow, 'Schwab fixture has a blocked row');
assert.equal(schwabBlockedRow!.source_fields, undefined, 'Schwab rows never carry source_fields');
assert.equal(isRowFixable(schwabImportAdapter, schwabBlockedRow!), false, 'Schwab blocked rows are not offered inline fixing');
assert.equal(schwabImportAdapter.reparseRow, undefined, 'Schwab adapter does not implement reparseRow');

console.log('portfolio import adapter checks passed');
