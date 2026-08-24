import { Calculator, AlertTriangle } from '@/components/icons';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { usd, signedPct, changeColor } from '@/lib/format';
import type { NavBridge } from '@/lib/calc/navBridge';

interface Props {
  bridge: NavBridge;
}

/** PP-style signed ledger: 期初净值 + 外部净流入 + 期间盈亏 = 期末净值. */
export function NavBridgeCard({ bridge }: Props) {
  const gapVisible = Math.abs(bridge.identity_gap_usd) >= 0.005;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="h-4 w-4 text-brand" />
          计算拆解
        </h2>
        <span className="text-[11px] text-muted-foreground tnum">
          {bridge.start_date} 至 {bridge.end_date} · 与图表区间一致
        </span>
      </div>

      <dl className="mt-3 divide-y divide-border rounded-lg border border-border text-sm">
        <BridgeRow sign="" label="期初净值" sub="区间前一交易日的账户净值" value={bridge.starting_nav_usd} />
        <BridgeRow sign="+" label="外部净流入" sub="由交易推断的资金流，区间内合计" value={bridge.external_flow_usd} />
        <BridgeRow
          sign="+"
          label="期间盈亏"
          sub="区间内净值变化中非资金流部分"
          value={bridge.pnl_usd}
          valueClassName={changeColor(bridge.pnl_usd)}
        />
        <BridgeRow sign="=" label="期末净值" sub="区间最后一个交易日" value={bridge.ending_nav_usd} emphasize />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {bridge.period_return_pct !== null && (
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
            区间 TWR <strong className={cn('tnum', changeColor(bridge.period_return_pct))}>{signedPct(bridge.period_return_pct)}</strong>
          </span>
        )}
        {gapVisible ? (
          <StatusBadge tone="warn" dot>
            恒等差 {usd.format(bridge.identity_gap_usd)}，缓存可能需要刷新
          </StatusBadge>
        ) : (
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
            恒等式校验通过
          </span>
        )}
        <span className="basis-full text-muted-foreground">
          TWR 描述曲线形状，与金额拆解相互独立；未导入的股息、利息等现金事件不在此拆解中。
        </span>
      </div>

      {gapVisible && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          期初净值、外部净流入与期间盈亏之和不等于期末净值，通常表示业绩缓存不一致，请刷新业绩缓存后复核。
        </p>
      )}
    </Card>
  );
}

function BridgeRow({
  sign,
  label,
  sub,
  value,
  emphasize = false,
  valueClassName,
}: {
  sign: '' | '+' | '=';
  label: string;
  sub: string;
  value: number;
  emphasize?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5', emphasize && 'bg-surface-elevated')}>
      <span aria-hidden="true" className="w-4 shrink-0 text-center font-num text-muted-foreground">{sign}</span>
      <dt className="min-w-0 flex-1">
        <span className={cn('block', emphasize && 'font-semibold')}>{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{sub}</span>
      </dt>
      <dd className={cn('shrink-0 font-num tabular-nums', emphasize ? 'text-base font-semibold' : 'text-sm', valueClassName)}>
        {usd.format(value)}
      </dd>
    </div>
  );
}
