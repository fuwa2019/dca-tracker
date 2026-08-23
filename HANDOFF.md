# Current Handoff

Updated: 2026-08-23

## Current Goal

Execute the DCA Tracker competitive research and six-month optimization plan:
move from trusted source import and ledger semantics to financial calculation,
task-oriented interaction, and privacy-safe analysis without expanding beyond
one personal ETF portfolio.

## Goal Progress (2026-08-19)

- The pre-goal baseline commit is `e1bed4e`; it was clean and passed
  `test:finance`, `test:csv-import`, `test:ui`, `typecheck`, and `build` before
  this working-tree change set. The workbench release is committed as
  `4d499d3` and pushed to `origin/master`.
- `PRODUCT.md` and `DESIGN.md` define the precise, restrained, transparent
  product boundary and WCAG 2.2 AA baseline.
- Fixed-version research sources, task script, scorecard, reconciliation
  contract, screenshot index, decisions, backlog, and synthetic fixtures are
  under `docs/research/competitive/2026-08/`.
- `test:competitive-fixture` validates the canonical ledger with fixed-point
  arithmetic and prints fixture hashes.
- `src/lib/import/` now contains a database-free `PortfolioImportAdapter`
  contract and Schwab, IBKR, and TradingView adapters. The adapter regression
  command `test:portfolio-import` passes, including Chinese IBKR headers,
  non-USD blocking, duplicate keys, and six-column TradingView rows.
- Fixed-version research runs use only synthetic data. Ghostfolio `3.36.0`
  runs in Colima, Wealthfolio `v3.6.2` runs from its official DMG, and
  Portfolio Performance `0.86.0` now has a saved synthetic `.portfolio` file
  and XML export. No real brokerage file was read.
- Migration `0050` and its generic RPC are applied and verified in production.
  The source-neutral preview is now the default cloud path after the frontend
  workbench release; setting `VITE_LEDGER_IMPORT_V2=0` remains an explicit
  compatibility rollback to the legacy Schwab path.
- The private shell now uses a task-oriented workbench: overview, performance,
  look-through exposure, ledger/import, data health, and settings share the same
  navigation and responsive state language. The old editorial dashboard is no
  longer rendered by the root route.
- The new preview has four row states, source detection, asset confirmation,
  append/source-replace/reset modes, and generic RPC payload construction. A
  synthetic TradingView run passed desktop and 390px Playwright checks with no
  console errors; no write was executed.
- TradingView now exports the normalized ledger back to the six-column format
  and round-trips the synthetic cash events without blocked rows. IBKR aliases
  now cover official Trades fields such as `Date/Time`, `Type`, `T. Price`,
  `Proceeds`, and `Total Comm/Tax`, with gross proceeds plus commission tested.
- `test:finance` now includes an independent PP-aligned daily-flow/XIRR
  reconciliation gate. The canonical fixture reports zero TWR difference and
  sub-basis-point XIRR difference against the independent reference. The fixed
  Portfolio Performance run separately verified the 11-entry ledger, cents
  rounding, cash balance, calculation breakdown, and XML export; exact quote-
  history TTWROR/XIRR reconciliation remains pending.
- The preview now computes fixed-point reconciliation totals for ending shares,
  cash by event kind, external inflows/outflows, and negative-cash warnings;
  asset-policy filtering is applied before those totals and before the RPC
  payload is built.
- The same ETF asset policy now applies to ticker-bearing cash events such as
  dividends, while pure cash events remain eligible without a ticker.
- Supabase production verification after `0050` confirms the migration record,
  all V2 cashflow columns and backfill (`7/7` existing rows have
  `effective_date`), the source/date index, constraints, three cashflow
  triggers, RLS on the affected tables, and authenticated-only execution for
  both ledger and compatibility import RPCs. The private PnL helper is owner
  checked; anonymous execution is denied. Public share function source returns
  only the existing sanitized percentage/series contract.
- Supabase branching was checked and intentionally not used. The Free
  organization has only `main`; a create attempt returned
  `PaymentRequiredException` because branching requires Pro or above. The
  user chose `main` as the cloud baseline. No production portfolio rows were
  written; the local PostgreSQL 15 cluster remains the isolated write/test
  boundary for write/RLS tests.
- Homebrew PostgreSQL `15.19` is installed. A separate local cluster is
  running at `127.0.0.1:55432` with database `dca_ledger_test` under
  `/private/tmp/dca-pg15-ledger.rwVrwh`; all 52 repository migrations through
  `0050` applied successfully. Two-user RLS, append idempotency,
  `replace_source` isolation, failed `reset_all` rollback, and private PnL cache
  invalidation passed locally; the same migration is now verified on Supabase
  `main`. This is not a Supabase development branch.
- Fixed-version competitive execution has started in
  `/private/tmp/dca-competitive-20260818`. Ghostfolio `3.36.0` runs in Colima
  with image digest
  `sha256:b53ebfe00de1510decbed4ca3310b3d6292d419bb906a7d749ec7e8bcc48cdce`.
  Ghostfolio's duplicate JSON import created a second account and eight extra
  orders; its public view hid absolute amounts but exposed manual UUIDs.
  Wealthfolio `v3.6.2` completed a synthetic 5-step import with 13 imported and
  1 skipped. Its repeat import, using the saved mapping template, returned 0
  imported, 13 duplicates, 14 skipped, 14 total and left the account at 13
  activities; a SQLite backup and CSV activity export are also in the temp
  fixtures directory. Portfolio Performance `0.86.0` completed a synthetic desktop run:
  four securities-account trades plus seven cash-account events, final cash
  `$554.66`, final value `$921.53`, TTWROR `2.15%`, IRR `3.83%`, and repeat
  import remained at 11 entries. Its `.portfolio` and XML exports are under
  the temporary fixture directory. A follow-up navigation check in Wealthfolio
  found no source-replacement control and no public-share route in the fixed
  build; these are recorded as not provided rather than inferred. A Ghostfolio
  authenticated synthetic Demo run captured `/zh/home`, `/zh/portfolio`,
  `/zh/portfolio/activities` and `/zh/account` at 390x844 with no horizontal
  overflow. The empty Demo state showed a restricted-action toast and no ledger
  rows. Its mobile menu exposed named routes, and ArrowRight + Enter cycled the
  five lower tab routes; header/menu traversal and reduced-motion emulation are
  recorded as supplemental limitations. Wealthfolio's Activities view now
  has direct forward/reverse Tab evidence, a visible focus ring and a
  keyboard-opened row menu; its fixed source contains 768px/1024px viewport
  breakpoints but no scoped reduced-motion rule. A real narrow native window
  was also captured at approximately 390 logical px (`490x960` Retina);
  Activities and Appearance layouts fit and their visible controls are
  keyboard-reachable. Portfolio Performance was resized to `392x700`; its
  fixed sidebar clipped the activity table instead of reflowing. Native runtime
  reduced-motion and unavailable focus surfaces are recorded as supplemental
  limitations; no macOS setting was changed.
  The macOS reduced-motion probe was restored to its original unset state;
  `NSReduceMotion=1` was not reflected by a fresh browser `matchMedia` result,
  and macOS rejected the universal-access domain write. No reduced-motion pass
  is claimed from that probe.

