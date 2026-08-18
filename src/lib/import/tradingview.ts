import Papa from 'papaparse';
import {
  buildImportPreview,
  fixedDecimal,
  makeImportKey,
  normalizeAction,
  normalizeHeader,
  normalizeTradingViewSymbol,
  parseDate,
  parseDecimal,
  parseDelimited,
  rowsForItems,
  signedTradeAmount,
} from './common.ts';
import type {
  ImportDetection,
  ImportInput,
  LedgerCashEvent,
  LedgerTrade,
  NormalizedLedger,
  ParsedImport,
  ParsedImportRow,
  PortfolioImportAdapter,
} from './types.ts';

interface TradingViewParsedImport extends ParsedImport {
  header_row: number;
}

const HEADERS = ['symbol', 'side', 'qty', 'fill price', 'commission', 'closing time'];

function isHeader(row: string[]): boolean {
  return HEADERS.every((header, index) => normalizeHeader(row[index] ?? '') === header);
}

function actionKind(value: string): 'buy' | 'sell' | 'dividend' | 'interest' | 'broker_deposit' | 'broker_withdrawal' | 'fee' | 'tax' | null {
  const action = normalizeAction(value);
  if (action === 'buy') return 'buy';
  if (action === 'sell') return 'sell';
  if (action === 'dividend') return 'dividend';
  if (action === 'interest') return 'interest';
  if (action === 'deposit') return 'broker_deposit';
  if (action === 'withdrawal') return 'broker_withdrawal';
  if (action === 'tax' || action === 'taxes') return 'tax';
  if (action === 'fees' || action === 'fee' || action === 'taxes and fees') return 'fee';
  return null;
}

function addDuplicateOrdinals(items: Array<LedgerTrade | LedgerCashEvent>): void {
  const counts = new Map<string, number>();
  for (const item of items) {
    const base = item.import_key;
    const ordinal = (counts.get(base) ?? 0) + 1;
    counts.set(base, ordinal);
    item.duplicate_ordinal = ordinal;
    item.import_key = `${base}|${ordinal}`;
  }
}

