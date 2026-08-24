# Release gates

`docs/research/competitive/2026-08/requirements-audit.md` carried
**"Performance/Lighthouse/compatibility gates"** as the last fully `missing`
contract row. This directory is what closes it: a deterministic budget that
runs in CI, two browser probes that run before a release, and the checklist
that ties them to an actual deploy.

| Gate | Where it runs | What it proves |
|---|---|---|
| First-load transfer budget | CI, `npm run test:release-budget` | The bundle did not get heavier and no new render-blocking third-party origin appeared |
| Lighthouse thresholds | Local probe, `docs/release/probes/lighthouse-budget.mjs` | Field performance, accessibility and best-practices scores per route and form factor |
| Cross-browser record | Local probe, `docs/release/probes/cross-browser-check.mjs` | The app boots, does not overflow, and its CSS/JS/date contracts hold on each covered engine |
| Public-share privacy | CI, `npm run test:share-privacy` | The anonymous surface did not widen |
| Accessibility | Local probes, `docs/accessibility/probes/` | axe, keyboard, reduced motion, reflow, target size, focus-not-obscured |

Numbers and their limits are recorded, dated, in
`docs/release/2026-08-24-release-gates.md`. Budgets and thresholds live in
`docs/release/performance-budget.json`.

## Why only one of them is in CI

The budget gate reads built files and is exact, so it belongs in CI. Lighthouse
and the cross-browser record need a real browser, take minutes, and their
composite scores move run to run — putting them in CI would buy flaky builds,
not confidence. They are release-time probes with a written record, the same
arrangement the accessibility probes already use.

## What these gates do not cover

- The authenticated cloud routes, `/cashflows`, and a populated
  `/share/<token>`. Both probes measure a production-mode build of the offline
  demo (`VITE_LOCAL_MODE=1`) so no Supabase project is contacted.
- Gecko. Firefox is not installed on the development machine and the constraint
  for this record was to download no browsers.
- Real-network and real-device performance. Lighthouse's emulated mobile is a
  throttled desktop, not a phone.

## Release checklist

Run in order. Nothing here grants deployment authority — see
`docs/runbooks/deployment.md`, and get explicit authorization for the deploy
itself.

1. `git status --short --branch` is clean and on the intended branch.
2. `npm ci` (root, `workers/quote`, `workers/email-cron`).
3. CI-equivalent set: `test:finance`, `test:email-reminder`, `test:quote-status`,
   `test:share-privacy`, `typecheck`, `build`.
4. `npm run test:release-budget` against the `dist/` that step 3 produced.
5. Scoped checks for whatever the change actually touched (`test:ui`,
   `test:portfolio-import`, `test:csv-import`, `test:migration-numbering`,
   `test:etf-holdings`, `test:symbols`, `test:nyse-calendar-sync`).
6. If the change is user visible: the Lighthouse probe and the cross-browser
   probe, and the accessibility probes in `docs/accessibility/probes/`.
   Update the dated record with the new numbers.
7. If the change includes a migration: apply order, rollback story, and
   `test:migration-numbering`. Production application is a separately
   authorized operation.
8. `git diff --check`, then review the full diff.
9. Deploy only with explicit authorization for that exact operation.
10. Post-deploy, always with a cache-busting query parameter — the Pages edge
    can serve a cached `index.html` naming the previous bundle for a few
    minutes: the served bundle contains a string only the new build has, every
    named route returns 200, and the login route renders with no console
    output (which is how you know the Pages build injected the public `VITE_`
    values).
11. Record the release in `HANDOFF.md` under "Verified production state":
    commit, bundle and stylesheet names, what was checked, and what was not.
    Keep it to current state — the chronological history belongs in
    `docs/archive/ai/`.
