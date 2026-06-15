import { useMemo } from 'react';
import { useDashboardModel, type DashboardModel } from '@/app/dashboard/model';
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
  dashboard: DashboardModel;
  lookThrough: LookThroughResult;
  /** 成分股权重数据的「截至」日期表,用于页面提示。 */
  asOf: Record<string, string>;
  /** 是否还在等行情(影响穿透市值精度)。 */
  loading: boolean;
  isEmpty: boolean;
}

/**
 * 穿透敞口模型。复用 dashboard 的数据来源(持仓 + 行情 + 现金),
 * 在前端按 etf-holdings.json 把每个 ETF 拆成底层股票后加总。
 */
export function useExposure(): ExposureModel {
  const dashboard = useDashboardModel();
  const { positions, quoteByTicker, aggregates, costBasisMode } = dashboard;

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
        uninvestedCash: aggregates.cash,
        data: HOLDINGS,
        lines: MONITOR_LINES,
      }),
    [holdings, aggregates.cash],
  );

  const asOf = (HOLDINGS._meta?.asOf ?? {}) as Record<string, string>;

  return {
    dashboard,
    lookThrough,
    asOf,
    loading: dashboard.quotesLoading,
    isEmpty: dashboard.isEmpty || positions.length === 0,
  };
}
