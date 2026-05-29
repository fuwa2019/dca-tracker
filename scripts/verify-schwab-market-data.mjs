import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = await mkdtemp(path.join(tmpdir(), 'dca-schwab-tests-'));

try {
  execFileSync(
    path.join(root, 'node_modules/.bin/tsc'),
    [
      '-p',
      path.join(root, 'workers/quote/tsconfig.json'),
      '--outDir',
      outDir,
      '--module',
      'ES2022',
      '--noEmit',
      'false',
    ],
    { stdio: 'pipe' },
  );

  const mod = await import(path.join(outDir, 'marketData.js'));
  const env = {
    SCHWAB_CLIENT_ID: 'client-id',
    SCHWAB_CLIENT_SECRET: 'client-secret',
    SCHWAB_REDIRECT_URI: 'http://localhost:8787/api/schwab/oauth/callback',
    SCHWAB_REFRESH_TOKEN: 'refresh-secret',
    MARKET_DATA_PROVIDER: 'schwab',
  };

  assert.deepEqual(mod.parseSymbolsParam(' voo, QQQM,voo,,smh '), ['VOO', 'QQQM', 'SMH'], 'symbols parse and de-dupe');
  assert.equal(mod.marketDataProviderFromEnv(env), 'schwab', 'provider env switch');
  assert.throws(
    () => mod.assertSchwabMarketDataUrl('https://api.schwabapi.com/trader/v1/accounts'),
    /blocked_schwab_endpoint/,
    'blocks accounts endpoint',
  );
  assert.throws(
    () => mod.assertSchwabMarketDataUrl('https://api.schwabapi.com/trader/v1/accounts/hash/orders'),
    /blocked_schwab_endpoint/,
    'blocks orders endpoint',
  );
  assert.equal(
    mod.assertSchwabMarketDataUrl('/quotes?symbols=VOO').toString(),
    'https://api.schwabapi.com/marketdata/v1/quotes?symbols=VOO',
    'allows marketdata quote endpoint',
  );

  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/oauth/token')) {
      return jsonResponse({ access_token: `access-${calls.length}`, expires_in: 1800 });
    }
    if (url.includes('/marketdata/v1/quotes')) {
      return jsonResponse({
        VOO: {
          quote: { lastPrice: 501, closePrice: 500, netChange: 1, netPercentChange: 0.2 },
          reference: { symbol: 'VOO' },
        },
        QQQM: {
          quote: { lastPrice: 210, closePrice: 200, netChange: 10, netPercentChange: 5 },
          reference: { symbol: 'QQQM' },
        },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  mod.resetSchwabClientForTests();
  const client = new mod.SchwabMarketDataClient(env, fetcher, async () => {});
  const quotes = await client.getQuotes(['voo', 'qqqm', 'voo']);
  assert.equal(calls.filter((c) => c.url.includes('/marketdata/v1/quotes')).length, 1, 'batch quote request');
  assert.deepEqual(quotes.map((q) => q.ticker), ['VOO', 'QQQM'], 'normalized quote order');

  let quoteAttempts = 0;
  const refreshCalls = [];
  const retryFetcher = async (url, init = {}) => {
    refreshCalls.push({ url, init });
    if (url.endsWith('/v1/oauth/token')) {
      return jsonResponse({ access_token: `new-access-${refreshCalls.length}`, expires_in: 1800 });
    }
    if (++quoteAttempts === 1) return new Response('expired', { status: 401 });
    return jsonResponse({ VOO: { quote: { lastPrice: 501 }, reference: { symbol: 'VOO' } } });
  };
  mod.resetSchwabClientForTests();
  const retryClient = new mod.SchwabMarketDataClient(env, retryFetcher, async () => {});
  await retryClient.getQuotes(['VOO']);
  assert.equal(quoteAttempts, 2, '401 refresh and retry once');
  assert.ok(refreshCalls.some((c) => String(c.init.body).includes('grant_type=refresh_token')), 'uses refresh token');

  let sleeps = [];
  let limitedAttempts = 0;
  const limitedFetcher = async (url) => {
    if (url.endsWith('/v1/oauth/token')) return jsonResponse({ access_token: 'limited-access', expires_in: 1800 });
    limitedAttempts += 1;
    if (limitedAttempts === 1) return new Response('slow down', { status: 429, headers: { 'Retry-After': '1' } });
    return jsonResponse({ VOO: { quote: { lastPrice: 501 }, reference: { symbol: 'VOO' } } });
  };
  mod.resetSchwabClientForTests();
  const limitedClient = new mod.SchwabMarketDataClient(env, limitedFetcher, async (ms) => sleeps.push(ms));
  await limitedClient.getQuotes(['VOO']);
  assert.equal(limitedAttempts, 2, '429 backs off and retries once');
  assert.ok(sleeps.some((ms) => ms >= 1000), '429 retry-after respected');

  const sanitized = JSON.stringify(mod.sanitizeForLog({
    client_secret: 'client-secret',
    access_token: 'access-secret',
    message: 'Authorization: Bearer access-secret&refresh_token=refresh-secret',
  }));
  assert.doesNotMatch(sanitized, /client-secret|access-secret|refresh-secret/, 'secrets redacted from logs');

  const perfSource = await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'src/app/performance.tsx'), 'utf8'));
  assert.match(perfSource, /交易业绩是否跑赢 \{selectedBenchmark\}/, 'benchmark title uses selected benchmark');
  assert.doesNotMatch(perfSource, /交易业绩是否跑赢 SPY/, 'benchmark title does not hard-code SPY');

  console.log('Schwab market data checks passed');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}
