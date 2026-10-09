# 2026-10-09 read-only share preview release

Scope: SPA frontend only. No database migration, Worker deploy, secret, or KV
change. Owner authorized the commit and Pages release.

## Change

Code commit `bdaf36d`. Adds a development-only preview of a "full read-only"
share: `?sharePreview=full` shows the owner's own layout without settings or
write actions (`src/lib/sharePreview.ts`, `src/components/ReadOnlyShare.tsx`).
Hidden in that mode: settings nav and routes (`/settings/*` renders a blocked
page), manual entry, import, ledger export, transaction row edit/delete,
cashflow add/edit/delete, exposure / share-cache / performance-cache refresh,
price backfill, Schwab reauthorize, closed-symbol delete, the share-link audit,
the goal-planner link, and the dev seed panel.

`READ_ONLY_SHARE` is `import.meta.env.DEV ? … : false`, so production folds it
to `false` and drops the preview code. Production behavior is unchanged; this is
not a share scope. Real full read-only links still need the public-share privacy
contract amended, a migration, and a scope-aware `test:share-privacy`.

## Verification

- Finance, email-reminder, quote-status, share-privacy, UI, typecheck, offline
  build, and first-load budget (182.82 / 194 KiB gzip) passed. A stub-env
  production build contained none of the preview strings.
- Offline demo (`dev:local`): all seven views plus `/settings` and
  `/settings/share` in preview mode at desktop width, the ledger at 390px with no
  horizontal overflow, and owner mode unchanged after `?sharePreview=off`. No
  console errors.

## Production

- Pushed `bdaf36d` to `master`; the `dca-tracker-git` Pages Git integration
  served the new entry `index-DpTC8GEk.js` about 50 seconds later (previous
  `index-CzXvgO5h.js`).
- Cache-busted `/`, `/login`, `/performance`, `/exposure`, `/transactions`,
  `/health`, and `/settings` returned 200. None of the 40 production JS chunks
  contained `sharePreview` or the preview copy; the owner's ledger export is
  still present. The login form rendered with no console messages. No login or
  account-data access was performed.
