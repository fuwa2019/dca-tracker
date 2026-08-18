# Ledger Import Release Gate

## Context

The source-neutral import contract and migration `0050_portfolio_ledger_import.sql`
are implemented in the working tree. The active production Supabase project was
updated after explicit user authorization on 2026-08-18 and then verified
read-only.

## Evidence

- Production migration inventory now includes
  `0050_portfolio_ledger_import` after the authorized migration.
- `public.cashflows` has V2 fields `effective_date`, `ticker`,
  `source_currency`, and `source_amount`; all 7 pre-existing rows have a
  non-null `effective_date`.
- `cashflows`, `transactions`, and private cache tables have RLS enabled.
- The existing `import_schwab_transactions` function is security-invoker and
  executable by `authenticated`; the public share functions remain separate
  security-definer read paths.
- The internal performance-cache dirty helper exists, but production has no
  `cashflows_invalidate_history_cache` trigger. Migration `0050` recreates it.
- No development branch exists. A confirmed create attempt for
  `dca-ledger-20260818` returned `PaymentRequiredException`: branching is
  supported only on the Pro plan or above. The user has now chosen to keep
  Supabase `main` as the cloud baseline and use local PostgreSQL 15 for
  isolated writes and migration/RLS tests.

## Decision

Use Supabase `main` as the production cloud baseline with migration `0050`
applied. Keep `VITE_LEDGER_IMPORT_V2=0` for the first cloud frontend release;
local mode may expose the source-neutral preview because it never writes. Use
the local PostgreSQL 15 cluster for isolated writes and migration/RLS tests.
The following gates were re-run against production after the migration:

- RLS owner isolation and authenticated-only RPC execution;
- append idempotency and source-scoped replacement;
- full reset scope and rollback after validation/insert failure;
- cashflow cache invalidation and private PnL cleanup;
- old Schwab RPC compatibility;
- public share privacy remains percentage-only.

## Alternatives Considered

- Apply `0050` without explicit authorization: rejected; it was later applied
  only after the user gave direct authorization.
- Update `performance_history_cache` directly from the invoker RPC: rejected;
  the cache is authenticated-read-only and the existing internal helper is the
  established security boundary.
- Create a Supabase development branch without checking cost/organization:
  rejected because it creates external state and may incur cost.
- Assume the free plan supports branching: rejected by the actual Supabase
  response; the user chose the existing `main` baseline plus local PostgreSQL.

## Consequences

The generic preview and payload code can continue to mature locally while the
first cloud frontend release remains on the verified legacy import path.
`main` is the cloud reference; local PostgreSQL remains the isolated write/test
boundary. Enabling the V2 flag or switching the performance method is a later
release gate.

## Rollback

Migration rollback is not automatic: the repository keeps the append-only
history and the next corrective migration must be authorized separately. The
frontend can be rolled back to the previous Pages deployment while the V2 flag
remains off. No production rows or secrets were changed by this migration.
