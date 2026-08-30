import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, CheckCircle2, FileUp, Plus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TxnList, TxnListSkeleton } from '@/components/TxnList';
import { TxnForm } from '@/components/TxnForm';
import { useTransactions } from '@/hooks/usePortfolio';
import { useQuotes } from '@/hooks/useQuotes';
import { aggregatePositions } from '@/lib/calc/position';
import { SchwabTransactionTools } from '@/components/SchwabTransactionTools';
import { PortfolioImportTools } from '@/components/PortfolioImportTools';
import { LEDGER_IMPORT_V2 } from '@/lib/localMode';

export function TransactionsPage() {
  const [adding, setAdding] = useState(false);
  const { data: txns = [], isLoading } = useTransactions();
  const recent = txns.slice(0, 5);
  const positions = useMemo(
    () => aggregatePositions(txns).filter((p) => p.shares > 1e-9),
    [txns],
  );
  const symbols = useMemo(() => positions.map((p) => p.ticker), [positions]);
  const { data: quotes = [] } = useQuotes(symbols);
  const defaultTicker = useMemo(() => {
    const quoteByTicker = new Map(quotes.map((q) => [q.ticker, q]));
    return [...positions]
      .sort((a, b) => {
        const quoteA = quoteByTicker.get(a.ticker);
        const quoteB = quoteByTicker.get(b.ticker);
        const priceA = quoteA?.price ?? quoteA?.displayPrice ?? quoteA?.regularPrice ?? a.avgCost;
        const priceB = quoteB?.price ?? quoteB?.displayPrice ?? quoteB?.regularPrice ?? b.avgCost;
        return b.shares * priceB - a.shares * priceA;
      })[0]?.ticker ?? 'QQQ';
  }, [positions, quotes]);

  return (
    <div className="workbench-page">
      <header className="workbench-intro">
        <p className="workbench-lede">
          所有交易和现金事件都先经过预览、去重和对账，再进入组合计算。
        </p>
        <div className="flex flex-wrap gap-2">
          <Dialog open={adding} onOpenChange={setAdding}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4" />手工录入</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>新增交易</DialogTitle></DialogHeader>
              <TxnForm defaultTicker={defaultTicker} onDone={() => setAdding(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <section className="workbench-panel mt-4" aria-labelledby="import-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <FileUp className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id="import-title" className="text-sm font-semibold">统一导入预览</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
                支持 Schwab、IBKR 和 TradingView。文件只在本机解析，确认前不写入数据库；每一行都会得到导入、重复、忽略或阻止状态。
              </p>
            </div>
          </div>
          {LEDGER_IMPORT_V2
            ? <PortfolioImportTools transactions={txns} />
            : <SchwabTransactionTools transactions={txns} />}
        </div>
        <div className="mt-5 grid gap-2 border-t border-border pt-4 text-xs sm:grid-cols-3">
          <ImportRule label="支持来源" value={LEDGER_IMPORT_V2 ? 'Schwab · IBKR · TradingView' : 'Schwab 兼容导入'} />
          <ImportRule label="写入边界" value="事务提交，失败不留半条记录" />
          <ImportRule label="现有账本" value={`${txns.length} 笔交易 · ${positions.length} 个持仓`} />
        </div>
      </section>

      <section className="mt-6" aria-labelledby="recent-ledger-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="workbench-eyebrow">Recorded activity</div>
            <h2 id="recent-ledger-title" className="mt-1 text-lg font-semibold">最近记录</h2>
            <p className="mt-1 text-xs text-muted-foreground">{txns.length} 笔交易 · 默认展示最近 5 笔</p>
          </div>
          {txns.length > 5 && (
            <Button asChild variant="outline" size="sm">
              <Link to="/transactions/all">查看全部 <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          )}
        </div>

        {isLoading ? (
          <TxnListSkeleton />
        ) : (
          <TxnList rows={recent} emptyText="还没有交易，先导入文件或手工录入第一笔。" />
        )}
      </section>

      <section className="workbench-next" aria-label="账本说明">
        <div className="flex min-w-0 gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gain" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">可审计边界</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">源文件身份、结算金额、现金事件和导入回执会保留在账本合同中，不直接改写原始计算函数。</p>
          </div>
        </div>
        <BookOpen className="hidden h-5 w-5 text-muted-foreground sm:block" aria-hidden="true" />
      </section>
    </div>
  );
}

function ImportRule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-muted-foreground">{label}</div>
        <div className="mt-1 font-medium text-foreground">{value}</div>
      </div>
    </div>
  );
}
