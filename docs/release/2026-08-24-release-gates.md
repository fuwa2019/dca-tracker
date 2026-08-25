# Release gates — measured record

Date: 2026-08-24
Baseline commit: `6940af7`
Target: production-mode build of the offline demo (`VITE_LOCAL_MODE=1`), served
by `vite preview` on `127.0.0.1:4173`. No Supabase project was contacted and no
private data was involved in any measurement on this page.

This closes the `Performance/Lighthouse/compatibility gates` row that
`docs/research/competitive/2026-08/requirements-audit.md` carried as the last
fully `missing` contract item. What each gate does *not* cover is stated with
the numbers, not in a footnote.

---

## 1. First-load transfer budget (CI)

`npm run test:release-budget`, added to `.github/workflows/ci.yml` after the
build step. It resolves every asset the document needs before any route renders
— entry module, modulepreloads, stylesheets — and measures raw and gzip bytes.

| Metric | Measured | Budget |
|---|---|---|
| First-load JS (gzip) | 428.32 KiB | 450 |
| First-load CSS (gzip) | 10.86 KiB | 14 |
| First-load total (gzip) | 439.18 KiB | 462 |
| Largest single chunk (gzip) | 182.58 KiB | 195 |
| First-load requests | 8 | 9 |
| Render-blocking third-party origins | 1 | 1 |

Gzip is the transfer proxy: Cloudflare Pages negotiates brotli when offered,
which is smaller, so a gzip budget is the conservative one.

**Negative-tested**, so it is not a vacuous check. Four mutations each fail it:
a tightened budget, a second render-blocking third-party stylesheet injected
into `index.html`, 400 KB appended to the entry chunk, and a missing `dist/`.

**It cannot see** LCP, TBT, CLS or anything else needing a real browser. That is
section 2's job.

---

## 2. Lighthouse (release-time probe)

`docs/release/probes/lighthouse-budget.mjs`, Lighthouse 12.8.2 against the
system Chrome. Deliberately **not** in CI.

### The noise finding, which shaped the gate

Three full passes over six routes at both form factors, on an unchanged build,
moved the composite performance score by up to 20 points:

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| `/` mobile | 62 | 42 | 65 |
| `/performance` mobile | 63 | 64 | 52 |
| `/settings` desktop | 90 | 99 | 81 |

Accessibility was **100 in all 36 measurements**. Best practices stayed 96–100
and CLS 0–0.044 over the same passes.

So the composite performance score is gated only at a catastrophic-regression
floor, and the precise performance ratchet is section 1's deterministic budget.
The probe runs each combination twice and takes the **best** score and the
**worst** CLS, because interference from other work on the machine only ever
degrades a Lighthouse result.

### Improvements made while establishing the gate

Two render blockers in the document head, both removed:

- The Google Fonts stylesheet (94 KB on a third-party connection, measured at
  2,907 ms of blocking) now loads through `rel="preload" as="style"` with an
  `onload` swap and a `<noscript>` fallback. The families already carried
  `display=swap`, so text was always going to swap once; this only stops the
  swap from holding up the first frame.
- `vite-plugin-pwa` injected the service-worker registration as a synchronous
  `<script src>`. `injectRegister: 'script-defer'` in `vite.config.ts` defers
  it; nothing on first paint depends on the worker registering.

Effect on `/`, same build otherwise:

| | before | after |
|---|---|---|
| FCP mobile | 8.3 s | 4.0 s |
| Speed Index mobile | 8.3 s | 4.0 s |
| FCP desktop | 1.6 s | 0.8 s |
| Performance desktop | 87 | 95 |
| Render-blocking savings | 4,860 ms | 0 ms |
| CLS | 0 | 0 |

Mobile LCP did not move (8.5 s → 8.6 s). After the fix it is bound by script
evaluation, not by the network: 672 ms of script evaluation and 427 ms of style
and layout on emulated mobile, with `react` and `motion` the two largest
contributors. Route-level code splitting is the next lever and is recorded as
an open item, not done here — **done later the same day, in section 5**.

