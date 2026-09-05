# Overloaded Postgres functions must not carry a default that shadows a wrapper

Date: 2026-08-31
Status: accepted
Migration: `supabase/migrations/0053_fix_performance_source_hash_ambiguity.sql`
Check: `npm run test:migration-overloads`

## Context

`refresh_due_performance_caches` — the small-batch nightly warm-up the quote
Worker calls after each daily price sync — has been failing in production. The
project's own Postgres logs show it on every cron firing, for example at
`2026-08-31T12:15:39.808Z` and `2026-08-31T04:10:35.708Z`:

```
42725  function public._performance_source_hash(uuid) is not unique
HINT   Could not choose a best candidate function. You might need to add
       explicit type casts.
```

PostgREST returned 400 to the Worker; `refreshDuePerformanceCaches` in
`workers/quote/src/index.ts` catches and `console.warn`s instead of rethrowing,
so nothing reached the handoff, the release gates, or any test.

The cause is an overload pair:

- `_performance_source_hash(p_user_id uuid)` — the default-`SPY` wrapper;
- `_performance_source_hash(p_user_id uuid, p_benchmark text)` — the real body.

A one-argument call resolves only while the two-argument form has **no**
default. Migration `0028` established exactly that, and its header says so.
`0043` (2026-07-28) then wrote `p_benchmark text default 'SPY'` and `0047`
carried it forward. `create or replace function` happily *adds* a default, so
both migrations applied cleanly and the breakage appeared only at call time.

The blast radius is narrow because every other caller passes both arguments:
`_refresh_performance_history_cache_for_user` (0042) and
`performance_cache_status` (0027) both use the two-argument form. The single
one-argument caller is `refresh_due_performance_caches` (0014).

## Decision

Add `0053`, which drops the two-argument form and recreates it with the 0047
body and no default. `create or replace` cannot remove a parameter default, so
a drop is required; the one-argument wrapper is left untouched because its body
resolves the two-argument call at runtime. The migration ends with a
`do $$ perform public._performance_source_hash('…'::uuid); $$` so a future
reintroduced default fails the migration loudly instead of silently at 04:10.

Add `scripts/verify-function-overloads.mjs`, run as
`npm run test:migration-overloads`. It replays every `create function` and
`drop function` across `supabase/migrations/` **in file order**, computes each
function's live signature set, and fails when two live signatures accept the
same argument count with an identical type prefix. It is mutation-tested in
both directions: removing `0053` reproduces the production error, and
reintroducing the default inside `0053` fails it.

## Known ambiguities left in place

The same check surfaces four older pairs, each a `(p_benchmark text default …)`
form plus an explicit zero-argument compatibility wrapper:

| Function | Zero-arg wrapper | Defaulted form |
|---|---|---|
| `performance_history` | 0027 | 0052 |
| `performance_cache_status` | 0027 | 0027 |
| `refresh_performance_history_cache` | 0027 | 0027 |
| `tracked_symbol_coverage` | 0033 | 0040 |

These are registered in the script as non-blocking warnings rather than fixed.
They differ from the `_performance_source_hash` case in three ways: no
production failure has been observed for any of them; the client reaches the
zero-argument form only through a fallback branch
(`src/hooks/usePerformanceCache.ts`, `src/hooks/usePortfolio.ts`,
`src/hooks/useDemoDcaData.ts`) that normally passes `p_benchmark` by name, which
PostgREST resolves unambiguously; and fixing them means dropping and recreating
four functions that carry `grant execute … to authenticated`, one of which is
part of the 0052 V2 cache contract. That is a separate, authorized change, not
a side effect of this one.

The fallback branches are therefore latent, not dead: if the named-argument
call ever fails, the zero-argument retry raises 42725 rather than falling back.

## Rejected alternatives

- **Drop the one-argument wrapper instead.** It would fix the resolution just
  as well, but `refresh_due_performance_caches` (0014) calls it, and rewriting
  an applied migration is not allowed. Rewriting the caller in 0053 too would
  widen the change without making it safer.
- **Give the wrapper a distinct name.** Same call-site churn, and it abandons
  the pattern the rest of the schema already uses.
- **Make the Worker rethrow so the failure surfaces.** Worth doing on its own
  merits, but it is a deploy, and it would have turned a silent no-op into a
  daily alarm rather than preventing the regression. The static check prevents
  it before it reaches the database.

## Consequences

- The nightly warm-up starts working again once `0053` is applied, so the first
  dashboard load after a data change no longer pays the full recompute. Nothing
  else changes: the hash body is byte-identical to 0047, so no cached row is
  invalidated by this migration.
- Any future migration that adds a shadowing default fails
  `npm run test:migration-overloads` before it can be applied, and fails its own
  `do $$ … $$` guard if applied anyway.
- The check is static text only. It cannot see a function built by dynamic SQL
  inside a `do $$ … $$` block — 0047 rewrites `shared_portfolio` that way — so
  it is a floor, not a proof.

## Rollback

`0053` is additive in effect: it restores the 0028 signature. To roll back,
apply a new migration that drops `public._performance_source_hash(uuid, text)`
and recreates it with `p_benchmark text default 'SPY'`, which returns the
schema to its 0047 state and reinstates the 42725 failure. There is no data to
restore — the function is `stable` and writes nothing.
