// Accessibility-tree audit — the mechanical half of a screen-reader pass.
//
// What this is, precisely. A screen reader does not read the DOM; it reads the
// platform accessibility tree the browser computes from it. This probe pulls
// that exact tree out of Chrome (`Accessibility.getFullAXTree` over the
// DevTools Protocol, zero dependencies, no downloaded browser) and checks the
// properties a screen-reader user actually depends on: does every control have
// a name, is the heading outline navigable, are the landmarks named, is
// anything focusable hidden from the tree, do the data tables announce as
// tables.
//
// What it is NOT. It does not run VoiceOver, NVDA or JAWS, and it does not
// listen to speech. Announcement order under a real AT, live-region timing,
// braille output, rotor behaviour and gesture navigation are NOT covered and
// stay recorded as unproved. Enabling and driving VoiceOver needs system
// settings changes that are outside what this repository's tooling does.
//
// Usage:
//   npm run dev:local -- --port 5174 --strictPort
//   node docs/accessibility/probes/ax-tree-audit.mjs
//
// Runs against the offline demo, so no Supabase project is contacted. The
// cloud-only routes (`/cashflows`, a populated `/share/<token>`, the
// authenticated login flow) are therefore out of its reach.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.PROBE_ORIGIN ?? 'http://127.0.0.1:5174';
const CHROME = process.env.CHROME_BIN
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ROUTES = [
  '/', '/performance', '/exposure', '/transactions', '/transactions/all',
  '/health', '/settings', '/settings/goal', '/settings/basis', '/settings/email',
  '/settings/share', '/settings/appearance', '/settings/account',
];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
];

/** Roles that a screen-reader user reaches and that must announce a name. */
const NAMED_INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox',
  'radio', 'switch', 'slider', 'spinbutton', 'tab', 'menuitem',
  'menuitemcheckbox', 'menuitemradio',
]);
/** Landmarks that must be distinguishable when more than one is present. */
const LANDMARK_ROLES = new Set([
  'navigation', 'complementary', 'region', 'form', 'search', 'banner', 'contentinfo',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    } else if (msg.method) events.push(msg);
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

function removeProfile(dir) {
  // Chrome keeps writing to its profile briefly after `kill()`, so a bare
  // rmSync races it and throws ENOTEMPTY *after* the probe has done its work.
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'dca-ax-'));
const port = 9223;
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  // The tree the browser exposes to a real AT differs from the lazy one it
  // builds for nobody, so ask for the full computed tree.
  '--force-renderer-accessibility',
], { stdio: 'ignore' });

let up = null;
for (let i = 0; i < 40 && !up; i += 1) {
  await sleep(250);
  up = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
}
if (!up) {
  chrome.kill();
  removeProfile(userDataDir);
  console.error('无障碍树审计失败：Chrome 没有在 10 秒内开放调试端口。');
  process.exit(1);
}

