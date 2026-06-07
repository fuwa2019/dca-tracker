# DCA Tracker

一个为嘉信美股 ETF 定投设计的个人投资追踪 PWA：跨 iPhone / iPad / Mac / PC 同步、可只读分享、零月费、$0 运维。

> 详细需求源自 `CLAUDE.md`，最终方案见 `/Users/junxihuo/.claude/plans/sleepy-orbiting-starlight.md`。

## 功能

- **现金流 + 损耗追踪**：CNY → 港卡 → Schwab USD 每笔单独记录，手动输入目标汇率，自动算汇兑损耗
- **持仓与盈亏**：实时市值、今日盈亏、开仓盈亏、累计盈亏（本金口径 = 累计入金）
- **成本基准切换**：平均成本 ↔ FIFO 一键切换
- **年化收益率双口径**：XIRR（钱加权，精确）+ TWR（时间加权，剔除资金时点）
- **$1M 进度**：根据当前市值、月供、预期年化解出剩余月数
- **交易 CRUD**：定投 / 大额建仓 标签区分；最近 5 笔 + 全部交易（日期/股票/金额/类型搜索）
- **只读分享**：生成永久链接，别人能看到持仓权重和收益率 %，但看不到具体 USD 金额、CNY、损耗
- **每月入金提醒邮件**：每月第一个美股交易日**前一天** Beijing 11:00 自动发邮件
- **PWA**：iPhone Safari 添加到主屏，像原生 App 一样使用
- **响应式 + Apple 风动画**：iPhone 15 Pro / iPad Pro / Mac / PC 全端适配，Framer Motion 弹簧动画

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Browser PWA (Cloudflare Pages)                             │
│  Vite + React + TS + Tailwind + shadcn/ui + Framer Motion   │
└─────┬───────────────┬───────────────────────────────────────┘
      │ supabase-js   │ fetch
      ▼               ▼
┌────────────┐  ┌──────────────────┐
│  Supabase  │  │ Worker: quote    │──► Yahoo Finance / Schwab Market Data
│  Postgres  │  │ (KV cache 1min)  │
│  Auth+RLS  │  └──────────────────┘
└────────────┘  ┌──────────────────────┐  ┌────────┐
                │ Worker: email-cron   │──►│ Resend │──► Gmail
                │ (NYSE 日历 + KV 去重) │   └────────┘
                └──────────────────────┘
