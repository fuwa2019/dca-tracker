import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SettingsField, SettingsPaneHeader, SettingsSaveRow } from '../components';
import { useSettingsForm } from '../formState';
import { QqqmGoalPlanner } from './QqqmGoalPlanner';

export function GoalPane() {
  const { form, setForm } = useSettingsForm();
  return (
    <div className="space-y-5">
      <SettingsPaneHeader heading="目标与定投" text="设置目标终点、月定投金额，并查看基于 QQQM 研究模型的达标概率。" />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">进度目标</CardTitle>
          <CardDescription className="text-xs">目标金额会用于总览进度环和下方的概率规划</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <SettingsField htmlFor="target" label="目标金额 (USD)" description="长期净值目标；概率规划按今天购买力的 USD 解读">
            <Input
              id="target"
              type="number"
              inputMode="decimal"
              value={form.target_usd}
              onChange={(e) => setForm((f) => ({ ...f, target_usd: e.target.value }))}
            />
          </SettingsField>
          <SettingsField htmlFor="ret" label="总览参考年化 (%)" description="仅用于总览的单一路径推算；概率规划使用下方 QQQM 研究模型">
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
          <CardDescription className="text-xs">每月入金提醒邮件会带上这个金额，概率规划按今天购买力的固定月投读取</CardDescription>
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

      <QqqmGoalPlanner
        targetUsdText={form.target_usd}
        monthlyContributionUsdText={form.monthly_dca_usd}
      />

      <SettingsSaveRow />
    </div>
  );
}
