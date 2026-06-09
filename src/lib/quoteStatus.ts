import type { Quote, QuoteMeta } from '@/lib/quote';

type QuoteStatusMeta = QuoteMeta | Quote;

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

function getCachedAt(meta: QuoteStatusMeta) {
  return 'cachedAt' in meta ? meta.cachedAt : undefined;
}

function parseTime(value?: string) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getQuoteSourceLabel(meta: QuoteStatusMeta) {
  const source = meta.source === 'schwab' ? 'Schwab' : 'Yahoo';
  return meta.fallback ? `${source} 备用行情` : source;
}

function getRealtimeLabel(meta: QuoteStatusMeta) {
  if (meta.realtime === true) return '实时';
  if (meta.source === 'yahoo') return '可能延迟';
  if (meta.delayMinutes != null) return `延迟 ${meta.delayMinutes}min`;
  if (meta.realtime === false) return '延迟';
  return '实时性未知';
}

export function getQuoteStatusLabel(meta: QuoteStatusMeta): string {
  return `${getQuoteSourceLabel(meta)} · ${getRealtimeLabel(meta)}`;
}

export function getQuoteTimeLabel(meta: QuoteStatusMeta): string {
  const quoteTime = formatLocalClock(meta.asOf);
  const fetchedAt = meta.fetchedAt ?? getCachedAt(meta);
  const fetchedTime = formatLocalClock(fetchedAt);
  if (quoteTime) {
    const quoteTimestamp = parseTime(meta.asOf);
    const fetchedTimestamp = parseTime(fetchedAt);
    if (
      fetchedTime
      && quoteTimestamp != null
      && fetchedTimestamp != null
      && fetchedTimestamp - quoteTimestamp > 5 * 60_000
    ) {
      return `行情 ${quoteTime} · 拉取 ${fetchedTime}`;
    }
    return `行情 ${quoteTime}`;
  }

  return fetchedTime ? `拉取 ${fetchedTime}` : '时间未知';
}

export function getQuoteStatusText(meta: QuoteStatusMeta | null): string {
  if (!meta) return '行情源 — · 实时性未知';
  return `${getQuoteStatusLabel(meta)} · ${getQuoteTimeLabel(meta)}`;
}

export function getQuoteStatusSummary(quotes: Quote[]): { text: string; title?: string } {
  const liveQuotes = quotes.filter((quote) => quote.price != null);
  if (liveQuotes.length === 0) return { text: getQuoteStatusText(null) };

  const hasSchwab = liveQuotes.some((quote) => quote.source === 'schwab' && !quote.fallback);
  const hasYahooFallback = liveQuotes.some((quote) => quote.source === 'yahoo' && quote.fallback);
  const hasOtherYahoo = liveQuotes.some((quote) => quote.source === 'yahoo' && !quote.fallback);

  if (hasSchwab && hasYahooFallback) {
    const latest = latestQuote(liveQuotes);
    const title = providerDistributionTitle(liveQuotes);
    return {
      text: `Schwab + Yahoo 备用 · 部分可能延迟 · ${latest ? getQuoteTimeLabel(latest) : '时间未知'}`,
      title,
    };
  }

  if (hasSchwab && hasOtherYahoo) {
    const latest = latestQuote(liveQuotes);
    const title = providerDistributionTitle(liveQuotes);
    return {
      text: `Schwab + Yahoo · 部分可能延迟 · ${latest ? getQuoteTimeLabel(latest) : '时间未知'}`,
      title,
    };
  }

  const latest = latestQuote(liveQuotes);
  return {
    text: getQuoteStatusText(latest),
    title: providerDistributionTitle(liveQuotes),
  };
}

function latestQuote(quotes: Quote[]): Quote | null {
  let latest: Quote | null = null;
  for (const quote of quotes) {
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

function providerDistributionTitle(quotes: Quote[]) {
  const counts = new Map<string, number>();
  for (const quote of quotes) {
    const label = quote.providerLabel ?? getQuoteSourceLabel(quote);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  return [...counts.entries()].map(([label, count]) => `${label}: ${count}`).join(' · ');
}
