# dca-email-cron Worker

每月第一个美股交易日**前一天** Beijing 11:00 发邮件提醒入金。

## 工作原理

1. Cloudflare 触发 cron `0 3 * * *`（UTC 03:00 = Beijing 11:00）
2. 算出"美东今天"的下一个 NYSE 交易日
3. 如果是当月**第一个**交易日 → 是候选发送日
4. 查 Supabase `settings` 表里 `email_enabled = true` 且 `email_to` 不为空的用户
5. KV 去重（`sent:<user_id>:<YYYY-MM>`，TTL 40 天）→ 调用 Resend 发邮件 → 写 `email_log` 二级去重

## 部署步骤

```bash
cd workers/email-cron
npm install
npx wrangler login

# 创建 KV
npx wrangler kv namespace create EMAIL_KV
npx wrangler kv namespace create EMAIL_KV --preview
# 把打印的 id 填进 wrangler.toml

# 设置 secrets（不会进仓库）
npx wrangler secret put RESEND_API_KEY            # 在 resend.com 创建 API key
npx wrangler secret put SUPABASE_URL              # 例 https://xxxx.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY # 在 Supabase Settings → API
npx wrangler secret put FROM_EMAIL                # 例 "DCA <reminders@yourdomain.com>"

# 部署
npm run deploy
```

## 验证

- 临时把 cron 改成 `* * * * *`（每分钟），部署后看 `wrangler tail` 日志
- 或者 `curl -X POST https://dca-email-cron.YOUR.workers.dev/run` 手动触发
- 测试完恢复 `0 3 * * *`

## Resend 域名设置

免费层默认只能发到**本人验证邮箱**，要发到任意 Gmail 必须：

1. Resend Dashboard → Domains → Add Domain（你拥有的任何域名都行，没有的话可以买个便宜的）
2. 添加 SPF / DKIM DNS 记录（Resend 给详细 copy-paste）
3. 域名验证通过后，`FROM_EMAIL` 用 `noreply@yourdomain.com` 这种地址

如果暂时没域名，先用 Resend 默认的 `onboarding@resend.dev`，但只能发到你 Resend 账号的注册邮箱。

## NYSE 日历

`src/nyse-calendar.ts` 硬编码了 2026 / 2027 / 2028 年的节假日。**每年 12 月** 从 [NYSE 官方](https://www.nyse.com/markets/hours-calendars) 拿新的一年节假日，追加到 `NYSE_HOLIDAYS` 里重新部署。
