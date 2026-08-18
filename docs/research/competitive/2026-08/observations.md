# Observation Log

Status: S1 study window closed on 2026-08-18 under the explicit no-macOS-change
boundary. Ghostfolio 3.36.0, Wealthfolio v3.6.2 and Portfolio Performance
0.86.0 have isolated synthetic runs. Runtime limitations are recorded as
limitations, not silently promoted to product passes.

Use one row per product/task run. `not_run` is intentionally different from a
pass or fail. Attach local-only screenshot/export paths through
`screenshot-index.md` and cite the synthetic fixture hash from the run.

## Accessibility Environment Notes

- The initial macOS `NSReduceMotion` and universal-access reduce-motion values
  were unset. A temporary `NSReduceMotion=1` probe was written and removed
  successfully; a fresh Ghostfolio browser page still reported
  `matchMedia('(prefers-reduced-motion: reduce)') === false`.
- Writing `com.apple.universalaccess/reduceMotion` was rejected by macOS, so
  no system-level reduced-motion emulation was obtained. A temporary global
  `AppleReduceMotion=1` probe was also ignored by a fresh browser page and was
  removed. This is an environment limitation, not product evidence; the
  product records below distinguish loaded stylesheet rules from an actual
  reduced-motion runtime pass.

| Product/version | Task IDs | Profile/file | Fixture hash | Desktop result | Mobile 390px | Keyboard/reduced motion | Evidence level | Notes |
|---|---|---|---|---|---|---|---|---|
| Ghostfolio 3.36.0 | T01-T03,T06-T10 | `/private/tmp/dca-competitive-20260818` + Colima | `be210e7040782ddd50197e7bc03b72357cbe2e74753bbde5900b20756d879f8b` | T01-T03,T06-T09 observed; authenticated Demo T10 routes captured | Home, portfolio, activities and account all captured at 390px without horizontal overflow; tablist ArrowRight/Enter keyboard path verified; reduced-motion stylesheet observed | S1, partial S2 | Fixed image digest; duplicate re-import created 8 extra activities and a second account; Demo account is empty and reports a restricted-action toast |
| Wealthfolio v3.6.2 | T01-T10 partial; T05/T09 capability check | official DMG, synthetic profile `DCA Synthetic Broker` | `3c151633369489a6ceb43656bd949fdd3c9460337d432c0aa7cbcaa552c367c3`; incremental `0ee20448de90e4cd0224597dcf16590741573046a16ed7f9dd297a736079604d` | T01-T04,T06-T08 observed; T05/T09 navigation check completed; desktop and narrow-window screenshots captured | approximately 390 logical px / 490x960 Retina capture; Activities and Appearance layouts fit | Activities Tab/Shift-Tab and row-menu keyboard path verified; Appearance Tab path verified; reduced motion not exposed | Initial receipt 13 imported/1 skipped; repeat receipt 0 imported/13 duplicates/14 skipped; incremental receipt 1 imported/0 skipped; no source-replacement or public-share action found; backup and CSV export completed |
| Portfolio Performance 0.86.0 | T01-T10 partial | `/private/tmp/dca-competitive-20260818/fixtures/pp-0.86.0-canonical.portfolio` | `33edfad4ee35ecbd03a2779b2ad37018e24b3ae4256f85aa9276f01fbfd9acee`; `9b1fd52a5246a719480e2797f13d566dbb55f38a6aa069b4326dfcd405383f72` | T01-T09 desktop observations; 11-entry ledger/export verified; T10 narrow window captured | 392x700 captured; side navigation consumed most width and table columns clipped without responsive reflow | keyboard focus not exposed; reduced motion not exposed | 4 securities-account trades + 7 cash-account events; repeat copy stayed at 11 entries; PP rounds money to cents and needs a price-provider login for historical quotes |

## Reproducibility Notes

- Ghostfolio's fixed-tag compose file uses a floating `latest` image reference;
  record the resolved image digest before any UI observation.
- Wealthfolio's public download page is currently a `v3.6.0` convenience path;
  do not use it for the fixed `v3.6.2` run.

## S1 Run Records

### Ghostfolio 3.36.0

- Build: `ghostfolio/ghostfolio@sha256:b53ebfe00de1510decbed4ca3310b3d6292d419bb906a7d749ec7e8bcc48cdce`; the container log reports `3.36.0`.
- Runtime: Colima profile `dca-competitive`, temporary network and volumes,
  localhost port `3333`; no production or personal account was used.
- T01: first launch presents product marketing content, then a two-step
  security-token account registration; the first account receives the ADMIN
  role. The authenticated home page exposes Overview, Portfolio, Accounts and
  Admin Control.
