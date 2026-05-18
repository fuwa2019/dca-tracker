import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TxnList } from '@/components/TxnList';
import { useTransactions } from '@/hooks/usePortfolio';

type Filter = 'all' | 'buy' | 'sell' | 'dca' | 'lumpsum';

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
    <div className="container max-w-5xl py-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">全部交易</h1>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：股票 / 日期 / 金额 / 备注"
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="buy">仅买入</SelectItem>
            <SelectItem value="sell">仅卖出</SelectItem>
            <SelectItem value="dca">定投</SelectItem>
            <SelectItem value="lumpsum">大额</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground tnum">{filtered.length} / {txns.length} 条</p>
      <TxnList rows={filtered} emptyText="没有匹配的交易" />
    </div>
  );
}
