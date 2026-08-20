# Wealthfolio UI teardown and mapping

Reference: Wealthfolio `v3.6.2` (Apple Silicon DMG, hash recorded in
`docs/research/competitive/2026-08/sources.md`). Direction and boundaries:
`docs/decisions/2026-08-20-wealthfolio-ui-alignment.md`.

## Method

Two evidence channels, both read-only:

- **Measured values** read as facts out of the official source archive
  (`apps/frontend/src/globals.css`, `packages/ui/src/styles.css`). Numbers and
  color values are facts; no text from those files is copied into this
  repository, and everything here is reimplemented from scratch.
- **Composition and interaction** read from the 2026-08-18 synthetic run
  captures (`wealthfolio-t02-review-activities`, `t06-holdings`,
  `t07-performance`, `t03-*`), all produced with synthetic data.

The Overview tab was captured live on 2026-08-20 (window-only capture of the
running app, after dismissing its update prompt with Escape — the pinned study
version was not upgraded). The settings surfaces are still uncaptured, so any
future mapping for them stays inference.

## 1. Token layer

| Token | Wealthfolio | Ours today | Action |
|---|---|---|---|
| Palette | Flexoki (MIT, Steph Ango) | hand-rolled cool gray + brand red | adopt Flexoki upstream, with attribution |
| Light surface / raised | `48 100% 97%` / `51 59% 95%` | `220 20% 97%` / `0 0% 100%` | replace — warm paper, and the card is lighter-warm, not white |
| Light text / muted | `0 3% 6%` / `50 3% 42%` | `222 28% 13%` / `220 10% 42%` | replace |
| Light border | `51 21% 88%` | `220 15% 86%` | replace |
| Dark surface / raised | `0 3% 6%` / `30 4% 11%` | `222 18% 7%` / `222 16% 10%` | replace — warm near-black, not blue-black |
| Dark text / muted | `55 10% 79%` / `43 3% 52%` | `220 22% 93%` / `220 10% 66%` | replace |
| Red / green / yellow (light) | `3 62% 42%` / `73 84% 27%` / `45 99% 34%` | `5 72% 46%` / `158 62% 30%` / `32 90% 44%` | replace; their green is olive, not teal |
| Red / green / yellow (dark) | `5 61% 54%` / `72 46% 41%` / `45 82% 45%` | `6 90% 68%` / `156 70% 52%` / `40 94% 64%` | replace |
| Primary action | `--primary` is the text color: near-black fill, paper-colored label | brand red | replace — actions are ink, not brand color |
| Chart series | `#355c4c` forest, `#7e9f8c` sage, `#cbba8c` sand, `#c08a5f` clay, `#9a7e92` plum, `#b1aa9a` stone, then three UI greys | brand red + benchmark grey | replace with the six-hue muted set |
| Radius | `--radius: 0.625rem` (10px); sm 6 / md 8 / lg 10 / xl 14 | flat `0.5rem` | adopt the derived scale |
| Base font size | `0.875rem` (14px) | browser default | adopt a 14px base |
| Sans | Inter Variable | Hanken Grotesk | switch to Inter, keep the CJK fallback chain |
| Mono | JetBrains Mono | JetBrains Mono | already aligned |
| Serif | Merriweather, barely used | Fraunces, used for hero figures | drop the serif figure treatment |
| Input height | 44px (`h-11`) | 40px | adopt 44 |
| Button height | 40 / 36 / 44 (default / sm / lg) | 40 / 32 / 44 | adopt 36 for `sm` |
| Card padding | 16px | mixed 16–20px | standardize on 16 |
| Sidebar width | 200px expanded, 70px collapsed | 224px / 64px | adopt 200 / 70 |

Accessibility override: several Flexoki-on-Flexoki pairs sit near the 4.5:1
floor. Every adopted pair is re-checked with the axe probe before it ships;
where one fails, the accessible neighbour in the same Flexoki ramp is used and
the divergence is recorded here.

## 2. Pattern inventory

### Shell

- Icon-only left rail, no labels, ~56–70px, with pinned top and bottom groups;
  the window is a rounded container and content sits on an inset card.
- No page-level `h1` banner. Page identity comes from a **pill tab group** at
  the top left (icon + label per tab; the selected tab is a raised light pill).
- The same row carries scope controls on the right: account selector, kebab
  overflow, or a range segmented control.
- A second toolbar row carries search, filter chips and entity chips.