- T02/T06: the product-specific JSON preview showed 9 rows and defaulted all
  rows selected. It preserves BUY, SELL, DIVIDEND, INTEREST and FEE, but has no
  first-class Deposit, Withdrawal or Tax activity type. The synthetic tax was
  mapped to FEE and deposit/withdrawal were represented by account balance
  snapshots for this run. The table renders prices, fees and values rounded to
  two decimals in the UI.
- T03: the exact same JSON file produced a preview with only one row disabled;
  confirming the import increased the temporary database from 9 to 17 orders
  and from 1 to 2 accounts. This is a failed zero-new-records criterion, not a
  pass. The account ID in the portable JSON was remapped on re-import, so the
  new account boundary prevented stable duplicate identity for most rows.
- T07: the analysis view exposes absolute total amount, absolute net
  performance, currency effect and percentage performance, but no visible
  XIRR/IRR method explanation was found in the tested view. The duplicate run
  makes the displayed performance unsuitable for canonical reconciliation.
- T09: the Public / Restricted view link exposes percentages, weights,
  performance and activity summaries without USD amounts. It exposed manual
  asset UUIDs and duplicated holdings after the failed re-import. Revoke removed
  the public access and reloading the old link redirected to the public start
  page.
- T10 initial app-view observation: at 390px the primary navigation collapses
  and the activity table hides several audit columns; compact tab controls had
  no accessible text in the captured tree. Later authenticated Demo evidence
  verifies the lower tablist route cycle; the initial finding remains relevant
  to the activity-view audit-column boundary.
- T10 follow-up: an unauthenticated fixed-build landing-page re-probe at
  `390x844` again collapsed the desktop navigation to the Ghostfolio mark and
  login action without horizontal overflow in the captured viewport. The
  loaded stylesheets contain `prefers-reduced-motion` rules for disabling a
  badge transition and a body motion hook. This is landing-page evidence only;
  it does not replace the authenticated activity-view keyboard result.
- T10 login follow-up: the fixed-build login dialog at `390x844` measured
  `374.39px` wide with left/right bounds `7.80px` and `382.19px`; document and
  body scroll widths were both `390px`. The security-token field had an
  accessible name and the empty-state login button was disabled. The browser
  keypress adapter did not move focus after the field was focused, so keyboard
  traversal remains unverified rather than being classified as an app failure.
- T10 authentication boundary: the fixed build's anonymous `/zh/demo` route
  redirected back to `/zh/start`, indicating that this isolated container did
  not expose a demo authorization token. A read-only container database check
  also found no `DEMO_USER_ID` property row. This was the pre-Demo probe; no
  credential value was read or recorded, and the isolated Demo setup is
  described separately below.
- T10 authenticated follow-up: a synthetic local Demo user and
  `DEMO_USER_ID` property were created inside the isolated container only; no
  token was written to the repository or exposed in the run record. The Demo
  route reached `/zh/home`, `/zh/portfolio`,
  `/zh/portfolio/activities` and `/zh/account` at `390x844`. Each route had
  document and body scroll widths of `390px`; the screenshots show the compact
  header, bottom navigation, performance cards, activity table headers and
  account settings controls. The empty Demo state emitted `不允许执行此操作。`
  and contained no ledger rows, so this is responsive/state evidence rather
  than a financial-calculation pass.
- T10 authenticated keyboard/reduced-motion follow-up: the pointer-opened
  mobile menu exposed named items for Overview, Portfolio, Accounts, My
  Ghostfolio, Resources, About and Logout. The lower tablist's ArrowRight +
  Enter path activated Holdings, Summary, Watchlist, Markets and wrapped back
  to Overview; every route URL was observed at 390px. One Tab from the active
  menu item moved to a header button, while subsequent browser keypresses
  remained on unnamed header controls. The loaded stylesheets contained
  reduced-motion rules for badge and overlay transitions, while
  `matchMedia('(prefers-reduced-motion: reduce)')` was false. Header/menu full
  traversal and emulated reduced-motion runtime remain unverified.
- Browser console errors were present during market-data-backed views because
  the run used manual synthetic assets without a live provider; they were
  recorded as runtime noise rather than silently treated as calculation proof.

### Wealthfolio v3.6.2

- Build: official Apple Silicon DMG; local SHA-256 is
  `a2e2f58f2cbdfc52cdf46979bcc699a6ba03273f62fe05ea0cb5b6cba9776c11`.
  The app displayed an available v3.6.3 update, which was not installed.
- T01: onboarding explicitly separates Holdings / Value Tracking from
  Transactions / Performance Tracking. The selected Transactions mode states
  that it is the complete performance path and requires all transactions; the
  Holdings mode explicitly says it does not provide transaction-based TWR/IRR.
  USD and Shanghai timezone were selected. A single synthetic securities
  account was created.
