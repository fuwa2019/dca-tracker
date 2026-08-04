# Current Handoff

Updated: 2026-08-05

## Current Goal

Remove the overly strict historical ETF cash gate from the live brokerage CSV
importer. The adjusted-deposit feature is already live; the current local fix
keeps real stock-funding failures blocking while turning temporary ETF cash
gaps caused by omitted cash events into non-blocking warnings.

## Current Status

- Current repository: `/Users/junxihuo/Documents/dca_system`
- Branch: `master`, tracking `origin/master`.
- A real-file preview reported a temporary `-$56.1975727` ETF cash point on
  2026-05-14 after individual-stock funding was removed. The file also contains
  excluded non-Deposit cash events, so the previous per-date solvency gate made
  a stronger claim than the supported input data can prove.
- The local fix now completes the full cash timeline, reports its minimum as a
  warning, and keeps import enabled. It still blocks when individual-stock
  funding itself cannot be deducted from eligible deposits. No database change
  is required.
- The local importer now classifies each traded symbol as ETF or individual
  stock. Known ETFs are resolved locally, symbol search is used as a fallback,
  and unresolved symbols require an explicit user choice before import.
- Only confirmed ETF Buy/Sell rows are imported. Individual-stock rows are
  excluded, while same-day and earlier stock-sale proceeds are applied before
  deducting the remaining stock-buy funding from eligible deposits.
- Positive Schwab deposit actions and six-column Portfolio `Deposit` rows are
  parsed. Adjusted deposits retain up to 10 decimal places and become imported
  broker cashflows. A temporary negative retained-ETF cash point is advisory;
  import remains blocked only when required stock funding cannot be deducted
  from eligible deposits.
- Imported broker deposits are authoritative for account cash, invested
  capital, and XIRR. Manual FX rows remain available for exchange-loss reporting
  and serve as the legacy XIRR fallback only when no imported deposit exists.
- The preview reports ETF trade count, excluded stock count, gross deposits,
  stock deduction, adjusted deposits, and ending cash. Files containing stocks
  or deposits require `reset_all`; append mode cannot replace the existing cash
  basis and is therefore blocked.
- New append-only migration `0046_adjusted_deposit_precision.sql` widens
  `cashflows.usd_amount` to `numeric(22,10)` and updates the authenticated-only,
  security-invoker import helper. It was applied to production project
  `igwacbeojogblacektxr` as migration version `20260804162313`.
- Synthetic browser verification passed on desktop and 390px mobile. A fixture
  with a $1,000 deposit, $350 net individual-stock funding, and a $600 ETF buy
  previewed a $650 adjusted deposit and $50 ending cash. The second destructive
  confirmation was inspected, but the final import action was not executed.
- The current warning regression was reproduced exactly with synthetic data:
  2026-05-14 reached `-$56.1975727`, 12 rows were excluded, the yellow warning
  rendered without overlap on desktop and 390px mobile, and the checked
  “continue” action remained enabled. The final import action was not executed.
- Hotfix verification passed on 2026-08-05: `test:csv-import`, `test:finance`,
  `test:ui`, `test:migration-numbering`, `test:email-reminder`,
  `test:quote-status`, `typecheck`, `build`, and `git diff --check`.
- The hotfix is local and uncommitted. It has not been pushed or deployed; no
  migration or production database change is needed.
- Local verification passed on 2026-08-05: `test:csv-import`, `test:finance`,
  `test:ui`, `test:migration-numbering`, `test:email-reminder`,
  `test:quote-status`, `typecheck`, `build`, and `git diff --check`.
- The user-provided real portfolio CSV was not read, copied, or imported.
- Commit `48b93cf` and the follow-up documentation commit `959a5ce` are pushed
  to `origin/master`. Git-triggered Pages production deployments completed
  from both commits; the canonical site serves the latest bundle. Fresh browser
  checks confirmed `/login` renders and `/transactions` redirects
  unauthenticated users to login.
- Canonical bundle verification found the ETF-only adjusted-cash UI markers
  (`ETF 交易与现金`, `个股净投入`, `调整后存款`, and `reset_all`).
- Local precision adaptation preserves up to 10 decimal places for quantity and
  commission and up to 12 decimal places for fill price across parsing,
  import identity, database storage, export, and manual editing.
- New append-only migration `0045_transaction_numeric_precision.sql` widens the
  transaction columns and upgrades the private security-invoker import helper.
- Local verification passed on 2026-08-04: `test:csv-import`, `test:finance`,
  `test:ui`, `test:migration-numbering`, `test:email-reminder`,
  `test:quote-status`, `typecheck`, `build`, and `git diff --check`.
- The user-provided real portfolio CSV was not read, copied, or imported.
- Migration `0045` was applied to production project
  `igwacbeojogblacektxr` as version `20260804144149`.
- Production structural verification confirmed `shares numeric(18,10)`,
  `price numeric(22,12)`, `fees_usd numeric(22,10)`, the restored import-identity
  trigger, widened helper validation/import keys, security-invoker behavior,
  and authenticated-only helper execution.
- The migration had to drop and recreate the `UPDATE OF` import-identity
  trigger around the type changes because PostgreSQL tracks its column list as
  a dependency.
- Current revision: `cdeba76`, pushed to `origin/master`.
- Cloudflare Pages deployment `a11de78f-534a-4bf6-884e-06d88b500fbc` completed
  from `cdeba76`; it serves `index-BcOwsWFB.js` through the canonical
  `dca-tracker-git.pages.dev` domain.
- Fresh HTTP and browser checks confirmed `/`, `/login`, and `/transactions`
  return HTTP 200, the unauthenticated app renders the login page, the bundle
  contains production Supabase/Quote configuration and target projection code,
  and no missing-Supabase-config warning is present.
- Quote Worker health and `/api/quote?symbols=VOO` both returned HTTP 200.
- Supabase Advisors still report only existing warnings/information items; no
  new error was introduced by this migration.
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
- Deployment status: `0045` and the high-precision target-projection frontend
  are live in production.

## Next Steps

1. After explicit authorization, commit and push the frontend-only hotfix so
   the Git-triggered Cloudflare Pages deployment can complete.
2. Verify the canonical bundle and the real-file preview, then let the user
   execute the separately confirmed `reset_all` import after reviewing the
   adjusted ETF/deposit counts.

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
- `supabase/migrations/0046_adjusted_deposit_precision.sql`

## Risks and Blockers

- Full reset is destructive: all transactions, cashflows, and funding batches
  are deleted. Only confirmed ETF Buy/Sell rows and adjusted deposits from the
  selected file are rebuilt; individual stocks and unsupported cash events are
  intentionally not rebuilt.
- Dividends, withdrawals, taxes, and other unsupported cash events remain
  ignored. They can produce a temporary negative cash warning; the preview
  still blocks when eligible deposits cannot absorb the individual-stock
  funding deduction itself.
- No real CSV import was read or attempted during the fix.
- A browser with the previous PWA bundle may need a reload while the
  auto-updating service worker activates.