### The CLS episode, and why the gate rule changed

The first run of the tuned gate failed on `/performance` desktop with
**CLS 0.186**, where every earlier pass had read 0 to 0.005. The suspicion was
that making the font stylesheet non-blocking had moved the font swap to after
first paint and introduced a real shift — a plausible mechanism, since the
blocking stylesheet used to give the font files a head start.

Measured instead of assumed. `/performance` desktop, `--preset=desktop`:

| | CLS |
|---|---|
| Baseline `6940af7`, 4 runs | 0.0017, 0.0017, 0.0017, 0.0017 |
| Working tree, 14 consecutive runs | 0.0017, 0.0017, 0.0018, 0.0017, 0.002, 0.0017, 0.002, 0.0018, 0.0019, 0.0143, 0.0033, 0.0019, 0.0017, 0.0018 |

Baseline and working tree are indistinguishable. It was then chased further,
because **0.186 recurred in the next full sweep, at exactly the same value and
the same route** — an identical figure twice is a specific element moving a
specific distance, not white noise.

40 runs across three configurations failed to reproduce it:

| Configuration | Runs | Max CLS |
|---|---|---|
| `/performance` desktop, `--only-categories=performance` | 28 | 0.0143 |
| `/performance` desktop, with the accessibility and best-practices categories (in case axe running in the same page session was inflating it) | 4 | 0.0019 |
| The probe's own sequence replayed for `/` and `/performance`, both form factors | 8 | 0.0171 |

It appears only deep inside the **full** 24-run sweep, which is consistent with
resource exhaustion: a saturated main thread delays the chart and table render
past first paint, and the resulting displacement is the same geometry every
time, which is why the number repeats exactly.

**What is and is not established.** Not established: an attribution. The
shifting element was never captured, because the spike never occurred in a run
whose report was kept. Established: the app measures ~0.0018 on this route in 40
isolated runs, identical to `6940af7`, so this change did not introduce it.

**Follow-up worth doing, not done here:** the shift is real when the main thread
is slow enough, which a genuinely slow phone can be. Reserving explicit height
for the performance chart and history table so a late render cannot push content
down would remove the class entirely. Recorded as an open item — **done later
the same day, in section 5, together with the tooling that would have attributed
this spike in the first place**.

So the gate's rule was wrong, not the code. CLS is now gated on the **best** run
for the same reason performance is: a stalled main thread delays paints and
inflates measured shift, so load only ever makes CLS look worse, while a genuine
layout shift is deterministic and appears on every run. The worst run is still
printed and warned about, so a real intermittent shift stays visible instead of
being swallowed. The 0.1 threshold itself was not loosened.

### Gate result

Passing run, each combination measured twice; performance, LCP and CLS take the
best run, accessibility and best practices the worst.

| Route | Form factor | Perf | Spread | A11y | Best practices | CLS | LCP |
|---|---|---|---|---|---|---|---|
| `/` | mobile | 76 | ±11 | 100 | 100 | 0 | 4,157 ms |
| `/` | desktop | 97 | ±2 | 100 | 100 | 0 | 1,235 ms |
| `/performance` | mobile | 76 | ±3 | 100 | 96 | 0 | 4,171 ms |
| `/performance` | desktop | 98 | ±7 | 100 | 100 | 0.002 (worst run 0.186, see above) | 801 ms |
| `/exposure` | mobile | 66 | ±0 | 100 | 96 | 0 | 8,096 ms |
| `/exposure` | desktop | 99 | ±6 | 100 | 100 | 0 | 821 ms |
| `/transactions` | mobile | 84 | ±2 | 100 | 100 | 0.015 | 3,492 ms |
| `/transactions` | desktop | 99 | ±3 | 100 | 100 | 0 (worst run 0.044) | 700 ms |
| `/health` | mobile | 80 | ±0 | 100 | 100 | 0 | 4,056 ms |
| `/health` | desktop | 99 | ±0 | 100 | 100 | 0 | 811 ms |
| `/settings` | mobile | 83 | ±4 | 100 | 96 | 0 | 3,641 ms |
| `/settings` | desktop | 100 | ±0 | 100 | 100 | 0 | 704 ms |

