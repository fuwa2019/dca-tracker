// Ticker logos must stay bundled: no source file may request a third-party logo
// host, and every catalogued ticker must ship its own file under public/ticker-logos.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const failures = [];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const file of walk('src').filter((f) => /\.(ts|tsx)$/.test(f))) {
  if (/financialmodelingprep|image-stock/.test(readFileSync(file, 'utf8'))) {
    failures.push(`${file}: requests a third-party logo host`);
  }
}

const catalog = readFileSync('src/data/ticker-names.ts', 'utf8');
const tickers = [...catalog.matchAll(/^ {2}'?([A-Z][A-Z0-9.]*)'?:/gm)].map((m) => m[1]);
if (tickers.length === 0) failures.push('ticker-names.ts: no tickers parsed');
for (const t of tickers) {
  if (!existsSync(`public/ticker-logos/${t}.png`)) failures.push(`public/ticker-logos/${t}.png is missing`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`ticker logos: ${tickers.length} bundled, no third-party logo requests`);
