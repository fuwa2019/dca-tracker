// Layout-shift attribution probe.
//
// Lighthouse reports a CLS number and, in `layout-shifts`, the element that
// shifted — but not what it shifted *from*, which is the half that tells you
// which render caused it. `docs/release/2026-08-24-release-gates.md` records a
// 0.186 spike on `/performance` that was never attributed for exactly that
// reason: the shift was seen, the moving element was not.
//
// This probe reproduces Lighthouse's emulated-mobile conditions (412x823, 4x
// CPU throttling, its default network profile) and installs a
// `PerformanceObserver` *before any page script runs*, so every layout-shift
// entry is captured with its sources and their before/after rectangles. That is
// enough to name the element, the direction and the exact distance.
//
// It drives the system Chrome over the DevTools Protocol with Node's built-in
// `WebSocket` — no downloaded browser, no npm dependency, the same arrangement
// as `docs/accessibility/probes/ax-tree-audit.mjs`.
//
// It is a diagnostic, not a gate. The gate is `lighthouse-budget.mjs`; run this
// when that gate reports a CLS you cannot explain.
//
// Usage:
//   VITE_LOCAL_MODE=1 npx vite build --outDir dist-local
//   npx vite preview --outDir dist-local --port 4173 --strictPort &
//   node docs/release/probes/cls-attribution.mjs
//   PROBE_ROUTE=/transactions node docs/release/probes/cls-attribution.mjs
//
// Measures the offline demo, so no Supabase project is contacted and no private
// data is involved — and, like the other probes, it cannot reach the
// authenticated cloud routes or a populated share page.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.PROBE_ORIGIN ?? 'http://127.0.0.1:4173';
const ROUTE = process.env.PROBE_ROUTE ?? '/performance';
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? 15000);
const CHROME = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Lighthouse 12's mobile emulation, so a number here is comparable with a
// number from the gate rather than merely similar.
const VIEWPORT = { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true };
const CPU_THROTTLE = 4;
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
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
  return { ready, send, close: () => ws.close() };
}

// Runs in the page before its own scripts, so nothing is missed and no
// `buffered: true` replay is relied on.
const RECORDER = `
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__shifts.push({
        startMs: Math.round(entry.startTime),
        value: Number(entry.value.toFixed(4)),
        hadRecentInput: entry.hadRecentInput,
        sources: [...(entry.sources || [])].map((source) => ({
          tag: source.node ? source.node.tagName : null,
          className: source.node ? String(source.node.className || '').slice(0, 80) : null,
          text: source.node ? String(source.node.textContent || '').replace(/\\s+/g, ' ').slice(0, 60) : null,
          fromY: Math.round(source.previousRect.y),
          toY: Math.round(source.currentRect.y),
          fromHeight: Math.round(source.previousRect.height),
          toHeight: Math.round(source.currentRect.height),
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
`;

function removeProfile(dir) {
  // Chrome keeps writing to its profile briefly after `kill()`.
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'dca-cls-'));
const port = Number(process.env.PROBE_CDP_PORT ?? 9224);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
], { stdio: 'ignore' });

let up = null;
for (let i = 0; i < 40 && !up; i += 1) {
  await sleep(250);
  up = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
}
if (!up) {
  chrome.kill();
  removeProfile(userDataDir);
  console.error('布局偏移归因失败：Chrome 没有在 10 秒内开放调试端口。');
  process.exit(1);
}

const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
  .then((r) => r.json());
const session = cdpSession(target.webSocketDebuggerUrl);
await session.ready;
await session.send('Page.enable');
await session.send('Runtime.enable');
await session.send('Network.enable');
await session.send('Emulation.setDeviceMetricsOverride', VIEWPORT);
await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
await session.send('Network.emulateNetworkConditions', NETWORK);
await session.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
await session.send('Page.navigate', { url: `${ORIGIN}${ROUTE}` });
await sleep(SETTLE_MS);

const evaluated = await session.send('Runtime.evaluate', {
  expression: 'JSON.stringify(window.__shifts ?? [])',
  returnByValue: true,
});
session.close();
chrome.kill();
removeProfile(userDataDir);

const shifts = JSON.parse(evaluated.result.value ?? '[]');
const cls = shifts.reduce((sum, s) => sum + (s.hadRecentInput ? 0 : s.value), 0);

console.log(`${ROUTE} @${VIEWPORT.width}x${VIEWPORT.height} · CPU ${CPU_THROTTLE}x · CLS ${cls.toFixed(4)}`);
if (shifts.length === 0) {
  console.log('  没有记录到任何布局偏移。');
}
for (const shift of shifts) {
  const flag = shift.hadRecentInput ? '（有近期输入，不计入 CLS）' : '';
  console.log(`  ${shift.startMs} ms  +${shift.value}${flag}`);
  for (const source of shift.sources) {
    const moved = source.toY - source.fromY;
    const grew = source.toHeight - source.fromHeight;
    const parts = [];
    if (moved !== 0) parts.push(`移动 ${moved > 0 ? '+' : ''}${moved}px`);
    if (grew !== 0) parts.push(`高度 ${source.fromHeight}→${source.toHeight}px`);
    if (parts.length === 0) parts.push('原地重排（通常是字体替换）');
    console.log(`    <${(source.tag ?? '?').toLowerCase()} class="${source.className ?? ''}">  ${parts.join('，')}`);
    if (source.text) console.log(`      ${source.text}`);
  }
}