function parseInput(input: ImportInput): TradingViewParsedImport {
  const table = parseDelimited(input.text, ',');
  const headerIndex = table.rows.findIndex(isHeader);
  const detection: ImportDetection = {
    supported: headerIndex >= 0,
    source: 'tradingview',
    format: 'tradingview-portfolio-analyzer-six-column',
    confidence: headerIndex >= 0 ? 'high' : 'low',
    delimiter: ',',
    header_row: headerIndex >= 0 ? headerIndex + 1 : undefined,
    warnings: headerIndex >= 0
      ? ['TradingView 六列格式没有独立 Amount，交易现金按数量、成交价和佣金计算。']
      : [],
  };
  const rows: ParsedImportRow[] = [];
  const items: Array<LedgerTrade | LedgerCashEvent> = [];

  if (headerIndex < 0) {
    rows.push({
      source_index: 0,
      action: 'parse-error',
      category: 'error',
      default_status: 'block',
      reason: '未找到 TradingView 六列表头。',
    });
    return { detection, rows, warnings: [], header_row: 0 };
  }

  for (const error of table.errors.filter((entry) => entry.type === 'Quotes')) {
    rows.push({
      source_index: (error.row ?? 0) + 1,
      action: 'parse-error',
      category: 'error',
      default_status: 'block',
      reason: `CSV 引号格式错误：${error.message}`,
    });
  }

  for (let index = headerIndex + 1; index < table.rows.length; index += 1) {
    const sourceIndex = index + 1;
    const row = table.rows[index];
    if (row.every((cell) => cell.trim() === '')) continue;
    const symbol = normalizeTradingViewSymbol(row[0] ?? '');
    const actionText = String(row[1] ?? '').trim();
    const kind = actionKind(actionText);
    const date = parseDate(row[5] ?? '');
    const quantity = parseDecimal(row[2], 10);
    const price = parseDecimal(row[3], 12);
    const commission = parseDecimal(row[4], 10) ?? '0';
    const errors: string[] = [];
    if (!date) errors.push('日期无效');
    if (!kind) errors.push('操作类型不支持');
    if (!symbol.currency || symbol.currency !== 'USD') errors.push('仅支持可核对为 USD 的行');
    if (!kind) {
      rows.push({ source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') });
      continue;
    }
    if (kind === 'buy' || kind === 'sell') {
      if (!symbol.ticker) errors.push('交易缺少证券代码');
      if (!quantity || Number(quantity) <= 0) errors.push('交易数量必须为正数');
      if (!price || Number(price) <= 0) errors.push('成交价必须为正数');
      if (Number(commission) < 0) errors.push('佣金不能为负数');
      if (errors.length > 0 || !date || !quantity || !price) {
        rows.push({ source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') });
        continue;
      }
      const amount = signedTradeAmount(kind, quantity, price, commission);
      const trade: LedgerTrade = {
        source: 'tradingview',
        source_index: sourceIndex,
        effective_date: date,
        side: kind,
        ticker: symbol.ticker,
        shares: fixedDecimal(quantity, 10),
        price: fixedDecimal(price, 12),
        fees_usd: fixedDecimal(commission, 10),
        usd_amount: amount,
        source_currency: symbol.currency,
        source_action: actionText,
        source_description: '',
        duplicate_ordinal: 0,
        import_key: makeImportKey(['tradingview', date, kind, symbol.ticker, quantity, price, commission]),
      };
      items.push(trade);
      rows.push({ source_index: sourceIndex, action: actionText, category: 'trade', default_status: 'import', item: trade });
      continue;
    }

    if (!quantity) errors.push('现金事件金额无效');
    if ((kind === 'broker_deposit' || kind === 'dividend' || kind === 'interest') && quantity && Number(quantity) <= 0) {
      errors.push('该现金事件金额必须为正数');
    }
    if (kind === 'broker_withdrawal' && quantity && Number(quantity) >= 0) errors.push('提款金额必须为负数');
    if ((kind === 'tax' || kind === 'fee') && quantity && Number(quantity) >= 0) errors.push('税费金额必须为负数');
    if (errors.length > 0 || !date || !quantity) {
      rows.push({ source_index: sourceIndex, action: actionText, category: 'error', default_status: 'block', reason: errors.join('；') });
      continue;
    }
    const cashEvent: LedgerCashEvent = {
      source: 'tradingview',
      source_index: sourceIndex,
      effective_date: date,
      event_type: kind,
      ...(symbol.ticker ? { ticker: symbol.ticker } : {}),
      source_currency: symbol.currency,
      source_amount: fixedDecimal(quantity, 10),
      usd_amount: fixedDecimal(quantity, 10),
      source_action: actionText,
      source_description: '',
      duplicate_ordinal: 0,
      import_key: makeImportKey(['tradingview', date, actionText, symbol.ticker, quantity, symbol.currency]),
    };
    items.push(cashEvent);
    rows.push({ source_index: sourceIndex, action: actionText, category: 'cash_event', default_status: 'import', item: cashEvent });
  }

  addDuplicateOrdinals(items);
  const itemBySource = new Map(items.map((item) => [item.source_index, item]));
  for (const row of rows) {
    const item = itemBySource.get(row.source_index);
    if (item) row.item = item;
  }
  return {
    detection,
    rows: rows.sort((left, right) => left.source_index - right.source_index),
    warnings: [],
    header_row: headerIndex + 1,
  };
}

export const tradingViewImportAdapter: PortfolioImportAdapter<TradingViewParsedImport> = {
  source: 'tradingview',

  detect(input) {
    return parseInput(input).detection;
  },

  parse: parseInput,

  normalize(parsed): NormalizedLedger {
    return rowsForItems(parsed.rows);
  },

  audit(input, options) {
    const parsed = parseInput(input);
    return buildImportPreview(parsed, tradingViewImportAdapter.normalize(parsed), options);
  },

  export(ledger) {
    const rows: Array<{ date: string; source_index: number; cells: string[] }> = [];
    for (const trade of ledger.trades) {
      if (trade.source_currency !== 'USD') {
        throw new Error('TradingView 六列导出只支持 USD 交易。');
      }
      rows.push({
        date: trade.effective_date,
        source_index: trade.source_index,
        cells: [
          trade.ticker,
          trade.side === 'buy' ? 'Buy' : 'Sell',
          trade.shares,
          trade.price,
          trade.fees_usd,
          `${trade.effective_date} 00:00:00`,
        ],
      });
    }
    for (const event of ledger.cash_events) {
      if (event.source_currency !== 'USD') {
        throw new Error('TradingView 六列导出无法表达非 USD 现金事件的 USD 结算值。');
      }
      const symbol = event.ticker || 'USD:USD';
      let side: string;
      if (event.event_type === 'broker_deposit') side = 'Deposit';
      else if (event.event_type === 'broker_withdrawal') side = 'Withdrawal';
      else if (event.event_type === 'stock_allocation') {
        throw new Error('TradingView 六列导出无法无损表达 stock_allocation。');
      }
      else if (event.event_type === 'dividend') side = 'Dividend';
      else if (event.event_type === 'interest') side = 'Interest';
      else if (event.event_type === 'tax') side = 'Tax';
      else if (event.event_type === 'fee') side = 'Taxes and fees';
      else throw new Error(`TradingView 六列导出无法表达 ${event.event_type}。`);
      rows.push({
        date: event.effective_date,
        source_index: event.source_index,
        cells: [symbol, side, event.source_amount, '', '', `${event.effective_date} 00:00:00`],
      });
    }
    rows.sort((left, right) => left.date.localeCompare(right.date) || left.source_index - right.source_index);
    return Papa.unparse([
      ['Symbol', 'Side', 'Qty', 'Fill Price', 'Commission', 'Closing Time'],
      ...rows.map((row) => row.cells),
    ], { newline: '\n' });
  },
};
