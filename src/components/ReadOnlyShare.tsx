import { Link } from 'react-router-dom';
import { EyeOff, ShieldCheck } from '@/components/icons';
import { READ_ONLY_SHARE } from '@/lib/shareSession';

/** The strip above the top bar while a full read-only share is being viewed. */
export function ReadOnlyShareBanner() {
  if (!READ_ONLY_SHARE) return null;
  return (
    <div className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-1.5 text-[11px] text-foreground lg:px-6">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-warn" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">只读分享</span>
        <span className="text-muted-foreground"> · 所有者授权的完整视图，不含设置，不能修改数据</span>
      </span>
      {/* A full reload, so the session is read again and cleared. */}
      <a href="/?share=off" className="shrink-0 text-muted-foreground underline-offset-2 hover:underline">
        退出只读视图
      </a>
    </div>
  );
}

export function ReadOnlySettingsBlocked() {
  return (
    <div className="container flex min-h-[420px] max-w-3xl items-center justify-center px-4 py-10">
      <div className="w-full rounded-lg border border-border bg-surface p-5 text-center">
        <EyeOff className="mx-auto h-5 w-5 text-muted-foreground" />
        <div className="mt-3 text-base font-semibold">此链接无权查看设置</div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          只读分享不包含目标、口径、邮件提醒、分享链接与账户身份。
        </p>
        <Link
          to="/"
          className="mt-4 inline-flex h-8 items-center rounded-md border border-border bg-surface-elevated px-3 text-xs font-medium"
        >
          回到总览
        </Link>
      </div>
    </div>
  );
}
