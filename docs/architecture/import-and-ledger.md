# Import and Ledger Contract

Status: parser and preview contracts implemented locally; database write release pending.
Updated: 2026-08-18

## Boundary

`src/lib/import/` is a browser-safe, database-free boundary. An adapter detects
one source format, parses it, normalizes it into ledger objects, and audits each
source row. It never calls Supabase or mutates account state.

The default cloud UI still uses `src/lib/schwabTransactions.ts` and the
compatible `import_schwab_transactions` RPC. `PortfolioImportTools` is now
available behind `VITE_LEDGER_IMPORT_V2` and is always visible in local mode;
it remains preview-only until the generic RPC is verified and released.

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
kind, investor inflows/outflows, and ending cash from the final asset-policy
filtered ledger. The displayed totals therefore match the payload that would
be sent to the RPC, not the raw rows before ignored or blocked securities.
The same asset policy applies to ticker-bearing cash events such as dividends,
not only buy/sell rows; pure cash events remain eligible without an asset
classification.

## Current Adapters

- Schwab: wraps the existing tab-delimited/eight-column and six-column parser,
  preserving source identity, settled amount, deposits, and stock allocations.
- IBKR: accepts English and Chinese header/action aliases, including official
  `Date/Time`, `Type`, `T. Price`, `Proceeds`, and `Total Comm/Tax` fields;
  maps activity rows and blocks non-USD rows without an explicit USD settlement
  value.
- TradingView: accepts the six-column Portfolio Analyzer shape, including
  Buy, Sell, Dividend, Deposit, Withdrawal, Interest, Tax, and Taxes and fees;
  its normalized ledger also exports back to the same six-column shape.

The adapter regression fixture is synthetic and lives under
`docs/research/competitive/2026-08/fixtures/`. It is not a real broker export.

## Persistence Release Gate

The local append-only migration `0050_portfolio_ledger_import.sql` provides:

- `cashflows.effective_date`, optional `ticker`, `source_currency`, and
  source amount audit fields;
- allows the fixed cash event kinds while preserving signed `usd_amount`;
- authenticated `import_portfolio_ledger(source, trades, cash_events,
  mode)` with `append`, `replace_source`, and `reset_all`;
- one-user advisory transaction locking;
- the old Schwab RPC as a compatibility wrapper;
- unchanged percentage-only public share RPCs.

Before enabling the flag for a cloud deployment, run the migration against an
isolated authorized database and prove append idempotency, source replacement,
reset rollback, RLS ownership, and the public-share privacy snapshot.

The migration also restores the missing `cashflows_invalidate_history_cache`
AFTER trigger using the existing internal cache-dirty helper. This is required
because the live production schema currently has the helper but no cashflow
trigger attached to it.
