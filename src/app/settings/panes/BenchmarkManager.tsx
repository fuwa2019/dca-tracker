import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { searchSymbols, type SymbolSearchResult } from '@/lib/quote';
import { DEFAULT_BENCHMARKS } from '@/lib/settings';
import { normalizeSymbol } from '@/lib/symbols';
import { LOCAL_MODE } from '@/lib/localMode';
import { cn } from '@/lib/utils';

export function BenchmarkManager({
  benchmarks,
  selected,
  onChange,
}: {
  benchmarks: string[];
  selected: string;
  onChange: (benchmarks: string[], selected: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const safeSelected = benchmarks.includes(selected) ? selected : benchmarks[0] ?? 'SPY';

  async function runSearch() {
    const q = normalizeSymbol(query);
    if (!q) return;
    if (LOCAL_MODE) {
      setResults([{ symbol: q, name: '本地手动添加', exchange: null, type: null }]);
      return;
    }
    setSearching(true);
    try {
      const next = await searchSymbols(q);
      setResults(next.length > 0 ? next : [{ symbol: q, name: '手动添加', exchange: null, type: null }]);
    } finally {
      setSearching(false);
    }
  }

  function add(symbol: string) {
    const ticker = normalizeSymbol(symbol);
    if (!ticker) return;
    const next = benchmarks.includes(ticker) ? benchmarks : [...benchmarks, ticker];
    onChange(next, ticker);
    setQuery('');
    setResults([]);
  }

  function remove(symbol: string) {
    const next = benchmarks.filter((b) => b !== symbol);
    const fallback = next.length > 0 ? next : DEFAULT_BENCHMARKS;
    onChange(fallback, safeSelected === symbol ? fallback[0] : safeSelected);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {benchmarks.map((ticker) => (
          <div
            key={ticker}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors',
              safeSelected === ticker
                ? 'border-brand/50 bg-brand/10 text-foreground'
                : 'border-border bg-surface text-muted-foreground hover:text-foreground',
            )}
          >
            <button type="button" className="inline-flex min-h-6 min-w-6 items-center justify-center" onClick={() => onChange(benchmarks, ticker)}>
              {ticker}
            </button>
            {ticker !== 'SPY' && (
              <button
                type="button"
                className="inline-flex min-h-6 min-w-6 items-center justify-center text-muted-foreground hover:text-loss"
                onClick={() => remove(ticker)}
                aria-label={`删除 ${ticker}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              runSearch();
            }
          }}
          aria-label="搜索要添加的基准"
          placeholder="搜索 ETF / 股票，例如 QQQ"
        />
        <Button type="button" variant="outline" size="sm" onClick={runSearch} disabled={searching || !query.trim()}>
          {searching ? '搜索中' : '搜索'}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="space-y-1">
          {results.map((row) => (
            <button
              key={`${row.symbol}-${row.exchange ?? ''}`}
              type="button"
              onClick={() => add(row.symbol)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-xs hover:bg-surface"
            >
              <span className="min-w-0">
                <span className="font-semibold">{row.symbol}</span>
                <span className="ml-2 text-muted-foreground">{row.name}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{row.exchange ?? row.type ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
