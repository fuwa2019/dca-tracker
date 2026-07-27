# ADR 0001: Cache Public Performance

Status: accepted

## Context

The authenticated dashboard and public share view need the same performance
curve. Recomputing history anonymously would require access to private
transactions, cashflows, and prices and would create unnecessary database cost.

## Decision

Use `performance_history_cache` as the shared return-series contract.
Authenticated and service-role entry points refresh it. Public share reads are
cache-only and return sanitized percentage data.

## Consequences

- Dashboard/share parity is testable.
- Public views do not need private source rows.
- Shared responses cannot expose absolute portfolio amounts.
- Cache dirty state and refresh operations are part of normal product behavior.
- A missing public cache produces an empty/stale state, not anonymous
  recomputation.
