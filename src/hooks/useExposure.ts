import { useMemo } from 'react';
import { usePositionsModel, type PositionsModel } from '@/hooks/usePositionsModel';
import { unrealizedPL } from '@/lib/calc/position';
import {
  computeLookThrough,
  resolveLeveragedEtf,
  type HoldingInput,
  type LookThroughResult,
} from '@/lib/calc/lookThrough';
import { MONITOR_LINES } from '@/lib/calc/exposureConfig';
import { useEtfHoldings, type EtfHoldingSourceMeta } from '@/hooks/useEtfHoldings';

export interface ExposureModel {
  model: PositionsModel;
  lookThrough: LookThroughResult;
  /** 成分股权重数据的「截至」日期表,用于页面提示。 */
  asOf: Record<string, string>;
  sources: Record<string, EtfHoldingSourceMeta>;
  isFallback: boolean;
  /** 是否还在等行情(影响穿透市值精度)。 */
  loading: boolean;
  isEmpty: boolean;
}

/**
 * 穿透敞口模型。只依赖轻量持仓模型(持仓 + 行情 + 现金),
 * 在前端按 etf-holdings.json 把每个 ETF 拆成底层股票后加总。
 */
export function useExposure(): ExposureModel {
  const model = usePositionsModel();
  const holdingsData = useEtfHoldings();
  const { positions, quoteByTicker, cash, costBasisMode } = model;

  const holdings: HoldingInput[] = useMemo(
    () =>
      positions.map((p) => {
        const q = quoteByTicker.get(p.ticker);
        const { marketValue } = unrealizedPL(p, q?.price ?? null, costBasisMode);
        return { ticker: p.ticker, value: marketValue };
      }),
    [positions, quoteByTicker, costBasisMode],
  );

  const lookThrough = useMemo(
    () =>
      computeLookThrough({
        holdings,
        uninvestedCash: cash,
        data: holdingsData.data,
        lines: MONITOR_LINES,
      }),
    [holdings, cash, holdingsData.data],
  );

  // 杠杆 ETF 没有自己的成分表,日期和来源沿用实际采用的标的 ETF。
  const asOf: Record<string, string> = { ...(holdingsData.data._meta?.asOf ?? {}) };
  const sources = Object.fromEntries(
    positions.map((position) => {
      const leveraged = resolveLeveragedEtf(position.ticker, holdingsData.data);
      if (leveraged && asOf[leveraged.underlying]) {
        asOf[position.ticker] = `${leveraged.leverage}×${leveraged.underlying} ${asOf[leveraged.underlying]}`;
      }
      return [position.ticker, holdingsData.sources[leveraged?.underlying ?? position.ticker]] as const;
    })
      .filter((entry): entry is [string, EtfHoldingSourceMeta] => entry[1] != null),
  );
  const isFallback = Object.values(sources).some((source) => source.provider === 'static');

  return {
    model,
    lookThrough,
    asOf,
    sources,
    isFallback,
    loading: model.quotesLoading || holdingsData.isLoading,
    isEmpty: model.isEmpty,
  };
}
