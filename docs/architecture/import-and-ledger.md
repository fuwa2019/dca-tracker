# Import and Portfolio Ledger Contract

Status: parser and preview contracts implemented locally; database write release pending.
Updated: 2026-09-04

## Boundary

`src/lib/import/` is a browser-safe, database-free boundary. An adapter detects
one source format, parses it, normalizes it into ledger objects, and audits each
source row. It never calls Supabase or mutates account state.

The unified `PortfolioImportTools` is the default when
`VITE_LEDGER_IMPORT_V2` is not explicitly set to `0`, and is always visible in
local mode. The legacy Schwab-specific path remains available only as an
explicit compatibility rollback; native multi-currency writes require the
append-only migration `0054_portfolio_multi_currency.sql` to be applied first.

## Standard Interface

`PortfolioImportAdapter` exposes:

- `detect(input)`: source and format detection with confidence;
- `parse(input)`: format-specific rows and parse errors;
- `normalize(parsed)`: `LedgerTrade[]` and `LedgerCashEvent[]`;
- `audit(input, options)`: row outcomes `import`, `duplicate`, `ignore`, or
  `block`, plus reconciliation-ready normalized values;
- optional `export(ledger)`: a source-shaped export when the source can express
  every event type without loss.

`LedgerTrade` and `LedgerCashEvent` keep decimal values as strings until an
explicit persistence/calculation boundary. `usd_amount` is signed settlement
cash. A source-provided settlement amount is authoritative; quantity times
price is only the fallback for formats that do not provide it.

`ImportPreview.reconciliation` recomputes ending shares, signed cash by event
kind, investor inflows/outflows, and ending cash from the final retained ledger.
The displayed totals therefore match the payload that would be sent to the RPC,
not raw rows before ignored or blocked source actions. Asset classification is
descriptive only in the unified portfolio importer: individual stocks, ETFs,
foreign-market symbols, and unknown tickers are retained when their row fields
are valid.

## Current Adapters

- Schwab: the unified adapter parses the native tab-delimited/eight-column
  export, including deposits, withdrawals, dividends, DRIP/reinvested shares,
  interest, taxes, and fees; it preserves source identity and settled amount.
  A six-column legacy fallback remains for backward compatibility.
- IBKR: accepts English and Chinese header/action aliases, including official
  `Date/Time`, `Type`, `T. Price`, `Proceeds`, `Net Amount`, `Currency`,
  `Exchange`, and `Total Comm/Tax` fields; maps transaction-history Header/Data
  sections, preserves native price/amount/currency/FX fields, and normalizes
  to USD when a source row provides either an FX rate or an explicit USD
  settlement value. A non-USD row without enough conversion evidence is
  blocked with its reason visible in the preview.
- TradingView: accepts the six-column Portfolio Analyzer shape, including
  Buy, Sell, Dividend, Deposit, Withdrawal, Interest, Tax, and Taxes and fees;
  its normalized ledger also exports back to the same six-column shape.

The adapter regression fixture is synthetic and lives under
`docs/research/competitive/2026-08/fixtures/`. It is not a real broker export.
The multi-currency contract is additive and keeps the existing USD calculation surface.

## Persistence Release Gate

The local append-only migrations `0050_portfolio_ledger_import.sql` and `0054_portfolio_multi_currency.sql` provide:

- `cashflows.effective_date`, optional `ticker`, `source_currency`, source
  amount, and FX audit fields;
- allows the fixed cash event kinds while preserving signed `usd_amount`;
- authenticated `import_portfolio_ledger(source, trades, cash_events,
  mode)` with `append`, `replace_source`, and `reset_all`;
- one-user advisory transaction locking;
- the old Schwab RPC as a compatibility wrapper;
- unchanged percentage-only public share RPCs.
- transaction-native price/amount/currency and FX columns while keeping
  canonical `price`, `fees_usd`, and `settled_amount_usd` in USD;
- an authenticated multi-currency wrapper around the already validated ledger
  write primitive.

Before enabling the flag for a cloud deployment, run the migration against an
isolated authorized database and prove append idempotency, source replacement,
reset rollback, RLS ownership, and the public-share privacy snapshot.

The migration also restores the missing `cashflows_invalidate_history_cache`
AFTER trigger using the existing internal cache-dirty helper. This is required
because the live production schema currently has the helper but no cashflow
trigger attached to it.
