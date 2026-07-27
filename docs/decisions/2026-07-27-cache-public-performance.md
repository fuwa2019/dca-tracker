# Cache Public Performance

Status: accepted
Date: 2026-07-27

## Context

The authenticated dashboard and public share view need the same performance
curve. Recomputing history anonymously would require access to private
transactions, cashflows, and prices and would create unnecessary database cost.

## Decision

Use `performance_history_cache` as the shared return-series contract.
Authenticated and service-role entry points refresh it. Public share reads are
cache-only and return sanitized percentage data.

## Alternatives Considered

1. Recompute performance anonymously from transactions, cashflows, and prices.
   Rejected because it would require access to private source rows and create
   unbounded public database work.
2. Maintain separate dashboard and public-share performance series. Rejected
   because calculation and warning behavior could drift between the two views.
3. Recompute the public series in the browser. Rejected because the browser
   cannot safely receive the private inputs and would not provide a durable,
   reusable result.

## Decision Rationale

A shared cache gives authenticated and public views one testable TWR contract
while keeping private inputs behind RLS and service-role boundaries. Cache-only
public reads also bound request cost and make missing or stale data explicit.

## Consequences

- Dashboard/share parity is testable.
- Public views do not need private source rows.
- Shared responses cannot expose absolute portfolio amounts.
- Cache dirty state and refresh operations are part of normal product behavior.
- A missing public cache produces an empty/stale state, not anonymous
  recomputation.

## Rollback

Any replacement requires a new ADR and append-only database migration. Keep the
public path cache-only until a replacement preserves the same privacy boundary.
Roll back application readers or refresh entry points through a normal release;
do not rewrite applied migrations or restore anonymous access to private rows.
