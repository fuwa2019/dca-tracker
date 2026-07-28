# Current Handoff

Updated: 2026-07-28

## Current Goal

Finish and deploy the corrected full-reset import semantics.

## Current Status

- Current repository: `/Users/junxihuo/Documents/dca_system`
- Branch: `master`
- Current revision: inspect with `git rev-parse --short HEAD`; this file does
  not cache live Git state.
- The implementation is committed as `1400798` and pushed to `master`.
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
  successfully from commit `1400798` and is the current production deployment.
- The canonical site serves `index-BssVJPEd.js`; the bundle does not contain
  the missing-Supabase-config warning. Fresh browser verification produced no
  console warnings or errors, and `/login` plus `/transactions` return HTTP
  200.
- The existing Chrome production tab was refreshed through the PWA update and
  now loads the current production bundle.
- No real Schwab export has been read or imported.
- The reset contract was clarified: reset means delete all current-user
  transactions, cashflows, and funding batches, then import the current file.
- The corrected local implementation uses a new `reset_all` mode in the
  frontend preview and append-only migration
  `0044_full_reset_schwab_import.sql`. The old `reset_etf` mode remains only for
  rolling-deploy compatibility with the already-live frontend.
- Corrected full-reset verification passed on 2026-07-28:
  `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- A production read-only metadata query confirmed the `0044` prerequisite:
  `public.import_schwab_transactions(jsonb, jsonb, text[], text)` exists and is
  security-invoker. No migration SQL or business-data query was executed.
- A second production read-only metadata query confirmed that `transactions`,
  `cashflows`, and `funding_batches` all have RLS enabled and owner-delete
  policies using `auth.uid() = user_id`; only transactions and cashflows
  reference funding batches.
- Working tree: inspect with `git status`; this file does not cache live Git
  state.
- Deployment status: `0043` and the original frontend remain live;
  `0044` and the full-reset frontend are not deployed.

## Next Steps

1. Review and commit the full-reset fix.
2. With explicit authorization, apply `0044` and deploy the frontend.
3. Re-run reset import and confirm only current-file ETF trades and deposits
   remain.

## Related Files

- `PROJECT.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `supabase/migrations/0043_schwab_transaction_import.sql`
- `supabase/migrations/0044_full_reset_schwab_import.sql`

## Risks and Blockers

- The fix is not yet applied to production; the live reset still preserves
  out-of-scope manual and stock data.
- Full reset is destructive: individual-stock transactions, manual cashflows,
  and funding batches are deleted and are not rebuilt unless represented by
  supported rows in the current import file.
- No real CSV import was read or attempted during the fix.
- A browser that loaded the temporary broken PWA bundle may require a second
  reload while the auto-updating service worker activates. The current Chrome
  production tab has already completed that update.
