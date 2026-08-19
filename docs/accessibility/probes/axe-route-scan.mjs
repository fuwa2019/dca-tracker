// C1: automated WCAG 2.2 A/AA scan (axe-core 4.10.2) over every route,
// desktop + 390px, light + dark. Local demo server = synthetic data only.
async (page) => {

const ROUTES = [
  ['overview', 'http://localhost:5174/'],
  ['performance', 'http://localhost:5174/performance'],
  ['exposure', 'http://localhost:5174/exposure'],
  ['ledger', 'http://localhost:5174/transactions'],
  ['ledger-all', 'http://localhost:5174/transactions/all'],
  ['health', 'http://localhost:5174/health'],
  ['settings', 'http://localhost:5174/settings'],
  ['share-invalid', 'http://localhost:5174/share/demo-token'],
  ['login', 'http://localhost:5175/login'],
];

  const out = {};
  for (const [name, url] of ROUTES) {
    out[name] = {};
    for (const [viewport, size] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize(size);
        await page.goto(url, { waitUntil: 'load' });
        await page.evaluate((t) => {
          document.documentElement.setAttribute('data-theme', t);
          try { localStorage.setItem('theme', t); } catch { /* ignore */ }
        }, theme);
        await page.waitForTimeout(2200);
        await page.addScriptTag({ url: url.split('/').slice(0, 3).join('/') + '/axe-audit-tmp.js' });
        const result = await page.evaluate(async () => {
          const r = await window.axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
            resultTypes: ['violations'],
          });
          return r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            tags: v.tags.filter((t) => t.startsWith('wcag') || t === 'best-practice'),
            nodes: v.nodes.length,
            sample: v.nodes.slice(0, 2).map((n) => `${n.target.join(' ')} :: ${(n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 160)}`),
          }));
        });
        out[name][`${viewport}-${theme}`] = result;
      }
    }
  }
  return JSON.stringify(out);
}
