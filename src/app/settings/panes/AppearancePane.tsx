import { ThemeToggle } from '@/components/ThemeToggle';
import { SettingsPaneHeader, SettingsToggleRow } from '../components';

export function AppearancePane() {
  return (
    <div className="space-y-5">
      <SettingsPaneHeader heading="外观" text="默认跟随系统，也可以手动固定浅色或深色。" />
      <div className="max-w-xl">
        <SettingsToggleRow label="主题" description="切换即时生效，选择记在这台设备上">
          <ThemeToggle compact={false} />
        </SettingsToggleRow>
      </div>
    </div>
  );
}
