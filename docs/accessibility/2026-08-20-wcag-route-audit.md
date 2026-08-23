# WCAG 2.2 AA route audit — 2026-08-20

Scope: the DESIGN.md accessibility gate (WCAG 2.2 AA for login, overview,
performance, ledger/import, data health, settings and share). This record
covers the automated scan, the keyboard evidence, the reduced-motion
degradation and the narrow-viewport behaviour, plus the defects fixed in the
same change set and the parts that remain unproven.

All runs used synthetic data only: `npm run dev:local` (bundled 10-year QQQ
simulation) on port 5174, and for `/login` a second dev server on 5175 started
with stub Supabase credentials (`http://127.0.0.1:9`), so no real project,
account or brokerage file was contacted. No macOS setting was changed; the
reduced-motion evidence comes from browser emulation, not the system probe that
was recorded as unavailable in the 2026-08-19 study.

Tools: `playwright-cli` (npx cache, Chromium) and `axe-core` 4.10.2, neither
added to the repository. The probe sources are in `probes/`.

## 1. Automated scan (axe-core 4.10.2)

Rule sets `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`.
Nine routes x {1280x900, 390x844} x {light, dark} = 36 scans.

Before the fixes below:

| Rule | Tags | Nodes | Routes |
|---|---|---|---|
| `color-contrast` | wcag2aa 1.4.3 | 75 | overview, performance, exposure, ledger, ledger-all |
| `meta-viewport` | wcag2aa 1.4.4 | 36 | every route |
| `aria-prohibited-attr` | wcag2a 4.1.2 | 16 | performance |
| `region` | best-practice | 16 | share, login |
| `heading-order` | best-practice | 8 | health, settings |
| `landmark-one-main` | best-practice | 8 | share, login |
| `empty-table-header` | best-practice | 4 | performance |
| `page-has-heading-one` | best-practice | 4 | share |
| `landmark-unique` | best-practice | 2 | overview |
| `scrollable-region-focusable` | wcag2a 2.1.1 / 2.1.3 | 2 | performance (390px) |

After the fixes: **0 violations in all 36 scans.**

## 2. Defects fixed in this change set

| Finding | Criterion | Fix |
|---|---|---|
| `maximum-scale=1.0` blocked pinch zoom | 1.4.4 Resize Text | dropped from the `index.html` viewport meta |
| Soft chips unreadable in light theme (gain 4.10–4.37:1, warn 2.61–2.79:1) | 1.4.3 Contrast | new `--*-ink` tokens used only by the `.bg-*-soft` utilities; series/chart colors unchanged |
| White on the pale dark brand fill (2.96:1) | 1.4.3 Contrast | dark `--brand-foreground` is now `222 39% 11%` (6.0:1) |
| `aria-label` on a role-less `<span>` dot | 4.1.2 Name, Role, Value | the calendar trade-day dot carries `role="img"` |
| Sideways-scrolling history table unreachable by keyboard | 2.1.1 Keyboard | wrapper is `tabIndex={0}` with `role="region"` and a name |
| Share-link copy/revoke icon buttons had no accessible name beyond `title` | 4.1.2 | explicit `aria-label` carrying the same masked token already on screen |
| `/login` and the invalid-share page had no `main` landmark, and the share fallback had no `h1` | best practice, 1.3.1 | both wrapped in `<main>`; the share fallback title is an `h1` |
| Two unnamed complementary landmarks and an unnamed bottom nav | best practice | `aria-label` on the shell sidebar, the overview side column and the mobile nav |
| Page outline skipped `h1 -> h3` on card pages | best practice | `CardTitle` renders `h2` |
| Blank corner header in the history table | best practice | `sr-only` label |
| Three controls below the 24x24 minimum (`.workbench-link` 90x18, benchmark switch 111x16, benchmark chip 21x16) | 2.5.8 Target Size | `min-height`/`min-width` raised to 24px |

## 3. Keyboard evidence (C2)

Desktop 1280x900, forward Tab through a full cycle, then Shift+Tab back.
"Ring" means a computed outline or box-shadow, or `:focus-visible` matching.

