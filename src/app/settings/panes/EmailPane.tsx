import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SettingsField, SettingsPaneHeader, SettingsSaveRow, SettingsToggleRow } from '../components';
import { useSettingsForm } from '../formState';

export function EmailPane() {
  const { form, setForm } = useSettingsForm();
  return (
    <div className="space-y-5">
      <SettingsPaneHeader
        heading="邮件提醒"
        text="每月第一个美股交易日前一天 11:00（北京）提醒入金。"
      />

      <div className="max-w-xl space-y-4">
        <SettingsToggleRow
          htmlFor="email-on"
          label="启用提醒"
          description="关闭后不再发送任何提醒邮件，其余设置照常保留"
        >
          <Switch
            id="email-on"
            checked={form.email_enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, email_enabled: v }))}
          />
        </SettingsToggleRow>

        <SettingsField
          htmlFor="mail"
          label="收件邮箱"
          description="建议 Gmail / iCloud / Outlook（Resend 直发可达）"
        >
          <Input
            id="mail"
            type="email"
            value={form.email_to}
            onChange={(e) => setForm((f) => ({ ...f, email_to: e.target.value }))}
            placeholder="you@gmail.com"
          />
        </SettingsField>
      </div>

      <SettingsSaveRow />
    </div>
  );
}
