# dca-quote Worker

免 CORS 行情接口。默认使用 Yahoo Finance；设置 `MARKET_DATA_PROVIDER=schwab` 后使用 Charles Schwab Market Data Production。Worker 只实现市场数据，不实现账户、持仓、订单、交易记录或下单能力。

## 部署步骤（首次 ~10 分钟）

```bash
cd workers/quote
npm install                              # 安装 wrangler
npx wrangler login                       # 浏览器登 Cloudflare 账号
npx wrangler kv namespace create QUOTE_CACHE
npx wrangler kv namespace create QUOTE_CACHE --preview
# 把上面两条命令打印的 id 填到 wrangler.toml 的 kv_namespaces

# 修改 wrangler.toml 里的 ALLOWED_ORIGINS 为你的 Cloudflare Pages 域名 + 本地开发地址
# 例：ALLOWED_ORIGINS = "https://dca.your-domain.pages.dev,http://localhost:5173"

npm run deploy                           # 部署
```

### 使用 Schwab Market Data

`SCHWAB_CLIENT_SECRET` 和 `SCHWAB_REFRESH_TOKEN` 必须用 Worker secret，不要写进 git：

```bash
cd workers/quote
npx wrangler secret put SCHWAB_CLIENT_ID
npx wrangler secret put SCHWAB_CLIENT_SECRET
npx wrangler secret put SCHWAB_REDIRECT_URI
npx wrangler secret put SCHWAB_REFRESH_TOKEN
```

把 `workers/quote/wrangler.toml` 里的 `MARKET_DATA_PROVIDER` 改成 `schwab` 后重新部署。你的 App Key 可以填：

```text
2DF8i6sNjUMOKCWjmCA3g4jMCNywp0o2ndq46s8nFp8nCCWz
```

首次授权：

1. `SCHWAB_REDIRECT_URI` 必须和 Schwab Developer Portal App 中配置的 Callback URL 完全一致，例如 `http://localhost:8787/api/schwab/oauth/callback` 或生产 Worker callback。
2. 本地运行 `npm run dev`，访问 `/api/schwab/oauth/url`，打开返回的 `authorizationUrl`。
3. 登录 Schwab 并授权 Market Data。
4. 回调会用 `authorization_code` 换 token，并返回新的 `refreshToken`。把它写入 `SCHWAB_REFRESH_TOKEN` Worker secret 后重启本地 Worker或重新部署。
5. 后续 access token 会在过期前自动通过 refresh token 刷新；refresh token 缺失或失效时接口会返回明确错误，需要重新授权。

部署完成后会输出 URL（如 `https://dca-quote.your-account.workers.dev`），把它填到前端 `.env.local`：

```
VITE_QUOTE_WORKER_URL=https://dca-quote.your-account.workers.dev
```

## 接口

- `GET /api/quote?symbols=VOO,QQQM,SMH` — 多股报价，KV 缓存 5 分钟。返回：
- `GET /api/market/quotes?symbols=VOO,QQQM,SMH` — 同上，前端默认使用这个路径；Schwab provider 会批量请求 `/marketdata/v1/quotes`。
  ```json
  {
    "quotes": [{"ticker": "VOO", "price": 532.4, "prevClose": 530.1, "change": 2.3, "changePct": 0.0043, "marketState": "REGULAR", "source": "yahoo", "asOf": "...", "fetchedAt": "...", "fallback": false, "providerLabel": "yahoo-v7"}],
    "cache": "miss"
  }
  ```
- `GET /api/chart?symbol=VOO&range=1y&interval=1d` — Yahoo v8 chart 透传，KV 缓存 1 小时。
- `GET /api/history?symbols=QQQ,SPY&range=10y` — 返回 `close` 和 `adjustedClose`，并写入 Supabase `daily_prices.close / adjusted_close`。
- `GET /api/market/price-history?symbol=VOO` — 单标的日线历史价格；Schwab provider 请求 `/marketdata/v1/pricehistory`，支持继续透传 `periodType`、`period`、`frequencyType`、`frequency`、`startDate`、`endDate`。

定时任务在收盘后同步价格，并调用 `refresh_due_performance_caches` 小批量刷新 dirty 的业绩曲线缓存。
- `GET /health` — 健康检查。

## 注意

- Yahoo 接口是非官方反向工程，实时性可能延迟，且未来可能被加限。Worker 会返回 `source`、`asOf`、`fetchedAt`、`realtime`、`delayMinutes`、`fallback` 等元数据，前端不要硬编码延迟分钟数。
- 单 IP 频繁触发可能被 Yahoo 限流；5 分钟缓存 + 单用户场景下基本不会撞墙。
- `User-Agent` header **不能省**，否则 401。
- Schwab provider 有硬性 endpoint allow-list：只允许 `https://api.schwabapi.com/marketdata/v1/`；任何 account/order/position/transaction/trader endpoint 都会在发出请求前被拒绝。
- 401 会 refresh token 后重试一次；429 会按 `Retry-After` 或默认 1 秒退避一次，不会死循环。
- 日志会脱敏 `client_secret`、`access_token`、`refresh_token` 和 Bearer token。
