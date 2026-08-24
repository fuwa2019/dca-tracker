import { LogOut } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAuth, signOut } from '@/hooks/useAuth';
import { LOCAL_MODE } from '@/lib/localMode';
import { SettingsPaneHeader } from '../components';

export function AccountPane() {
  const { user } = useAuth();
  return (
    <div className="space-y-5">
      <SettingsPaneHeader heading="登录身份" text="当前登录的账号，以及退出登录。" />
      <div className="max-w-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">当前账号</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {LOCAL_MODE ? '本地 Debug 模式 · 免登录' : user?.email ?? '—'}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => signOut()} disabled={LOCAL_MODE}>
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        </div>
      </div>
    </div>
  );
}
