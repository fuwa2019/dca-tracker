import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const calendarMod = await import(path.join(outDir, 'nyseCalendar.js'));
  const workerMod = await importCompiledWorker(outDir);
  const env = {
    SCHWAB_CLIENT_ID: 'client-id',
    SCHWAB_CLIENT_SECRET: 'client-secret',
    SCHWAB_REDIRECT_URI: 'http://localhost:8787/api/schwab/oauth/callback',
    SCHWAB_REFRESH_TOKEN: 'refresh-secret',
    MARKET_DATA_PROVIDER: 'schwab',
  };

  assert.deepEqual(mod.parseSymbolsParam(' voo, QQQM,voo,,smh '), ['VOO', 'QQQM', 'SMH'], 'symbols parse and de-dupe');
  assert.equal(mod.normalizeSymbol(' ibit '), 'IBIT', 'symbol normalization trims and uppercases');
  assert.equal(mod.marketDataProviderFromEnv(env), 'schwab', 'provider env switch');
  assert.equal(workerMod.dailyPriceSourceFromEnv(env), 'schwab', 'Schwab daily_prices source');
  assert.equal(workerMod.dailyPriceSourceFromEnv({ ...env, MARKET_DATA_PROVIDER: 'yahoo' }), 'yahoo', 'Yahoo daily_prices source');
  assert.equal(
    calendarMod.lastCompletedNyseTradingDate(new Date('2026-05-29T19:59:00Z')),
    '2026-05-28',
    'before 16:00 ET uses the previous NYSE trading day',
  );
  assert.equal(
    calendarMod.lastCompletedNyseTradingDate(new Date('2026-05-29T20:00:00Z')),
    '2026-05-29',
    '16:00 ET completes the current NYSE trading day',
  );
  assert.equal(
    calendarMod.lastCompletedNyseTradingDate(new Date('2026-05-30T12:00:00Z')),
    '2026-05-29',
    'Saturday retry reconciles Friday',
  );
  assert.equal(
    calendarMod.lastCompletedNyseTradingDate(new Date('2026-05-25T22:15:00Z')),
    '2026-05-22',
    'NYSE holiday does not create a trading day',
  );
  assert.equal(
    workerMod.historyCacheKey('schwab', ['VOO', 'QQQM'], '5y'),
    'history:schwab:VOO,QQQM:5y:VOO::|QQQM::',
    '/api/history cache key includes Schwab provider and date bounds',
  );
  assert.equal(
    workerMod.historyCacheKey('yahoo', ['VOO', 'QQQM'], '5y'),
    'history:yahoo:VOO,QQQM:5y:VOO::|QQQM::',
    '/api/history cache key includes Yahoo provider and date bounds',
  );
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
  assert.deepEqual(
    mod.schwabHistoryToSeries('SPY', {
      candles: [{ datetime: Date.parse('2026-05-30T00:30:00Z'), close: 755.76 }],
    }),
    {
      ticker: 'SPY',
      points: [{
        date: '2026-05-29',
        close: 755.76,
        adjustedClose: 755.76,
        asOfTimestamp: '2026-05-30T00:30:00.000Z',
      }],
    },
    'Schwab daily candle is labeled with its America/New_York trading date',
  );

  const upsertBodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/rpc/upsert_daily_prices')) upsertBodies.push(JSON.parse(String(init.body)));
    return new Response('', { status: 200 });
  };
  try {
    await workerMod.upsertDailyPrices(
      { ...env, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
      'VOO',
      [{ date: '2026-05-28', close: 500, adjustedClose: 499 }],
    );
    await workerMod.upsertDailyPrices(
      { ...env, MARKET_DATA_PROVIDER: 'yahoo', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' },
      'VOO',
      [{ date: '2026-05-28', close: 500, adjustedClose: 499 }],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(upsertBodies[0].p_rows[0].source, 'schwab', 'Schwab provider upserts daily_prices.source=schwab');
  assert.equal(upsertBodies[1].p_rows[0].source, 'yahoo', 'Yahoo provider upserts daily_prices.source=yahoo');
  assert.equal(upsertBodies[0].p_rows[0].is_provisional, false, 'historical candles reconcile provisional rows');

  const storedTokens = new Map();
  const tokenStore = {
    get: async (key) => storedTokens.get(key) ?? null,
    put: async (key, value) => storedTokens.set(key, value),
  };
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/v1/oauth/token')) {
      assert.ok(String(init.body).includes('grant_type=authorization_code'), 'OAuth callback exchanges authorization code');
      return jsonResponse({ access_token: 'callback-access', refresh_token: 'callback-refresh-token', expires_in: 1800 });
    }
    throw new Error(`unexpected callback fetch ${url}`);
  };
  try {
    mod.resetSchwabClientForTests();
    const callback = await workerMod.default.fetch(
      new Request('https://worker.test/api/schwab/oauth/callback?code=auth-code'),
      { ...env, ALLOWED_ORIGINS: '*', SCHWAB_TOKEN_STORE: tokenStore, QUOTE_CACHE: { get: async () => null, put: async () => {} } },
      { waitUntil: () => {} },
    );
    const html = await callback.text();
    assert.equal(callback.status, 200, 'OAuth callback succeeds');
    assert.equal(storedTokens.get('schwab:refresh_token'), 'callback-refresh-token', 'OAuth callback stores refresh token in KV');
    assert.doesNotMatch(html, /callback-refresh-token/, 'OAuth callback does not expose refresh token in response body');
  } finally {
    globalThis.fetch = originalFetch;
  }

  storedTokens.set('schwab:refresh_token', 'stored-refresh-token');
  const refreshBodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).endsWith('/v1/oauth/token')) {
      refreshBodies.push(String(init.body));
      return jsonResponse({ access_token: 'stored-access', refresh_token: 'rotated-refresh-token', expires_in: 1800 });
    }
    throw new Error(`unexpected refresh fetch ${url}`);
  };
  try {
    mod.resetSchwabClientForTests();
    const refreshed = await mod.refreshSchwabAccessToken({ ...env, SCHWAB_TOKEN_STORE: tokenStore });
    assert.equal(refreshed.access_token, 'stored-access', 'refresh returns access token');
    assert.ok(refreshBodies[0].includes('refresh_token=stored-refresh-token'), 'refresh reads refresh token from KV first');
    assert.equal(storedTokens.get('schwab:refresh_token'), 'rotated-refresh-token', 'refresh stores rotated refresh token in KV');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const fallbackUpsertBodies = [];
  const fallbackCacheWrites = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.endsWith('/v1/oauth/token')) return new Response('expired refresh token', { status: 400 });
    if (
      target.includes('query1.finance.yahoo.com/v8/finance/chart/VOO')
      || target.includes('query1.finance.yahoo.com/v8/finance/chart/SPY')
    ) {
      const isSpy = target.includes('/SPY?');
      return jsonResponse({
        chart: {
          result: [{
            timestamp: [Math.floor(Date.parse('2026-05-29T20:00:00.000Z') / 1000)],
            indicators: {
              quote: [{ close: [isSpy ? 600 : 501] }],
              adjclose: [{ adjclose: [isSpy ? 599.5 : 500.5] }],
            },
          }],
        },
      });
    }
    if (target.includes('/rest/v1/rpc/upsert_daily_prices')) {
      fallbackUpsertBodies.push(JSON.parse(String(init.body)));
      return new Response('', { status: 200 });
    }
    if (
      target.includes('/rest/v1/tracked_symbols')
      || target.includes('/rest/v1/rpc/add_tracked_symbol')
    ) {
      return new Response('', { status: 200 });
    }
    throw new Error(`unexpected fallback fetch ${target}`);
  };
  try {
    mod.resetSchwabClientForTests();
    const response = await workerMod.default.fetch(
      new Request('https://worker.test/api/history?symbols=VOO,SPY&range=1y&persist=sync'),
      {
        ...env,
        ALLOWED_ORIGINS: '*',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
        QUOTE_CACHE: {
          get: async () => null,
          put: async (key, value) => fallbackCacheWrites.push({ key, value }),
        },
      },
      { waitUntil: () => {} },
    );
    assert.equal(response.status, 200, 'Schwab history failure still returns a successful history response');
    const body = await response.json();
    assert.equal(body.persisted, true, 'fallback history is persisted during sync backfill');
    assert.equal(body.progress.limit, 10, 'history default limit uses the configured fallback');
    assert.equal(body.progress.completed, 2, 'history default limit processes both requested tickers');
    assert.equal(body.hasMore, false, 'history default limit completes two requested tickers');
    assert.equal(body.series[0].source, 'yahoo', 'fallback history response reports actual Yahoo source');
    assert.equal(body.series[0].fallback, true, 'fallback history response marks provider fallback');
    assert.equal(fallbackUpsertBodies[0].p_rows[0].source, 'yahoo', 'fallback history upserts daily_prices.source=yahoo');
    assert.equal(fallbackUpsertBodies[0].p_rows[1].source, 'yahoo', 'fallback history upserts all fallback rows as Yahoo');
    assert.equal(fallbackUpsertBodies[0].p_rows[0].is_provisional, false, 'fallback history still reconciles final candles');
    assert.equal(fallbackCacheWrites.length, 1, 'fallback history response is cached under the Schwab request bucket');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const provisionalRows = workerMod.provisionalDailyPriceRows(
    '2026-05-29',
    [
      { ticker: 'SPY', price: 755.76, source: 'schwab', asOf: '2026-05-29T20:00:00.000Z' },
      { ticker: 'VOO', price: 695.07, source: 'schwab', asOf: '2026-05-29T19:59:59.000Z' },
    ],
    '2026-05-30T02:54:21.600Z',
  );
  assert.deepEqual(
    provisionalRows,
    [{
      ticker: 'SPY',
      trade_date: '2026-05-29',
      close: 755.76,
      adjusted_close: null,
      source: 'schwab-quote-provisional',
      as_of_timestamp: '2026-05-29T20:00:00.000Z',
      is_provisional: true,
      updated_at: '2026-05-30T02:54:21.600Z',
    }],
    'only close-eligible New York quotes become provisional daily prices',
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

  const perfSource = await readFile(path.join(root, 'src/app/performance.tsx'), 'utf8');
  assert.match(perfSource, /交易业绩是否跑赢 \{selectedBenchmark\}/, 'benchmark title uses selected benchmark');
  assert.doesNotMatch(perfSource, /交易业绩是否跑赢 SPY/, 'benchmark title does not hard-code SPY');

  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const envExample = await readFile(path.join(root, '.env.example'), 'utf8');
  const docs = `${readme}\n${envExample}`;
  assert.match(docs, /SCHWAB_CLIENT_ID=your_schwab_app_key/, 'Schwab app key placeholder documented');
  assert.doesNotMatch(docs, /SCHWAB_CLIENT_ID=(?!your_schwab_app_key\s*$)\S+/m, 'real Schwab app key not documented');
  assert.doesNotMatch(docs, /SCHWAB_CLIENT_SECRET=\S+/, 'real Schwab client secret not documented');
  assert.doesNotMatch(docs, /SCHWAB_REFRESH_TOKEN=\S+/, 'real Schwab refresh token not documented');
  assert.doesNotMatch(docs, /access_token=\S+|Bearer\s+[A-Za-z0-9._~+/=-]+/, 'access and bearer tokens not documented');

  console.log('Schwab market data checks passed');
} finally {
  await rm(outDir, { recursive: true, force: true });
}

async function importCompiledWorker(outDir) {
  const indexPath = path.join(outDir, 'index.js');
  const marketDataUrl = pathToFileURL(path.join(outDir, 'marketData.js')).href;
  const nyseCalendarUrl = pathToFileURL(path.join(outDir, 'nyseCalendar.js')).href;
  const source = await readFile(indexPath, 'utf8');
  const loadableSource = source
    .replace("from './marketData';", `from '${marketDataUrl}';`)
    .replace("from './nyseCalendar.js';", `from '${nyseCalendarUrl}';`);
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(loadableSource)}`);
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}
