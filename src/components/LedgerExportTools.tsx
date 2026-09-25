import { useMemo } from 'react';
import { Download } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAccounts, useCashflows, useTransactions } from '@/hooks/usePortfolio';
import { exportLedgerCsv } from '@/lib/export/ledgerExport';
import { exportTradingViewCsv } from '@/lib/export/tradingviewExport';
import { todayLocalIso } from '@/lib/format';

function download(filename: string, text: string) {
  // A BOM keeps Excel from mis-reading the Chinese descriptions.
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Two exports of the stored ledger: the complete native file (every field,
 * for backup and audit) and a TradingView Portfolio file, so broker imports
 * reach TradingView without typing them in again.
 */
export function LedgerExportTools() {
  const transactions = useTransactions();
  const cashflows = useCashflows();
  const accounts = useAccounts();
  const accountNames = useMemo(
    () => new Map((accounts.data ?? []).map((account) => [account.id, account.name])),
    [accounts.data],
  );
  const ready = !!transactions.data && !!cashflows.data;
  const empty = ready && transactions.data!.length === 0 && cashflows.data!.length === 0;
  const stamp = todayLocalIso();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!ready || empty}
        onClick={() => download(
          `portfolio-ledger-${stamp}.csv`,
          exportLedgerCsv(transactions.data ?? [], cashflows.data ?? [], accountNames),
        )}
      >
        <Download className="h-4 w-4" />导出完整账本
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!ready || empty}
        onClick={() => download(
          `tradingview-portfolio-${stamp}.csv`,
          exportTradingViewCsv(transactions.data ?? [], cashflows.data ?? []),
        )}
      >
        <Download className="h-4 w-4" />导出 TradingView
      </Button>
    </div>
  );
}
