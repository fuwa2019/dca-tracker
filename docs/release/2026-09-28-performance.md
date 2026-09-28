# 2026-09-28 performance layout release

Scope: private performance page, frontend only. Owner authorized commit and
production release after reviewing the local implementation and requesting
smooth curves. No database migrations, Worker changes or private-data reads.

- Calendar leads the page; amount and daily TWR share a cell with pale gain/loss
  backgrounds. Date selection shows full values on desktop and mobile.
- Monthly totals remain unavailable when any required input is missing.
- Curve metrics use the same rebased series endpoint as the chart. Existing
  historical calculation and range boundaries are preserved.
- Portfolio and benchmark use monotone interpolation; underlying values remain
  unchanged. Explanations and ledger breakdown are collapsed below the chart.
- Finance, email-reminder, quote-status, share-privacy, typecheck, UI/calendar,
  offline build and release budget passed. Total first-load gzip: 182.31 KiB.
- Normal local build fails because public VITE configuration is absent;
  production uses the configured Pages Git build. Offline dist is not uploaded.
- Browser inspection: desktop and 390px mobile layout; no horizontal overflow;
  month switching, date details and All/1Y changes verified with bundled data.
- Blink compatibility passed 18 runs. Safari driver and Firefox unavailable.

## Browser gates

- Lighthouse, two runs per route/form factor: performance page mobile 84,
  desktop 100; accessibility 100 both; best practices 96/100; CLS rounds to
  0.000 both; LCP 3745/680 ms. All modified-route thresholds passed.
- Full gate fails only on unchanged settings desktop CLS 0.358. Same issue
  was reproduced on bc274b3 for the earlier overview release. It is not hidden
  or counted as passed; this frontend scope does not modify settings.
- Accessibility-tree audit passed. Live authenticated production data and
  actual VoiceOver/NVDA behavior are not covered.
- Existing GitHub CI production build configuration issue remains; Pages
  builds independently with its configured public VITE environment.

## Deployment

Pending Pages Git build and public asset verification.
