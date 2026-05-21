# Supabase 部署步骤

1. 注册 [Supabase](https://supabase.com)，新建免费项目（区域选 Singapore，对大陆访问最快）。已完成

2. 项目 → SQL Editor → New query → **按顺序**粘贴并 Run：
   - `migrations/0001_init.sql`（核心表 + RLS + 分享函数 v1）
   - `migrations/0002_daily_prices.sql`（资产曲线和 SPY 对照所需的历史价表）
   - `migrations/0003_shared_portfolio_v2.sql`（修复卖出后均价虚高，覆盖旧函数）

   新部署只需按顺序跑一次；已部署的项目跑新增的 sql 即可（idempotent）。

3. 项目 → Authentication → Providers → 启用 **Email** → Magic Link 模式（默认即可）。已完成

4. 项目 → Settings → API：
   - `Project URL` → 已写入 `.env.local` 的 `VITE_SUPABASE_URL`
   - `anon public key` → 已写入 `.env.local` 的 `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → 后面用 `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` 配进 email-cron Worker，**绝不提交进仓库**

5. 第一次登录后 `settings` 表会自动建一行；可以在 SQL Editor 改 `target_usd` / `monthly_dca_usd` 等。

## 表关系速查

```
auth.users (1) ──┬── settings (1)
                 ├── funding_batches (N) ─┬── cashflows (N)
                 │                        └── transactions (N)
                 ├── share_links (N)
                 └── email_log (N, monthly dedupe)

quote_snapshots: 单表，service-role 写、所有人读（供 share 视图用）
```

## RLS 摘要

- `funding_batches / cashflows / transactions / share_links / settings / email_log`：每行 `auth.uid() = user_id` 才能访问。
- `quote_snapshots`：anon + authenticated 都可 select，但 RLS 阻止任何 client 写入（只有 service-role 绕过）。
- `shared_portfolio(token)`：`security definer` RPC，校验 token 后返回脱敏 JSON（只有持仓权重 % 和收益率 %，无绝对 USD 金额）。

## 验证

```sql
-- 模拟分享调用：自己先建一条 share_links，然后随便用一个客户端（哪怕匿名）调
select public.shared_portfolio('YOUR_TOKEN_HERE');
```