```

## 目录结构

```
.
├── src/                          # 前端 SPA
│   ├── app/                      # 页面（dashboard / transactions / cashflows / settings / share / login）
│   ├── components/               # 复用组件 + shadcn/ui primitives
│   ├── hooks/                    # useAuth, useQuotes, usePortfolio
│   ├── lib/
│   │   ├── calc/                 # position, xirr, twr, target
│   │   ├── supabase.ts
│   │   ├── quote.ts              # Worker 客户端 + 美股开盘时段判断
│   │   ├── format.ts
│   │   └── database.types.ts
│   └── styles
├── supabase/
│   ├── migrations/0001_init.sql  # 全部 schema + RLS + shared_portfolio 函数
│   └── README.md                 # 部署步骤
├── workers/
│   ├── quote/                    # 行情代理 Worker（Yahoo/Schwab + KV cache）
│   └── email-cron/               # 邮件提醒 Worker（NYSE 日历 + Resend + KV 去重）
├── public/
├── CLAUDE.md                     # 原始需求
└── README.md                     # 你在这里
```

## 部署（首次约 1 小时）

详细步骤分散在三个子 README，按顺序执行：

### 1. Supabase（建库 + 认证）

见 [`supabase/README.md`](./supabase/README.md)。简版：

1. supabase.com 新建免费项目
2. SQL Editor 按顺序跑：
   - `supabase/migrations/0001_init.sql`（基础表 + RLS）
   - `supabase/migrations/0002_daily_prices.sql`（日线价表，资产曲线 + SPY 对照所需）
   - `supabase/migrations/0003_shared_portfolio_v2.sql`（修复卖出后均价的分享函数）
3. Authentication → 启用 Email Magic Link
4. 记下 `Project URL` / `anon key` / `service_role key`

### 2. 行情 Worker

见 [`workers/quote/README.md`](./workers/quote/README.md)。简版：

```bash
cd workers/quote
npm install
npx wrangler login
npx wrangler kv namespace create QUOTE_CACHE
# 把 id 填到 wrangler.toml
npm run deploy
```

Schwab Developer API 接入只使用 **Market Data Production**。本项目不会申请或调用 Accounts and Trading Production，不读取账户、持仓、现金、订单或交易记录，也不会下单、撤单或改单。

需要的 Worker 环境变量：

```bash
MARKET_DATA_PROVIDER=schwab
SCHWAB_CLIENT_ID=your_schwab_app_key
SCHWAB_CLIENT_SECRET=
SCHWAB_REDIRECT_URI=
```

这些变量都不能加 `VITE_` 前缀，不能放进前端 bundle，不能提交 `.env.local`、token 文件或任何 secret。`SCHWAB_REFRESH_TOKEN` 由 OAuth callback 写入 `SCHWAB_TOKEN_STORE` KV，旧的 `SCHWAB_REFRESH_TOKEN` Worker secret 只作为兜底兼容。你的 secret 自己填，方式是：

```bash
cd workers/quote
npx wrangler secret put SCHWAB_CLIENT_ID
npx wrangler secret put SCHWAB_CLIENT_SECRET
npx wrangler secret put SCHWAB_REDIRECT_URI
```

首次 OAuth 授权：

1. 在 Schwab Developer Portal 确认 App 只选择 `Market Data Production`，Callback URL 填入你的 `SCHWAB_REDIRECT_URI`。
2. 生产环境推荐使用 `https://dca-quote.891390734.workers.dev/api/schwab/oauth/callback`。
3. 部署 quote Worker 后访问 `/api/schwab/oauth/url`，打开返回的 `authorizationUrl`。
4. 登录 Schwab 并授权；回调会自动交换 token，把 refresh token 存入 `SCHWAB_TOKEN_STORE` KV。页面不会显示 token。
5. 后续 Worker 调用 Schwab Market Data 时会自动 refresh；如果 Schwab 返回新的 `refresh_token`，Worker 会写回 KV。

本地备用脚本：

```bash
# 拿到 refresh token 后只写回 .env.local
npm run schwab:oauth

# 同时把 Schwab id/key/redirect/refresh token 写入 Cloudflare Worker secrets
npm run schwab:oauth -- --wrangler-secrets
```

脚本会启动本地 callback，打印 Schwab 授权 URL；在浏览器完成授权后，自动交换 token，并把 `SCHWAB_REFRESH_TOKEN` 写入 `.env.local`。如果加了 `--wrangler-secrets`，脚本还会更新 `dca-quote` Worker secrets。之后重新部署 Worker。

Token 续期：

Schwab access token 通常是短期 token，Worker 会在调用 Market Data 时自动刷新。refresh token 的生命周期更严格，常见实现约 7 天会失效；如果 Schwab 在刷新响应中返回新的 `refresh_token`，生产 Worker 会持续写回 `SCHWAB_TOKEN_STORE` KV。本地也可以用脚本检查：

```bash
# 只检查 Schwab 是否接受当前 refresh token，不写任何 secret
npm run schwab:refresh

# Schwab 返回新 refresh_token 时，写回 .env.local
npm run schwab:refresh -- --write-env

# Schwab 返回新 refresh_token 时，同时更新 Cloudflare Worker secret 兜底值
npm run schwab:refresh -- --write-env --wrangler-secret
```

如果脚本输出 `refreshTokenReturned: false`，说明 Schwab 只发了新的 access token，没有发新的 refresh token；这种情况下定时脚本无法突破 refresh token 的固定有效期，仍需要在过期前重新走 OAuth。脚本不会把 token 打到日志里。

