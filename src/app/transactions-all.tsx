import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TxnList } from '@/components/TxnList';
import { useTransactions } from '@/hooks/usePortfolio';

type Filter = 'all' | 'buy' | 'sell' | 'dca' | 'lumpsum';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' },
  { value: 'dca', label: '定投' },
  { value: 'lumpsum', label: '大额' },
];

export function TransactionsAllPage() {
  const { data: txns = [] } = useTransactions();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (filter === 'buy' || filter === 'sell') {
        if (t.side !== filter) return false;
      } else if (filter === 'dca' || filter === 'lumpsum') {
        if (t.kind !== filter) return false;
      }
      if (!needle) return true;
      const notional = Number(t.shares) * Number(t.price);
      const hay = [
        t.ticker,
        t.trade_date,
        t.note ?? '',
        notional.toFixed(2),
        Number(t.price).toFixed(2),
        Number(t.shares).toFixed(4),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [txns, q, filter]);

  return (
    <div className="container max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：股票 / 日期 / 金额 / 备注"
            className="pl-9"
          />
        </div>
        <SegmentedControl
          value={filter}
          onChange={(v) => setFilter(v)}
          name="txn-filter"
          ariaLabel="交易筛选"
          options={FILTERS}
          size="sm"
        />
      </div>

      <p className="text-xs text-muted-foreground tnum">{filtered.length} / {txns.length} 条</p>
      <TxnList rows={filtered} emptyText="没有匹配的交易" />
    </div>
  );
}