## Frontend Rectification Progress (2026-08-19)

- The rectification plan derived from the competitive-learning deck lives at
  `docs/tasks/2026-08-19-competitive-learning-rectification-plan.md`; the user
  authorized live computer-use study of the still-running Wealthfolio and
  Portfolio Performance instances (logged as S1b in
  `docs/research/competitive/2026-08/observations.md`) and assigned frontend
  implementation to Claude.
- First B4 slice is in the working tree, not yet committed:
  `src/lib/calc/navBridge.ts` (pure account-level NAV bridge over the cached
  series), `scripts/verify-nav-bridge.mjs` (appended to `test:finance`),
  `src/components/NavBridgeCard.tsx`, and the Performance-page wiring that
  renders 期初净值 + 外部净流入 + 期间盈亏 = 期末净值 for the selected chart
  range with an identity-gap check and an explicit note that non-imported
  dividend/interest events are excluded.
- Verified locally: `test:finance` (incl. the new bridge fixtures), `test:ui`,
  `test:email-reminder`, `test:quote-status`, `typecheck`, `build`,
  `git diff --check`, plus local-mode browser checks at desktop and 390px
  (3M sub-range anchoring confirmed: 112,660.66 + 600 + 34,892.30 =
  148,152.96). No database, worker, or share-contract change; the share page
  is untouched and remains percentage-only.
- The B4 slice above is committed as `e0d506e` on `master`.
- Second slice (ledger event-type chips), delivered by the scheduled cloud
  routine and merged to `master` as `435c1d0` via PR #1:
  `src/lib/ledgerEvents.ts` is a pure
  label/tone/direction map from a trade side or `cashflow_kind` to a chip.
  Buy, deposit, dividend and interest use the gain tone; sell, withdrawal, tax
  and fee use the loss tone; FX transfer and stock allocation stay outside that
  pair because they move existing money. An unrecognized kind renders a visible
  `未知事件` chip instead of being relabelled. `TxnList` and the cashflow ledger
  now render the shared chip through `StatusBadge`; the cashflow page shows the
  event kind plus a right-aligned tabular-nums USD amount for every kind,
  including the dividend/interest/tax/fee/withdrawal rows that previously fell
  through to the FX branch.
- Third slice (plan A2/A4), same PR: `src/lib/import/receipt.ts`
  derives `imported / duplicates / skipped / total` from the existing RPC
  receipt counts plus the preview's per-row statuses, with `skipped` containing
  `duplicates` to match the Wealthfolio 0/13/14/14 reading. No RPC argument or
  response field changed. The receipt keeps the original four ledger-record
  counts in a separate block, adds an event-type composition strip to the
  preview, and lists the retained blocked/ignored row reasons so nothing is
  silently corrected.
- Verified on the branch after `npm ci` (root plus both workers):
  `test:finance`, `test:ui`, `test:csv-import`, `test:portfolio-import`,
  `test:email-reminder`, `test:quote-status`, `typecheck`, `build`, and
  `git diff --check`. `test:ui` now runs `verify-ui-behavior.mjs` under
  `--experimental-strip-types` so it asserts the two new pure modules directly
  instead of only regex-matching component source. No database, worker, or
  share-contract change; `src/app/share.tsx` and `supabase/migrations/` are
  untouched and no dependency changed.
- The chip rows were visually confirmed before merge in local demo mode at
  desktop and 390px on the ledger and all-trades routes (no horizontal
  overflow, right-aligned amounts). The cashflow page redirects to
  /transactions in local mode, so its chip rendering is covered by assertions
  and typecheck only; a one-time read-only cloud view remains the suggested
  spot check.
- C2/C4 evidence for the ledger and import routes was collected on 2026-08-20
  with playwright-cli against the local demo server (synthetic data only):
  /transactions desktop forward-Tab traversal hits only interactive elements
  with a visible focus ring across all 24 stops (row buttons carry aria-labels
  such as `编辑 SGOV 交易`), Shift+Tab reverses symmetrically; the import
  dialog opens with Enter, traps focus, closes with Escape; with the synthetic
  TradingView fixture injected, mode buttons, asset selects, the focusable
  row-list scroll container, and all dialog controls are keyboard-reachable.
  At 390px, /transactions, /transactions/all, and the open import dialog with
  a 15-row preview show no page horizontal overflow; the only over-wide
  element is the intentionally hidden sr-only file input.
- C2 defect found and fixed: controlled dialogs without a `DialogTrigger`
  (import preview, row edit/delete, cashflow delete) dropped keyboard focus to
  `<body>` on close. `src/components/ui/dialog.tsx` now remembers the invoker
  in `onOpenAutoFocus` (before Radix moves focus) and restores it in
  `onCloseAutoFocus` unless a call-site handler prevented default; the
  `DialogTrigger` path (`手工录入`) was re-tested without regression, and
  `verify-ui-behavior.mjs` gained source assertions for the restore contract.
