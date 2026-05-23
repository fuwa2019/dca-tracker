import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getUsMarketSession, type UsMarketSessionKey } from '@/lib/quote';
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

export function MarketStatusBar({ className, compact = false }: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const session = getUsMarketSession(now);

  return (
    <div className={cn('flex items-center gap-2 text-xs text-muted-foreground tnum', className)}>
      <StatusBadge tone={sessionTone[session.key]} dot>
        美股{session.label}
      </StatusBadge>
      {!compact && (
        <span className="hidden items-center gap-1 sm:inline-flex">
          <Clock className="h-3 w-3" />
          NYC {formatEtClock(now)} ET
        </span>
      )}
      {!compact && (
        <span className="hidden md:inline">
          · {session.detail}{session.isTrading ? ' · 行情延迟 ~15min' : ''}
        </span>
      )}
    </div>
  );
}
