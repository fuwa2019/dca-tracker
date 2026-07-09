import { useEffect, useMemo, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { getUsMarketSession, type Quote, type UsMarketSessionKey } from '@/lib/quote';
import { getQuoteStatusSummary } from '@/lib/quoteStatus';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { LOCAL_MODE } from '@/lib/localMode';

interface Props {
  className?: string;
  compact?: boolean;
}

function formatEtClock(now: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

// TradingView-aligned session colors: closed=gray, pre/after=amber-orange,
// regular=green, overnight=deep blue.
const sessionTone: Record<UsMarketSessionKey, StatusTone> = {
  pre_market: 'warn',
  regular: 'ok',
  after_hours: 'warn',
  overnight: 'night',
  closed: 'neutral',
};

function readQuoteCache(queryClient: QueryClient): Quote[] {
  return queryClient
    .getQueriesData<Quote[]>({ queryKey: ['quotes'] })
    .flatMap(([, data]) => data ?? [])
    .filter((q) => q.price != null);
}

export function MarketStatusBar({ className, compact = false }: Props) {
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => new Date());
  const [quotes, setQuotes] = useState<Quote[]>(() => readQuoteCache(queryClient));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let active = true;
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      queueMicrotask(() => {
        if (!active) return;
        setQuotes(readQuoteCache(queryClient));
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [queryClient]);

  const session = getUsMarketSession(now);
  const quoteSummary = useMemo(() => getQuoteStatusSummary(quotes), [quotes]);
  const summaryText = LOCAL_MODE ? '内置 QQQ 样本 · 不连接 Supabase / Quote Worker' : quoteSummary.text;
  const summaryTitle = LOCAL_MODE ? '本地 Debug 模式使用内置 10 年 QQQ 数据' : quoteSummary.title;

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground tnum', className)}>
      <StatusBadge tone={sessionTone[session.key]} dot>
        美股{session.label}
      </StatusBadge>
      {!compact && (
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          NYC {formatEtClock(now)} ET
        </span>
      )}
      {!compact && (
        <span className="inline" title={summaryTitle}>
          · {session.detail} · {summaryText}
        </span>
      )}
    </div>
  );
}