- T02: the fixed flow has Upload, Mapping, Review Assets, Review Activities and
  Import steps. A six-column TradingView file parsed into 14 rows but left the
  required Amount mapping empty. A temporary Wealthfolio-shaped CSV with the
  same canonical events mapped Date, Type, Symbol, Quantity, Price, Amount, Fee,
  Currency and Note. Two assets were resolved, the malformed amount row was
  clearly reported, and the receipt showed 13 imported and 1 skipped.
- The review summary grouped activities as Buy 5, Deposit 2, Tax 2, Dividend 1,
  Interest 1, Sell 1 and Withdrawal 1. Because both `Taxes and fees` rows share
  one raw action, the mapping applied Tax to both; the independent fee therefore
  needs a row-level correction. The exact duplicate row was visible but was not
  marked as duplicate in the first review.
- The initial T03 attempt was not committed: reusing the existing symbol
  mapping made the dynamic mapping control show `AMEX:SMH -> VGT`, so the run
  was canceled before persistence. A later run used a saved mapping template
  and completed the duplicate receipt below; the initial ambiguity remains a
  mapping-safety observation.
- A second T03 run used the saved `DCA Synthetic Wealthfolio CSV v1` mapping
  template. Review Activities reported `1 error 13 duplicates`; after skipping
  the malformed-number withdrawal, the final receipt reported `0 Imported`,
  `13 Duplicates`, `14 Skipped`, `14 Total`. The activities page remained at
  `13 / 13 activities`, proving no new records were persisted. The independent
  fee row was still mapped to Tax because both raw rows use `Taxes and fees`.

- T06 (before T04): the holdings view showed SMH `1` share and VGT `5.51234568` shares. The
  extra VGT quantity is the intentional incremental and exact-duplicate rows
  from the first import; the repeat import did not add more. Without live
  quotes, SMH displayed `$0.00` and VGT displayed a small stale/manual value;
  the overview showed cash-only portfolio value `$153.92` and book cost
  `$752.27`. The income view correctly showed dividends `$1.25` and interest
  `$0.07`, while taxes and fees remained visibly separated in activities.
- T07: the All Time performance view displayed time-weighted `36.40%`,
  money-weighted `47.91%`, annualized `51.57%`, volatility `75.55%` and total
  gain/loss `-$746.08`. Its metric explanation explicitly warns that external
  flows were inferred from net contribution deltas, same-day flows may be
  netted, and unpriced positions may be excluded. No benchmark was added; the
  values are observed app output, not a canonical reconciliation pass.
- T08: Settings > Backup & Export created the self-contained SQLite backup
  `/private/tmp/dca-competitive-20260818/fixtures/wealthfolio_backup_20260818_203832.db`
  and the CSV activity export
  `/private/tmp/dca-competitive-20260818/fixtures/wealthfolio_activities_repeat_20260818.csv`.
  After T04, a second CSV export of the final 14-activity state was saved as
  `/private/tmp/dca-competitive-20260818/fixtures/wealthfolio_activities_final_20260818.csv`.
  The page offers CSV, JSON and SQLite export choices plus restore with a
  pre-restore backup warning.
- T04: a separate one-row `wealthfolio-incremental.csv` using the saved mapping
  template produced a final receipt of `1 Imported`, `0 Skipped`, `1 Total`.
  The activities page changed from `13 / 13` to `14 / 14`, with VGT quantity
  increased by `0.25`. The account view does not expose a source-replacement
  identity in this flow.
- T05: after T04, the Activities `Add Activities` menu exposed only Add
  Transaction, Import from CSV, Transfer Holdings and Add Personal Asset. The
  CSV flow exposed account selection, upload, format selection and the five
  import steps, but no source identity, replace-source mode or source deletion
  control. The global command palette returned no action for `replace` or
  `source`. This fixed-version run therefore records source replacement as not
  provided, not as a successful workflow.
- T09: the fixed build has no public-share destination in the tested sidebar,
  settings or command palette. Searches for `public` and `link` returned no
  matching action; `share` did not expose a share destination. This records
  public sharing as not provided in the tested build, not as an unexecuted
  workflow.
- T10 keyboard follow-up: after focusing the Activities search field, Tab moved
  through Status, Date, Account, Type, Instrument, View mode, Edit mode,
  table headers, activity links and row actions. Shift+Tab returned to the row
  action; Enter opened a row menu with More details, Edit, Duplicate and Delete
  without changing data. The focused VGT link had a visible focus ring in the
  captured screenshot. The same path was run in the narrow window; its mobile
  Activities cards, search, filter, row actions and bottom navigation were
  reachable. The Appearance page's Tab path reached Sans, Serif, Mono, Light,
  Sidebar, Floating Bar, Show menu bar and bottom navigation. The screenshot
  is `490x960` physical pixels for an approximately `390px` logical window.
  Full cross-route keyboard traversal and reduced motion remain unverified. A
  fixed source scan identifies mobile and compact viewport breakpoints at
  768px and 1024px, respectively, but no `prefers-reduced-motion` rule was
  found in the scoped frontend source; this is source evidence only, not a
  runtime pass.

