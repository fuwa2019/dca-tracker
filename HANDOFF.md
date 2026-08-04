# Current Handoff

Updated: 2026-08-04

## Current Goal

Complete six-column Portfolio CSV precision support in code, then deploy only
after separate authorization for the database migration and frontend release.

## Current Status

- Current repository: `/Users/junxihuo/Documents/dca_system`
- Branch: `master`, tracking `origin/master`.
- Local precision adaptation preserves up to 10 decimal places for quantity and
  commission and up to 12 decimal places for fill price across parsing,
  import identity, database storage, export, and manual editing.
- New append-only migration `0045_transaction_numeric_precision.sql` widens the
  transaction columns and upgrades the private security-invoker import helper.
- Local verification passed on 2026-08-04: `test:csv-import`, `test:finance`,
  `test:ui`, `test:migration-numbering`, `test:email-reminder`,
  `test:quote-status`, `typecheck`, `build`, and `git diff --check`.
- The user-provided real portfolio CSV was not read, copied, or imported.
- Migration `0045` has not been applied and the matching frontend has not been
  deployed. Production still serves the previously verified `0044` contract.
- No local Supabase CLI or PostgreSQL runtime is available, so `0045` received
  static contract verification but no database execution test.
- Current revision: inspect with `git rev-parse --short HEAD`; this file does
  not cache live Git state.
- The original import/export implementation is committed as `1400798` and
  pushed to `master`.
- Synthetic browser verification passed on the local transaction page:
  the custom file picker is visually consistent, the reset confirmation is
  clearly visible and clickable, and the second confirmation reports the
  strict delete/rebuild counts. The final import action was not executed.
- Verification passed on 2026-07-28:
  `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Supabase's current function guidance and changelog were reviewed. The import
  RPC remains security-invoker, derives ownership from `auth.uid()`, and grants
  execution only to `authenticated`; no relevant breaking change was found.
- `0043_schwab_transaction_import.sql` was applied to production project
  `igwacbeojogblacektxr` in one explicit transaction on 2026-07-28.
- Production verification confirmed the new transaction/cashflow fields,
  import uniqueness constraints, and four-argument import RPC. The RPC is
  security-invoker, executable by `authenticated`, and not executable by
  `anon`/`PUBLIC`.
- Refreshed Supabase Advisors report zero security errors and zero performance
  errors. Existing warnings remain for older security-definer functions and
  per-row RLS auth checks. The new import uniqueness indexes have zero scans
  before the first import, which is expected and is not a removal signal.
- During rollout, direct deployment `63479b04` served a bundle without the
  required public `VITE_*` build configuration. Production was restored to
  verified deployment `09ee772b` before rebuilding the feature commit.
- The three required production Pages variable names were confirmed in the
  Cloudflare project without copying their values.
- Cloudflare Git rebuild `466c30fc-9ba5-464b-9145-794a322f3b98` completed
  successfully from commit `1400798`.
- The existing Chrome production tab was refreshed through the PWA update and
  now loads the current production bundle.
- No real Schwab export has been read or imported.
- The reset contract was clarified: reset means delete all current-user
  transactions, cashflows, and funding batches, then import the current file.
- The corrected local implementation uses a new `reset_all` mode in the
  frontend preview and append-only migration
  `0044_full_reset_schwab_import.sql`. The old `reset_etf` mode remains only for
  rolling-deploy compatibility with the already-live frontend.
- The full-reset correction is committed as `a459e9f` and pushed to `master`.
- Corrected full-reset verification passed on 2026-07-28:
  `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Migration `0044_full_reset_schwab_import.sql` was applied to production
  project `igwacbeojogblacektxr` as migration version `20260728103203`.
- Post-migration metadata checks confirmed that the public wrapper and private
  helper are security-invoker functions, `reset_all` is present, anonymous and
  `PUBLIC` execution is denied, and only `authenticated` can use the private
  helper schema. No business data was read or changed during verification.
- Supabase Advisors reported no errors related to the migration. Existing
  warnings on older functions, RLS initialization plans, indexes, and password
  protection remain outside this task.
- Cloudflare Pages production deployment
  `03cc20da-8558-4ead-a8b8-5f31a80c738c` completed from commit `a459e9f`.
  It served `index-C86Or5YJ.js` with the full-reset UI.
- The cash correction is committed as `7780f68` and pushed to `master`.
  Schwab import now ignores all transfer rows, imports every standard Buy/Sell,
  and treats broker cash as zero. Required investment capital is inferred from
  trade funding instead of cashflows.
- Zero-cash verification passed on 2026-07-28:
  `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Synthetic browser verification confirmed 2 standard buys, including an
  individual stock, one ignored MoneyLink row, and `$0` cash on desktop and
  390px mobile. The final import action was not executed.
- Cloudflare Pages production deployment
  `c81a5b11-46d5-4180-a16f-cc6725e35ca6` completed from `7780f68`.
  `/`, `/login`, and `/transactions` return HTTP 200 and serve
  `index-Dsy3wFOu.js`, which contains the zero-cash import UI without the
  missing-Supabase-config warning.
- No database migration or production database change was required for the
  zero-cash correction.
- Working tree: inspect with `git status`; this file does not cache live Git
  state.
- Deployment status: `0044` and the zero-cash full-reset frontend are live in
  production.

## Next Steps

1. With explicit authorization, apply `0045` to an authorized database, verify
   column typmods/function grants with structural queries, and run a synthetic
   high-precision import smoke test.
2. With explicit authorization, deploy the frontend and verify the production
   bundle before the user retries their real CSV.

A real reset import remains an intentionally destructive, user-controlled
operation and must not be executed as part of migration or deployment checks.

## Related Files

- `PROJECT.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `supabase/migrations/0043_schwab_transaction_import.sql`
- `supabase/migrations/0044_full_reset_schwab_import.sql`
- `supabase/migrations/0045_transaction_numeric_precision.sql`

## Risks and Blockers

- Full reset is destructive: all transactions, cashflows, and funding batches
  are deleted. Every standard Buy/Sell in the selected file is rebuilt;
  non-trade rows and cashflows are intentionally not rebuilt.
- No real CSV import was read or attempted during the fix.
- Applying `0045` takes a short exclusive table lock while PostgreSQL changes
  numeric typmods; use an authorized maintenance window and a lock timeout.
- The high-precision frontend must not be deployed before `0045`, because the
  currently deployed helper still rejects values beyond 6/4/2 decimal places.
- A browser with the previous PWA bundle may need a reload while the
  auto-updating service worker activates.