Ours today: a 200px labelled sidebar, a mobile bottom nav, and a large serif
page title inside every route. The title block goes away and routes become
tabs.

### Data tables (holdings, activities)

- Tinted header band, no vertical rules, hairline row separators only.
- Row height ~58px with a two-line identity cell: rounded square ticker avatar,
  bold ticker plus a small badge, muted full name underneath.
- **Two-line numeric cells** — value on top in mono, unit or percentage in
  small muted mono underneath, right-aligned.
- Trailing kebab per row for row actions; sortable headers with carets and a
  `Columns` chooser.
- Filters read `⊕ Type`, `⊕ Symbol`, … — an add-a-filter affordance rather than
  a labelled dropdown.

Ours today: compact rows, single-line numerics, inline pencil/trash buttons, no
column chooser, no filter chips.

### Import wizard

- Full-screen takeover with its own header (title, help link, `× Cancel`), not
  a dialog.
- Numbered stepper with connectors; completed steps are filled circles with a
  check: Upload → Mapping → Review Assets → Review Activities → Import.
- Problem banner as a tinted card: icon, bold count headline, one explanatory
  line, and a count chip.
- Row-level review table with per-row status and inline fixing; footer bar with
  a ghost back button and a filled forward action.

Ours today: one dialog with an inline preview, the four-number receipt, and the
event-composition strip. The receipt semantics already match; the staging, the
takeover layout, and per-row fixing do not.

### Performance and KPI presentation

- KPI clusters grouped under uppercase micro-labels (`RETURNS`, `RISK`,
  `TOTAL`) separated by vertical hairlines; each metric is a tiny label plus a
  large mono figure colored by sign.
- Range control as a nine-stop segmented pill (`1W 1M 3M 6M YTD 1Y 3Y 5Y ALL`)
  plus a calendar icon for a custom range.
- Comparison entities as removable chips with a leading color bar, beside
  `Add account` / `Add benchmark` chips.
- Charts: horizontal gridlines only, mono axis labels, a small square legend
  centered below.

Ours today: a `StatCard` grid, a six-stop range control, a single benchmark
toggle, and the NAV bridge card. The bridge card stays — it has no Wealthfolio
counterpart and it is what the calculation work bought us.

## 3. Delivery order

Each phase ships on its own branch with the CI-equivalent set plus the
accessibility probes, and updates this document with what actually landed.

1. **Token layer + shell** — Flexoki tokens, type/radius/height scales, icon
   rail, pill tab groups, toolbar row. Every route inherits the new surface at
   once, so this is the largest single visual jump.
   - **1a landed 2026-08-20**: the palette, the 10px radius scale, the 14px
     base size, Inter in place of Hanken Grotesk, and chart series tokens.
     Actions are ink (`--brand` = Flexoki black / base-200) instead of brand
     red, and the three chart strokes that borrowed `--brand` now use
     `--chart-1`. axe reports zero violations across eight routes x
     desktop/390px x light/dark (32 scans).
   - **1b landed 2026-08-20**: the labelled sidebar became a 70px icon rail
     (200px when expanded, which is now the opt-in state), page identity moved
     from per-route banners into a pill tab group in the toolbar row, and the
     route name survives as a single `sr-only` `h1` in the shell.
     The rail switches sections (分析 / 账本 / 维护) and the tabs switch views
     inside one, so the two never repeat a name. Every route's banner block is
     replaced by a `workbench-lede` line plus its actions.
     Re-verified: axe 0 violations over 32 scans, every Tab stop interactive
     with a visible ring on all five private routes, reduced motion still
     opacity-only (the 2px settle measured on `/exposure` is data arriving —
     nothing changes at all between 2.5s and 7.5s), 0 page overflow at 390px
     and 320px, and no interactive target under 24x24.

### AA divergences from the reference values (1a)

Flexoki's own pairs miss the 4.5:1 text floor on our surfaces in four places;
each takes the next step in the same Flexoki ramp:

| Role | Reference value | Measured | Shipped instead |
|---|---|---|---|
| muted text, light | base-600 on base-50 card | 4.47 | base-700 (`45 2% 33%`) |
| muted text, dark | base-500 on base-900 | 4.15 | base-400 (`47 4% 61%`) |
| gain text, light | green-600 on card | 3.95 | green-800 ink (`73 83% 16%`) |
| loss text, dark | red-400 on card | 3.95 | red-200 ink (`9 89% 76%`) |

