import { normalizeSymbol } from '../lib/symbols';

// 公开信息的静态名称表;未收录的代码不显示名称。
const TICKER_NAMES: Record<string, string> = {
  VOO: 'Vanguard 标普500 ETF',
  QQQ: 'Invesco 纳斯达克100 ETF',
  QQQM: 'Invesco 纳斯达克100 ETF (低费率)',
  QLD: 'ProShares 纳指100 两倍做多 ETF',
  VGT: 'Vanguard 信息技术 ETF',
  SMH: 'VanEck 半导体 ETF',
  SGOV: 'iShares 0-3月美国国债 ETF',
  NVDA: '英伟达',
  AAPL: '苹果',
  MSFT: '微软',
  AMZN: '亚马逊',
  GOOGL: '谷歌 A',
  GOOG: '谷歌 C',
  META: 'Meta',
  AVGO: '博通',
  TSLA: '特斯拉',
  TSM: '台积电',
  AMD: 'AMD',
  MU: '美光科技',
  ASML: '阿斯麦',
  AMAT: '应用材料',
  LRCX: '泛林集团',
  KLAC: '科磊',
  ADI: '亚德诺',
  TXN: '德州仪器',
  INTC: '英特尔',
  CSCO: '思科',
  ORCL: '甲骨文',
  NFLX: '奈飞',
  PLTR: 'Palantir',
  LLY: '礼来',
  JPM: '摩根大通',
  'BRK.B': '伯克希尔 B',
};

export function getTickerName(symbol: string): string | undefined {
  return TICKER_NAMES[normalizeSymbol(symbol)];
}
