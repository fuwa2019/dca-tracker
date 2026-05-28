// Generate 30-year deterministic fixtures for long-horizon stress testing.
// Fixed seed guarantees identical output on every run.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SEED = 42;
const OUT_DIR = join(import.meta.dirname, '..', 'tests', 'fixtures', 'long-horizon');

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let state = seed | 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

/** Box-Muller normal variate */
function normalRand(rng) {
  let u1, u2;
  do { u1 = rng(); } while (u1 === 0);
  u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Integer in [lo, hi] inclusive */
function randInt(rng, lo, hi) {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/** Pick a random element from an array */
function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function isWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5; // Mon-Fri
}

// ---------------------------------------------------------------------------
// Ticker configuration
// ---------------------------------------------------------------------------
const TICKERS = [
  { ticker: 'VOO',  drift: 0.08, vol: 0.17, divYield: 0.013, startPrice: 60 },
  { ticker: 'QQQM', drift: 0.10, vol: 0.22, divYield: 0.007, startPrice: 30 },
  { ticker: 'SMH',  drift: 0.11, vol: 0.28, divYield: 0.005, startPrice: 15 },
  { ticker: 'SPY',  drift: 0.08, vol: 0.17, divYield: 0.013, startPrice: 75 },
];

const START_DATE = '1996-01-01';
const END_DATE = '2026-12-31';
const USER_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Generate daily prices via Geometric Brownian Motion (trading days only)
// ---------------------------------------------------------------------------
function generatePrices() {
  console.log('Generating 30-year daily prices...');
  const rows = [];
  const dt = 1 / 252; // trading days per year

  for (const cfg of TICKERS) {
    let price = cfg.startPrice;
    let adjPrice = cfg.startPrice;
    // Use per-ticker sub-seeds for reproducibility even if ticker list changes
    const priceRng = mulberry32(SEED + TICKERS.indexOf(cfg) * 1000);

    for (let iso = START_DATE; iso <= END_DATE; iso = addDays(iso, 1)) {
      if (!isWeekday(iso)) continue;

      const z = normalRand(priceRng);
      // close price via GBM (raw market price, no dividend adjustment)
      price *= Math.exp((cfg.drift - 0.5 * cfg.vol * cfg.vol) * dt + cfg.vol * Math.sqrt(dt) * z);
      if (price < 0.01) price = 0.01;

      // adjusted_close: total-return proxy for testing.
      // Uses drift + divYield so adjusted_close >= close (reinvested dividends).
      // This is NOT Yahoo's backward adjustment; it's a synthetic total-return index
      // that lets stress tests verify TWR against a "price + reinvested dividends" benchmark.
      adjPrice *= Math.exp((cfg.drift + cfg.divYield - 0.5 * cfg.vol * cfg.vol) * dt + cfg.vol * Math.sqrt(dt) * z);
      if (adjPrice < 0.01) adjPrice = 0.01;

      rows.push({
        ticker: cfg.ticker,
        trade_date: iso,
        close: Math.round(price * 100) / 100,
        adjusted_close: Math.round(adjPrice * 100) / 100,
      });
    }
  }
  console.log(`  → ${rows.length} price rows (${rows.length / TICKERS.length | 0} days × ${TICKERS.length} tickers)`);
  return rows;
}

// ---------------------------------------------------------------------------
// Generate cashflows (monthly deposits)
// ---------------------------------------------------------------------------
function generateCashflows() {
  console.log('Generating cashflows...');
  const rows = [];
  let id = 0;
  let batchId = 0;

  for (let year = 1996; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const m = String(month).padStart(2, '0');
      // Pick a weekday early in the month for USD-in date
      let usdDate = `${year}-${m}-05`;
      while (!isWeekday(usdDate)) usdDate = addDays(usdDate, 1);

      // CNY out date: a few days before USD in
      const cnyDate = addDays(usdDate, -randInt(rand, 2, 5));

      // Monthly deposit grows over time: $500 → $2000 over 30 years
      const baseAmount = 500 + (year - 1996) * 50;
      const amount = baseAmount + randInt(rand, -100, 200);

      const targetRate = 6.5 + (rand() - 0.5) * 1.5;

      rows.push({
        id: `cf-${String(++id).padStart(4, '0')}`,
        user_id: USER_ID,
        batch_id: `bat-${String(++batchId).padStart(4, '0')}`,
        cny_out_date: cnyDate,
        cny_amount: Math.round(amount * targetRate),
        usd_in_date: usdDate,
        usd_amount: amount,
        target_rate: Math.round(targetRate * 100) / 100,
        fees_cny: Math.round(amount * targetRate * 0.002),
        fees_usd: 0,
        note: null,
        created_at: `${usdDate}T08:00:00Z`,
      });
    }
  }
  console.log(`  → ${rows.length} cashflows`);
  return rows;
}