### Portfolio Performance 0.86.0

- Build: official Apple Silicon DMG was mounted and its bundle reports
  `0.86.0`; local SHA-256 is
  `ada742fda4be39ba06a126cd8216aa67f3a22eeb616da8303d6b42edd6d3c0a7`.
  The update prompt for `0.87.0` was dismissed so the fixed build remained in
  use.
- T01: the new-file wizard defaulted to CNY; it was changed to USD, then a
  synthetic securities account and its cash account were created. The file was
  saved at `/private/tmp/dca-competitive-20260818/fixtures/pp-0.86.0-canonical.portfolio`.
- T02/T04/T05: PP's official CSV flow was exercised with two locale-matched
  synthetic fixtures. The `账目` target imported four BUY/SELL transactions
  for VGT/SMH, and the `转账记录` target imported seven DEPOSIT, DIVIDENDS,
  INTEREST, REMOVAL, TAXES and FEES records. The all-activities view showed
  exactly 11 entries with the canonical dates and event types. The cash view
  showed `$554.66`; the holdings view showed 1 SMH and approximately 1.5 VGT
  shares. The 0.0000000001 deposit rendered as `$0.00`, demonstrating PP's
  cents precision boundary.
- T03: a copy of the clean file was used for repeat testing. Re-importing both
  exact CSV files left the copy at `11` entries and with no unsaved change; PP
  did not create duplicate records. The review did not expose a row-level
  skipped/duplicate receipt, so this is an idempotency observation, not proof
  of explanatory duplicate UX.
- T07: the report showed cumulative TTWROR `2.15%`, IRR `3.83%`, maximum
  drawdown `0.02%`, volatility `1.81%`, and final value `$921.53`. The
  calculation view separated capital gains, realized gains, income, fees,
  taxes and transfers (`$1,000` deposit and `$100` withdrawal). No historical
  quote provider was configured, so benchmark and quote-history behavior were
  not scored.
- T08/T09: the `.portfolio` file and a Portfolio Performance XML export were
  written to the temporary fixture directory. The fixed File menu exposed only
  local binary/XML/CSV export paths, and the Online menu exposed quote updates;
  neither exposed Share, Public or Publish. The fixed source scan found no
  product-share route. Public sharing is therefore recorded as not provided in
  this build; the private backup remained synthetic.
- T10: desktop screenshots were captured for the cash ledger, all activities,
  performance report, calculation breakdown, and return/volatility view.
- T10 narrow follow-up: the native window was resized to `392x700`. The left
  navigation remained fixed at roughly half the viewport and the activities
  table clipped its columns instead of switching to a mobile layout. A pointer
  selection changed the highlighted row, but Tab did not expose a distinct
  accessibility focus state in the application tree or screenshot. Reduced
  motion was not exposed; this is a responsive failure/keyboard unknown, not a
  pass.

## S0 Source Observations

These are release/documentation observations only. They do not replace the
fixed-version task runs in the table above.

| Product/version | S0 observation | Product implication |
|---|---|---|
| [Ghostfolio 3.36.0](https://github.com/ghostfolio/ghostfolio/releases/tag/3.36.0) | Release notes add an overview tab to account details and read-only tags; the fixed-tag compose file still references a floating `latest` image | Copy the idea of account-level overview context only after an isolated build is pinned; never use a floating image for the study |
| [Wealthfolio v3.6.2](https://github.com/wealthfolio/wealthfolio/releases/tag/v3.6.2) | Release notes explicitly address dividend-adjusted history double counting, tax cash balance, tax-only activity values, and price precision | Keep ordinary-close V2 and explicit income/tax/fee events separate; show the calculation basis in the import/performance UI |
| [Portfolio Performance 0.86.0](https://github.com/portfolio-performance/portfolio/releases/tag/0.86.0) | Release notes fix re-reading CSV files with empty columns; the manual defines daily TTWROR flow timing | Treat empty-column parsing and start/end-of-day flow timing as release-gate fixtures |

The current Ghostfolio README, which is a `main`-branch source rather than a
fixed-tag observation, documents an activities import API with `BUY`, `SELL`,
`DIVIDEND`, `FEE`, and `INTEREST`, and reports duplicate activities as a 400
error. It also documents an experimental public portfolio endpoint. These are
S0 hypotheses for T02/T03/T09 and require confirmation against `3.36.0`.

## Run Record Template

```text
product:
version:
build_identifier:
os:
viewport:
profile_or_file:
fixture_files:
fixture_sha256:
task_id:
started_at:
finished_at:
outcome:
row_status_counts:
calculation_export:
screenshot_ids:
evidence_level:
unresolved_questions:
```
