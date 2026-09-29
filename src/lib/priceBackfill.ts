export type PriceMap = Map<string, Map<string, number>>;
export type PriceBounds = ReadonlyMap<string, { startDate: string; endDate: string }>;

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

export function symbolsNeedingBackfill(
  map: PriceMap,
  symbols: string[],
  earliestDate: string,
  todayIso: string,
  bounds?: PriceBounds,
): string[] {
  return symbols.filter((symbol) => {
    const startDate = bounds?.get(symbol)?.startDate ?? earliestDate;
    const endDate = bounds?.get(symbol)?.endDate ?? todayIso;
    const needsMultiPointSeries = addDays(startDate, 7) < endDate;
    const prices = map.get(symbol);
    if (!prices || prices.size === 0) return true;
    const dates = [...prices.keys()].sort();
    return dates[0] > addDays(startDate, 7)
      || (needsMultiPointSeries && (prices.size < 2 || dates[dates.length - 1] < addDays(endDate, -10)));
  });
}

export async function fetchHistoryPages<T>(
  symbols: string[],
  range: string,
  request: (params: URLSearchParams) => Promise<T>,
): Promise<T[]> {
  const pages: T[] = [];
  // Separate symbol batches also work when the Worker serves a KV hit without cursor metadata.
  for (let offset = 0; offset < symbols.length; offset += 10) {
    const params = new URLSearchParams({ symbols: symbols.slice(offset, offset + 10).join(','), range });
    pages.push(await request(params));
  }
  return pages;
}
