# 2026-10-07 copy cleanup release

Scope: SPA frontend copy only. No database migration, Worker deploy, secret, or
KV change.

## Change

Code commit `f4f5411`, from an owner review of user-facing text that read like
debug notes.

- Removed copy that explains the layout ("不随上方区间变化", the exposure
  "自动分组依据" block, "条长以最大持仓…为满格", "与图表区间一致"),
  changelog-style asides ("不再使用单一年化假设", "不只统计成功者",
  "本页数字直接来自账本，不受影响"), and the login-page `/share/<token>` hint.
- Reworded implementation terms into plain language: RPC contract, batch
  `cursor`, `dirty` / `source_hash`, `adjusted close`, benchmark "proxy",
  "32 位 hex token", "服务端脱敏", "Resend 直发可达", "归一化值",
  `source ordinal`, and the bilingual import-receipt labels
  (`已导入 imported` → `已导入`).
- Overview: the since-inception strip is labelled `成立以来 · <date range>`;
  the always-on "导入模型" status row and two panel subtitles were dropped.
- Kept on purpose: local-debug-only copy, missing-`VITE_` deployment errors,
  operational fields on the data-health page, and import validation errors.

`test:ui` and `test:portfolio-import` assertions now match the new receipt
labels, reasons heading, and duplicate-row warning.

## Verification

- Finance, email-reminder, quote-status, share-privacy, UI, portfolio-import,
  typecheck, offline build, and first-load budget checks passed. The production
  `build` was not run locally because the public `VITE_` values are injected
  only by Pages.
- Offline demo (`dev:local`): overview, exposure, and performance rendered the
  new copy with no console errors.

## Production

- Cloudflare Pages project `dca-tracker-git` built production deployment
  `d0c0c644-be0d-4eb6-885d-a983d9c6cf87` from `f4f5411`.
- Cache-busted `/`, `/login`, `/performance`, `/exposure`, and `/settings`
  returned 200 and referenced `index-CzXvgO5h.js`. Across the 39 referenced
  chunks, none contained the removed strings and the new copy ("成立以来 · ",
  "以下行未写入", "含分红总回报", "多个代码用逗号分隔") was present. No login
  or account-data access was performed.
