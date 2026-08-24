// Cross-browser compatibility record.
//
// Runs one shared assertion payload against two real engines with no
// repository dependency and no downloaded browser:
//
//   - Blink, through the system Google Chrome over the DevTools Protocol
//     (Node's built-in WebSocket; nothing is installed).
//   - WebKit, through macOS' built-in `safaridriver` over W3C WebDriver
//     (plain HTTP; nothing is installed). Safari must have
//     Settings -> Developer -> "Allow remote automation" turned on, which is a
//     human action — the probe reports the engine as UNCOVERED rather than
//     pretending, if it cannot get a session.
//
// Gecko is not covered: Firefox is not installed on this machine and the
// chosen constraint for this record was to download nothing. That gap is
// recorded, not papered over.
//
// Usage:
//   VITE_LOCAL_MODE=1 npx vite build --outDir dist-local
//   npx vite preview --outDir dist-local --port 4173 --strictPort &
//   /System/Cryptexes/App/usr/bin/safaridriver -p 4444 &        # optional
//   node docs/release/probes/cross-browser-check.mjs
//
// Measures the offline demo build, so no Supabase project is contacted.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PAYLOAD, ROUTES, VIEWPORTS } from './browser-support-payload.mjs';

const ORIGIN = process.env.PROBE_ORIGIN ?? 'http://127.0.0.1:4173';
const CHROME = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SAFARIDRIVER_PORT = Number(process.env.SAFARIDRIVER_PORT ?? 4444);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ Blink
function removeProfile(dir) {
  // Chrome keeps writing to its profile briefly after `kill()`, so a bare
  // rmSync races it and throws ENOTEMPTY *after* the probe has done its work.
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

async function withChrome(fn) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'dca-chrome-'));
  const port = 9222;
  const child = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  ], { stdio: 'ignore' });

  let version = null;
  for (let i = 0; i < 40 && !version; i += 1) {
    await sleep(250);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  }
  if (!version) {
    child.kill();
    removeProfile(userDataDir);
    throw new Error('Chrome 没有在 10 秒内开放调试端口。');
  }

  try {
    return await fn(port, version['Browser']);
  } finally {
    child.kill();
    removeProfile(userDataDir);
  }
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, events, close: () => ws.close() };
}

async function runChrome() {
  return withChrome(async (port, browserVersion) => {
    const rows = [];
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        const target = await fetch(
          `http://127.0.0.1:${port}/json/new?about:blank`,
          { method: 'PUT' },
        ).then((r) => r.json());
        const s = cdpSession(target.webSocketDebuggerUrl);
        await s.ready;
        await s.send('Runtime.enable');
        await s.send('Log.enable');
        await s.send('Page.enable');
        await s.send('Emulation.setDeviceMetricsOverride', {
          width: viewport.width, height: viewport.height,
          deviceScaleFactor: 1, mobile: viewport.width < 768,
        });
        s.events.length = 0;
        await s.send('Page.navigate', { url: `${ORIGIN}${route}` });
        // The app renders client side; wait for the load event, then give React
        // a beat to mount before asking whether it mounted.
        for (let i = 0; i < 60; i += 1) {
          await sleep(100);
          if (s.events.some((e) => e.method === 'Page.loadEventFired')) break;
        }
        await sleep(1200);
        const evaluated = await s.send('Runtime.evaluate', {
          expression: PAYLOAD, returnByValue: true, awaitPromise: false,
        });
        const consoleErrors = s.events
          .filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
            || e.method === 'Runtime.exceptionThrown')
          .map((e) => e.params.entry?.text ?? e.params.exceptionDetails?.text ?? 'exception');
        s.close();
        await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});

        if (evaluated.exceptionDetails) {
          rows.push({ engine: 'Blink', browserVersion, viewport: viewport.name, route, error: evaluated.exceptionDetails.text });
          continue;
        }
        rows.push({
          engine: 'Blink', browserVersion, viewport: viewport.name, route,
          consoleErrors, ...JSON.parse(evaluated.result.value),
        });
      }
    }
    return rows;
  });
}

