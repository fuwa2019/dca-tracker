import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, PlusCircle, Search, X } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DEFAULT_TXN_SORT, sortLedgerRows, TxnList, type TxnSort } from '@/components/TxnList';
import { useTransactions } from '@/hooks/usePortfolio';
import { transactionCashAmount } from '@/lib/calc/transactionAmounts';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 50;

const SIDES = [
  { value: 'buy', label: '买入' },
  { value: 'sell', label: '卖出' },
] as const;

const KINDS = [
  { value: 'dca', label: '定投' },
  { value: 'lumpsum', label: '建仓' },
] as const;

type Side = (typeof SIDES)[number]['value'];
type Kind = (typeof KINDS)[number]['value'];

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function TransactionsAllPage() {
  const { data: txns = [] } = useTransactions();
  const [q, setQ] = useState('');
  const [sides, setSides] = useState<ReadonlySet<Side>>(() => new Set());
  const [kinds, setKinds] = useState<ReadonlySet<Kind>>(() => new Set());
  const [tickers, setTickers] = useState<ReadonlySet<string>>(() => new Set());
  const [notesOnly, setNotesOnly] = useState(false);
  const [sort, setSort] = useState<TxnSort>(DEFAULT_TXN_SORT);
  const [page, setPage] = useState(1);

  const activeCount = sides.size + kinds.size + tickers.size + (notesOnly ? 1 : 0);

  useEffect(() => {
    setPage(1);
  }, [q, sides, kinds, tickers, notesOnly]);

  const allTickers = useMemo(
    () => Array.from(new Set(txns.map((t) => t.ticker))).sort(),
    [txns],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return txns.filter((t) => {
      if (sides.size > 0 && !sides.has(t.side as Side)) return false;
      if (kinds.size > 0 && !kinds.has(t.kind as Kind)) return false;
      if (tickers.size > 0 && !tickers.has(t.ticker)) return false;
      if (notesOnly && !(t.note ?? '').trim()) return false;
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
  }, [txns, q, sides, kinds, tickers, notesOnly]);

  // Sort the whole filtered set, then paginate: a header must not reorder
  // only the rows that happen to be on screen.
  const ordered = useMemo(() => sortLedgerRows(filtered, sort), [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pageRows = useMemo(() => ordered.slice(pageStart, pageEnd), [ordered, pageStart, pageEnd]);

  return (
    <div className="workbench-page max-w-5xl space-y-3">
      <header className="workbench-intro">
        <p className="workbench-lede">搜索、筛选并核对每一笔已入账的交易。</p>
      </header>

      {/* Toolbar row: search on the left, add-a-filter chips beside it. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索：股票 / 日期 / 金额 / 备注"
            className="h-9 pl-9"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <FilterChip label="类型" count={sides.size}>
            <DropdownMenuLabel>交易方向</DropdownMenuLabel>
            {SIDES.map(({ value, label }) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={sides.has(value)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => setSides((current) => toggle(current, value))}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </FilterChip>

          <FilterChip label="策略" count={kinds.size + (notesOnly ? 1 : 0)}>
            <DropdownMenuLabel>建仓方式</DropdownMenuLabel>
            {KINDS.map(({ value, label }) => (
              <DropdownMenuCheckboxItem
                key={value}
                checked={kinds.has(value)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => setKinds((current) => toggle(current, value))}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={notesOnly}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => setNotesOnly((value) => !value)}
            >
              仅带备注
            </DropdownMenuCheckboxItem>
          </FilterChip>

          <FilterChip label="标的" count={tickers.size}>
            <DropdownMenuLabel>标的</DropdownMenuLabel>
            <div className="max-h-64 overflow-y-auto">
              {allTickers.map((ticker) => (
                <DropdownMenuCheckboxItem
                  key={ticker}
                  checked={tickers.has(ticker)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => setTickers((current) => toggle(current, ticker))}
                >
                  {ticker}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          </FilterChip>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => {
                setSides(new Set());
                setKinds(new Set());
                setTickers(new Set());
                setNotesOnly(false);
              }}
            >
              <X className="h-3.5 w-3.5" />
              清除筛选
            </Button>
          )}
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

      <TxnList rows={pageRows} emptyText="没有匹配的交易" sort={sort} onSortChange={setSort} />

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

/**
 * Reference affordance: filters read as "add a filter" chips rather than
 * labelled dropdowns, and carry their active count once set.
 */
function FilterChip({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={active ? `${label} 筛选，已选 ${count} 项` : `按${label}筛选`}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors',
            active
              ? 'border-foreground/25 bg-surface-elevated text-foreground'
              : 'border-border bg-surface text-muted-foreground hover:text-foreground',
          )}
        >
          <PlusCircle className="h-3.5 w-3.5" />
          {label}
          {active && <span className="font-num tnum">{count}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
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