// ---------------------------------------------------------------------------
// Generate transactions (buys + occasional sells + 5-year lump sums)
// ---------------------------------------------------------------------------
function generateTransactions(prices) {
  console.log('Generating transactions...');

  // Build price lookup: ticker → date → close
  const priceMap = new Map();
  for (const p of prices) {
    let m = priceMap.get(p.ticker);
    if (!m) { m = new Map(); priceMap.set(p.ticker, m); }
    m.set(p.trade_date, p.close);
  }

  const rows = [];
  let id = 0;
  let batchId = 0;

  // Monthly buys: 3 buys/month spread across tickers
  for (let year = 1996; year <= 2026; year++) {
    for (let month = 1; month <= 12; month++) {
      const m = String(month).padStart(2, '0');

      for (let b = 0; b < 3; b++) {
        let tradeDate = `${year}-${m}-${10 + b * 7}`;
        // Find nearest weekday
        while (!isWeekday(tradeDate)) tradeDate = addDays(tradeDate, 1);
        if (tradeDate > END_DATE) continue;

        const ticker = TICKERS[b % TICKERS.length].ticker;
        const tickerPrices = priceMap.get(ticker);
        // Find the closest price on or after trade date
        let price = tickerPrices?.get(tradeDate);
        if (price == null) {
          // walk forward to find a price
          for (let d = tradeDate; d <= END_DATE; d = addDays(d, 1)) {
            price = tickerPrices?.get(d);
            if (price != null) break;
          }
        }
        if (price == null) price = 100;

        const amount = 500 + (year - 1996) * 20 + randInt(rand, -50, 100);
        const shares = Math.round((amount / price) * 100) / 100;

        rows.push({
          id: `txn-${String(++id).padStart(5, '0')}`,
          user_id: USER_ID,
          batch_id: `bat-${String(++batchId).padStart(4, '0')}`,
          trade_date: tradeDate,
          ticker,
          side: 'buy',
          price,
          shares,
          kind: 'dca',
          note: null,
          created_at: `${tradeDate}T14:00:00Z`,
          updated_at: `${tradeDate}T14:00:00Z`,
        });
      }
    }
  }

  // 5-year lump sums (large buys at years 2000, 2005, 2010, 2015, 2020, 2025)
  for (const year of [2000, 2005, 2010, 2015, 2020, 2025]) {
    const ticker = pick(rand, TICKERS).ticker;
    const tickerPrices = priceMap.get(ticker);
    let tradeDate = `${year}-06-15`;
    while (!isWeekday(tradeDate)) tradeDate = addDays(tradeDate, 1);

    let price = tickerPrices?.get(tradeDate);
    if (price == null) {
      for (let d = tradeDate; d <= END_DATE; d = addDays(d, 1)) {
        price = tickerPrices?.get(d);
        if (price != null) break;
      }
    }
    if (price == null) price = 100;

    const amount = 5000 + (year - 2000) * 2000;
    const shares = Math.round((amount / price) * 100) / 100;

    rows.push({
      id: `txn-${String(++id).padStart(5, '0')}`,
      user_id: USER_ID,
      batch_id: `bat-${String(++batchId).padStart(4, '0')}`,
      trade_date: tradeDate,
      ticker,
      side: 'buy',
      price,
      shares,
      kind: 'lumpsum',
      note: `${year} lump sum`,
      created_at: `${tradeDate}T14:00:00Z`,
      updated_at: `${tradeDate}T14:00:00Z`,
    });
  }

  // Occasional sells — sell 10-30% of a position roughly every 3 years
  const sellTickers = TICKERS.map(t => t.ticker);
  for (let year = 1999; year <= 2025; year += 3) {
    const ticker = pick(rand, sellTickers);
    const tickerPrices = priceMap.get(ticker);
    let tradeDate = `${year}-${randInt(rand, 3, 10)}-${randInt(rand, 1, 25)}`;
    while (!isWeekday(tradeDate)) tradeDate = addDays(tradeDate, 1);

    let price = tickerPrices?.get(tradeDate);
    if (price == null) {
      for (let d = tradeDate; d <= END_DATE; d = addDays(d, 1)) {
        price = tickerPrices?.get(d);
        if (price != null) break;
      }
    }
    if (price == null) price = 100;

    // Compute net shares up to this date to avoid oversell
    const netBefore = rows
      .filter(r => r.ticker === ticker && r.trade_date <= tradeDate)
      .reduce((sum, r) => sum + (r.side === 'buy' ? r.shares : -r.shares), 0);
    const sellShares = Math.round(netBefore * rand() * 0.3 * 100) / 100;
    if (sellShares <= 0) continue;

    rows.push({
      id: `txn-${String(++id).padStart(5, '0')}`,
      user_id: USER_ID,
      batch_id: null,
      trade_date: tradeDate,
      ticker,
      side: 'sell',
      price,
      shares: sellShares,
      kind: 'dca',
      note: 'periodic sell',
      created_at: `${tradeDate}T14:00:00Z`,
      updated_at: `${tradeDate}T14:00:00Z`,
    });
  }

  console.log(`  → ${rows.length} transactions (${rows.filter(r => r.side === 'buy').length} buys, ${rows.filter(r => r.side === 'sell').length} sells, ${rows.filter(r => r.kind === 'lumpsum').length} lumpsum)`);
  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

const prices = generatePrices();
writeFileSync(join(OUT_DIR, 'prices.json'), JSON.stringify(prices));
console.log(`  wrote prices.json (${(JSON.stringify(prices).length / 1024 / 1024).toFixed(1)} MB)`);

const cashflows = generateCashflows();
writeFileSync(join(OUT_DIR, 'cashflows.json'), JSON.stringify(cashflows));
console.log(`  wrote cashflows.json`);

const transactions = generateTransactions(prices);
writeFileSync(join(OUT_DIR, 'transactions.json'), JSON.stringify(transactions));
console.log(`  wrote transactions.json`);

console.log('\nFixtures generated successfully.');