| Route | Stops per cycle | Non-interactive stops | Stops without a ring | Reverse symmetric |
|---|---|---|---|---|
| `/` overview | 14 | 0 | 0 | yes |
| `/performance` | 22 | 0 | 0 | yes |
| `/exposure` | 18 | 0 | 0 | yes |
| `/health` | 11 | 0 | 0 | yes |
| `/settings` | 24 | 0 | 0 | yes |
| `/transactions` | 24 | 0 | 0 | yes (2026-08-19 run) |
| `/transactions/all` | covered 2026-08-19 | 0 | 0 | yes |
| `/login` (stub cloud build) | 2 | 0 | 0 | yes |
| `/share/:token` invalid state | 0 | — | — | n/a |

Notes:

- The `(body)` stop that appears once per cycle is the browser chrome step, not
  a focus loss; the traces in `probes/` show the cycle resuming at the first
  control.
- Row-level controls keep aria-labels (`编辑 SGOV 交易`), so every stop reports
  a name.
- The invalid-share page has no focusable element at all. That is not a WCAG
  failure (it offers no action), but it is a dead end for keyboard and pointer
  users alike and is left as a product question, not a silent pass.
- Dialog focus return was fixed on 2026-08-19 (`src/components/ui/dialog.tsx`).

## 4. Reduced motion (C3)

The CSS `@media (prefers-reduced-motion: reduce)` block only reaches CSS
transitions and keyframes. Framer Motion and Recharts run their own timelines,
and framer's `reducedMotion="user"` still honours per-item `delay`, so lists
kept popping in row by row. The application now degrades explicitly:

- `MotionConfig reducedMotion="user"` at the app entry;
- `useEnterMotion()` (over the pure `enterMotionProps()` rule) cancels both the
  entrance offset and the stagger delay for every staggered list, card, ring,
  gauge and share bar;
- `AnimatedNumber` snaps instead of counting;
- the shared spark chart passes `isAnimationActive={!reduceMotion}`.

Measurement: sample every animated node 90 ms after a remount and again 2.4 s
later, then classify what changed.

| Route | Default preference | `prefers-reduced-motion: reduce` |
|---|---|---|
| overview | opacity + transform + position | opacity only |
| performance | opacity + transform + position | opacity only |
| exposure | opacity + transform + position | opacity only |
| health | opacity + transform + position | opacity only |
| settings | opacity + transform + position | opacity only |

No transform, position, `stroke-dashoffset` or width change survives under
reduced motion on any route. Opacity fades remain deliberately: they carry no
movement, and framer keeps opacity animating under `reducedMotion="user"`.

## 5. Narrow viewport and reflow (C4)

- 390x844: page horizontal overflow is 0 on every route. The only elements
  whose `scrollWidth` exceeds their box are an `sr-only` label, SVG chart text
  nodes and a `truncate` token line — none of which scroll the page.
- 320x800 (the 1.4.10 reflow width): page horizontal overflow is 0 on all nine
  routes.
- Wide tables scroll inside their own container, which is now keyboard
  focusable — the failure mode observed in Portfolio Performance at 392px
  (fixed sidebar clipping the table) does not reproduce here.

## 6. Not proved

- No screen-reader pass (VoiceOver/NVDA). Names and roles are only machine
  checked.
- 2.4.11 Focus Not Obscured was not measured; sticky headers and the fixed
  mobile nav are the surfaces to check when that is done.
  **Measured on 2026-08-23 — see section 8. It was failing; it now passes.**
- Cloud-only states are unaudited: `/cashflows` redirects in local mode, the
  populated `/share/:token` report renders only with cloud data, and the
  authenticated post-login shell was not exercised. `/login` evidence comes
  from a stubbed build, so its error and success states are still unaudited.
- axe-core covers only part of WCAG. Criteria that need human judgement
  (1.3.1 beyond markup, 2.4.6, 3.3.x error handling and instructions) were
  reviewed informally while collecting the traces, not formally.
- No Lighthouse or cross-browser evidence; that stays in the E2 release gate.

Under the `requirements-audit.md` tri-state this moves the product side of the
WCAG row from `missing` evidence to `partial`: automated AA coverage plus
keyboard, reduced-motion, reflow and target-size measurement on every locally
renderable route, with the screen-reader and cloud-only surfaces still open.