// ----------------------------------------------------------------- WebKit
async function runSafari() {
  const base = `http://127.0.0.1:${SAFARIDRIVER_PORT}`;
  const status = await fetch(`${base}/status`).then((r) => r.json()).catch(() => null);
  if (!status?.value?.ready) {
    return { skipped: `safaridriver 未在 ${base} 运行。` };
  }
  const created = await fetch(`${base}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'safari' } } }),
  }).then((r) => r.json());
  if (created.value?.error) {
    return { skipped: created.value.message };
  }
  const id = created.value.sessionId;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}/session/${id}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
    if (res.value?.error) throw new Error(`${res.value.error}: ${res.value.message}`);
    return res.value;
  };

  const rows = [];
  try {
    for (const viewport of VIEWPORTS) {
      // Safari sizes the whole window; the viewport ends up a little shorter
      // than the requested height. Width is what these assertions depend on.
      await call('POST', '/window/rect', { width: viewport.width, height: viewport.height + 120, x: 0, y: 0 });
      for (const route of ROUTES) {
        await call('POST', '/url', { url: `${ORIGIN}${route}` });
        await sleep(2000);
        const value = await call('POST', '/execute/sync', { script: `return ${PAYLOAD}`, args: [] });
        rows.push({
          engine: 'WebKit', viewport: viewport.name, route,
          // safaridriver's W3C surface exposes no console log endpoint, so
          // console errors are not observable here. Recorded as null rather
          // than as an empty list, which would read as "none found".
          consoleErrors: null,
          ...JSON.parse(value),
        });
      }
    }
  } finally {
    await fetch(`${base}/session/${id}`, { method: 'DELETE' }).catch(() => {});
  }
  return { rows };
}

// ------------------------------------------------------------------- run
const report = { origin: ORIGIN, ranAt: new Date().toISOString(), engines: {} };

const chromeRows = await runChrome();
report.engines.Blink = { covered: true, browserVersion: chromeRows[0]?.browserVersion, rows: chromeRows };

const safari = await runSafari();
report.engines.WebKit = safari.skipped
  ? { covered: false, reason: safari.skipped }
  : { covered: true, rows: safari.rows };

report.engines.Gecko = {
  covered: false,
  reason: 'Firefox 未安装，且本次记录的约束是不下载任何浏览器。',
};

// --------------------------------------------------------------- verdict
const failures = [];
for (const [engine, data] of Object.entries(report.engines)) {
  if (!data.covered) continue;
  for (const row of data.rows) {
    const where = `${engine} ${row.viewport} ${row.route}`;
    if (row.error) { failures.push(`${where}：页内断言抛异常 ${row.error}`); continue; }
    if (!row.booted) failures.push(`${where}：#root 为空，应用没有挂载。`);
    if (row.pageOverflowPx > 0) failures.push(`${where}：页面横向溢出 ${row.pageOverflowPx}px。`);
    for (const [feature, ok] of Object.entries(row.cssSupports)) {
      if (!ok) failures.push(`${where}：CSS ${feature} 不受支持。`);
    }
    if (!row.jsSupports.structuredClone) failures.push(`${where}：structuredClone 缺失。`);
    if (!row.jsSupports.resizeObserver) failures.push(`${where}：ResizeObserver 缺失。`);
    if (row.jsSupports.intlCurrency !== '$1,234.50') {
      failures.push(`${where}：Intl 货币格式为 ${row.jsSupports.intlCurrency}，与 $1,234.50 不一致。`);
    }
    if (!row.dateContract.localeMatchesManual) {
      failures.push(`${where}：本地日期契约不成立（${row.dateContract.swedishLocale} vs ${row.dateContract.localDate}）。`);
    }
    if (!row.theme.bodyBackground || row.theme.bodyBackground === 'rgba(0, 0, 0, 0)') {
      failures.push(`${where}：body 背景没有解析出来，令牌层可能没生效。`);
    }
    if (Array.isArray(row.consoleErrors) && row.consoleErrors.length > 0) {
      failures.push(`${where}：控制台错误 ${JSON.stringify(row.consoleErrors)}`);
    }
  }
}

console.log(JSON.stringify(report, null, 1));
console.log('');
for (const [engine, data] of Object.entries(report.engines)) {
  console.log(data.covered
    ? `${engine}：已覆盖，${data.rows.length} 次运行。`
    : `${engine}：未覆盖 — ${data.reason}`);
}
if (failures.length > 0) {
  console.error('跨浏览器记录发现问题：');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('跨浏览器记录通过（覆盖到的引擎上无失败断言）。');
