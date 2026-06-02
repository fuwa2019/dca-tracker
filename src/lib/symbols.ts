export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function normalizeSymbols(symbols: Iterable<string>): string[] {
  return [...new Set([...symbols].map(normalizeSymbol).filter(Boolean))].sort();
}