## 7. Follow-up scan — settings panes (2026-08-23)

The settings surface stopped being one route on 2026-08-23; it is now
`/settings` plus six panes. Same tool versions and rule sets as section 1, with
Chromium replaced by the system Chrome channel (Playwright's own browser
download was not present on this machine, and was not added).

- **axe-core 4.10.2**: 7 routes x {1280x900, 390x844} x {light, dark} =
  **28 scans, 0 violations**.
- **Keyboard**: 107 Tab stops across the seven routes. Every stop is an
  interactive element, every stop paints a visible ring, and no focused target
  is under 24x24.
- **Reflow**: page horizontal overflow is 0 on all seven routes at 320x812.
- **Reduced motion**: pixel-identical screenshots across a 2s hold on
  `/settings`, `/settings/goal` and `/settings/basis`, and across a nav-column
  pane switch — panes now swap with no page transition at all.

One regression was found by this scan and fixed before the change shipped:
moving the share list out of its card left the revoked row's `opacity-60`
compositing over a lighter backdrop, which put four nodes at 2.62:1 against the
4.5:1 floor. Baseline `/settings` on `master` was re-scanned in a throwaway
worktree to confirm the failure was new rather than inherited. The row now
carries muted ink on a raised surface instead of an opacity blend, so its
contrast no longer depends on what is behind it.

Section 6 is unchanged: the screen-reader pass, 2.4.11 and the cloud-only
routes remain open.

## 8. Focus Not Obscured — 2.4.11 (2026-08-23)

Section 6 listed 2.4.11 as unmeasured. It is now measured, and it was failing.

**Method.** For every sequential-focus stop, the focused element's box is
compared against the page in three ways, so a single weak signal cannot decide
the result:

1. **Clipping** — intersect the box with the viewport and with every ancestor
   that establishes a clipping box (`overflow` other than `visible`).
2. **Geometry** — subtract the painted boxes of every `position: fixed` or
   `sticky` element that is neither an ancestor nor a descendant of the focused
   element. Ancestors are excluded, otherwise the toolbar's own tab pills would
   report themselves as obscured.
3. **Paint** — sample an 11x11 grid over the surviving box and ask
   `elementFromPoint` whether the focused element (or a descendant) is topmost.

A stop fails 2.4.11 (AA) when no part survives; a stop that survives only in
part is recorded against 2.4.12 (AAA), which this product does not claim.

14 routes — the nine from section 1 plus the six settings panes, with `/login`
on the stubbed 5175 build — across 1280x900, 390x844 and 320x812. **691 focus
stops.**

**Before the fix: 8 AA failures and 10 partially obscured stops**, every one of
them at 390px and every one behind the same element, the fixed bottom nav:

| Route | Stops entirely hidden | Obscured by |
|---|---|---|
| `/transactions/all` | 7 row overflow-menu buttons | `nav.safe-bottom.fixed` |
| `/settings/basis` | the benchmark search input | `nav.safe-bottom.fixed` |

The cause is not the nav's size — `main` already reserves `pb-24` for it — but
scroll alignment. Sequential focus scrolls a control *only just* into the
viewport, and the viewport's bottom edge is underneath the nav, so the browser
parks the control exactly where the nav covers it. Measured on
`/settings/basis` at 390x844: the focused input sat at y 783-823 with the nav
starting at y 774, i.e. entirely behind it.

**Fix.** `scroll-margin-bottom` on focusable elements below `lg`, sized to the
nav's measured 70px footprint plus breathing room and the safe-area inset
(`src/index.css`). The same input now lands at y 722-762, fully clear.

**After: 0 AA failures and 0 partially obscured stops** across all 691. The
partial-obscuring cases disappeared with the AA ones, since both had the one
cause.

**Reading the residual numbers.** 267 stops report a paint fraction below 1
while their geometry fraction is exactly 1. These are sampler artifacts, not
obscuring: on a 28x28 icon button with a 10px radius, all 8 missing samples land
on the four grid corners, outside the rounded shape, where the row behind is
legitimately topmost. One stop on `/performance` at 320px is clipped by its own
card by roughly a pixel and remains visible on every sample.

This closes the 2.4.11 line in section 6. The screen-reader pass and the
cloud-only routes are still open.
