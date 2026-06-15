/**
 * Look-through monitoring configuration.
 *
 * 这是「两条监控线」的口径定义,纯数据、可手动编辑。
 * - tickers: 计入该条线的成分股(穿透加总后)。
 * - ceiling: 触警上限(小数),pct >= ceiling 记为「超限」,pct >= ceiling*WARN_RATIO 记为「接近」。
 * - basis: 'nav' 用总净值(含现金/国债)作分母;'equity' 用股票市值(剔除现金/国债)作分母。
 *
 * 改这里就能调监控口径,不用动页面或计算逻辑。
 */

export type MonitorBasis = 'nav' | 'equity';
export type MonitorStatus = 'ok' | 'warn' | 'over';

export interface MonitorLineConfig {
  id: string;
  /** 中文短标签 */
  label: string;
  /** 英文 kicker */
  labelEn: string;
  /** 计入这条线的穿透成分股 */
  tickers: string[];
  /** 触警上限(小数) */
  ceiling: number;
  /** 分母口径 */
  basis: MonitorBasis;
  /** 说明文案(信息气泡) */
  description: string;
}

/** pct 达到 ceiling * WARN_RATIO 即进入「接近上限」黄色状态。 */
export const WARN_RATIO = 0.85;

/**
 * AI 铲子线 = 卖铲子的(半导体)+ AI 基建龙头 + 用户核心 conviction。
 * 来源:investment-system 备忘里的「NVDA + AAPL + MSFT + MU + AVGO + ORCL」加上 SMH/VGT 带来的核心芯片线,
 * 以及进攻仓 SIVE。可按需增删。
 */
export const SHOVEL_TICKERS = [
  // 算力/AI 核心
  'NVDA', 'AVGO', 'TSM', 'ASML',
  // 存储/DRAM
  'MU',
  // CPU/GPU 与设计
  'AMD', 'QCOM', 'MRVL', 'ARM',
  // 半导体设备 (WFE)
  'LRCX', 'KLAC', 'AMAT',
  // 平台型 conviction
  'AAPL', 'MSFT', 'ORCL',
  // 进攻仓单票
  'SIVE',
];

export const MONITOR_LINES: MonitorLineConfig[] = [
  {
    id: 'nvda',
    label: 'NVDA 单票',
    labelEn: 'Single-name · NVDA',
    tickers: ['NVDA'],
    ceiling: 0.12,
    basis: 'nav',
    description:
      'NVDA 穿透后占总净值的比例。它会同时出现在 VOO / SMH / VGT 里,直接持有以外的隐含敞口也算进来。超过设定上限说明单票集中度偏高,可考虑下次定投少买含 NVDA 的篮子。',
  },
  {
    id: 'shovel',
    label: 'AI 铲子线',
    labelEn: 'AI shovel line',
    tickers: SHOVEL_TICKERS,
    ceiling: 0.60,
    basis: 'equity',
    description:
      '半导体 + AI 基建 conviction 一篮子穿透后占股票市值的比例(剔除现金/国债)。这条线衡量「整条铲子线」的总敞口,而不是某一只票。',
  },
];