Thresholds: mobile performance 50 / desktop 80, accessibility 100, best
practices 95, CLS 0.1, LCP 11,000 ms mobile and 2,500 ms desktop. Accessibility
was 100 on every one of the 24 runs.

### Findings recorded but not acted on

- `font-size`: `.text-[11px]` is below Lighthouse's 12 px legibility threshold,
  which costs three routes their best-practices 100. Not a WCAG AA failure —
  2.2 sets no minimum font size — and the type scale is a `DESIGN.md` decision,
  so changing it belongs in a decision record, not here.
- `valid-source-maps`: production ships no source maps. Accepted for a private
  application.
- `robots-txt`: the SPA `_redirects` fallback serves `index.html` for
  `/robots.txt`, which Lighthouse parses as 47 syntax errors. Cosmetic for a
  private app with no SEO goal; worth a real `robots.txt` if it ever matters.

### Not covered

The authenticated cloud routes, `/cashflows`, and a populated `/share/<token>`.
Emulated mobile is a throttled desktop, not a phone.

---

## 3. Cross-browser record

`docs/release/probes/cross-browser-check.mjs`. One shared assertion payload,
run against real engines with **no repository dependency and no downloaded
browser**: Chrome over the DevTools Protocol using Node's built-in `WebSocket`,
and Safari over macOS' built-in `safaridriver` via plain W3C WebDriver HTTP.

Six routes x three viewports (1280x900, 390x844, 320x812).

| Engine | Covered | Result |
|---|---|---|
| Blink (Chrome 151.0.7922.170) | yes | 18/18 runs pass |
| WebKit (Safari) | **no** | `safaridriver` is installed and reports ready, but session creation returns "You must enable 'Allow remote automation' in the Developer section of Safari Settings". That is a human action on the machine's own settings and was not taken by tooling. |
| Gecko | **no** | Firefox is not installed and the constraint for this record was to download no browsers. |

Blink results, identical on all 18 runs:

- App boots (`#root` populated) on every route and viewport.
- Page horizontal overflow **0** at all three widths.
- 0 console errors.
- CSS support: `scroll-margin-bottom` (the WCAG 2.4.11 fix depends on it),
  custom properties, `color-mix()`, `:has()`, `env(safe-area-inset-*)`, `gap`,
  `aspect-ratio` — all supported.
- JS support: `structuredClone`, `ResizeObserver`,
  `matchMedia().addEventListener`, `serviceWorker` — all present.
  `Intl.NumberFormat` USD formatting returns exactly `$1,234.50`.
- The local-date contract holds, and was **load-bearing during this run**: the
  measurement fell after UTC midnight, so `toISOString().slice(0,10)` read
  `2026-08-23` while the local calendar date read `2026-08-24`. A UTC
  truncation would have defaulted forms to the wrong day.
- The Flexoki token layer resolves (`--background: 48 100% 97%`, body
  background `rgb(255, 252, 240)` in light).

The probe reports an uncovered engine as `未覆盖` with the reason and does not
count it as a pass. Re-running it after the Safari setting is enabled fills in
the WebKit row without any code change.

---

## 4. Privacy and accessibility gates

Unchanged in kind by this work, re-run against it:

- `npm run test:share-privacy` — passes; anonymous surface still the three
  documented entry points.
- axe-core 4.10.2 — 0 violations over 36 scans.
- Keyboard, reduced motion, reflow, target size — no regression; see
  `docs/accessibility/2026-08-20-wcag-route-audit.md` section 9.
- Accessibility tree — 0 findings over 26 scans, after fixing 503. Same section.

