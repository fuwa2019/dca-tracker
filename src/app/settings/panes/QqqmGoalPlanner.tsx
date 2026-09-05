import { useMemo, useState } from 'react';
import { Calculator, Info, TriangleAlert } from '@/components/icons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePositionsModel } from '@/hooks/usePositionsModel';
import { unrealizedPL } from '@/lib/calc/position';
import {
  QQQM_GOAL_UI_PATHS,
  simulateQqqmGoal,
  type GoalStressScenario,
  type QqqmGoalSimulation,
} from '@/lib/calc/goalProbability';
import { usd0 } from '@/lib/format';

interface Props {
  targetUsdText: string;
  monthlyContributionUsdText: string;
}

const STRESS_OPTIONS: ReadonlyArray<{
  value: GoalStressScenario;
  label: string;
  detail: string;
}> = [
  { value: 'baseline', label: '研究基准', detail: '基本面情景与历史区块扰动的融合路径' },
  { value: 'lost-decade', label: '失去的十年', detail: '前十年强制使用 2000—2009 的零实际回报顺序' },
  { value: 'dot-com-early', label: '早期互联网泡沫', detail: '先经历 2000—2002 的科技股下跌顺序' },
  { value: 'financial-crisis-early', label: '早期 2008 危机', detail: '先经历 2007—2009 的金融危机顺序' },
  { value: 'valuation-pe20', label: '估值回落至 PE20', detail: '15 年内把估值压力设为回落到 20 倍' },
  { value: 'persistent-ai', label: '持续 AI 繁荣', detail: '前 20 年实际每股盈利增速额外增加 3 个百分点' },
];

const DISPLAY_YEARS = new Set([10, 20, 30, 40]);
const QUANTILE_ROWS: ReadonlyArray<{
  key: 'p10' | 'p25' | 'p50' | 'p75' | 'p90';
  label: string;
  detail: string;
}> = [
  { key: 'p10', label: 'P10', detail: '较快的 10% 路径' },
  { key: 'p25', label: 'P25', detail: '较快的四分之一' },
  { key: 'p50', label: 'P50', detail: '中位路径' },
  { key: 'p75', label: 'P75', detail: '较稳妥的四分之三' },
  { key: 'p90', label: 'P90', detail: '九成路径以内' },
];

export function QqqmGoalPlanner({ targetUsdText, monthlyContributionUsdText }: Props) {
  const [stress, setStress] = useState<GoalStressScenario>('baseline');
  const targetUsd = parseAmount(targetUsdText);
  const monthlyContributionUsd = parseAmount(monthlyContributionUsdText);
  const portfolio = usePositionsModel();

  const currentValueUsd = useMemo(() => {
    if (portfolio.quotesError || portfolio.quotesNone || portfolio.quotesPartial) return null;
    const holdingsValue = portfolio.positions.reduce((sum, position) => {
      const price = portfolio.quoteByTicker.get(position.ticker)?.price;
      if (price == null || !Number.isFinite(price)) return Number.NaN;
      return sum + unrealizedPL(position, price, portfolio.costBasisMode).marketValue;
    }, 0);
    if (!Number.isFinite(holdingsValue) || !Number.isFinite(portfolio.cash)) return null;
    return Math.max(0, holdingsValue + portfolio.cash);
  }, [
    portfolio.cash,
    portfolio.costBasisMode,
    portfolio.positions,
    portfolio.quoteByTicker,
    portfolio.quotesError,
    portfolio.quotesNone,
    portfolio.quotesPartial,
  ]);

  const simulation = useMemo<QqqmGoalSimulation | null>(() => {
    if (portfolio.quotesLoading || currentValueUsd === null || targetUsd === null || monthlyContributionUsd === null) {
      return null;
    }
    if (targetUsd <= 0 || monthlyContributionUsd < 0) return null;
    return simulateQqqmGoal({
      initialValueUsd: currentValueUsd,
      monthlyContributionUsd,
      targetUsd,
      stress,
      pathCount: QQQM_GOAL_UI_PATHS,
    });
  }, [
    currentValueUsd,
    monthlyContributionUsd,
    portfolio.quotesLoading,
    stress,
    targetUsd,
  ]);

  const selectedStress = STRESS_OPTIONS.find((option) => option.value === stress) ?? STRESS_OPTIONS[0];
  const hasInvalidAmount = (targetUsdText.trim() !== '' && targetUsd === null)
    || (monthlyContributionUsdText.trim() !== '' && monthlyContributionUsd === null);

  return (
    <Card className="overflow-hidden border-brand/25">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-brand" />
              概率规划
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              把“能否达到目标”从单一收益假设，换成首次达标时间的路径分布
            </CardDescription>
          </div>
          <span className="shrink-0 rounded-full bg-brand-soft px-2 py-1 text-[10px] font-semibold tracking-wide">
            QQQM 研究代理
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {portfolio.quotesLoading ? (
          <PlannerStatus text="正在读取当前持仓行情，准备计算起点净值…" />
        ) : portfolio.quotesError || portfolio.quotesNone || portfolio.quotesPartial ? (
          <PlannerStatus
            tone="warning"
            text="当前持仓行情不完整，暂不生成达标概率；完成行情修复后再试。"
          />
        ) : hasInvalidAmount || targetUsd === null || monthlyContributionUsd === null ? (
          <PlannerStatus
            text="填入有效的目标金额和月定投金额后，这里会按当前表单值实时更新。"
          />
        ) : simulation ? (
          <PlannerResult
            currentValueUsd={currentValueUsd ?? 0}
            monthlyContributionUsd={monthlyContributionUsd}
            targetUsd={targetUsd}
            simulation={simulation}
            selectedStress={selectedStress}
            stress={stress}
            onStressChange={setStress}
          />
        ) : (
          <PlannerStatus tone="warning" text="当前输入无法用于模拟，请检查金额是否为非负数。" />
        )}
      </CardContent>
    </Card>
  );
}

