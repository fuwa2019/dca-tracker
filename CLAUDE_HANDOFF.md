# Claude Handoff - dca_system

更新时间：2026-06-15

这份文件给下一轮 Claude Code 接手用。长期项目规则仍看
`CLAUDE.md` / `AGENTS.md`；这里记录当前仓库事实、接手顺序和容易踩坑的点。

## 当前状态

- 当前工作区：`/Users/junxihuo/Documents/dca_system`
- `git status`：干净，没有未提交改动。
- 最近提交：
  - `58d3ad3 feat: align font and market session colors`
  - `d43352a fix: keep return info UI minimal`
  - `f67376d feat: explain return metrics on dashboard`
  - `b8b2120 fix: show quote fetch time when as-of lags`
  - `7ac0e13 fix: refresh quotes after history backfill`
- 当前项目已经超过早期文档里的迁移范围：`supabase/migrations/` 最新到 `0038_daily_price_readthrough.sql`。
  `CLAUDE.md` / `AGENTS.md` 中写的 “0001 -> 0017” 已经不是当前事实。
- `supabase/README.md` 也偏旧，仍写到 `0030_reset_daily_price_upsert_temp_table.sql`。涉及数据库时，以文件树里的最新 migration 和调用方代码为准。

## 先看哪里

1. 项目长期约束：`CLAUDE.md`
2. 业绩曲线口径：`docs/PERFORMANCE_SPEC.md`
3. 前端入口和路由：`src/App.tsx`
4. 价格/行情链路：
   - `workers/quote/src/index.ts`
   - `workers/quote/README.md`
   - `src/lib/quote.ts`
   - `src/hooks/useQuotes.ts`
   - `src/hooks/useDailyPrices.ts`
5. 业绩缓存链路：
   - `src/hooks/usePerformanceCache.ts`
   - `src/app/data-health.tsx`
   - 最新相关 migration，尤其 `supabase/migrations/0026_*.sql` 之后的文件

## 必跑验证

代码改动后至少跑：

```bash
npm run test:finance
npm run typecheck
npm run build
```

如果改了本地演示模式，再跑：

```bash
npm run build:local
```

如果改了邮箱提醒逻辑，再跑：

```bash
npm run test:email-reminder
```

如果改了 Schwab / Quote Worker 行情状态，再考虑跑：

```bash
npm run test:quote-status
npm run test:schwab
```

## 部署目标

当前记住的生产目标标识：

- Cloudflare Pages 项目：`dca-tracker-git`
- 公开站点：`https://dca-tracker-git.pages.dev/`
- Quote Worker：`dca-quote`
- Quote Worker URL：`https://dca-quote.891390734.workers.dev`
- Schwab OAuth callback：
  `https://dca-quote.891390734.workers.dev/api/schwab/oauth/callback`
- 当前行情提供方记录：Schwab Market Data，经 `dca-quote` Worker

前端 Pages 构建仍是：

```bash
npm run build
```

Quote Worker 部署：

```bash
cd workers/quote
npm run deploy
```

Email cron Worker 部署：

```bash
cd workers/email-cron
npm run deploy
```

## 核心红线

- `/share/:token` 只能读脱敏 RPC 结果，不能暴露 USD/CNY 金额、现金流、交易明细、汇损或用户私有字段。
- 分享业绩曲线读 `shared_performance_history(token)`，不能匿名实时重算。
- Dashboard 和 share view 的 TWR 曲线要来自同一套 `performance_history_cache` 口径。
- 新 schema / RPC 改动必须新增 migration，不要改已经提交或已部署的 migration。
- `src/lib/calc/` 必须保持纯函数：不要引入 Supabase、网络请求或 React。
- 不要给 `src/lib/supabase.ts` 补 `Database` 泛型；当前无泛型是有意为之。
- `xirr` 的类型 shim 在 `src/types/xirr.d.ts`，不要删除。
- 表单默认日期需要继续用本地日期格式，避免北京时间早晨录入回退一天。
- `public/_redirects` 对 Cloudflare Pages 的 SPA 深链必要，不能删。

## 当前架构提醒

三块部署物共享 Supabase：

- Browser SPA：React 18 + Vite + React Query，Cloudflare Pages 承载。
- `workers/quote`：行情代理、KV 缓存、日线持久化、定时刷新 dirty performance cache。
- `workers/email-cron`：每月定投邮件提醒，Resend 发信，KV + `email_log` 双重去重。

性能曲线当前重点：

- Dashboard NAV = 持仓市值 + 未投资现金。
- Performance chart = daily-linked TWR，按交易资金流推断，不用 XIRR 画曲线。
- 默认 benchmark 是 SPY，但已有动态 benchmark / selected performance 相关迁移。
- `daily_prices.trade_date` 是美东交易日；`is_provisional` 标记尚未 reconcile 的盘后 quote 行。

## 本地演示模式

`VITE_LOCAL_MODE=1` 时走离线演示数据，不连 Supabase / Worker：

```bash
npm run dev:local
npm run build:local
```

相关文件：

- `src/lib/localMode.ts`
- `src/lib/localData.ts`
- `src/data/local-dataset.json`
- `scripts/build-local-dataset.mjs`

不要把 `VITE_LOCAL_MODE=1` 配到正式 Pages 环境。

## 交接建议

接手后先执行：

```bash
git status --short
npm run test:finance
npm run typecheck
```

如果任务涉及 UI，再启动：

```bash
npm run dev
```

打开 `http://localhost:5173` 做浏览器验证。涉及分享页、数据健康页、行情状态或移动端布局时，务必实际截图或浏览器检查，不要只看类型检查。
