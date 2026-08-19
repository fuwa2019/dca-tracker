// WCAG 1.4.10 reflow (320px) + 2.5.8 target size, all routes.
async (page) => {
const ROUTES = [
  ['overview','http://localhost:5174/'],
  ['performance','http://localhost:5174/performance'],
  ['exposure','http://localhost:5174/exposure'],
  ['ledger','http://localhost:5174/transactions'],
  ['ledger-all','http://localhost:5174/transactions/all'],
  ['health','http://localhost:5174/health'],
  ['settings','http://localhost:5174/settings'],
  ['share-invalid','http://localhost:5174/share/demo-token'],
  ['login','http://localhost:5175/login'],
];
  const out = {};
  for (const [name, url] of ROUTES) {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2200);
    out[name] = await page.evaluate(() => {
      const small = [];
      for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
        if (el.classList.contains('sr-only')) continue;
        if (r.width < 24 || r.height < 24) {
          small.push(`${el.tagName}.${(el.className || '').toString().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18)}"`);
        }
      }
      return {
        reflowOverflow: document.documentElement.scrollWidth - window.innerWidth,
        smallTargets: small.slice(0, 10),
        smallTargetCount: small.length,
      };
    });
  }
  return JSON.stringify(out);
}