- Fourth slice (plan C1/C2/C3 plus a C4 addition), committed as `4b2b49a` on
  `master` via branch `a11y/reduced-motion-and-route-audit` (not pushed):
  reduced-motion degradation, the remaining keyboard evidence, and the
  full-route WCAG audit with its fixes.
  - C3: `src/lib/motionPrefs.ts` is the pure rule (`enterMotionProps`) and
    `src/hooks/useEnterMotion.ts` the hook over it. The CSS media block only
    reaches CSS transitions/keyframes, and framer's `reducedMotion="user"`
    still honours per-item `delay`, so lists kept popping in row by row. The
    entry now wraps the app in `MotionConfig reducedMotion="user"`, every
    staggered list/card/ring/gauge/share bar goes through `enter(...)`,
    `AnimatedNumber` snaps instead of counting, and the shared spark chart
    passes `isAnimationActive={!reduceMotion}`.
  - C2: overview / performance / exposure / health / settings and `/login`
    now have full forward and reverse Tab traces (14 / 22 / 18 / 11 / 24 / 2
    stops per cycle). Every stop is interactive and shows a focus ring, and
    Shift+Tab retraces the same order. The invalid `/share/:token` state has
    no focusable element at all — recorded as a product dead end, not a pass.
  - C1: `docs/accessibility/2026-08-20-wcag-route-audit.md` is the audit
    record; the four probe scripts live in `docs/accessibility/probes/` with a
    README (not in CI, no new repository dependency). axe-core 4.10.2 over
    nine routes x desktop/390px x light/dark went from ten violation classes
    (color-contrast 75 nodes, meta-viewport 36, aria-prohibited-attr 16,
    scrollable-region-focusable 2, and six best-practice rules) to zero.
    Fixes: viewport `maximum-scale` removed; new `--*-ink` tokens for the soft
    chips and a dark `--brand-foreground` (chart/series colors untouched);
    `role="img"` on the calendar trade-day dot; the history table wrapper is a
    focusable named region; aria-labels on the share-link copy/revoke buttons;
    `<main>` on login and the share fallback plus an `h1`; named sidebar,
    overview aside and mobile nav; `CardTitle` renders `h2`; `sr-only` label
    for the blank table corner; three sub-24px targets raised to the 2.5.8
    minimum.
  - C4 addition: page horizontal overflow is 0 on all nine routes at both
    390px and the 1.4.10 320px reflow width.
  - Not proved and recorded as such: screen-reader pass, 2.4.11 focus not
    obscured, and the cloud-only states (`/cashflows`, a populated share page,
    the authenticated login flow).
- Verified for this slice: `test:finance`, `test:ui`, `test:csv-import`,
  `test:portfolio-import`, `test:email-reminder`, `test:quote-status`,
  `test:competitive-fixture`, `typecheck`, `build`, `git diff --check`.
  `test:ui` gained a pure `enterMotionProps` unit assertion plus source
  assertions for every reduced-motion call site. No database, worker,
  share-contract or dependency change; `supabase/migrations/` untouched.
- Next frontend slices per the plan: the D1/D2 privacy-snapshot work for the
  V2 cache, then the E2 release gates (Lighthouse budget, cross-browser
  record). Accessibility follow-ups are the screen-reader pass, 2.4.11, and
  auditing the cloud-only routes when a cloud session is authorized.

## Wealthfolio UI Alignment (2026-08-20)

- The owner directed the frontend to follow Wealthfolio `v3.6.2` as closely as
  practical, interaction and interface. That reverses a recorded boundary, so
  it is written up in `docs/decisions/2026-08-20-wealthfolio-ui-alignment.md`,
  and the superseded rows in `docs/research/competitive/2026-08/decisions.md`
  and `DESIGN.md` now point at it.
- Licensing facts established before accepting the direction: Wealthfolio is
  **AGPL-3.0**, so none of its code, stylesheets or assets may enter this
  repository; its `TRADEMARKS.md` rules out its name and logo; and its palette
  is **Flexoki** (Steph Ango, **MIT**, attribution requested), which this
  project therefore takes from Flexoki's own upstream ramps. Everything shipped
  is reimplemented here from measured values and screen captures.
- The measured reference, the per-surface mapping and the delivery order live
  in `docs/design/wealthfolio-ui-teardown.md`.
- **Phase 1a `7c1a6e3`** — token layer: Flexoki surfaces and accents in both
  themes, actions are ink instead of brand red, a six-hue chart series set,
  10px base radius with derived steps, 14px base size, Inter in place of
  Hanken Grotesk. Four Flexoki pairs miss the AA text floor on our card fill,
  so colored and muted *text* resolves to the next accessible step in the same
  ramp while fills, gauge arcs and chart strokes keep the vivid 600/400 values;
  the focus ring is ink rather than Flexoki's base-200. Divergences are
  tabulated in the teardown doc.
- **Phase 1b `f655c5c`** — shell: 70px icon rail (the 200px labelled column is
  now opt-in), page identity moved from per-route banners into a pill tab group
  on the toolbar row, and the route name kept as a single `sr-only` `h1` in the
  shell. The rail switches sections (分析 / 账本 / 维护) and the tabs switch
  views inside one, so the two never repeat a name.
- Accessibility baseline held through both slices: axe-core 0 violations across
  eight routes x desktop/390px x light/dark (32 scans), every Tab stop
  interactive with a visible focus ring, reduced motion still opacity-only,
  0 page overflow at 390px and 320px, no target under 24x24.
- **Phases 2-4 landed and deployed 2026-08-20**: ledger tables (`2e2dc7f`),
  the import takeover (`54e06bb`), and the overview hero/full-bleed curve
  (`8ff006f`). Each shipped on its own branch with the CI-equivalent set plus
  the accessibility probes; axe stayed at zero violations across 32 scans for
  every one of them, and the import takeover was additionally audited with the
  dialog open (focus never escapes across 30 Tab presses).
- Reference captures: the Overview tab and the General settings pane were
  captured live on 2026-08-20 with window-only screen captures, after
  dismissing the app's update prompt with Escape — the pinned v3.6.2 study
  build was **not** upgraded. Settings had to be opened through the app's own
  menu bar because its webview exposes no clickable accessibility elements.
  The captures live in the session scratchpad, not in the repository.
- Open follow-up recorded in `docs/design/wealthfolio-ui-teardown.md`: a
  settings slice for the grouped navigation column and the field pattern. The
  sibling settings panes (Appearance, Accounts, …) are still uncaptured.
- No calculation, import, share-contract, worker or database change came out of
  either slice.

## Import Inline Row Fixing (2026-08-21)

**Local review and verification (the cloud session could not do this part):**

- Code review confirmed the claimed contract: `applyRowFix` always restores the
  pristine `source_fields`, a colliding fix is refused and the row stays
  blocked with a reason naming the collision, and the rebuild goes through the
  existing `buildImportPreview` rather than a parallel path.
- `rebuildPreviewAfterRowFix` passes `warnings: []`. That is safe today only
  because both fixable adapters (TradingView, IBKR) always return an empty
  `ParsedImport.warnings` and keep their file-level notes in
  `detection.warnings`, which the rebuild carries over. **If a future adapter
  puts warnings there and becomes fixable, a fix would silently drop them.**
- Functional test against the synthetic TradingView fixture, three passes:
  breaking the date keeps the row blocked; a positive withdrawal amount keeps
  it blocked with a new visible reason (`提款金额必须为负数`), proving the fix
  re-runs the adapter's real validation instead of bypassing it; a valid
  `-50` moves 待导入 13 → 14 and 阻止 1 → 0 with the row total unchanged at 14.