Vivid fills, gauge arcs and chart strokes keep the reference 600/400 steps; only
text resolves to the ink step. The focus ring is ink rather than Flexoki's
base-200, which would not have been visible enough against the paper surface.
2. **Ledger tables** — `/transactions`, `/transactions/all`: row anatomy,
   two-line numeric cells, filter chips, row overflow menu, column chooser.
   - **landed 2026-08-20**: the row list became a real table with a tinted
     header band, hairline separators and no vertical rules; each row opens
     with a rounded ticker mark, the ticker and its strategy line; quantity,
     price and cash effect render as value-over-unit cells; row actions moved
     from inline pencil/trash buttons into a trailing overflow menu; the date,
     ticker and cash-effect headers sort; a column chooser hides 事件 / 数量 /
     价格 and reveals the opt-in 备注 column.
     `/transactions/all` replaced its segmented filter with add-a-filter chips
     (类型 / 策略 / 标的, multi-select, with a clear-all) beside the search box.
     Ordering moved into the pure `src/lib/ledgerSort.ts` and is owned by the
     paginated page, so a header click reorders all 726 rows rather than the
     50 on screen — verified by keyboard: ascending date reaches 2016.
     A new `src/components/ui/dropdown-menu.tsx` backs the row menu, the
     chooser and the chips; each opens on Enter, highlights its first item and
     returns focus to its trigger on Escape.
     Re-verified: axe 0 violations over 32 scans, 0 overflow at 390px and
     320px, no target under 24x24, reduced motion unchanged.
3. **Import** — takeover layout, stepper, banner, per-row review and fixing on
   top of the existing preview and receipt contract.
   - **landed 2026-08-20**: the preview dialog became a full-screen takeover
     with its own header, a labelled `取消` close, a numbered stepper
     (上传 → 方式 → 证券 → 逐行核对 → 导入; the 证券 step only exists when the
     file carries symbols) and a sticky footer with 上一步 / 重新选择 /
     下一步 · 确认并导入. The review step opens with a problem banner that
     counts the rows needing attention and reports importable-versus-total,
     which reproduces the reference's "13 of 14 rows are valid" semantics on
     our own fixture. The destructive-scope confirmation moved onto the commit
     step, immediately before the write.
     Walked with the synthetic TradingView fixture: upload auto-advances,
     每 step renders, 上一步 steps rather than closing, Escape closes and
     returns focus to the 导入预览 button.
     Audited with the takeover open on the review step: axe 0 violations at
     desktop light/dark and 390px, focus never escapes the takeover across 30
     Tab presses, and 0 page overflow at 390px. Two scroll containers that had
     no keyboard path (the takeover body and the per-row result list) are now
     focusable named regions.
   - **still open**: per-row inline fixing. The reference lets a reader repair
     a bad row in place; here a blocked row still keeps its reason and has to
     be fixed in the source file. That is a real feature, not a restyle, and
     it touches what gets written, so it stays a separate slice.
4. **Overview** — **landed 2026-08-20**, against the live capture.
   What the capture showed: pill tabs top-left with small icon actions
   top-right; one hero figure whose cents are muted, and under it a single
   inline line of absolute change, percent change and the period label; a
   full-bleed area curve with no axes, no gridlines and a fill that fades out;
   a centered range selector under the curve; then a two-column section grid,
   accounts on the left, holdings and goals stacked on the right, each section
   introduced by a small title row with a trailing `View All ›`.
   What shipped here: the four-up metric strip became a hero figure with muted
   cents; the change line reads over the selected range (`+34.34% 近 1 年`,
   `-1.68% 近 3 个月`) instead of a fixed day-over-day number; the chart left
   its card and became a full-bleed area with no grid and no axes, with a
   centered range selector under it; the grid is now holdings on the left with
   summary, ledger state and target progress stacked on the right. The three
   secondary figures (今日盈亏 / 总收益 / 现金余额) moved into that stack
   rather than being dropped.
   Divergence: the curve respects the page padding instead of bleeding past
   it, which keeps the narrow layouts intact.
   Re-verified: axe 0 violations over 32 scans, 0 overflow at 390px and 320px,
   no target under 24x24, every Tab stop interactive with a visible ring.

Out of scope throughout: multi-account scoping, budgeting and liabilities, the
add-on marketplace, and anything else on the product reject list. Where a
Wealthfolio surface exists only to serve those, it is not ported.