常见错误：

- `redirect_uri mismatch`：`SCHWAB_REDIRECT_URI` 和 Developer Portal Callback URL 不完全一致，包括协议、域名、端口、路径。
- `401 token expired`：Worker 会 refresh 后重试一次；仍失败说明 refresh token 失效，需要重新授权。
- `refresh token invalid`：重新走 OAuth，把新的 refresh token 写入 Worker secret。
- `429 rate limit`：Worker 会退避一次；前端不要高频轮询，报价会批量请求并走 KV 缓存。

测试接口：

```bash
curl "http://localhost:8787/api/market/quotes?symbols=VOO,QQQM,SMH"
curl "http://localhost:8787/api/market/price-history?symbol=VOO"
```

### 3. 邮件 Worker

见 [`workers/email-cron/README.md`](./workers/email-cron/README.md)。简版：

```bash
cd workers/email-cron
npm install
npx wrangler kv namespace create EMAIL_KV
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put FROM_EMAIL
npm run deploy
```

### 4. 前端

```bash
cp .env.example .env.local
# 编辑 .env.local，填三个 VITE_ 变量
npm install
npm run dev
```

部署到 Cloudflare Pages：

1. 把这个仓库推到 GitHub
2. Cloudflare Dashboard → Pages → Connect to Git → 选这个仓库
3. Build command: `npm run build`，Output dir: `dist`
4. Environment variables：把 `.env.local` 里的 `VITE_*` 三个变量全填上
5. Save → 第一次构建完成，访问 `https://your-app.pages.dev`
6. **回到 Worker** `wrangler.toml` 把 `ALLOWED_ORIGINS` 加上 Pages 域名，重新 `npm run deploy`

## 本地开发

```bash
npm install
npm run dev       # 开 http://localhost:5173
npm run build     # 验证生产构建
npm run typecheck
```

## 验证清单

- [ ] iPhone Safari 打开 → 添加到主屏 → 像原生 App 启动
- [ ] iPad Pro / MacBook Air / Windows Chrome 布局正常
- [ ] 录入：1 笔现金流 + 3 笔交易（VOO/QQQM/SMH 各 1 笔，DCA 类型）
- [ ] Dashboard 显示三只 ETF 行情（盘中应每分钟刷新；状态栏展示来源、实时性和更新时间）
- [ ] 平均成本 / FIFO 切换数值正确
- [ ] XIRR / TWR 与 Excel 手算误差 < 0.1%
- [ ] $1M 进度环显示"X 年 Y 月达成"
- [ ] 录入大额建仓：3 笔 cashflow，损耗汇总正确
- [ ] 编辑/删除任意交易，持仓自动重算
- [ ] 交易页搜索"VOO" / "2026-03" / "1000" 都返回正确结果
- [ ] 生成分享链接 → 隐身窗口打开 → 只看到持仓 % 和 收益率 %、看不到 $ 金额
- [ ] 改 email-cron cron 为每分钟跑一次，确认 Resend 邮件到达
- [ ] 改回 `0 3 * * *`，等下月第一交易日前一天自动触发

## 待办 (V2 可选)

- 历史汇率自动抓取（替代手动输入 target_rate）
- 历史日线价格缓存到 Supabase，让 TWR 不再用粗估
- CSV 导出 / 备份
- 多 portfolio（"主组合" / "试验组合"）

## 成本

| 服务 | 用量 | 月费 |
|---|---|---|
| Supabase | 单用户 < 500MB DB | $0 |
| Cloudflare Pages | 静态站 + 100k req/day | $0 |
| Cloudflare Workers | 2 个 Worker × < 100k req/day | $0 |
| Workers KV | < 100k 读/天 | $0 |
| Resend | < 100 封邮件/天 | $0 |
| GitHub 私有仓 | 1 个 | $0 |
| **合计** | | **$0/月** |
