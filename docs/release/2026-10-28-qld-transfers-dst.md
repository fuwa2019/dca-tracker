# 2026-10-28 QLD look-through, IBKR linked transfers, New York DST display

Scope: Supabase migration 0060 and the SPA. No Worker deploy, secret, or KV
change; `workers/` is unchanged across the three commits. Owner authorized the
push and release.

## Change

- `cd39666` QLD is looked through as 2x Nasdaq-100 (`lookThrough.ts`,
  `etf-holdings.json._meta.leveraged`, exposure and share pages). Migration
  `0060_etf_universe_leveraged_underlying.sql` replaces
  `current_user_etf_universe()` and `active_etf_universe()` only.
- `d3fdcbb` IBKR importer pairs a 取款 with the same-day 存款 of the same amount
  in the other linked account and ignores both; a lone 取款 maps to a broker
  withdrawal. Front end only.
- `b1da1b1` Market status bar names 夏令时/冬令时, flags a clock change within
  7 days, and shows the ET window in the viewer's zone. Front end only.

## Verification before release

`test:finance`, `test:email-reminder`, `test:quote-status`, `test:share-privacy`,
`test:etf-holdings`, `test:ui`, `test:migration-numbering`,
`test:migration-overloads`, `typecheck`, `build:local` and `test:release-budget`
passed.

## Production

- Migration 0060 applied by the owner in the Supabase SQL editor (not run by
  this session); this session did not re-verify it against the database.
- Pushed `4f37e44..cd39666` to `origin/master`; the `dca-tracker-git` Pages Git
  integration served entry `index-DQatRxp5.js` (previous `index-B55A-I9B.js`).
  The deployment id was not read (no Cloudflare dashboard access).
- Cache-busted `/`, `/login`, `/performance`, `/exposure`, `/transactions`,
  `/health`, `/settings` returned 200. The 40 production chunks contain
  杠杆名义敞口, `leverageFinancing`, 夏令时/冬令时 and the 取款 mapping; the
  entry has the Supabase host and no `http://localhost` stub.
- Not verified: the login page console (browser pane policy check was
  unavailable), authenticated routes, and QLD look-through with real data.