function PlannerResult({
  currentValueUsd,
  monthlyContributionUsd,
  targetUsd,
  simulation,
  selectedStress,
  stress,
  onStressChange,
}: {
  currentValueUsd: number;
  monthlyContributionUsd: number;
  targetUsd: number;
  simulation: QqqmGoalSimulation;
  selectedStress: (typeof STRESS_OPTIONS)[number];
  stress: GoalStressScenario;
  onStressChange: (value: GoalStressScenario) => void;
}) {
  const successAt20 = simulation.successByYear.find((point) => point.years === 20)?.probability ?? 0;
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <PlannerMetric
          label="P50 中位达标"
          value={formatYears(simulation.quantiles.p50)}
          detail="一半模拟路径在此之前达到"
        />
        <PlannerMetric
          label="P75 较稳妥"
          value={formatYears(simulation.quantiles.p75)}
          detail="四分之三模拟路径在此之前达到"
        />
        <PlannerMetric
          label="20 年内达标"
          value={formatPercent(successAt20)}
          detail="首次触线累计概率"
        />
      </div>

      <div className="rounded-lg border border-border bg-background/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-semibold">换一个压力情景</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedStress.detail}</p>
          </div>
          <Select value={stress} onValueChange={(value) => onStressChange(value as GoalStressScenario)}>
            <SelectTrigger className="h-9 w-full text-xs sm:w-52" aria-label="选择压力情景">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STRESS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 space-y-3">
          {simulation.successByYear.filter((point) => DISPLAY_YEARS.has(point.years)).map((point) => (
            <div key={point.years} className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 text-xs">
              <span className="font-num text-muted-foreground">{point.years} 年</span>
              <div className="h-2 overflow-hidden rounded-full bg-surface-elevated">
                <div
                  className="h-full rounded-full bg-brand transition-[width]"
                  style={{ width: String(Math.min(100, Math.max(0, point.probability * 100))) + '%' }}
                />
              </div>
              <span className="font-num w-10 text-right font-semibold">{formatPercent(point.probability)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">首次达标时间分位</div>
            <p className="mt-1 text-xs text-muted-foreground">P90 仍显示未在 40 年内达标的路径，不只统计成功者。</p>
          </div>
          <span className="font-num text-[11px] text-muted-foreground">{simulation.pathCount.toLocaleString('en-US')} 条路径</span>
        </div>
        <div className="mt-3 divide-y divide-border rounded-lg border border-border">
          {QUANTILE_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-num w-8 text-xs font-semibold text-brand">{row.label}</span>
                <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
              </div>
              <span className="shrink-0 font-num text-sm font-semibold">{formatYears(simulation.quantiles[row.key])}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded-lg bg-brand-soft p-3 text-[11px] leading-5">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            当前起点 {usd0.format(currentValueUsd)}，月定投 {usd0.format(monthlyContributionUsd)}，目标 {usd0.format(targetUsd)}。
            模型按美元今天购买力、固定实际月投、Nasdaq-100 总回报代理、基金费后和税前计算；不是退休提款可持续性预测。
          </p>
        </div>
        <p className="pl-5 text-muted-foreground">
          研究输入截至 {simulation.asOf}；交互版用冻结公开历史收益和 {simulation.pathCount.toLocaleString('en-US')} 条路径。
          若组合不是全仓 QQQM，这只是 QQQM 等效压力估算，不代表混合组合的精确预测。
        </p>
      </div>
    </div>
  );
}

function PlannerMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 bg-surface p-3.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 font-num text-xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</div>
    </div>
  );
}

function PlannerStatus({ text, tone = 'info' }: { text: string; tone?: 'info' | 'warning' }) {
  return (
    <div className={'flex items-start gap-2 rounded-lg p-3 text-xs leading-5 ' + (tone === 'warning' ? 'bg-warn-soft' : 'bg-surface-elevated text-muted-foreground')}>
      {tone === 'warning' ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}

function parseAmount(value: string): number | null {
  if (value.trim() === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function formatPercent(value: number): string {
  return String(Math.round(value * 100)) + '%';
}

function formatYears(value: number): string {
  if (!Number.isFinite(value)) return '>40 年';
  if (value <= 0) return '已达成';
  const totalMonths = Math.max(1, Math.round(value * 12));
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  if (years === 0) return String(months) + ' 个月';
  if (months === 0) return String(years) + ' 年';
  return String(years) + ' 年 ' + String(months) + ' 个月';
}
