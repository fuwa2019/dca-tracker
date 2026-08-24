import { motion } from 'framer-motion';
import { useState } from 'react';
import { Info } from '@/components/icons';
import { pct as fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MonitorLineResult } from '@/lib/calc/lookThrough';
import { useEnterMotion } from '@/hooks/useEnterMotion';

/**
 * 风险状态色刻意避开盈亏的绿/红二元:
 * - ok   → night(蓝),"安全/计量"色,提示这不是一张盈亏图;
 * - warn → warn(琥珀),接近上限;
 * - over → loss(红),仅在真正超限时才出现红,语义清晰。
 */
const STATUS_VAR: Record<MonitorLineResult['status'], string> = {
  ok: 'var(--night)',
  warn: 'var(--warn)',
  over: 'var(--loss)',
};

const STATUS_LABEL: Record<MonitorLineResult['status'], string> = {
  ok: '安全',
  warn: '接近上限',
  over: '已超限',
};

/**
 * 半环 gauge:展示一条监控线当前占比 vs 上限。
 * denomNote 可覆盖分母口径文案(分享页用「占公开持仓」,避免对外失真)。
 */
export function ExposureGauge({ line, denomNote }: { line: MonitorLineResult; denomNote?: string }) {
  const enter = useEnterMotion();
  const [infoOpen, setInfoOpen] = useState(false);
  const { config, pct, status, members } = line;
  const colorVar = STATUS_VAR[status];

  // 量程:上限的 1.6 倍,这样上限刻度落在弧线约 5/8 处,留出超限可视空间。
  const scaleMax = Math.max(config.ceiling * 1.6, pct * 1.08, 0.0001);
  const valueFrac = Math.min(1, pct / scaleMax);
  const ceilFrac = Math.min(1, config.ceiling / scaleMax);

  const remaining = config.ceiling - pct;
  const overLimit = remaining < 0;

  // 半环几何
  const W = 240;
  const H = 132;
  const cx = W / 2;
  const cy = 118;
  const r = 96;
  const stroke = 14;
  const circ = Math.PI * r; // 半圆周长

  const polar = (frac: number) => {
    const angle = Math.PI - frac * Math.PI; // 180° -> 0°
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  };
  const ceilPt = polar(ceilFrac);

  return (
    <div className="flex flex-col items-center">
      {/* 名称只出现一次 */}
      <div className="relative flex w-full flex-col items-center">
        <div className="flex items-center justify-center gap-1.5">
          <div className="kicker">{config.labelEn}</div>
          <button
            type="button"
            aria-label={`查看${config.label}说明`}
            aria-expanded={infoOpen}
            onClick={() => setInfoOpen((v) => !v)}
            className={cn(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground sm:h-5 sm:w-5',
              infoOpen && 'border-brand/40 text-brand',
            )}
          >
            <Info className="h-4 w-4 sm:h-3 sm:w-3" />
          </button>
        </div>
        <div className="mt-0.5 text-[13px] font-medium text-muted-foreground">{config.label}</div>
        {infoOpen && (
          <div className="absolute left-1/2 top-9 z-20 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border border-border bg-surface-elevated p-3 text-left text-xs leading-5 text-muted-foreground shadow-lg">
            <div className="mb-1 font-medium text-foreground">{config.label}</div>
            {config.description}
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full max-w-[260px]" role="img" aria-label={`${config.label} ${fmtPct(pct, 1)}`}>
        {/* 轨道 */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke="hsl(var(--surface-elevated))"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {/* 数值弧 */}
        <motion.path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={`hsl(${colorVar})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          {...enter({ strokeDashoffset: circ }, { duration: 1.1, ease: [0.16, 1, 0.3, 1] })}
          animate={{ strokeDashoffset: circ * (1 - valueFrac) }}
        />
        {/* 上限刻度 */}
        <line
          x1={cx + (r - stroke / 2 - 4) * Math.cos(Math.PI - ceilFrac * Math.PI)}
          y1={cy - (r - stroke / 2 - 4) * Math.sin(Math.PI - ceilFrac * Math.PI)}
          x2={cx + (r + stroke / 2 + 4) * Math.cos(Math.PI - ceilFrac * Math.PI)}
          y2={cy - (r + stroke / 2 + 4) * Math.sin(Math.PI - ceilFrac * Math.PI)}
          stroke="hsl(var(--foreground))"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <text
          x={ceilPt.x}
          y={ceilPt.y - 12}
          textAnchor="middle"
          className="font-num"
          fontSize="10"
          fill="hsl(var(--muted-foreground))"
        >
          上限 {fmtPct(config.ceiling, 0)}
        </text>
        {/* 中心:数字 + 分母口径(各出现一次) */}
        <text x={cx} y={cy - 30} textAnchor="middle" className="font-serif-fig" fontSize="34" fontWeight="600" fill={`hsl(${colorVar})`}>
          {fmtPct(pct, 1)}
        </text>
        <text x={cx} y={cy - 10} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">
          {denomNote ?? (config.basis === 'equity' ? '占股票市值' : '占总净值')}
        </text>
      </svg>

      <div className="mt-1 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `hsl(${colorVar} / 0.12)`, color: `hsl(${colorVar})` }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: `hsl(${colorVar})` }} />
          {STATUS_LABEL[status]}
        </span>
        <span className="font-num text-[11px] text-muted-foreground">
          {overLimit ? `超出 ${fmtPct(-remaining, 1)}` : `剩余空间 ${fmtPct(remaining, 1)}`}
        </span>
      </div>

      {members.length > 1 && (
        <div className="font-num mt-2 flex flex-wrap justify-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {members.slice(0, 6).map((m) => (
            <span key={m.ticker}>
              {m.ticker} <span className="text-foreground">{fmtPct(m.pct, 1)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
