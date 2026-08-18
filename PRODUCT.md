# DCA Tracker Product Baseline

Status: baseline draft, 2026-08-18

## Product

DCA Tracker is a private, open-source, single-portfolio tracker for a person
who steadily invests in US ETFs and needs an auditable record of what happened,
what the account is worth, and how the result was calculated.

The product promise is: precise inputs, restrained scope, transparent outputs.
The product is an application-owned ledger. It is not a trading terminal, a
brokerage sync service, a multi-account wealth platform, or a SaaS product.

## Product Principles

### Precise

- Preserve source values before deriving display values.
- Treat every imported source row as a first-class audit item.
- Keep settlement cash, cost basis, cash events, NAV, XIRR, and TWR as separate
  contracts with explicit boundaries.
- Reject data that cannot be reconciled instead of silently guessing.
- Keep decimal precision through parse, preview, persistence, calculation, and
  export.

### Restrained

- One person, one ETF portfolio, one clear operating model.
- Focus on transactions, cash events, holdings, performance, data health, and
  privacy-safe sharing.
- Do not add account aggregation, live brokerage synchronization, order
  execution, crypto assets, personal budgets, retirement planning, or multi-
  tenant operations in this plan.
- Prefer a small number of explainable states over a large feature surface.

### Transparent

- Preview before any write.
- Show a row-level result of imported, duplicate, ignored, or blocked.
- Explain the source, method, timing convention, and reason for every warning.
- Make source replacement, rollback, and destructive reset explicit.
- Keep public sharing percentage-only and independently reviewable.

## Priority Order

1. Trusted import and ledger
2. Financial calculations
3. Operational experience
4. Analysis and sharing

No visual redesign or analytical feature should weaken the first two priorities.

## Primary Jobs

1. Import a complete or incremental broker history without losing source
   identity or silently duplicating rows.
2. Reconcile holdings, cash, costs, dividends, interest, withdrawals, taxes,
   and fees against the source statement.
3. Understand the difference between account value, investor cash flows,
   realized results, XIRR, and daily TWR.
4. Repair, replace, export, or restore data without editing the database.
5. Share a useful performance view without exposing absolute amounts or
   transaction details.

## Core Objects

- `LedgerTrade`: a buy or sell with source identity, effective date, ticker,
  quantity, price, fee, and authoritative settlement amount when supplied.
- `LedgerCashEvent`: a dated cash event with a fixed kind, signed USD amount,
  optional ticker, source currency, and source identity.
- `ImportPreview`: a no-write result containing source metadata, row outcomes,
  warnings, reconciliation totals, and the selected import mode.
- `ImportReceipt`: an auditable write result containing the source fingerprint,
  mode, counts, unchanged/removed counts, and committed identifiers.
- `PerformanceMethod`: `adjusted_proxy_v1` for legacy data and
  `ledger_twr_v2` for a fully reconciled ledger.

## Required Import States

Every source row ends in exactly one primary state:

- `import`: valid and new, eligible for the selected write mode;
- `duplicate`: matches an existing source identity and will not create a row;
- `ignore`: known and intentionally outside the retained ETF ledger;
- `block`: invalid, ambiguous, unsupported currency, or unsafe to write.

Warnings may accompany an imported or ignored row, but a warning must never
hide a blocked row or imply that a failed write partially succeeded.

## Success Measures

- Same synthetic history imported through Schwab, IBKR, and TradingView agrees
  within 1e-8 shares and $0.01 ending cash.
- Re-importing the same file creates zero new records.
- `replace_source` leaves manual rows and other sources untouched.
- A failed import leaves no partial database changes.
- XIRR and daily TTWROR agree with the Portfolio Performance fixture within
  one basis point.
- A first import can be completed in five minutes without database access.
- Login, import, overview, performance, sharing, and settings pass WCAG 2.2 AA
  checks and keyboard flows.
- Public RPCs, share pages, and cached payloads expose no absolute amounts or
  cash events.

## Release Boundaries

Each six-month phase is an independent release. A database migration, a
performance-method switch, and a whole-site visual rebuild must not be bundled
into one release. Production database changes, secret changes, real broker
files, and deployment still require explicit authorization.
