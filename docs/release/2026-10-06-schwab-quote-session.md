# 2026-10-06 Schwab quote session release

Scope: quote Worker `dca-quote` only. No frontend change, database migration,
secret, or KV change.

## Change

Code commit `4f1a68a`. Schwab quotes now carry the trading session from the
New York clock (`usMarketSessionAt`, same windows as `getUsMarketSession` in
`src/lib/quote.ts`): `session`, `sessionLabel`, `isExtended`,
`preMarketPrice`/`postMarketPrice`. Worker labels now match the frontend
(早盘/盘中/盘后/夜盘/休市).

## Verification

- `test:quote-status`, `test:nyse-calendar-sync` and `typecheck` passed.
  `test:schwab` passed the new session assertions but still fails later at
  `benchmark labels use selected benchmark` (`src/app/performance.tsx`); that
  failure reproduces on the previous HEAD `c8a7803` and is unrelated.

## Production

- `wrangler deploy` uploaded `dca-quote` version
  `ce713b1b-ced6-428c-bb4e-d3bf972f8cf5`; bindings `QUOTE_CACHE`,
  `SCHWAB_TOKEN_STORE`, `MARKET_DATA_PROVIDER=schwab` unchanged.
- At 09:10 ET, uncached `/api/market/quotes?symbols=VOO,NVDA,SMH,QQQ`
  returned `source: schwab`, `session: pre_market`, `sessionLabel: 早盘`,
  `isExtended: true`, and `preMarketPrice` equal to the Schwab last price
  (VOO 715.18 vs previous close 712.32).

Regular, after-hours, and overnight sessions were not observed live. Schwab
coverage during 20:00-04:00 ET remains untested.
