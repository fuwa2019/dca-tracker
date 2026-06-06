// Downloads ~10 years of daily adjusted closes for the local-build dataset.
//
// The "local version" of the app (VITE_LOCAL_MODE=1) ships fully offline: no
// Supabase, no Quote Worker. It renders a 10-year QQQ DCA simulation built from
// the prices this script bundles into `src/data/local-dataset.json`.
//
// Re-run yearly (or whenever you want fresher prices):
//   npm run build:dataset
//
// Source: Yahoo Finance public chart JSON (adjusted close, splits+divs applied).

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SYMBOLS = ['QQQ', 'SPY'];
const RANGE = '10y';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/local-dataset.json');

async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${RANGE}&interval=1d&events=div%2Csplit`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${symbol}: HTTP ${r.status}`);
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: no chart result`);
  const ts = result.timestamp ?? [];
  const adj = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const close = result.indicators?.quote?.[0]?.close ?? [];
  const points = [];
  for (let i = 0; i < ts.length; i++) {
    const px = adj[i] ?? close[i];
    if (px == null || !Number.isFinite(px)) continue;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    points.push([date, Number(px.toFixed(4))]);
  }
  return points;
}

const prices = {};
for (const symbol of SYMBOLS) {
  process.stdout.write(`Fetching ${symbol}… `);
  const points = await fetchSeries(symbol);
  prices[symbol] = points;
  console.log(`${points.length} points (${points[0][0]} → ${points[points.length - 1][0]})`);
}

const dataset = {
  generatedAt: new Date().toISOString().slice(0, 10),
  ticker: 'QQQ',
  benchmark: 'SPY',
  monthlyUsd: 60,
  targetRate: 7.2,
  // [date, adjustedClose] tuples, ascending by date.
  prices,
};

writeFileSync(OUT, JSON.stringify(dataset) + '\n');
console.log(`\nWrote ${OUT}`);
