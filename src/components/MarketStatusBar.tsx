import { useEffect, useMemo, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { getUsMarketSession, type Quote, type UsMarketSessionKey } from '@/lib/quote';
import { StatusBadge, type StatusTone } from '@/components/StatusBadge';
import { cn } from '@/lib/utils';

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

const sessionTone: Record<UsMarketSessionKey, StatusTone> = {
  pre_market: 'info',
  regular: 'ok',
  after_hours: 'warn',
  overnight: 'info',
  closed: 'neutral',
};

function readQuoteCache(queryClient: QueryClient): Quote[] {
  return queryClient
    .getQueriesData<Quote[]>({ queryKey: ['quotes'] })
    .flatMap(([, data]) => data ?? [])
    .filter((q) => q.price != null);
}

function latestQuote(quotes: Quote[]): Quote | null {
  const candidates = quotes.some((quote) => quote.fallback)
    ? quotes.filter((quote) => quote.fallback)
    : quotes;
  let latest: Quote | null = null;
  for (const quote of candidates) {
    if (!latest) {
      latest = quote;
      continue;
    }
    const currentTime = Date.parse(quote.asOf ?? quote.fetchedAt ?? quote.cachedAt ?? '');
    const latestTime = Date.parse(latest.asOf ?? latest.fetchedAt ?? latest.cachedAt ?? '');
    if (Number.isFinite(currentTime) && (!Number.isFinite(latestTime) || currentTime > latestTime)) {
      latest = quote;
    }
  }
  return latest;
}

function formatLocalClock(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function realtimeLabel(quote: Quote) {
  if (quote.realtime === true) return '实时';
  if (quote.delayMinutes != null) return `延迟 ${quote.delayMinutes}min`;
  if (quote.realtime === false) return '延迟';
  if (quote.source === 'yahoo') return '可能延迟';
  return '实时性未知';
}

function quoteSourceLabel(quote: Quote) {
  const source = quote.source === 'schwab' ? 'Schwab' : 'Yahoo';
  return quote.fallback ? `${source} 备用行情` : source;
}

function quoteStatusText(quote: Quote | null) {
  if (!quote) return '行情源 — · 实时性未知';
  const time = formatLocalClock(quote.asOf);
  const fetched = formatLocalClock(quote.fetchedAt ?? quote.cachedAt);
  const timeText = time ? `行情 ${time}` : fetched ? `拉取 ${fetched}` : '时间未知';
  return `${quoteSourceLabel(quote)} · ${realtimeLabel(quote)} · ${timeText}`;
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
    return queryClient.getQueryCache().subscribe(() => {
      setQuotes(readQuoteCache(queryClient));
    });
  }, [queryClient]);

  const session = getUsMarketSession(now);
  const quote = useMemo(() => latestQuote(quotes), [quotes]);
  const quoteText = quoteStatusText(quote);
  const quoteTitle = quote?.providerLabel ? `Provider: ${quote.providerLabel}` : undefined;

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
        <span className="inline" title={quoteTitle}>
          · {session.detail} · {quoteText}
        </span>
      )}
    </div>
  );
}
