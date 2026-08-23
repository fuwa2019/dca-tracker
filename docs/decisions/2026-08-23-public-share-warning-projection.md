# Public Share Warning Projection

## Context

`requirements-audit.md` carries the D-row "dashboard and public share use the
same V2 cache without amount leakage" as the only fully missing contract. Work
on the D2/D3 half — assert no internal identifiers, assert the share stays a
read-only cache path — started with a static audit of the anonymous surface
rather than an implementation.

The audit found a live defect in the existing V1 path.

## Finding

`public.shared_performance_history` returns the cached history payload
wholesale:

```sql
return v_cached || jsonb_build_object('dirty', coalesce(v_dirty, false));
```

The cache writer builds a `warnings` array, and one of its three warning shapes
carries absolute USD figures:

```sql
jsonb_build_object(
    'date', date,
    'type', skip_type,
    'nav_user', nav_user,
    'nav_benchmark', nav_benchmark,
    'flow', flow
)
```

That warning fires when a day is skipped because NAV net of flow fell to zero or
below — a full liquidation, a large withdrawal, or a data gap. When it exists,
an anonymous share request returns portfolio NAV and a flow amount, which breaks
the percentage-only public-share contract in `PROJECT.md`.

The condition is why it went unnoticed: the synthetic and normal states never
produce a skip warning, so the payload is amount-free almost all of the time.

Reproduced on a throwaway PostgreSQL 15.19 cluster with the shipped function
body and a cache row shaped like the writer's output. Before the fix the
anonymous response contained `nav_user 12345.67`, `nav_benchmark 12000.00`,
`flow -9000.00`.

## Decision

Project the cached payload through an allowlist at the public boundary, in
migration `0051_public_share_warning_projection.sql`. A warning keeps `date`,
`type`, `original_date` and `ticker`; everything else is dropped for anonymous
readers.

The boundary, not the writer, for three reasons:

- The owner keeps the amounts. They are diagnostic detail about why a day was
  skipped, and nothing in the product displays them today, but discarding them
  from the cache would remove information the owner is entitled to.
- The dashboard and the share keep reading one cached TWR contract, which is the
  architecture rule this work must not break.
- Nothing has to be recomputed or rewritten. Existing cache rows are sanitized
  on read, so there is no production data write and no service gap.

The projection is an **allowlist**. Any field a future migration adds to a
warning is dropped from the public payload unless it is added deliberately. That
matters more than the specific fix: the cache writer
`_performance_history_for_user_fast_base` has no static definition anywhere in
the repository — migration 0029 created it by renaming the then-current
`_performance_history_for_user_fast`, and every later change patches it in place
through `pg_get_functiondef`. Its body is only knowable from a live database, so
the public boundary cannot trust it and must project.

## Alternatives Considered

- **Strip the amounts in the cache writer.** Rejected: the writer is only
  reachable by in-place patching, the change would need every cached row
  rewritten or invalidated, and it would take the diagnostic away from the
  owner as well.
- **Blocklist the three known fields at the boundary.** Rejected: it holds only
  until someone adds a fourth. The allowlist fails closed.
- **Leave it and document the condition.** Rejected: it is an unconditional
  breach of a stated red line whenever the warning exists.

## Gate

`npm run test:share-privacy` (`scripts/verify-public-share-privacy.mjs`, wired
into CI) reads the migration set and fails when:

- the effective anon-executable function set differs from the three documented
  entry points;
- an anonymous entry point emits a JSON key outside its allowlist, an id-like or
  amount-like key, or writes `v_user_id` / `p_token` / `share_links` into a
  payload value;
- an entry point returns a cached payload without routing it through
  `_public_share_sanitize_history`;
- an anonymous path calls a recompute or refresh helper;
- a dynamic `pg_get_functiondef` patch introduces a new `jsonb_build_object`,
  which would add payload fields outside static audit.

The gate was negative-tested against three mutated copies of the migration set —
sanitizer removed, an extra anon grant, an amount key added to an entry point —
and fails on each.

What the gate does not prove: it reads migration text, not the live database. A
production drift check still requires querying the deployed definitions.

## Consequences

Migration `0051` is written and verified locally but **not applied**. Applying it
changes a production RPC and needs explicit authorization for that operation. It
replaces two function definitions and writes no rows, so it is reversible by
re-applying the previous definition in a further append-only migration.

Until it is applied, production continues to leak the three warning fields in
the conditional case described above.

D2 (no internal identifiers) and D3 (share stays a read-only cache path) are now
gated in CI for the V1 path. D1 still needs the V2 cache itself; the gate and the
projection will carry over to it.
