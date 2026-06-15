import { useMemo } from 'react';
import { usePositionsModel, type PositionsModel } from '@/hooks/usePositionsModel';
import { unrealizedPL } from '@/lib/calc/position';
import {
  computeLookThrough,
  type EtfHoldingsData,
  type HoldingInput,
  type LookThroughResult,
} from '@/lib/calc/lookThrough';
import { MONITOR_LINES } from '@/lib/calc/exposureConfig';
import etfHoldings from '@/data/etf-holdings.json';

const HOLDINGS = etfHoldings as unknown as EtfHoldingsData;

export interface ExposureModel {
  model: PositionsModel;
  lookThrough: LookThroughResult;
  /** 成分股权重数据的「截至」日期表,用于页面提示。 */
  asOf: Record<string, string>;
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
        data: HOLDINGS,
        lines: MONITOR_LINES,
      }),
    [holdings, cash],
  );

  const asOf = (HOLDINGS._meta?.asOf ?? {}) as Record<string, string>;

  return {
    model,
    lookThrough,
    asOf,
    loading: model.quotesLoading,
    isEmpty: model.isEmpty,
  };
}
