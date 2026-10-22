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

## 2026-10-07 follow-up: session by trade time

- Overnight check at 21:45 ET on 2026-10-06: Schwab `/quotes` returned no
  overnight trades. Every quote time stopped at 20:00 ET (the after-hours
  last), yet fresh quotes read 夜盘 by the clock and snapshot-served quotes read
  休市 or 行情 from Schwab's `securityStatus`.
- Code commit `40f003d`: the Schwab session comes from `tradeTime` (then
  `quoteTime`) through `usMarketSessionForQuoteTime`; closing prints stamped at
  16:00:00 and 20:00:00 ET stay in the session that ended. Schwab quotes store
  a Yahoo-style `marketState` (PRE/REGULAR/POST/OVERNIGHT/CLOSED), and legacy
  Schwab snapshot rows (Normal/Closed) use their quote time.
- `test:schwab` (also fixed in `3148532` for the renamed benchmark variable),
  `test:quote-status`, `test:nyse-calendar-sync` and `typecheck` passed.
- Deployed `dca-quote` version `3e73bf61-d19c-4439-8f6d-c70108969fa5`; bindings
  unchanged. At 21:52 ET, uncached VOO/QQQ/AMD/MSFT/NVDA/TSLA/AAPL and the
  snapshot-served SPY all returned `session: after_hours`, `sessionLabel: 盘后`,
  `marketState: POST`, `postMarketPrice` = the 20:00 ET last price.

## 2026-10-21 correction: Schwab does carry overnight trades

The 2026-10-06 conclusion above ("Schwab `/quotes` has no overnight trades")
was wrong. It only looked at the `quote` node. A full `/quotes` response
(no `fields` parameter, which is how the Worker calls it) also has an
`extended` node, and that node carries overnight trades.

- Observed by the owner in the Schwab developer portal at 22:14 ET on
  2026-10-21: VOO `extended.lastPrice` 707.38, `tradeTime` 22:14:07 ET, bid/ask
  707.36/707.38, while `quote.lastPrice` 707.292 stopped at 19:59:59 ET. QQQ
  and NVDA showed the same shape.
- Code change: `normalizeSchwabQuote` uses
  `extended.lastPrice` when its `tradeTime` is newer than the `quote` node's,
  so the session reads 夜盘 by trade time. Overnight change is measured from
  the regular close, like after-hours. `provisionalDailyPriceRows` skips
  overnight quotes, because a trade after midnight ET is dated the next
  trading day before it opens.
- Pre-market quotes still become the trading day's provisional close; that
  predates this change and was not altered.
- Deployed `dca-quote` version `8e9bf038-e8ae-4660-8cf2-01ee614fbe03`
  (owner authorized, wrangler 3.114.17, from the uncommitted working tree);
  bindings unchanged. At 22:19 ET on 2026-10-21, an uncached
  `/api/market/quotes?symbols=VOO,QQQ,NVDA,SMH` returned `session: overnight`,
  `sessionLabel: 夜盘`, `marketState: OVERNIGHT` for all four, with 22:19 ET
  quote times; VOO 707.01 against the 710.72 regular close (−0.52%).
