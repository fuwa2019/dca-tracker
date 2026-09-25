import { Link } from 'react-router-dom';
import { AlertTriangle } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { LedgerCheck } from '@/lib/calc/ledgerChecks';

/**
 * Shown beside figures when a blocking accounting check failed, so an
 * unreconciled number is never displayed silently. Links to the full list.
 */
export function UnreconciledBadge({ checks, className }: { checks: readonly LedgerCheck[]; className?: string }) {
  const failed = checks.filter((check) => check.blocking && check.status === 'fail');
  if (failed.length === 0) return null;
  return (
    <Link
      to="/health"
      title={failed.map((check) => `${check.label}：${check.message}`).join('\n')}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-loss/40 bg-loss/10 px-2 py-1 text-[11px] font-medium text-loss hover:bg-loss/15',
        className,
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      数据未对账 · {failed.map((check) => check.label).join('、')}
    </Link>
  );
}
