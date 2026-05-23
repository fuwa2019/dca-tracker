# dca-quote Worker

反代 Yahoo Finance 的免 CORS 行情接口。

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

部署完成后会输出 URL（如 `https://dca-quote.your-account.workers.dev`），把它填到前端 `.env.local`：

```
VITE_QUOTE_WORKER_URL=https://dca-quote.your-account.workers.dev
```

## 接口

- `GET /api/quote?symbols=VOO,QQQM,SMH` — 多股报价，KV 缓存 5 分钟。返回：
  ```json
  {
    "quotes": [{"ticker": "VOO", "price": 532.4, "prevClose": 530.1, "change": 2.3, "changePct": 0.0043, "marketState": "REGULAR", "source": "yahoo-v7", "cachedAt": "..."}],
    "cache": "miss"
  }
  ```
- `GET /api/chart?symbol=VOO&range=1y&interval=1d` — Yahoo v8 chart 透传，KV 缓存 1 小时。
- `GET /api/history?symbols=QQQ,SPY&range=10y` — 返回 `close` 和 `adjustedClose`，并写入 Supabase `daily_prices.close / adjusted_close`。

定时任务在收盘后同步价格，并调用 `refresh_due_performance_caches` 小批量刷新 dirty 的业绩曲线缓存。
- `GET /health` — 健康检查。

## 注意

- Yahoo 接口是非官方反向工程，**15-20 分钟延迟**，且未来可能被加限。Worker 命中率高时基本无感。
- 单 IP 频繁触发可能被 Yahoo 限流；5 分钟缓存 + 单用户场景下基本不会撞墙。
- `User-Agent` header **不能省**，否则 401。