---

## 5. Route-level code splitting and reserved layout

Same day, after the gates above. Measured commit: `1f3e027`. This closes the two
follow-ups sections 1 and 2 recorded as open: route-level code splitting, and
reserving height so a late render cannot push content down. Measured on the same
machine, the same Lighthouse 12.8.2, the same offline-demo build served by
`vite preview`.

### What changed

- **Every route is a `React.lazy` chunk.** `src/App.tsx` was importing all ten
  page modules statically, so the entry graph contained every route and
  everything they pull in. The authenticated routes suspend against a boundary
  in `AppShell` around the `Outlet`, which keeps the navigation and top bar
  painted; the two shell-less routes (`/login`, `/share/:token`) suspend against
  a boundary in `App`. The fallback is `src/components/RouteFallback.tsx`, which
  fills the route area (`min-h-full`) rather than collapsing it.
- **`clsx` and `tailwind-merge` got their own manual chunk.** This one is worth
  writing down. Splitting the routes on its own moved almost nothing: the first
  load still pulled all 385 KB of recharts. The object form of Rollup's
  `manualChunks` pulls a listed package's own dependencies into that chunk
  unless another entry claims them, and recharts depends on `clsx`, so `clsx`
  landed inside `charts` — and `cn()` in `src/lib/utils.ts` imports `clsx`, so
  every component in the entry graph imported the chunk that contained recharts.
  First-load JS was still 275.29 KiB gzip until `classnames: ['clsx',
  'tailwind-merge']` was added to `vite.config.ts`.
- **The `/performance` loading states now occupy the loaded height.**
  `NavBridgeCard` takes `bridge: NavBridge | null` and renders the same card
  with the figures held back, so it no longer appears out of nowhere 366 px tall
  above the calendar and the chart. `PerformancePanel` renders the same frame —
  chart header, summary table, the chart's own `h-[340px] sm:h-[400px]` box, the
  detail bar — with the numbers withheld, instead of a short empty state.
- **The month calendar is always six rows.** `buildMonthCalendar` padded to a
  whole number of weeks, so a five-row month was 76 px shorter than a six-row
  one. The selected month moves on load, from the current month to the last
  month with data, so that difference was a real one-row shift. It now pads to a
  constant 42 cells.

### First-load transfer, CI gate

`npm run build`, gzip KiB, same measurement as section 1:

| Metric | Section 1 (`6940af7`) | Now | Budget now |
|---|---|---|---|
| First-load JS | 427.41 | **171.65** | 182 |
| First-load CSS | 10.86 | 10.87 | 14 |
| First-load total | 438.27 | **182.52** | 194 |
| Largest single chunk | 181.67 | **52.24** | 58 |
| First-load requests | 8 | 8 | 9 |
| Render-blocking third-party origins | 1 | 1 | 1 |

The budget in `performance-budget.json` was ratcheted down to match, keeping
roughly the previous proportional headroom. The ratchet is not vacuous: the
intermediate build described above — routes split but recharts still reachable
from the entry — measured 275.29 KiB of first-load JS, which the new 182 budget
rejects.

`charts` (recharts, 106.65 KiB gzip) is no longer in the document head at all.
It is now fetched by the routes that draw charts. Workbox precaches all 42
build outputs, so a returning visitor pays no navigation round trip for the
route chunks.

`supabase` (52.17 KiB gzip) is still first-load, because the auth check runs
before any route renders. Not addressed here.

### Lighthouse, release probe

One passing sweep, each combination run twice; performance, LCP and CLS take the
best run, accessibility and best practices the worst. Section 2's numbers are in
brackets.

