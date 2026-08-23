import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SettingsField, SettingsPaneHeader, SettingsSaveRow } from '../components';
import { useSettingsForm } from '../formState';

export function GoalPane() {
  const { form, setForm } = useSettingsForm();
  return (
    <div className="space-y-5">
      <SettingsPaneHeader heading="目标与定投" text="决定 $1M 进度环的终点，以及入金提醒里建议的金额。" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">进度目标</CardTitle>
          <CardDescription className="text-xs">进度环按当前净值与这两个参数推算达成年份</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SettingsField htmlFor="target" label="目标金额 (USD)" description="长期净值目标，进度环的分母">
            <Input
              id="target"
              type="number"
              inputMode="decimal"
              value={form.target_usd}
              onChange={(e) => setForm((f) => ({ ...f, target_usd: e.target.value }))}
            />
          </SettingsField>
          <SettingsField htmlFor="ret" label="预期年化 (%)" description="仅用于推算，不影响任何已实现收益">
            <Input
              id="ret"
              type="number"
              step="0.1"
              inputMode="decimal"
              value={form.expected_annual_ret}
              onChange={(e) => setForm((f) => ({ ...f, expected_annual_ret: e.target.value }))}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">定投计划</CardTitle>
          <CardDescription className="text-xs">每月入金提醒邮件会带上这个金额</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsField
            htmlFor="dca"
            label="月定投 (USD)"
            description="留空表示不固定金额，提醒邮件则只提示日期"
            className="sm:max-w-xs"
          >
            <Input
              id="dca"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={form.monthly_dca_usd}
              onChange={(e) => setForm((f) => ({ ...f, monthly_dca_usd: e.target.value }))}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <SettingsSaveRow />
    </div>
  );
}