const failures = [];
const notes = [];
const summary = [];

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })
      .then((r) => r.json());
    const s = cdpSession(target.webSocketDebuggerUrl);
    await s.ready;
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    await s.send('Accessibility.enable');
    await s.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height,
      deviceScaleFactor: 1, mobile: viewport.width < 768,
    });
    await s.send('Page.navigate', { url: `${ORIGIN}${route}` });
    for (let i = 0; i < 60; i += 1) {
      await sleep(100);
      if (s.events.some((e) => e.method === 'Page.loadEventFired')) break;
    }
    await sleep(1500);

    const { nodes } = await s.send('Accessibility.getFullAXTree');
    const where = `${route} @${viewport.name}`;

    const value = (node, key) => {
      if (key === 'role') return node.role?.value;
      if (key === 'name') return node.name?.value ?? '';
      const prop = node.properties?.find((p) => p.name === key);
      return prop?.value?.value;
    };
    const live = nodes.filter((n) => !n.ignored);

    // ---- 1. every interactive node announces a name
    const unnamed = live
      .filter((n) => NAMED_INTERACTIVE_ROLES.has(value(n, 'role')))
      .filter((n) => String(value(n, 'name')).trim() === '');
    for (const n of unnamed) {
      failures.push(`${where}：role=${value(n, 'role')} 的可交互节点没有可访问名称（屏幕阅读器只会念出角色）。`);
    }

    // ---- 2. heading outline is navigable
    const headings = live
      .filter((n) => value(n, 'role') === 'heading')
      .map((n) => ({ level: Number(value(n, 'level')), name: String(value(n, 'name')).trim() }));
    const h1s = headings.filter((h) => h.level === 1);
    if (h1s.length === 0) failures.push(`${where}：没有一级标题，屏幕阅读器用户无法用标题定位页面。`);
    if (h1s.length > 1) failures.push(`${where}：有 ${h1s.length} 个一级标题：${h1s.map((h) => h.name).join(' / ')}。`);
    for (const h of headings) {
      if (h.name === '') failures.push(`${where}：存在空标题（level ${h.level}）。`);
    }
    let previous = 0;
    for (const h of headings) {
      if (previous > 0 && h.level > previous + 1) {
        failures.push(`${where}：标题层级从 h${previous} 跳到 h${h.level}（“${h.name}”）。`);
      }
      previous = h.level;
    }

    // ---- 3. landmarks
    const mains = live.filter((n) => value(n, 'role') === 'main');
    if (mains.length !== 1) failures.push(`${where}：main 地标有 ${mains.length} 个，应当恰好 1 个。`);
    const byRole = new Map();
    for (const n of live) {
      const role = value(n, 'role');
      if (!LANDMARK_ROLES.has(role)) continue;
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role).push(String(value(n, 'name')).trim());
    }
    for (const [role, names] of byRole) {
      if (names.length > 1 && names.some((n) => n === '')) {
        failures.push(`${where}：有 ${names.length} 个 ${role} 地标，其中存在未命名的，无法区分。`);
      }
    }

    // ---- 4. nothing focusable is hidden from the tree
    const focusableCount = await s.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const sel = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
        return [...document.querySelectorAll(sel)].filter((el) => {
          if (el.closest('[aria-hidden="true"]')) return true;
          return false;
        }).length;
      })()`,
    });
    if (focusableCount.result.value > 0) {
      failures.push(`${where}：${focusableCount.result.value} 个可聚焦元素位于 aria-hidden 子树内，键盘能到达但屏幕阅读器读不到。`);
    }

    // ---- 5. data tables announce as tables with headers
    for (const table of live.filter((n) => ['table', 'grid', 'treegrid'].includes(value(n, 'role')))) {
      if (String(value(table, 'name')).trim() === '') {
        failures.push(`${where}：表格没有可访问名称，屏幕阅读器只会念“表格”。`);
      }
    }
    const columnHeaders = live.filter((n) => value(n, 'role') === 'columnheader');
    const rows = live.filter((n) => value(n, 'role') === 'row');
    if (rows.length > 1 && columnHeaders.length === 0) {
      failures.push(`${where}：有 ${rows.length} 个表格行但没有 columnheader，单元格不会带列名播报。`);
    }

    // ---- 6. images either have a name or are explicitly decorative
    for (const img of live.filter((n) => value(n, 'role') === 'image')) {
      if (String(value(img, 'name')).trim() === '') {
        failures.push(`${where}：role=image 的节点没有名称，也没有被标为装饰性。`);
      }
    }

    // ---- informational: sibling controls that announce identically
    const names = live
      .filter((n) => NAMED_INTERACTIVE_ROLES.has(value(n, 'role')))
      .map((n) => String(value(n, 'name')).trim())
      .filter(Boolean);
    const counts = new Map();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const dupes = [...counts].filter(([, c]) => c > 2).map(([n, c]) => `${n}×${c}`);
    if (dupes.length > 0) notes.push(`${where}：重名控件 ${dupes.join('、')}（列表内重复是否可接受要看是否有行上下文）。`);

    summary.push({
      route, viewport: viewport.name,
      axNodes: live.length,
      interactive: names.length + unnamed.length,
      headings: headings.length,
      landmarks: [...byRole.keys()].join(',') || '-',
      tables: live.filter((n) => ['table', 'grid'].includes(value(n, 'role'))).length,
    });

    s.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
  }
}

chrome.kill();
removeProfile(userDataDir);

console.log('路由 / 视口 / AX 节点 / 可交互 / 标题 / 地标 / 表格');
for (const r of summary) {
  console.log(
    r.route.padEnd(22), r.viewport.padEnd(11),
    String(r.axNodes).padStart(4), String(r.interactive).padStart(4),
    String(r.headings).padStart(3), String(r.tables).padStart(3), ' ', r.landmarks,
  );
}
if (notes.length > 0) {
  console.log('\n提示（不判失败）：');
  for (const note of notes) console.log(`  · ${note}`);
}
if (failures.length > 0) {
  console.error(`\n无障碍树审计失败，共 ${failures.length} 项：`);
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\n无障碍树审计通过。');
console.log('未覆盖：真实 VoiceOver/NVDA 播报顺序、live region 时序、盲文输出、转子与手势导航；'
  + '以及云端专属路由（/cashflows、已填充的 /share/<token>、已登录流程）。');