- **One accessibility defect found and fixed** (`4b21b4b`): the fix form was
  dropped directly into the div-based ARIA table, exposing its inputs and
  buttons as owned children of `role="table"` (axe `aria-required-children`,
  serious, WCAG 1.3.1) in all three configurations. Wrapped in a
  `role="row"` / `role="cell"` pair. After the fix: axe 0 violations at desktop
  light, desktop dark and 390px with the form open; focus stays inside the
  takeover across 30 Tab presses; 0 page overflow at 390px; no control under
  24x24.

**Release:** `master` pushed and Pages rebuilt; the live bundle
`index-BRboleyj.js` contains the feature's strings (`修正此行`, `原始值`,
`提款金额必须为负数`) and `/`, `/transactions`, `/performance`, `/settings`
all return 200. Note for future release checks: the Pages edge can serve a
cached `index.html` naming the previous bundle for a few minutes — verify with
a cache-busting query parameter.

**Routine note:** the one-shot routine `trig_01FCaLBbkbvvddzviBCN2zu2` reported
a `next_run_at` of 2026-08-21T10:28Z after being manually re-run, despite being
a `run_once` trigger with `enabled: false`. That time has since passed with no
run — `last_fired_at` stayed at the manual 05:58Z run and `list_runs` shows only
two sessions — so the field is stale display state, not a pending schedule. The
routine was explicitly disabled again on 2026-08-21. The API cannot delete a
routine; deleting requires the web UI at https://claude.ai/code/routines.

**Cloud-routine lessons, for the next time one is scheduled:**

1. **Check GitHub write access before scheduling.** The first run did the whole
   job, passed every check, committed on its branch — and then could not push:
   `403 Resource not accessible by integration`. The claude.ai "GitHub
   Integration" connector is read-oriented (attach files, list repos, browse
   branches); pushing needs the **Claude GitHub App** installed on the
   repository. It was installed on 2026-08-21 for `dca-tracker` only. Its
   declared permission set is wider than this use needs — it includes write on
   workflows and repository hooks — so remove the installation when cloud
   routines are no longer wanted.
2. **A cloud sandbox outlives the run.** The stranded session was still
   `active / idle` more than four hours after its last event. When a run
   finishes but cannot deliver, fix the blocker and try to reach that session
   again before rerunning from scratch — the first run's verified work was
   discarded needlessly. Note that `ListAgents` did not surface it, so there may
   be no way to message it from a local session; check before assuming.
3. **State what a cloud session cannot verify, in the prompt.** The routine was
   told it has no browser tooling and must not claim visual or accessibility
   verification. It complied, listed the gaps, and the very first item on that
   list turned out to be a real serious-severity defect (`aria-required-children`
   on the inline fix form). The local probe pass is not optional.

- Delivered by a scheduled cloud routine, reviewed and verified locally, then
  merged as PR #2 and deployed on 2026-08-21 (`1d475cf` + `4b21b4b`): the last
  open item from the import takeover slice above,
  "per-row inline fixing", is implemented and PR'd.
- `src/lib/import/rowFix.ts` is a new pure module: a row is fixable only when
  it failed the adapter's own per-row parsing (`category === 'error'`) and the
  adapter captured `source_fields` for it. `src/lib/import/tradingview.ts` and
  `src/lib/import/ibkr.ts` were refactored so their full-file loop and the new
  `adapter.reparseRow` both call the same per-row parsing function — no second
  validation path. `addDuplicateOrdinals` moved from being duplicated in both
  adapters into `common.ts`. Schwab's legacy eight-column parser keeps no
  per-field source capture, so its blocked rows stay source-file-only,
  honestly, rather than faking support.
- A fix re-parses the row and hands the whole row list back into the existing
  `buildImportPreview`, so status counts, reconciliation and the four-number
  receipt are recomputed by the one pipeline. `source_fields` is set once at
  parse time and never overwritten, so the review step always shows the
  original source text beside an edited field. A fix whose corrected identity
  would collide with another row already in the file is refused (kept
  blocked, reason naming the collision) instead of reaching the RPC with a
  duplicate import key.
- `PortfolioImportTools.tsx` gained the fix affordance and form in the
  逐行核对 step only; no other step, the takeover layout, or the stepper
  changed.
- Verified on the branch after `npm ci` (root plus both workers): `test:finance`,
  `test:portfolio-import`, `test:csv-import`, `test:competitive-fixture`,
  `test:ui`, `test:email-reminder`, `test:quote-status`, `typecheck`, `build`,
  and `git diff --check`. New assertions cover the pure module directly
  (fixing the synthetic TradingView fixture's one blocked row, an IBKR
  malformed-date fix, the collision refusal, and Schwab's honest
  non-fixability) plus source assertions in `verify-ui-behavior.mjs` for the
  component wiring.
- Not verified from the cloud session (no browser tool there): axe scans,
  takeover focus-trap with the fix form open, 390px overflow, and touch-target
  size for the new inputs/buttons. These need a local pass per
  `docs/accessibility/probes/README.md` before this is treated as visually or
  accessibility-verified.
- No database, worker, share-contract, or dependency change; no migration.

## Settings Panes (2026-08-23)

Branch `ui/settings-panes`, committed locally, **not pushed and not deployed**.

- The Wealthfolio app is no longer installed on this machine (the DMG is still
  in the research downloads directory), so the "one more live pass" the previous
  handoff called for was not run. The remaining Settings structure was read out
  of the official source archive at
  `/private/tmp/dca-competitive-20260818/wealthfolio-wealthfolio-633d3a1`
  instead — the same measured-value channel the token layer used, and a
  stronger one than a screenshot. It corrected three claims in the teardown:
  the nav column is 240px (not 200), the active row is a `bg-muted` rounded-md
  ghost button (not a filled pill), and sibling fields are separated by card
  boundaries, not hairlines. It also surfaced a structure the captures never
  showed: below `lg` the reference's `/settings` is a grouped **list**, and a
  row navigates to a detail pane with a back arrow.
- Shipped: six panes under real nested routes — 投资 (`goal`, `basis`),
  通知 (`email`), 数据与隐私 (`share`), 偏好 (`appearance`), 账户 (`account`) —
  with the grouped nav column at `lg` and the list/detail structure below it.
  Only one of the two structures renders at a time, chosen by
  `src/hooks/useMediaQuery.ts`, so control ids stay unique.
- The single settings row still backs three panes. Its edit state lives in
  `src/app/settings/formState.tsx` above them, each pane has its own save
  action, and a save writes the whole row — so a pending edit survives a pane
  switch, and the save row says when the pending change came from a sibling
  pane. This required keying the shell's route-enter animation to `/settings`
  for all panes (`motionKey` in `src/components/AppShell.tsx`); without it the
  provider remounted on every pane switch and the edit was lost.
