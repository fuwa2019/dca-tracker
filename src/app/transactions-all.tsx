import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TxnList } from '@/components/TxnList';
import { Kicker } from '@/components/Kicker';
import { useTransactions } from '@/hooks/usePortfolio';
import { transactionCashAmount } from '@/lib/calc/transactionAmounts';

type Filter = 'all' | 'buy' | 'sell' | 'dca' | 'lumpsum' | 'note';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' },
  { value: 'dca', label: '定投' },
  { value: 'lumpsum', label: '建仓' },
  { value: 'note', label: '备注' },
];

const PAGE_SIZE = 50;

export function TransactionsAllPage() {
  const { data: txns = [] } = useTransactions();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [q, filter]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (filter === 'buy' || filter === 'sell') {
        if (t.side !== filter) return false;
      } else if (filter === 'dca' || filter === 'lumpsum') {
        if (t.kind !== filter) return false;
      } else if (filter === 'note') {
        const note = (t.note ?? '').toLowerCase();
        if (!note) return false;
        return needle ? note.includes(needle) : true;
      }
      if (!needle) return true;
      const cashAmount = transactionCashAmount(t);
      const hay = [
        t.ticker,
        t.trade_date,
        t.note ?? '',
        cashAmount.toFixed(2),
        Number(t.price).toFixed(2),
        Number(t.shares).toFixed(4),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [txns, q, filter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageEnd),
    [filtered, pageStart, pageEnd],
  );

  const searchPlaceholder = filter === 'note'
    ? '备注关键词'
    : '搜索：股票 / 日期 / 金额 / 备注';

  return (
    <div className="container max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-4">
      <Kicker en="All Trades" zh="全部交易" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
          />
        </div>
        <div className="overflow-x-auto -mx-1 px-1">
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v)}
            name="txn-filter"
            ariaLabel="交易筛选"
            options={FILTERS}
            size="sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className="tnum">
          {filtered.length === 0 ? '0' : `${pageStart + 1}-${pageEnd}`} / {filtered.length} 条
          {filtered.length !== txns.length && <span> · 全部 {txns.length} 条</span>}
        </p>
        <PaginationControls
          page={safePage}
          pageCount={pageCount}
          canPrev={safePage > 1}
          canNext={safePage < pageCount}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
        />
      </div>

      <TxnList rows={pageRows} emptyText="没有匹配的交易" />

      {filtered.length > PAGE_SIZE && (
        <div className="flex justify-end">
          <PaginationControls
            page={safePage}
            pageCount={pageCount}
            canPrev={safePage > 1}
            canNext={safePage < pageCount}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
          />
        </div>
      )}
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="tnum">第 {page} / {pageCount} 页 · 每页 {PAGE_SIZE} 条</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={!canPrev} onClick={onPrev}>
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" disabled={!canNext} onClick={onNext}>
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
