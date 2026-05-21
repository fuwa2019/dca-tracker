/**
 * DCA Email Cron Worker
 * --------------------------------
 * Fires daily at UTC 03:00 (Beijing 11:00).
 *
 * Logic:
 *   1. Compute "today" in America/New_York (ET).
 *   2. Find the next NYSE trading day strictly after today.
 *   3. If that day is the FIRST NYSE trading day of its month → candidate.
 *   4. For each user with email_enabled = true and email_to set:
 *        - Skip if email_log already has a row for this (user_id, year-month).
 *        - Send Resend email.
 *        - Record email_log entry to dedupe.
 */

import {
  isoDateInNewYork,
  nextNyseTradingDay,
  firstNyseTradingDayOfMonth,
  isNyseTradingDay,
} from './nyse-calendar';

export interface Env {
  EMAIL_KV: KVNamespace;
  RESEND_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  FROM_EMAIL: string;
  ADMIN_EMAIL?: string;
  /** Required for manual triggers via POST /run; not used by the scheduled handler. */
  ADMIN_SECRET?: string;
}

interface SettingsRow {
  user_id: string;
  email_enabled: boolean;
  email_to: string | null;
  monthly_dca_usd: number | null;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await runDailyCheck(env);
  },
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/run') {
      // Require bearer token to prevent anyone-on-the-internet from triggering Resend sends.
      const expected = env.ADMIN_SECRET;
      if (!expected) {
        return new Response('admin_secret_not_configured\n', { status: 503 });
      }
      const auth = req.headers.get('Authorization') ?? '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (provided !== expected || provided.length === 0) {
        return new Response('unauthorized\n', { status: 401 });
      }
      const force = url.searchParams.get('force') === '1';
      await runDailyCheck(env, { force });
      return new Response(`ok${force ? ' (force)' : ''}\n`);
    }
    return new Response('dca-email-cron — POST /run with Authorization: Bearer <ADMIN_SECRET>\n', { status: 200 });
  },
};

async function runDailyCheck(env: Env, opts: { force?: boolean } = {}) {
  const nowEt = isoDateInNewYork(new Date());
  const next = nextNyseTradingDay(nowEt);
  const [y, m] = next.split('-').map(Number);
  const firstOfMonth = firstNyseTradingDayOfMonth(y, m);

  if (!opts.force) {
    if (next !== firstOfMonth) {
      console.log(`[cron] today=${nowEt} next=${next} first=${firstOfMonth} — not the month's first trading day, skipping`);
      return;
    }
    if (!isNyseTradingDay(next)) {
      console.log(`[cron] next=${next} not a trading day, skipping`);
      return;
    }
  } else {
    console.log(`[cron] FORCE mode — bypassing date and dedupe checks (today=${nowEt}, next=${next}, first=${firstOfMonth})`);
  }

  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const settingsList = await fetchEligibleSettings(env);
  console.log(`[cron] et=${nowEt} → next first trading day=${next} (ym=${ym}); ${settingsList.length} subscriber(s)`);

  for (const s of settingsList) {
    if (!s.email_to) continue;
    const dedupeKey = `sent:${s.user_id}:${ym}`;
    // Always honor month-level dedupe — even in force mode — to avoid hammering Resend
    // with repeated test sends. To re-send for an already-emailed month, manually
    // delete the KV key via `wrangler kv key delete --binding=EMAIL_KV "<key>"`.
    const already = await env.EMAIL_KV.get(dedupeKey);
    if (already) {
      console.log(`[cron] user=${s.user_id} already sent for ${ym}, skip`);
      continue;
    }

    try {
      await sendReminder(env, s.email_to, {
        nextTradingDay: next,
        ym,
        monthlyDca: s.monthly_dca_usd,
      });
      // Record dedupe regardless of force, for the reason explained above.
      await env.EMAIL_KV.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 * 40 });
      await recordEmailLog(env, s.user_id, ym).catch((e) => console.warn('email_log write failed', e));
      console.log(`[cron] sent to ${s.email_to} for ${ym}${opts.force ? ' (force)' : ''}`);
    } catch (err) {
      console.error(`[cron] send failed for ${s.email_to}:`, err);
    }
  }
}

async function fetchEligibleSettings(env: Env): Promise<SettingsRow[]> {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/settings?select=user_id,email_enabled,email_to,monthly_dca_usd&email_enabled=eq.true&email_to=not.is.null`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!r.ok) throw new Error(`supabase settings fetch failed: ${r.status}`);
  return (await r.json()) as SettingsRow[];
}

async function recordEmailLog(env: Env, userId: string, ym: string): Promise<void> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/email_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ user_id: userId, ym }),
  });
  if (!r.ok && r.status !== 409) {
    throw new Error(`supabase email_log insert failed: ${r.status} ${await r.text()}`);
  }
}

async function sendReminder(
  env: Env,
  to: string,
  ctx: { nextTradingDay: string; ym: string; monthlyDca: number | null },
): Promise<void> {
  const subject = `📅 明天 (${ctx.nextTradingDay}) 是 ${ctx.ym} 美股第一个交易日 — 别忘了入金`;
  const dca = ctx.monthlyDca ? `本月计划定投 $${ctx.monthlyDca.toFixed(0)}` : '';

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif; max-width:520px; margin:24px auto; padding:24px; border:1px solid #e5e5e5; border-radius:16px; color:#0a0a0a;">
      <div style="font-size:13px; color:#737373; margin-bottom:8px;">DCA Tracker · 入金提醒</div>
      <h1 style="font-size:22px; margin:0 0 12px; line-height:1.3;">明天 (${ctx.nextTradingDay}) 是 ${ctx.ym} 美股第一个交易日</h1>
      <p style="font-size:15px; line-height:1.55; color:#404040;">
        记得提前把这个月的定投资金到位到嘉信账户，以免错过开盘。
        ${dca ? `<br/><strong>${dca}</strong>` : ''}
      </p>
      <div style="margin-top:20px; padding:12px 14px; background:#fafafa; border-radius:10px; font-size:13px; color:#525252;">
        小提醒：CNY → 港卡 → Schwab 的链条通常需要 1–3 个工作日，留好时间。
      </div>
      <div style="margin-top:24px; font-size:11px; color:#a3a3a3;">
        想停止此提醒？在 DCA Tracker → 设置 → 关闭"邮件提醒"。
      </div>
    </div>
  `;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      html,
    }),
  });
  if (!resp.ok) {
    throw new Error(`resend ${resp.status} ${await resp.text()}`);
  }
}