- No database, RPC, migration, worker or deployment change. The settings write
  path, its legacy-column retry and the tracked-symbol backfill are byte-for-byte
  the same code, moved.
- Verified locally: `test:finance`, `test:email-reminder`, `test:quote-status`,
  `test:ui`, `test:migration-numbering`, `typecheck`, `build`, `git diff --check`.
  Accessibility: axe 0 violations over 28 scans, 107 Tab stops all interactive
  with a visible ring and none under 24x24, 0 overflow at 320px on all seven
  routes, reduced motion pixel-stable. Recorded in
  `docs/accessibility/2026-08-20-wcag-route-audit.md` section 7.
- A contrast regression was introduced and fixed inside this change: the
  revoked share row's `opacity-60` over a lighter backdrop measured 2.62:1.
  It was confirmed to be new by re-scanning `master` in a throwaway worktree,
  and the row now uses muted ink on a raised surface with no opacity blend.
- Not done: the axe probe needs `axe-core` and a Chrome to drive. Neither is in
  the repository — `axe-core@4.10.2` was installed into the session scratchpad
  and Playwright drove the system Chrome channel, because Playwright's own
  Chromium is not downloaded on this machine.

## Focus Not Obscured — WCAG 2.4.11 (2026-08-23)

On branch `ui/settings-panes`, committed locally, **not pushed and not
deployed**. This closes a criterion the 2026-08-20 audit had listed as
unmeasured — and it was failing, on `master` as well as on the branch.

- 691 sequential-focus stops measured across 14 routes (the nine audited
  routes plus the six settings panes, `/login` on the stubbed 5175 build) at
  1280x900, 390x844 and 320x812.
- **8 stops failed AA** and 10 more were partially obscured, all at 390px and
  all behind the fixed bottom nav: the seven row overflow-menu buttons on
  `/transactions/all` and the benchmark search input on `/settings/basis`.
- The cause is scroll alignment, not nav size. `main` already reserves `pb-24`
  for the nav, but sequential focus scrolls a control only just into the
  viewport, whose bottom edge is under the nav — so the browser parks the
  control exactly where the nav covers it. On `/settings/basis` at 390x844 the
  focused input sat at y 783-823 with the nav starting at y 774.
- Fix: `scroll-margin-bottom` on focusable elements below `lg`, sized to the
  nav's measured 70px footprint plus breathing room and the safe-area inset
  (`src/index.css`). The same input now lands at y 722-762. Re-measured:
  **0 AA failures and 0 partially obscured stops** across all 691.
- The residual 267 stops that report a sub-1 paint fraction are sampler
  artifacts at rounded corners, verified on a 28x28 button with a 10px radius
  where all 8 missing samples land on the four grid corners. Geometry says
  fully visible for every one of them.
- Method and numbers are recorded in
  `docs/accessibility/2026-08-20-wcag-route-audit.md` section 8. The probe uses
  three independent signals (clipping-ancestor intersection, geometric
  subtraction of non-ancestor fixed/sticky boxes, `elementFromPoint` sampling)
  so a single weak signal cannot decide a pass.
- Re-verified after the CSS change: axe 0 violations over 28 scans, 107 Tab
  stops all interactive with a visible ring, `test:finance`, `test:ui`,
  `test:email-reminder`, `test:quote-status`, `typecheck`, `build`,
  `git diff --check`.

## Portfolio Performance Reconciliation — B1 (2026-08-23)

On branch `ui/settings-panes`, committed locally, **not pushed and not
deployed**. No database, worker or frontend behaviour changed; this is a
verification gate plus its fixture.

- B1 asked for an exact TTWROR/XIRR comparison against Portfolio Performance
  0.86.0 with quote history configured. It was blocked on re-running the
  application, which is not installed here any more. It was closed instead
  through a stronger channel: the application's **own saved state**. The
  synthetic `.portfolio` files are zip containers holding a `PPPBV1` protobuf,
  decoded with a generic field walk to its stored integers — money in cents,
  shares in 1e-8 units. All three saved states carry an identical ledger, so
  the T03 repeat-import really did leave it unchanged.
- Those integers are pinned in
  `docs/research/competitive/2026-08/fixtures/portfolio-performance-stored-ledger.json`,
  together with the protobuf field map so the file can be re-decoded with any
  protobuf tool. The temporary research directory is not a durable source; this
  fixture is.
- `test:finance` now carries an application gate beside the existing formula
  gate. The shipped `computeLedgerTwr` and `computeXirr`, fed PP's stored
  ledger, reproduce **all three** figures the application displayed in T07:
  value `$921.53` (engine `921.5322`), TTWROR `2.15%` (engine `2.1532%`), IRR
  `3.83%` (engine `3.8324%`).
- Two application behaviours had to be read correctly, and both are now
  recorded rather than assumed. Without a quote provider PP values a security
  at the **gross price of its latest transaction** — net plus fees for a sale —
  so VGT is carried at `110.34`, not at the frozen `111.00` close. And the
  report period ends on the **run date**, not the last ledger date, so the IRR
  annualizes over 228 days; over 13 days the same flows read `81.86%`.
- Consequence for the gate: the `0.3994pp` difference between PP's `2.1532%`
  and our own `2.5527%` is entirely the price input, not a formula
  disagreement. `requirements-audit.md` moves the V2 formula row from `partial`
  to proved against the reference application.
- Honest limits. TTWROR is reconciled only to PP's display precision (two
  decimals) — the value and cash figures pin it much harder, but sub-basis-point
  TTWROR still needs a run with quote history configured. The same report's
  maximum drawdown (`0.02%`) and volatility (`1.81%`) are **not** reconciled;
  they are outside the B1 target and stay recorded as observations.
- B2 is still not satisfiable from here. Of its four preconditions, B1 now
  passes and `VITE_LEDGER_IMPORT_V2=0` remains the documented rollback, but the
  full re-import and the V1 regression both need authorized cloud work.
  Switching `ledger_twr_v2` remains a separate release gate.

## Public Share Privacy — D2/D3 and a Live Leak (2026-08-23)

On branch `ui/settings-panes`, committed locally. Migration `0051` is written
and locally verified but **NOT APPLIED**. Production still has the defect below
until an authorized apply.

**The finding.** `public.shared_performance_history` returns the cached history
payload wholesale. The cache writer's `warnings` array has three shapes, and one
of them carries absolute USD figures — `nav_user`, `nav_benchmark`, `flow` — for
a day skipped because NAV net of flow fell to zero or below (a full
liquidation, a large withdrawal, a data gap). Whenever such a warning exists, an
anonymous share request returns portfolio NAV and a flow amount. That breaks the
percentage-only public-share contract. It went unnoticed because the synthetic
and normal states never produce a skip warning.

