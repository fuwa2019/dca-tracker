# Migration Numbering Duplicates

Status: accepted
Date: 2026-07-27

## Context

The append-only migration history contains two files numbered `0022` and two
files numbered `0027`:

- `0022_daily_price_coverage_by_ticker_start.sql`
- `0022_fix_daily_prices_dirty_trigger_safe_update.sql`
- `0027_dynamic_benchmarks_and_selected_performance.sql`
- `0027_trading_day_performance_history.sql`

The two files in each numbered pair have been reviewed and do not depend on
functions, fields, or other objects introduced by the other file in that pair.
Migrations are applied manually in repository filename order through the
Supabase SQL Editor, not tracked automatically by the Supabase CLI. The current
lexical order happens to work, but duplicate numbering is not a reliable
ordering contract.

## Decision

Keep the four applied historical migration filenames unchanged. Add
`scripts/verify-migration-numbering.mjs` and the
`npm run test:migration-numbering` command. The check treats exactly two files
for each reviewed historical duplicate number, `0022` and `0027`, as
non-blocking warnings. It fails on any other duplicate, an additional file
using either known number, or a gap between `0001` and the current maximum
number.

## Alternatives Considered

1. Rename the four historical files to restore unique numbering. Rejected
   because applied migrations are immutable project history and renaming them
   would make repository history diverge from what operators executed.
2. Continue relying on reviewers to notice duplicate prefixes. Rejected
   because the existing duplicates show that filename review alone is not an
   effective guard.
3. Adopt Supabase CLI migration tracking as part of this change. Rejected
   because it would change the deployment workflow and is outside the scope of
   a repository-only validation guard.

## Decision Rationale

Preserving applied filenames avoids rewriting database history. A narrow,
explicit warning for the two reviewed pairs documents the current exception,
while an automated failure for new conflicts prevents the exception from
silently expanding.

## Consequences

- The two known duplicate groups remain visible on every validation run.
- Future migrations must use a new, continuous four-digit prefix.
- New duplicate prefixes, extra files under `0022` or `0027`, and numbering
  gaps fail `npm run test:migration-numbering`.
- The check changes no database schema, migration contents, or deployment
  behavior.

## Rollback

Remove the package script and verifier only after replacing them with an
equivalent or stronger numbering guard. The historical migration files remain
immutable during rollback; do not rename or rewrite them.
