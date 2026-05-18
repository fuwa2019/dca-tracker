import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { TxnList } from '@/components/TxnList';
import { TxnForm } from '@/components/TxnForm';
import { useTransactions } from '@/hooks/usePortfolio';

export function TransactionsPage() {
  const [adding, setAdding] = useState(false);
  const { data: txns = [], isLoading } = useTransactions();
  const recent = txns.slice(0, 5);

  return (
    <div className="container max-w-5xl py-6 space-y-5">
      <div className="flex items-baseline justify-between">
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-semibold tracking-tight"
        >
          最近交易
        </motion.h1>
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
        <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
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