**Reproduced, not inferred.** A throwaway PostgreSQL 15.19 cluster was created
in the session scratchpad with the shipped function body and a cache row shaped
like the writer's output. Before the fix the anonymous response contained
`nav_user 12345.67`, `nav_benchmark 12000.00`, `flow -9000.00`; after migration
`0051` the warning keeps only `date` and `type`, and the rest of the payload is
byte-identical (`(before - warnings - dirty) = (after - warnings - dirty)`
returns true). The `shared_history` alias goes through the same path.

**The fix.** `supabase/migrations/0051_public_share_warning_projection.sql`
projects the cached payload through an allowlist at the public boundary:
a warning keeps `date`, `type`, `original_date`, `ticker`. Boundary rather than
writer, because the owner keeps the diagnostic, the dashboard and share keep
reading one cached TWR contract, and nothing has to be recomputed — existing
cache rows are sanitized on read, so **the migration writes no rows**. Rationale
and alternatives in `docs/decisions/2026-08-23-public-share-warning-projection.md`.

**The gate.** `npm run test:share-privacy`
(`scripts/verify-public-share-privacy.mjs`), added to CI and to the core check
set in `PROJECT.md` and `AGENTS.md`. It pins the anon-executable set to the three
documented entry points, allowlists every JSON key those entry points emit,
rejects id-like and amount-like keys and internal identifiers in payload values,
requires the cached payload to be projected, and forbids an anonymous path from
calling a recompute helper. Negative-tested against three mutated copies of the
migration set (sanitizer removed, extra anon grant, amount key added) — it fails
on each, so it is not a vacuous check.

**Why the boundary and not the writer.** `_performance_history_for_user_fast_base`
has no static definition anywhere in the repository: migration 0029 created it by
renaming the then-current `_performance_history_for_user_fast`, and 0037, 0043
and 0047 each patch it in place through `pg_get_functiondef`. Its body is only
knowable from a live database. The public boundary therefore cannot trust the
cache payload and must project it. This is worth remembering for any future
change to that chain.

**Limits.** The gate reads migration text, not the deployed database; a
production drift check against the live definitions is still separate and
unauthorized work. D1 proper — the V2 cache and RPC — is still unimplemented;
the projection and the gate carry over to it. `requirements-audit.md` moves the
D row from `missing` to `partial`.

**Needs a decision from the owner:** applying `0051` changes a production RPC.
It replaces two function definitions, writes no rows, and is reversible by a
further append-only migration.

## Session Notes (2026-08-20 handoff)

- Delivery flow used this window: slices are implemented either locally or by
  a one-shot cloud routine, verified with the CI-equivalent set plus local
  demo-mode browser checks, then merged to `master`. The cloud routine
  `trig_0147fA6nee6ULcCnZ7zmL8tE` is one-shot and now disabled; its GitHub
  integration is read-only (`git push` and API branch creation both returned
  403), so its work came back as a git patch that was applied and re-verified
  locally before PR #1. Granting `contents:write` to the Claude GitHub
  integration (claude.ai Settings → Connectors) would let future cloud runs
  push branches and open PRs themselves.
- C2/C4 keyboard and narrow-table evidence was collected with playwright-cli
  (`~/.claude/skills/playwright/scripts/playwright_cli.sh`) against
  `npm run dev:local` on port 5174; the method is repeatable and its results
  are recorded above and in the rectification plan's C2/C4 entries. No
  Playwright dependency was added to the repository.
- `competitive-learning-plan-2026-08-19.pptx` was the meeting deck this
  rectification plan was derived from. It was never tracked, and on the user's
  instruction it was moved out of the repository root to the macOS Trash on
  2026-08-20 rather than committed or relocated. Its conclusions live on in
  `docs/tasks/2026-08-19-competitive-learning-rectification-plan.md`; recover
  the file from the Trash if the original slides are needed again.
- Accessibility evidence method (repeatable, documented in
  `docs/accessibility/probes/README.md`): `playwright-cli` `run-code` snippets
  against `npm run dev:local` on 5174. `/login` redirects to `/` in local mode,
  so it was audited on a second dev server (5175) started with stub Supabase
  credentials (`VITE_SUPABASE_URL=http://127.0.0.1:9`), which keeps the run
  offline — no real project was contacted. Both server entries live in the
  gitignored `.claude/launch.json`. axe-core is loaded from the dev server, so
  the run copies `axe.min.js` into `public/axe-audit-tmp.js` and deletes it
  afterwards; confirm `git status` is clean of it before committing.
- A `run-code` file must contain a bare `async (page) => { ... }` with no
  trailing semicolon: the CLI wraps it as `await (<file>)(page)`.
- The synthetic TradingView fixture surfaces 1 blocked row in the import
  preview (visible in the 阻止 counter). This is the preview honestly
  reporting fixture content, not a regression; adapter tests pass.
- No database, worker, share-contract, or dependency change is pending in the
  working tree after this session's commits. Production remains at migration
  `0050`; no deploy was performed from this session.

## Current Status

- SMH refresh compatibility is deployed in Quote Worker version
  `8d63a31a-2d64-4997-a039-a95dee51816e` from commit `7b981f5`. The primary
  SMH channel is now StockAnalysis' public HTML holdings page, which is
  reachable from the Worker and parses 25 equity rows. Its page date is checked
  against the verified 2026-08-18 official snapshot: an older response is not
  allowed to overwrite newer data. Network/edge failures or stale alternate
  data return the newer official snapshot with a `static-fallback` warning
  instead of reporting a partial refresh failure. Parser/schema and database
  write errors still fail. `test:etf-holdings`, the CI-equivalent tests,
  `typecheck`, Worker dry-run, `build`, and `git diff --check` pass.
- Current read-only probing reproduced VanEck resetting direct local connections
  to both the marketing page and XLSX endpoint. The official page and JSON
  dataset were independently reachable through the web retrieval path. The
  deployed Worker health endpoint returned 200, refresh CORS preflight returned
  200, and an unauthenticated refresh returned 401. No authenticated/private
  portfolio access was performed, so a real SMH refresh through the deployed
  Worker remains unverified.
- On 2026-08-19, the local static fallback `src/data/etf-holdings.json` was
  updated from VanEck's official SMH holdings page as of 2026-08-18: 25 equity
  constituents totaling 99.93%, with cash rows excluded. Direct Mac `curl`
  requests to the VanEck page and JSON endpoint still reset the connection.
- The fallback is bundled in the frontend and Worker; normal cloud mode still
  prefers the remote `etf_holdings` snapshot, which is now refreshed from this
  snapshot when the live provider is unavailable. No private portfolio data was
  read during the fix or deployment.
