/**
 * 穿透权重(look-through)纯计算层。
 *
 * 规则:
 * - 一个持仓若是已知 ETF(在 holdings 数据里),按成分股权重拆开,分摊到底层股票。
 * - 列出的成分股之外的长尾,计入 `unclassifiedValue`(诚实地标记「未穿透」),不会凭空消失。
 * - 现金类持仓(SGOV 等,在 cashLike 名单里)归入现金桶,不拆成股票。
 * - 杠杆 ETF(在 `_meta.leveraged` 里,如 QLD = 2× 纳指100)借用标的指数 ETF 的成分,
 *   按「市值 × 杠杆倍数」的名义敞口拆开;超出自身市值的部分记为 `leverageFinancing`
 *   (基金内部的互换/期货融资),NAV 不变,股票敞口按名义计。
 * - 其它(直接持有的单票,如 SIVE)按 100% 自身计入。
 *
 * 纯函数:无网络、无 Supabase、无 React。
 */

import type {
  MonitorLineConfig,
  MonitorStatus,
} from './exposureConfig.ts';
import { WARN_RATIO } from './exposureConfig.ts';

export interface EtfConstituent {
  ticker: string;
  weight: number;
}

/** 杠杆 ETF 的穿透口径:标的指数 ETF(按优先级,取成分表最新的一只)× 杠杆倍数。 */
export interface LeveragedEtfSpec {
  underlying: string[];
  leverage: number;
}

export interface EtfHoldingsData {
  _meta?: {
    cashLike?: string[];
    asOf?: Record<string, string>;
    leveraged?: Record<string, LeveragedEtfSpec>;
    [k: string]: unknown;
  };
  etfs: Record<string, EtfConstituent[]>;
}

/** 一笔持仓的市值输入。value 用市值(USD)或权重(分享页用 weight_pct)都可以,口径自洽即可。 */
export interface HoldingInput {
  ticker: string;
  value: number;
}

export interface ContributionSource {
  /** 'direct' 表示直接持有,否则是某 ETF 代码。 */
  via: string;
  value: number;
}

export interface LookThroughStock {
  ticker: string;
  /** 穿透后的市值(与输入同口径)。 */
  value: number;
  /** 占总净值(含现金)比例。 */
  weightNav: number;
  /** 占股票敞口(剔除现金,含杠杆名义敞口)比例。 */
  weightEquity: number;
  /** 各来源贡献(直接持有 + 各 ETF 透传),按贡献降序。 */
  sources: ContributionSource[];
}

export interface MonitorLineResult {
  config: MonitorLineConfig;
  /** 计入这条线的穿透市值合计。 */
  value: number;
  /** value / 分母。 */
  pct: number;
  /** 分母数值。 */
  denominator: number;
  status: MonitorStatus;
  /** 命中这条线的成分股(按穿透市值降序),用于展开明细。 */
  members: Array<{ ticker: string; value: number; pct: number }>;
}

export interface LookThroughResult {
  stocks: LookThroughStock[];
  totalNav: number;
  /** 股票敞口 = 总净值 − 现金 + 杠杆融资(名义口径)。 */
  equityValue: number;
  cashValue: number;
  /** 列出成分之外的长尾(未穿透部分,杠杆 ETF 按名义计)。 */
  unclassifiedValue: number;
  /** 杠杆 ETF 超出自身市值的名义敞口合计;已穿透 + 长尾 + 现金 = 总净值 + 它。 */
  leverageFinancing: number;
  lines: MonitorLineResult[];
}

function statusFor(pct: number, ceiling: number): MonitorStatus {
  if (pct >= ceiling) return 'over';
  if (pct >= ceiling * WARN_RATIO) return 'warn';
  return 'ok';
}

export interface ResolvedLeveragedEtf {
  underlying: string;
  leverage: number;
  constituents: EtfConstituent[];
}

/**
 * 杠杆 ETF → 实际采用的标的成分。候选里取有成分且 asOf 最新的一只(同日按列出顺序),
 * 这样持有 QQQM 时 QLD 能跟着用 QQQM 的动态快照。非杠杆 ETF 返回 null。
 */
