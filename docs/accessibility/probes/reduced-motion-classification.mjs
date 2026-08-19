// Reduced-motion classification: what actually keeps moving after first paint.
async (page) => {
const BASE = 'http://localhost:5174';
const ROUTES = [['overview','/'],['performance','/performance'],['exposure','/exposure'],['health','/health'],['settings','/settings']];

  const sample = () =>
    page.evaluate(() => {
      const out = {};
      const nodes = Array.from(document.querySelectorAll('[style*="transform"], [style*="opacity"], [style*="width"], svg path, svg circle, .font-num, .tnum'));
      nodes.slice(0, 120).forEach((el, i) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        out[`${i}:${el.tagName}`] = {
          opacity: cs.opacity,
          transform: cs.transform,
          dash: el.getAttribute('stroke-dashoffset') ?? cs.strokeDashoffset ?? '',
          width: Math.round(r.width),
          top: Math.round(r.top),
          text: (el.textContent || '').trim().slice(0, 18),
        };
      });
      return out;
    });

  const classify = (a, b) => {
    const kinds = {};
    for (const key of Object.keys(a)) {
      const x = a[key], y = b[key];
      if (!y) continue;
      for (const f of ['opacity', 'transform', 'dash', 'width', 'top', 'text']) {
        if (String(x[f]) !== String(y[f])) {
          kinds[f] = kinds[f] || [];
          if (kinds[f].length < 4) kinds[f].push(`${key} ${x[f]} -> ${y[f]}`);
        }
      }
    }
    return kinds;
  };

  const out = {};
  for (const [name, path] of ROUTES) {
    out[name] = {};
    for (const mode of ['no-preference', 'reduce']) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: mode });
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForTimeout(2500); // let data settle first
      const a = await sample();
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      const b = await sample();
      // now force a re-mount of the animated tree by navigating away and back
      await page.goto(BASE + '/settings', { waitUntil: 'load' });
      await page.waitForTimeout(300);
      await page.goto(BASE + path, { waitUntil: 'load' });
      await page.waitForTimeout(90);
      const early = await sample();
      await page.waitForTimeout(2400);
      const late = await sample();
      out[name][mode] = { settled: classify(a, b), remount: classify(early, late) };
    }
  }
  return JSON.stringify(out);
}