- StockAnalysis was read-only probed on 2026-08-19: HTTP 200, no challenge page,
  25 equity rows, `as_of=2026-07-30`, and parsed weight total `0.9991`. Because
  that date is older than the local official snapshot, production keeps the
  2026-08-18 data while treating the refresh as successful.
- Repository: `/Users/junxihuo/Documents/dca_system`, branch `master` tracking
  `origin/master`.
- Append-only migrations `0048_etf_holdings_refresh.sql`,
  `0049_restrict_etf_holding_table_privileges.sql`, and
  `0050_portfolio_ledger_import.sql` are applied to production.
  The latter removes inherited `REFERENCES/TRIGGER` grants so `anon` and
  `authenticated` have only `SELECT` on both ETF snapshot tables.
- Quote Worker version `8d63a31a-2d64-4997-a039-a95dee51816e` is deployed with
  authenticated `POST /api/etf-holdings/refresh` and weekly Sunday refresh.
  UTC 04:10 and 05:10 daily runs use one equivalent comma-list Cron expression
  to stay within the account's five-trigger limit without dropping a run.
- Git-backed Pages deployment `16cf94a6-32b8-46ab-8898-295591d34d4e` is live
  from `4d499d3`. The canonical bundle `index--thvpyYG.js` contains the new
  workbench and unified import UI, without the localhost stub. Fresh browser
  login rendered the login route without console errors; an invalid share token
  returned only the expired-link message.
- The preceding direct upload `b4191fc1` was built locally without public
  `VITE_` variables and briefly broke login with `Failed to fetch`. The Git
  deployment replaced it; production login now renders without the missing
  Supabase configuration warning. Do not direct-upload an unconfigured local
  `dist/`; follow `docs/runbooks/deployment.md`.
- Root-cause fix commit `395400e` is pushed to `origin/master` and deployed.
- Schwab transaction `Amount` is parsed as before and now persists in nullable
  `transactions.settled_amount_usd`. Private cash, cost basis, realized proceeds,
  TWR cache generation, and sanitized share percentages prefer that settled
  value. Manual and six-column Portfolio CSV trades retain the existing
  quantity-times-price plus/minus fees fallback.
- Recognized Deposit rows keep their original amount and date. Excluded-stock
  net funding is represented by a negative `stock_allocation` cashflow on the
  actual stock trade date. Account cash, invested capital, XIRR, export, and
  re-import all understand that event.
- New append-only migration
  `0047_schwab_settled_cash_and_stock_allocations.sql` adds the column and
  constraint, extends the existing owner-protected `cashflows` table, and
  replaces the four-argument import RPC without changing its signature. The RPC
  remains security-invoker, derives ownership from `auth.uid()`, and grants
  execution only to `authenticated`.
- Migration `0047` was applied to production project `igwacbeojogblacektxr` as
  version `20260805023032`. Structural checks confirmed
  `transactions.settled_amount_usd numeric(22,10)`, the dated
  `stock_allocation` cashflow constraint, and the updated owner-protected RPC.
- Old clients that send `deposit_date` remain accepted. New stock allocations
  require `reset_all`; append and legacy `reset_etf` remain available for
  rolling-deploy compatibility.
- The import preview now reports original deposits, dated stock allocations,
  net ETF funding, ending cash, and real incomplete-cash warnings. Export writes
  `Stock Allocation` extension rows so the application backup round-trips.
- Synthetic regression coverage fixes the former `-$0.0002015` false warning:
  a `$922.75` deposit and source trade `Amount` totaling `-$922.75` now produce
  `$0.00` minimum and ending cash despite a `$922.7502015` recomputed notional.
- A separate timing fixture proves a June 17 stock allocation is not moved back
  to June 5; any unresolved `-$99.93` cash gap appears on June 17.
- Final local verification passed: `test:csv-import`, `test:finance`, `test:ui`,
  `test:migration-numbering`, `test:email-reminder`, `test:quote-status`,
  `typecheck`, `build`, and `git diff --check`.
- Playwright local-mode checks passed at desktop and 390px mobile widths. The
  six metrics, original deposit, dated allocation, and second reset-confirmation
  counts rendered without overlap; the final import action was not executed.
- The user-provided real CSV was not read, copied, or imported.

## Production State

- 2026-08-20 UI-alignment phases 2-4 release: `master` was pushed to
  `origin/master` at `c52609e` with explicit user authorization, and Pages
  rebuilt within about 30 seconds. Canonical
  `https://dca-tracker-git.pages.dev` now serves `index-B1BhOvIP.js` with
  `index-Gpbkcydp.css`. Post-deploy checks: the live stylesheet carries the
  ledger table's `720px` minimum width and the overview hero's `34px` size
  alongside the Flexoki paper value; `/`, `/performance`, `/transactions`,
  `/transactions/all`, `/health`, `/settings` and an invalid `/share/<token>`
  all return 200; the production login route renders with no console output.
  Note for the next release check: the Pages edge served a cached `index.html`
  with the previous bundle name for a few minutes after the deploy — verify
  with a cache-busting query parameter before concluding a deploy has not
  landed.
- 2026-08-20 UI-alignment shell release: `master` was pushed to `origin/master` at
  `d094c5b` with explicit user authorization (deploy after phase 1b), and the
  Git-backed Pages project rebuilt automatically within about 15 seconds.
  Canonical `https://dca-tracker-git.pages.dev` now serves bundle
  `index-BdRGUPZm.js` with stylesheet `index-e-WDLDRA.css`. Post-deploy checks:
  the live stylesheet contains the Flexoki paper value `48 100% 97%`, the HTML
  links Inter and no longer links Hanken Grotesk, `/`, `/performance`,
  `/transactions`, `/transactions/all`, `/health`, `/settings` and an invalid
  `/share/<token>` all return 200, and the production login route renders with
  no console output. No login was attempted and no private data was read.
- 2026-08-20 earlier frontend release: `master` was pushed to `origin/master` at
  `2c93d45` with explicit user authorization, and the Git-backed Cloudflare
  Pages project rebuilt automatically. Canonical
  `https://dca-tracker-git.pages.dev` now serves bundle `index-DCYExNkH.js`
  with stylesheet `index-Cv_3GGMn.css`. Post-deploy checks: the served
  `index.html` viewport meta no longer carries `maximum-scale`, the stylesheet
  contains the new `--gain-ink` token, `/`, `/settings`, `/performance` and an
  invalid `/share/<token>` all return 200 (SPA `_redirects` intact), and the
  production login route renders with no console output, so the Pages build
  still injects the public `VITE_` values. No login was attempted and no
  private data was read. Any later docs-only commit rebuilds the same assets.
