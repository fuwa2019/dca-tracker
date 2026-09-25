import type { Quote } from '@/lib/quote';

/**
 * Foreign listings are quoted in their own currency. Holdings, exposure and
 * day P&L work in USD, at the rate of the ticker's latest trade — the same
 * rate the ledger falls back to when no daily FX series is available.
 */
export function usdRatesByTicker(
  trades: ReadonlyArray<{ ticker: string; currency: string; fxRateToUsd: number | null }>,
): Map<string, number> {
  const rates = new Map<string, number>();
  for (const trade of trades) {
    if (trade.currency === 'USD') rates.set(trade.ticker, 1);
    else if (trade.fxRateToUsd) rates.set(trade.ticker, trade.fxRateToUsd);
  }
  return rates;
}

export function toUsdQuotes(quotes: readonly Quote[], rates: ReadonlyMap<string, number>): Map<string, Quote> {
  return new Map(quotes.map((quote) => {
    const rate = rates.get(quote.ticker);
    return [quote.ticker, rate === undefined || rate === 1 ? quote : scaleQuote(quote, rate)];
  }));
}

function scaleQuote(quote: Quote, rate: number): Quote {
  const scale = (value: number | null | undefined) => (value == null ? value ?? null : value * rate);
  return {
    ...quote,
    price: scale(quote.price),
    displayPrice: scale(quote.displayPrice),
    regularPrice: scale(quote.regularPrice),
    prevClose: scale(quote.prevClose),
    change: scale(quote.change),
    currency: 'USD',
  };
}
