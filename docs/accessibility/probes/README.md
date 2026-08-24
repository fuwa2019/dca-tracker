# Accessibility probes

Five probes that produced the evidence in
`docs/accessibility/2026-08-20-wcag-route-audit.md`. They are **not** part of
`npm test`: the repository deliberately carries no Playwright, axe-core or
browser dependency.

Four are `playwright-cli` snippets run from the npx cache against a local dev
server. The fifth, `ax-tree-audit.mjs`, is a plain Node script that drives the
system Chrome over the DevTools Protocol with Node's built-in `WebSocket` — no
npx package and no downloaded browser at all.

## Prerequisites

```bash
npm run dev:local -- --port 5174 --strictPort
```

The login route needs a non-local build. Start a second server with stub
Supabase credentials so no real project is contacted:

```bash
VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=stub-anon-key npm run dev -- --port 5175 --strictPort
```

`axe-route-scan.mjs` loads axe-core from the dev server, so copy the library
into `public/` for the run and delete it afterwards (it must never be
committed):

```bash
npm pack axe-core@4.10.2 && tar xzf axe-core-4.10.2.tgz && cp package/axe.min.js public/axe-audit-tmp.js
```

## Running

```bash
npx --yes --package @playwright/cli playwright-cli open about:blank
npx --yes --package @playwright/cli playwright-cli run-code --filename docs/accessibility/probes/axe-route-scan.mjs --raw
```

Each probe returns a JSON string. Run them from a scratch directory: the CLI
writes snapshots into `.playwright-cli/` next to the working directory.

## What each probe asserts

- `route-keyboard-motion-narrow.mjs` — forward/reverse Tab per route, whether
  every stop is interactive and shows a focus ring, plus 390px page overflow.
- `reduced-motion-classification.mjs` — samples animated values twice after a
  remount and classifies what changed (opacity vs transform vs position vs
  `stroke-dashoffset` vs width) with and without reduced-motion emulation.
- `axe-route-scan.mjs` — axe-core over every route at desktop and 390px, in
  light and dark.
- `reflow-and-target-size.mjs` — 320px reflow overflow and any interactive
  target smaller than 24x24 CSS px.
- `ax-tree-audit.mjs` — the accessibility tree a screen reader actually
  consumes: every interactive node has a name, the heading outline has one h1
  and no skipped level, `main` appears exactly once and repeated landmarks are
  named, nothing focusable sits inside an `aria-hidden` subtree, data tables
  have names and column headers, and no image is both exposed and unnamed.

## Running `ax-tree-audit.mjs`

It needs no playwright-cli and no `public/` copy. Point it at any server:

```bash
node docs/accessibility/probes/ax-tree-audit.mjs
```

It defaults to `http://127.0.0.1:5174`; set `PROBE_ORIGIN` to audit a
production-mode build instead (which is how the 2026-08-24 run was done).

**What it does not prove.** It does not run VoiceOver, NVDA or JAWS and it does
not listen to speech. Announcement order under a real AT, live-region timing,
braille output, rotor behaviour and gesture navigation stay unproved, as do the
cloud-only routes.