- The Quote Worker, Email Worker, and Supabase were not touched by this
  release; production remains at migration `0050` and Quote Worker version
  `8d63a31a-2d64-4997-a039-a95dee51816e`.

- Production contains migrations through
  `0050_portfolio_ledger_import.sql`; post-migration schema and permission
  checks passed.
- Quote Worker version `23f51a7b-cc60-416d-9c3d-a95fe4a34671` serves health 200,
  valid refresh-route CORS preflight 200, and unauthenticated refresh 401.
- Cloudflare Pages deployment `16cf94a6-32b8-46ab-8898-295591d34d4e` for source
  `4d499d3` is live at
  `https://16cf94a6.dca-tracker-git.pages.dev`; canonical
  `https://dca-tracker-git.pages.dev` serves bundle `index--thvpyYG.js`.
- No real CSV, financial import, authenticated holdings, or user data was read
  or changed during deployment verification.

## Next Steps

The Settings slice is finished and verified but lives on the local branch
`ui/settings-panes`; `master` is still at `304ca9a` and production is unchanged.
Nothing is half-written. Pick up with whichever of these the owner wants.

1. **Release the branch, or don't.** `ui/settings-panes` now carries two things
   — the settings panes and the 2.4.11 fix. The 2.4.11 fix is one CSS rule that
   corrects a live AA failure present on `master` today, so it is worth
   shipping even if the settings redesign is held back; it can be cherry-picked
   onto `master` on its own. The full local check set passes and the
   accessibility evidence is recorded. Merging to `master` pushes a Pages
   rebuild, so it needs the usual one-at-a-time deploy authorization. Post-deploy, check the live bundle with a
   cache-busting query parameter and confirm `/settings`, `/settings/goal` …
   `/settings/account` all return 200 — the SPA `_redirects` fallback already
   covers the new deep links, but they have only been exercised locally.
   The UI-alignment delivery order in `docs/design/wealthfolio-ui-teardown.md`
   now has no open phase.
2. **Longer-standing gates.** B1 closed on 2026-08-23, so the `ledger_twr_v2`
   switch is now waiting on the rest of B2: a full re-import and a V1
   regression, both of which need authorized cloud work. D2/D3 are now gated in
   CI and a live V1 share leak was found and fixed in migration `0051`, which is
   **unapplied and waiting on authorization** — that is the most time-sensitive
   item on this list, because production leaks until it lands. D1 proper (the V2
   cache and RPC) is still unimplemented. The remaining fully missing contract
   row is `Performance/Lighthouse/compatibility gates`, not the share cache.
3. **Accessibility follow-ups that remain open:** a screen-reader pass and the
   cloud-only routes (`/cashflows`, a populated `/share/<token>`, the
   authenticated login flow). WCAG 2.4.11 is no longer on this list — it was
   measured on 2026-08-23, found failing at 390px, fixed, and re-measured at
   zero across 691 focus stops. Everything locally renderable — the six new
   settings panes included — is at zero axe violations; see
   `docs/accessibility/2026-08-20-wcag-route-audit.md` sections 7 and 8.
4. **Standing constraints:** keep the synthetic-file import smoke test separate
   from real brokerage data; `VITE_LEDGER_IMPORT_V2=0` is an explicit
   compatibility rollback only; and the competitive scorecard's choice of
   Wealthfolio as the interaction reference is a research decision, never a
   production release authorization. Deploys are authorized one at a time.
## Prior SMH Follow-up

1. Verify the authenticated `POST /api/etf-holdings/refresh` with a synthetic
   account, including partial provider failure, final-holder deletion, and
   re-buy refresh and SMH access to the VanEck JSON dataset from the deployed
   Worker runtime. Vanguard and Invesco live read-only probes passed locally.
2. Let the user review the real-file Schwab preview separately. Leave the
   actual `reset_all` import to explicit confirmation.

## Risks and Boundaries

- Full reset deletes all current-user transactions, cashflows, and funding
  batches before rebuilding ETF trades and imported cash events. Any validation
  or write error must roll back the whole RPC transaction.
- Dividends, interest, withdrawals, taxes, and unsupported cash events remain
  omitted from the existing Schwab compatibility write path. The new adapters
  and unified preview normalize them locally; migration `0050` and the V2
  import surface are released, but the ledger performance method remains
  separately gated.
- Public share responses remain percentage-only. The new absolute settled and
  allocation amounts stay behind existing owner RLS and are not added to public
  JSON contracts.
- Migration `0047` dynamically patches the currently deployed performance and
  share functions and should be applied transactionally before the frontend.
- Fixed-version Ghostfolio, Wealthfolio and Portfolio Performance assets are
  present only in the temporary research environment. Wealthfolio's desktop
  profile does not expose a custom data-root control in the tested flow; keep
  the profile synthetic and do not use it for personal data. Portfolio
  Performance has no configured historical quote provider in this run, so its
  benchmark and quote-history results are intentionally unscored.

## Related Files

- `PROJECT.md`
- `PRODUCT.md`
- `DESIGN.md`
- `docs/PERFORMANCE_SPEC.md`
- `docs/architecture/import-and-ledger.md`
- `docs/decisions/2026-08-18-ledger-import-release-gate.md`
- `docs/research/competitive/2026-08/`
- `docs/research/competitive/2026-08/requirements-audit.md`
- `docs/tasks/schwab-etf-transaction-import-export.md`
- `src/lib/schwabTransactions.ts`
- `src/lib/import/`
- `scripts/verify-portfolio-import-adapters.ts`
- `src/lib/calc/transactionAmounts.ts`
- `src/components/SchwabTransactionTools.tsx`
- `src/app/settings/`
- `docs/research/competitive/2026-08/reconciliation.md`
- `docs/research/competitive/2026-08/fixtures/portfolio-performance-stored-ledger.json`
- `scripts/verify-portfolio-performance-reconciliation.mjs`
- `scripts/verify-public-share-privacy.mjs`
- `supabase/migrations/0051_public_share_warning_projection.sql`
- `docs/decisions/2026-08-23-public-share-warning-projection.md`
- `docs/design/wealthfolio-ui-teardown.md`
- `docs/accessibility/2026-08-20-wcag-route-audit.md`
- `supabase/migrations/0047_schwab_settled_cash_and_stock_allocations.sql`
- `supabase/migrations/0048_etf_holdings_refresh.sql`
- `supabase/migrations/0049_restrict_etf_holding_table_privileges.sql`
- `workers/quote/src/etfHoldings.ts`
- `src/hooks/useEtfHoldings.ts`
