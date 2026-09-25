import { Calculator, AlertTriangle } from '@/components/icons';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { usd, signedPct, changeColor } from '@/lib/format';
import type { LedgerWindow } from '@/lib/calc/portfolioLedger';

interface Props {
  /**
   * `null` renders the same card with the figures withheld. The card is 366 px
   * tall and sits above the calendar and the performance panel, so appearing
   * only once the history resolves pushed the whole page down.
   */
  bridge: LedgerWindow | null;
}

/** PP-style signed ledger: 期初净值 + 外部净流入 + 投资盈亏 = 期末净值. */
export function NavBridgeCard({ bridge }: Props) {
  const status = bridge?.status ?? null;
  return (
    <Card className="p-4" aria-busy={bridge ? undefined : true}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Calculator className="h-4 w-4 text-brand" />
          计算拆解
        </h2>
        <span className="text-[11px] text-muted-foreground tnum">
          {bridge ? `${bridge.startDate} 至 ${bridge.endDate} · 与图表区间一致` : '正在读取账本'}
        </span>
      </div>

      <dl className="mt-3 divide-y divide-border rounded-lg border border-border text-sm">
        <BridgeRow sign="" label="期初净值" sub="区间前一交易日的账户净值" value={bridge?.startingNavUsd ?? null} />
        <BridgeRow sign="+" label="外部净流入" sub="券商入金 − 出金，区间内合计" value={bridge?.externalFlowUsd ?? null} />
        <BridgeRow
          sign="+"
          label="投资盈亏"
          sub="价格变动、股息利息、税费与换汇损益，逐日累计"
          value={bridge?.pnlUsd ?? null}
          valueClassName={bridge ? changeColor(bridge.pnlUsd) : undefined}
        />
        <BridgeRow sign="=" label="期末净值" sub="区间最后一个交易日" value={bridge?.endingNavUsd ?? null} emphasize />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {bridge && bridge.periodTwr !== null && (
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
            区间 TWR <strong className={cn('tnum', changeColor(bridge.periodTwr))}>{signedPct(bridge.periodTwr)}</strong>
          </span>
        )}
        {status === 'gap' ? (
          <StatusBadge tone="bad" dot>
            恒等差 {usd.format(bridge!.identityGapUsd)}
          </StatusBadge>
        ) : status === 'unverifiable' ? (
          <StatusBadge tone="warn" dot>
            无法校验
          </StatusBadge>
        ) : status === 'ok' ? (
          <StatusBadge tone="ok" dot>
            恒等式校验通过
          </StatusBadge>
        ) : (
          <span className="rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">等待账本</span>
        )}
        <span className="basis-full text-muted-foreground">
          金额与 TWR 来自同一条现金流序列：入金在当日开盘计入，出金在当日收盘计出。
        </span>
      </div>

      {(status === 'gap' || status === 'unverifiable') && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />
          {status === 'gap'
            ? '期初净值、外部净流入与投资盈亏之和不等于期末净值，账本序列不连续，请到「数据健康」查看对账结果。'
            : bridge?.reason}
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
  value: number | null;
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
        {value === null ? '—' : usd.format(value)}
      </dd>
    </div>
  );
}