export function resolveLeveragedEtf(ticker: string, data: EtfHoldingsData): ResolvedLeveragedEtf | null {
  const spec = data._meta?.leveraged?.[ticker.toUpperCase()];
  const leverage = Number(spec?.leverage);
  if (!spec || !(leverage > 0)) return null;
  const asOf = data._meta?.asOf ?? {};
  let best: ResolvedLeveragedEtf | null = null;
  let bestAsOf = '';
  for (const raw of spec.underlying) {
    const underlying = raw.toUpperCase();
    const constituents = data.etfs[underlying];
    if (!constituents || constituents.length === 0) continue;
    const date = String(asOf[underlying] ?? '');
    if (!best || date > bestAsOf) {
      best = { underlying, leverage, constituents };
      bestAsOf = date;
    }
  }
  return best;
}

export interface LookThroughInput {
  /** 各持仓市值(或权重)。 */
  holdings: HoldingInput[];
  /** 未投资现金(可选,计入 NAV 与现金桶)。 */
  uninvestedCash?: number;
  data: EtfHoldingsData;
  lines: MonitorLineConfig[];
}

export function computeLookThrough({
  holdings,
  uninvestedCash = 0,
  data,
  lines,
}: LookThroughInput): LookThroughResult {
  const cashLike = new Set((data._meta?.cashLike ?? []).map((t) => t.toUpperCase()));
  const etfs = data.etfs;

  // ticker -> { value, sources: Map<via, value> }
  const stockMap = new Map<string, { value: number; sources: Map<string, number> }>();
  const add = (ticker: string, value: number, via: string) => {
    if (value <= 0) return;
    const key = ticker.toUpperCase();
    const entry = stockMap.get(key) ?? { value: 0, sources: new Map<string, number>() };
    entry.value += value;
    entry.sources.set(via, (entry.sources.get(via) ?? 0) + value);
    stockMap.set(key, entry);
  };

  let totalNav = uninvestedCash;
  let cashValue = uninvestedCash;
  let unclassifiedValue = 0;
  let leverageFinancing = 0;

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const value = Number(h.value) || 0;
    if (value <= 0) continue;
    totalNav += value;

    if (cashLike.has(ticker)) {
      cashValue += value;
      continue;
    }

    const leveraged = resolveLeveragedEtf(ticker, data);
    const constituents = leveraged?.constituents ?? etfs[ticker];
    if (constituents && constituents.length > 0) {
      const exposure = value * (leveraged?.leverage ?? 1);
      leverageFinancing += exposure - value;
      let listed = 0;
      for (const c of constituents) {
        const w = Number(c.weight) || 0;
        if (w <= 0) continue;
        listed += w;
        add(c.ticker, exposure * w, ticker);
      }
      const remainder = exposure * Math.max(0, 1 - listed);
      unclassifiedValue += remainder;
    } else {
      // 直接持有的单票
      add(ticker, value, 'direct');
    }
  }

  const equityValue = Math.max(0, totalNav - cashValue + leverageFinancing);

  const stocks: LookThroughStock[] = [...stockMap.entries()]
    .map(([ticker, e]) => ({
      ticker,
      value: e.value,
      weightNav: totalNav > 0 ? e.value / totalNav : 0,
      weightEquity: equityValue > 0 ? e.value / equityValue : 0,
      sources: [...e.sources.entries()]
        .map(([via, v]) => ({ via, value: v }))
        .sort((a, b) => b.value - a.value),
    }))
    .sort((a, b) => b.value - a.value);

  const stockByTicker = new Map(stocks.map((s) => [s.ticker, s]));

  const lineResults: MonitorLineResult[] = lines.map((config) => {
    const denominator = config.basis === 'equity' ? equityValue : totalNav;
    const members = config.tickers
      .map((t) => stockByTicker.get(t.toUpperCase()))
      .filter((s): s is LookThroughStock => !!s && s.value > 0)
      .map((s) => ({
        ticker: s.ticker,
        value: s.value,
        pct: denominator > 0 ? s.value / denominator : 0,
      }))
      .sort((a, b) => b.value - a.value);
    const value = members.reduce((acc, m) => acc + m.value, 0);
    const pct = denominator > 0 ? value / denominator : 0;
    return { config, value, pct, denominator, status: statusFor(pct, config.ceiling), members };
  });

  return {
    stocks,
    totalNav,
    equityValue,
    cashValue,
    unclassifiedValue,
    leverageFinancing,
    lines: lineResults,
  };
}
