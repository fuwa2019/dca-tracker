# 2026-10-06 mobile layout release

Scope: SPA frontend only. No database migration, Worker deploy, secret, or KV
change.

## Change

Code commit `9121fd6`, from an iPhone 15 Pro review (393×852pt, standalone
PWA with a 59pt top / 34pt bottom safe area).

- `tailwind.config.ts` had no `popover` color, so `bg-popover` emitted no CSS
  and every chart tooltip, Select, and DropdownMenu rendered fully transparent
  (on desktop too). The color is now defined.
- Phones: analysis route tabs that repeat the bottom nav are hidden, the
  bottom nav sits on the home-indicator safe area, and the scroll port pads
  for it. Header height under the Dynamic Island dropped from 148pt to 116pt.
- Performance period returns no longer collide; the Y axis width follows its
  labels and uses integer percent above 100%.
- Exposure shows every ETF snapshot date on phones instead of a source count.
- Overview leads with the primary action and hides the duplicated footer
  actions on phones; ledger rows wrap instead of truncating the trade price.

The status bar style stays `black-translucent` by decision: in the light theme
the white clock and battery remain low contrast in the standalone PWA. A
light-theme top scrim was mocked and declined.

## Verification

- Finance, email-reminder, quote-status, share-privacy, UI, typecheck, offline
  build, and first-load budget checks passed. The production `build` was not
  run locally because the public `VITE_` values are injected only by Pages.
- Playwright (system Chrome, `iPhone 15 Pro` descriptor, simulated safe areas)
  on the offline demo: no horizontal overflow on overview, performance,
  exposure, ledger, and settings; Y-axis labels start inside the chart;
  tooltip, menu, and select backgrounds are opaque. A 1440×900 desktop pass
  showed no layout change apart from the opaque popovers.
- WebKit, a physical device, and the Lighthouse and cross-browser probes were
  not run.

## Production

- Cloudflare Pages project `dca-tracker-git` built production deployment
  `028df875-a476-4fd8-94ca-971296a9c0db` from `9121fd6`.
- Cache-busted canonical and deployment URLs referenced `index-Ch6C68M1.js` and
  `index-CydHUNdb.css`; the CSS contains the `.bg-popover` rule and the
  safe-area bottom-nav offset. `/`, `/login`, `/performance`, `/exposure`,
  `/transactions`, `/health`, and `/settings` returned 200.
- On the iPhone 15 Pro profile, production `/login` rendered its email form with
  no missing-Supabase-config notice, no horizontal overflow, and no console
  warnings or errors. No login or account-data access was performed.

`https://dca-tracker.pages.dev` is a separate, older project ("DCA Tracker")
and was not changed.
