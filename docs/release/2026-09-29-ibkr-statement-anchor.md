# 2026-09-29 IBKR statement-anchored append release

Scope: IBKR import preview (`src/lib/import/`, `PortfolioImportTools`). No
database migration, RPC, Worker, or secret change; the calibration rows are
ordinary `fx_conversion` cash events accepted by the existing import RPC.

## Verification

- `test:finance`, `test:email-reminder`, `test:quote-status`,
  `test:share-privacy`, `test:portfolio-import` (new synthetic overlap,
  idempotency, gap-block, replace-warning and row-fix cases),
  `test:portfolio-multi-currency`, `test:ui`, `typecheck`, a stub-public-env
  `build`, and `test:release-budget` passed.
- A scratch script (outside the repo) replayed the owner's 1-year and 7-day
  IBKR exports: appending the 7-day file adds −0.0429 @ 2026-09-21 and
  +0.2047 @ 2026-09-24, ledger cash 5.877766 = statement ending cash; a second
  import adds nothing.
- Local-mode browser check: a synthetic statement with opening cash rendered
  the 对账单校准 row in the review table; no console errors.

## Production

- Commit `d11433d` pushed to `master`. Cloudflare Pages project
  `dca-tracker-git` built production deployment
  `5d1bed1c-9adc-4ef2-8ccf-49c21244c15b`; entry `index-DXvl9ak-.js`, and
  `transactions-DpC_oeN9.js` contains the anchor code.
- `/`, `/login`, `/transactions`, `/health` returned 200. No login or
  account-data write was performed.

Pending: the owner re-imports the 7-day export with 「新增导入」 and confirms
the health page's statement-cash check passes.
