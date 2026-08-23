import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { DEFAULT_BENCHMARKS, splitTickers } from '@/lib/settings';
import { SettingsField, SettingsPaneHeader, SettingsSaveRow } from '../components';
import { useSettingsForm } from '../formState';
import { BenchmarkManager } from './BenchmarkManager';

export function BasisPane() {
  const { form, setForm } = useSettingsForm();
  return (
    <div className="space-y-5">
      <SettingsPaneHeader
        heading="口径与基准"
        text="决定盈亏怎么算、总览显示哪些标的、绩效和分享页跟谁比。"
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">成本口径</CardTitle>
          <CardDescription className="text-xs">影响持仓成本、未实现盈亏与卖出时的已实现口径</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsField
            label="默认口径"
            description="AVG 按持仓均价；FIFO 按最早买入批次"
          >
            <SegmentedControl
              name="cost-basis"
              ariaLabel="默认成本口径"
              value={form.cost_basis_default}
              onChange={(value) => setForm((f) => ({ ...f, cost_basis_default: value }))}
              options={[
                { value: 'avg', label: '平均成本 (AVG)' },
                { value: 'fifo', label: '先进先出 (FIFO)' },
              ]}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">自选股</CardTitle>
          <CardDescription className="text-xs">总览页顶部行情条展示的标的</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsField
            htmlFor="watchlist"
            label="自选列表"
            description="逗号分隔，保存时自动大写去重"
          >
            <Input
              id="watchlist"
              value={form.watchlist}
              onChange={(e) => setForm((f) => ({ ...f, watchlist: e.target.value }))}
              placeholder="VOO,QQQM,SMH"
            />
          </SettingsField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">业绩基准</CardTitle>
          <CardDescription className="text-xs">
            选中的基准会用于绩效曲线和分享页。新增后到「数据健康」补齐日线价格并刷新缓存。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsField label="基准列表" description="点击一枚设为当前基准，× 移除；SPY 不可移除">
            <BenchmarkManager
              benchmarks={splitTickers(form.benchmarks, DEFAULT_BENCHMARKS)}
              selected={form.selected_benchmark}
              onChange={(benchmarks, selected) => {
                setForm((f) => ({
                  ...f,
                  benchmarks: benchmarks.join(','),
                  selected_benchmark: selected,
                }));
              }}
            />
          </SettingsField>
        </CardContent>
      </Card>

      <SettingsSaveRow />
    </div>
  );
}
