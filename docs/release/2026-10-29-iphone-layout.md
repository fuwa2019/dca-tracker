# 2026-10-29 iPhone portrait and landscape layout

Scope: SPA only. No database, migration, Worker, secret, or KV change. Owner
authorized the commit, push, and Pages release.

## Change

- `d771c59` Phone header is one row: the market status pill sits beside the
  ledger tabs (tab icons hidden below `sm`) instead of wrapping under them.
- Landscape phones: bottom nav is icon-beside-label at `min-h-9` (about 40px
  instead of 58px), `main` bottom padding shrinks to match, and the app root
  pads by `safe-area-inset-left/right` so content clears the Dynamic Island.
- Phone transaction rows keep the full ticker and the side chip; only the
  ticker name truncates. Trade side chips read 买/卖 with no dot (cards and
  the table's 事件 column).

## Verification before release

- `test:finance`, `test:email-reminder`, `test:quote-status`,
  `test:share-privacy`, `typecheck`, `build:local`, `test:release-budget`,
  `test:ui` passed; `git diff --check` clean.
- Local demo mode screenshots at 393x852 and 852x393 (iPhone 15 Pro, DPR 2):
  ledger header on one row in both orientations, slim landscape nav, SGOV row
  shows "SGOV iShares 0-3月美国… 买" (previously "S…" and a wrapped 买/入).
- Not run: Lighthouse, cross-browser, and accessibility probes.

## Production

- Pushed to `origin/master`; the `dca-tracker-git` Pages Git integration
  builds from it.
- Not verified from the release session: the session's network policy denied
  `dca-tracker-git.pages.dev`, so the served bundle name, route status, and
  the `/login` console were not checked. The 盘中 label under the holdings
  price was not seen (demo data has no live session).
