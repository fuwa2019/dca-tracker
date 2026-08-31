// Release performance budget gate.
//
// `requirements-audit.md` carried "Performance/Lighthouse/compatibility gates"
// as the last fully missing contract row. A Lighthouse score cannot be a CI
// gate here: it needs a browser, it is noisy run to run, and this repository
// deliberately carries no browser dependency. What *can* be a deterministic
// gate is the thing Lighthouse's performance score mostly reacts to on this
// app — first-load transfer weight and the render-blocking third-party origins
// in the document head.
//
// What it can and cannot see, stated up front:
//
//   - It CAN read the built `dist/index.html`, resolve every asset the first
//     load needs (entry module, modulepreloads, stylesheets), measure raw and
//     gzip bytes, and count render-blocking external origins in the head.
//   - It CANNOT measure LCP, TBT, CLS or anything else that needs a real
//     browser and a real network. Those are measured by the Lighthouse probe
//     in `docs/release/probes/` and recorded, dated, in
//     `docs/release/2026-08-24-release-gates.md`.
//
// Gzip is the transfer proxy. Cloudflare Pages negotiates brotli when the
// client offers it, which is smaller, so a gzip budget is the conservative one.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = process.env.RELEASE_BUDGET_DIST ?? 'dist';
const BUDGET_FILE = process.env.RELEASE_BUDGET_FILE ?? 'docs/release/performance-budget.json';

const indexPath = join(DIST, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`发布预算校验失败：找不到 ${indexPath}。先运行 npm run build。`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const { budget } = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

const kib = (bytes) => Number((bytes / 1024).toFixed(2));

// ----------------------------------------------- first-load local assets
// The entry module, everything Vite asks the browser to modulepreload, and
// every stylesheet: exactly what the document costs before any route renders.
const localRefs = new Set();
for (const [, attr, url] of html.matchAll(/<(?:script|link)\b[^>]*\b(src|href)="(\/[^"]+)"/g)) {
  void attr;
  if (url.endsWith('.js') || url.endsWith('.css')) localRefs.add(url);
}
// registerSW.js is requested by the document but is not render blocking and is
// tiny; it still counts as a request, so keep it in the set deliberately.

if (localRefs.size === 0) {
  console.error('发布预算校验失败：index.html 里没有解析到任何本地首屏资源，解析器可能已过时。');
  process.exit(1);
}

const assets = [];
for (const ref of [...localRefs].sort()) {
  const file = join(DIST, ref);
  if (!existsSync(file)) {
    console.error(`发布预算校验失败：index.html 引用了 ${ref}，但 ${file} 不存在。`);
    process.exit(1);
  }
  const raw = readFileSync(file);
  assets.push({ ref, raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length });
}

const jsGzip = assets.filter((a) => a.ref.endsWith('.js')).reduce((s, a) => s + a.gzip, 0);
const cssGzip = assets.filter((a) => a.ref.endsWith('.css')).reduce((s, a) => s + a.gzip, 0);
const largestGzip = Math.max(...assets.map((a) => a.gzip));
// The document itself is a request too.
const requests = assets.length + 1;

// ------------------------------------- render-blocking third-party origins
// A stylesheet from another origin blocks first paint on a connection this app
// does not control. Zero are accepted; adding one back is a release decision,
// not an implementation detail.
//
// `<noscript>` is stripped before scanning. `ce2cd21` moved the Google Fonts
// stylesheet to `rel="preload" as="style"` with an `onload` swap and left a
// plain `<link rel="stylesheet">` inside `<noscript>` for scripting-off
// clients. That fallback cannot block first paint for anyone able to run this
// SPA at all, but the scan still counted it — and because the measurement is a
// count of distinct ORIGINS, the phantom occupied the Google Fonts slot, so a
// real render-blocking fonts stylesheet back in the head also read as 1. The
// gate passed on a build carrying exactly the regression it exists to catch.
// Confirmed by mutating a built `index.html` both before and after this fix.
const scanned = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
const externalOrigins = new Set();
for (const [, url] of scanned.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(https?:\/\/[^"]+)"/g)) {
  externalOrigins.add(new URL(url).origin);
}
for (const [, url] of scanned.matchAll(/<link\b[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*\brel="stylesheet"/g)) {
  externalOrigins.add(new URL(url).origin);
}
for (const [, url] of scanned.matchAll(/<script\b(?![^>]*\b(?:async|defer|type="module")\b)[^>]*\bsrc="(https?:\/\/[^"]+)"/g)) {
  externalOrigins.add(new URL(url).origin);
}

const measured = {
  initialJsGzipKib: kib(jsGzip),
  initialCssGzipKib: kib(cssGzip),
  initialTotalGzipKib: kib(jsGzip + cssGzip),
  largestChunkGzipKib: kib(largestGzip),
  initialRequests: requests,
  externalRenderBlockingOrigins: externalOrigins.size,
};

const LABELS = {
  initialJsGzipKib: '首屏 JS（gzip KiB）',
  initialCssGzipKib: '首屏 CSS（gzip KiB）',
  initialTotalGzipKib: '首屏合计（gzip KiB）',
  largestChunkGzipKib: '最大单块（gzip KiB）',
  initialRequests: '首屏请求数',
  externalRenderBlockingOrigins: '阻塞渲染的第三方来源数',
};

const failures = [];
for (const [key, limit] of Object.entries(budget)) {
  const value = measured[key];
  if (value === undefined) {
    failures.push(`预算文件里有未知条目 ${key}，校验脚本不认识它。`);
    continue;
  }
  if (value > limit) {
    failures.push(`${LABELS[key] ?? key} 为 ${value}，超过预算 ${limit}。`);
  }
}
for (const key of Object.keys(measured)) {
  if (!(key in budget)) failures.push(`预算文件缺少 ${key}，无法作为门禁。`);
}

console.log('首屏资源：');
for (const asset of assets) {
  console.log(`  · ${asset.ref}  ${kib(asset.raw)} KiB  →  ${kib(asset.gzip)} KiB gzip`);
}
if (externalOrigins.size > 0) {
  console.log(`阻塞渲染的第三方来源：${[...externalOrigins].join(', ')}`);
}

if (failures.length > 0) {
  console.error('发布预算校验失败：');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('  预算是防回归的棘轮，不是天花板。确有需要就在同一次提交里改 '
    + `${BUDGET_FILE} 并说明原因。`);
  process.exit(1);
}

console.log('发布预算校验通过。');
for (const [key, limit] of Object.entries(budget)) {
  console.log(`  · ${LABELS[key] ?? key}：${measured[key]} / ${limit}`);
}
console.log('  · 未覆盖：LCP / TBT / CLS 等需要真实浏览器的指标，见 docs/release/ 的 Lighthouse 记录。');
