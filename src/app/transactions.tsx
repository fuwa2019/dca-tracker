import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TxnList } from '@/components/TxnList';
import { TxnForm } from '@/components/TxnForm';
import { Kicker } from '@/components/Kicker';
import { useTransactions } from '@/hooks/usePortfolio';

export function TransactionsPage() {
  const [adding, setAdding] = useState(false);
  const { data: txns = [], isLoading } = useTransactions();
  const recent = txns.slice(0, 5);

  return (
    <div className="container max-w-5xl px-4 py-5 sm:px-6 sm:py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Kicker en="Recent Trades" zh="最近交易" />
          <p className="mt-1.5 text-[11px] text-muted-foreground">{txns.length} 笔已记录 · 展示最近 5 笔</p>
        </div>
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4" />添加交易</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>新增交易</DialogTitle></DialogHeader>
            <TxnForm onDone={() => setAdding(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="h-24 animate-pulse rounded-2xl bg-surface-elevated" />
      ) : (
        <TxnList rows={recent} emptyText="还没有交易，点右上角添加第一笔" />
      )}

      {txns.length > 5 && (
        <div className="flex justify-center">
          <Button asChild variant="ghost">
            <Link to="/transactions/all">查看全部 ({txns.length}) <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      )}
    </div>
  );
}
