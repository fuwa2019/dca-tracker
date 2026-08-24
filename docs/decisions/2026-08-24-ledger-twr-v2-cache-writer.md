# Where the ledger_twr_v2 curve is computed

Date: 2026-08-24
Status: accepted
Migration: `supabase/migrations/0052_ledger_performance_cache_v2.sql`

## Context

D1 in `docs/research/competitive/2026-08/requirements-audit.md` asks for the
dashboard and the public share to read one V2 cache without leaking amounts.
The V2 engine already exists as a pure module, `src/lib/calc/ledgerTwr.ts`, and
`npm run test:finance` gates it against Portfolio Performance 0.86.0's own
stored ledger — it reproduces that application's displayed value, TTWROR and
IRR. What did not exist was anywhere to put its output.

Three facts constrained the choice.

1. `performance_history_cache` is keyed `(user_id, benchmark, method)`, but
   every reader hardcodes `method = 'TWR'`. A second method can therefore be
   stored beside V1 rather than replacing it.
2. The V1 engine, `_performance_history_for_user_fast_base`, has no static
   definition anywhere in the repository. Migration 0029 created it by renaming
   the then-current function, and 0037, 0043 and 0047 each patch it in place
   through `pg_get_functiondef`. Its body is only knowable from a live database.
   That is what forced the boundary projection in 0051.
3. V1 stores `return_pct_user` as a **fraction** (`exp(sum(ln(factor))) - 1` in
   0026), not a percent, despite the name.

## Options considered

**Port the engine to PL/pgSQL.** Server-authoritative, and the share would read
a curve no client touched. Rejected: it creates a second implementation of an
engine that has been reconciled against a reference application, with the
reconciliation gate covering only one of the two. The two would drift, and the
drift would be invisible until someone re-ran the comparison by hand.

**Let the authenticated browser compute and write the cache.** Keeps one
engine and needs no new infrastructure. Rejected: the browser would become the
authority for a value the public share serves.

**Compute in the quote Worker under the service role.** Chosen. It keeps
`src/lib/calc/ledgerTwr.ts` as the single engine — the Worker imports it
directly rather than copying it, so there is nothing to drift — while the
authority stays server-side, and it reuses the service-role batch-refresh entry
point that `docs/architecture/performance-and-privacy.md` already sanctions.

## Decision

The Worker computes; the database validates and stores.

`write_ledger_performance_cache` is deliberately not a "store this payload"
RPC. It takes a series, a completeness flag and warnings, checks each against
an allowlist, and then **builds** the cached payload itself. A caller
contributes values, never keys, so an absolute amount cannot enter the cache at
all — not merely be stripped on the way out. Warnings use the same four-key
allowlist that 0051 projects to, so writer and boundary cannot drift apart.

Verified on a throwaway PostgreSQL 15.19 cluster with all 54 migrations
applied: series entries carrying `nav_user` or `flow` are rejected, as are
non-ISO dates, string percentages, and a non-array payload; a warning carrying
`nav_user: 999.99` and `flow: -42` is reduced to `date` and `type` at write
time.

## Consequences

- **V1 remains the default and is untouched.** `settings.performance_method`
  defaults to `adjusted_proxy_v1`. Both readers keep their existing V1 branches
  byte-for-byte, including the legacy-mirror fallback.
- **The method is stored server-side, not passed in.** An anonymous share
  caller must not be able to choose which method it reads.
- **No silent fallback.** When a user is on V2 and the V2 row is missing, both
  readers return `history_cache_missing` naming the method rather than serving
  V1. A fallback would let the dashboard and the share report different
  methods, which is the exact property D1 asks us to guarantee. The frontend
  already tolerates an empty series, so this degrades to an empty curve.
- **The magnitude check is a smell test, not the guarantee.** It rejects a
  return outside ±1000 — loose on purpose, because a 30-year time-weighted
  return at the rates this product projects can legitimately approach it. It
  catches a NAV like `138499.04` landing in a return field; it does not catch a
  small amount, and `921.53` passes. The guarantee is the key allowlist.
- **No cron trigger was added.** The account is near its five-trigger limit,
  and an independent schedule would race the prices the curve reads, so the V2
  refresh runs after the existing daily price sync completes.
- **The flag has no UI.** Flipping a user to `ledger_twr_v2` is a deliberate
  database action, gated by B2, not something a settings pane can do by
  accident.

## Not covered

Nothing here has run against a real portfolio. The Worker path is verified by
typecheck and a wrangler dry-run that confirms the engine bundles; the SQL is
verified on a local cluster with synthetic rows. A real refresh needs the
migration applied and the Worker deployed, both separately authorized, and B2's
re-import and V1 regression still gate the switch itself.