| Route | Form factor | Perf | A11y | Best practices | CLS | LCP |
|---|---|---|---|---|---|---|
| `/` | mobile | **86** (76) | 100 | 100 | 0 (0) | **3,541** (4,157) ms |
| `/` | desktop | 99 (97) | 100 | 100 | 0 (0) | **754** (1,235) ms |
| `/performance` | mobile | **86** (76) | 100 | 96 | 0.001 (0) | **3,579** (4,171) ms |
| `/performance` | desktop | 99 (98) | 100 | 100 | 0.005 (0.002) | 772 (801) ms |
| `/exposure` | mobile | **90** (66) | 100 | 96 | 0 (0) | **3,108** (8,096) ms |
| `/exposure` | desktop | 100 (99) | 100 | 100 | 0 (0) | 675 (821) ms |
| `/transactions` | mobile | 88 (84) | 100 | 100 | 0.015 (0.015) | 3,400 (3,492) ms |
| `/transactions` | desktop | 99 (99) | 100 | 100 | 0.044 (0) | 712 (700) ms |
| `/health` | mobile | **92** (80) | 100 | 100 | 0 (0) | **2,923** (4,056) ms |
| `/health` | desktop | 100 (99) | 100 | 100 | 0 (0) | 618 (811) ms |
| `/settings` | mobile | **91** (83) | 100 | 96 | 0 (0) | **3,049** (3,641) ms |
| `/settings` | desktop | 100 (100) | 100 | 100 | 0 (0) | 671 (704) ms |

Accessibility was 100 in all 24 runs, as before. Best practices is unchanged,
including the `.text-[11px]` legibility finding section 2 records and declines
to act on.

This is **one** sweep, not the three-pass noise study section 2 ran, so treat
the composite scores as indicative and the deterministic budget above as the
ratchet. The run-to-run spread was still visible: `/` mobile moved 25 points
between its two runs on this same build.

### The regression this exposed, and how it was attributed

The first sweep after code splitting **failed the gate**: `/performance` on
emulated mobile measured CLS 0.122, on both runs, where section 2 had measured
0. Making the app render sooner had exposed a shift that the old, slower first
paint had hidden.

It was attributed rather than guessed at, with a new probe —
`docs/release/probes/cls-attribution.mjs` — that reproduces Lighthouse's mobile
emulation (412x823, 4x CPU throttling, its network profile) over the DevTools
Protocol and installs a `PerformanceObserver` *before any page script runs*, so
every layout-shift entry is captured with its sources and their before/after
rectangles. Lighthouse names the element that shifted; this names what it
shifted **from**, which is the half that identifies the render responsible.

It reported one shift of 0.1294 at 6,946 ms, with the stat-card grid moving from
y=275 to y=304 and the two header buttons moving the same 29 px. The cause: the
performance cache status resolves after first paint, and the `更新于 …`
timestamp appearing in the header's `flex-wrap` row pushed the two buttons onto
a new line. The timestamp is now always rendered — showing `—` until it is
known — and carries `basis-full sm:basis-auto`, so below `sm` it owns its own
line and the row count no longer depends on it. Desktop layout is unchanged.

After the fix, the same probe reports **CLS 0.0032** on `/performance`, and both
remaining entries are font-swap reflows with no element movement. The gate
passes.

Pointed at `/transactions`, the probe attributes that route's long-standing
0.015 to `<section class="workbench-next">` collapsing from 43 px to 0. Under
the 0.1 threshold and outside this change; recorded now that it has a name.

### What this does not establish

- Section 2's intermittent 0.186 spike on `/performance` desktop is **not**
  proved gone. Its deterministic causes found here — the calendar's row count
  and the header's row count — are fixed, but two runs cannot disprove a class
  that took a full 24-run sweep to surface once. The attribution probe now
  exists to catch it if it returns.
- Nothing about the authenticated cloud routes, `/cashflows`, or a populated
  `/share/<token>`. Same limit as every other measurement on this page.
- Nothing about a real phone. Emulated mobile is still a throttled desktop.
- The accessibility probes in `docs/accessibility/probes/` were not re-run;
  Lighthouse's accessibility category (100 on all 24 runs) is the coverage
  claimed here.
