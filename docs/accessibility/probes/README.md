# Accessibility probes

Four `playwright-cli` snippets that produced the evidence in
`docs/accessibility/2026-08-20-wcag-route-audit.md`. They are **not** part of
`npm test`: the repository deliberately carries no Playwright or axe-core
dependency, so these run from the npx cache against a local dev server.

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
