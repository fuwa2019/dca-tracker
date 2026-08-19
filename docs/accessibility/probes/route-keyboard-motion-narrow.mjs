// Route-level keyboard / reduced-motion / narrow-viewport probe (C1-C4 evidence).
// Runs against the local demo server (synthetic data only).
async (page) => {
const BASE = 'http://localhost:5174';
const ROUTES = [
  ['overview', '/'],
  ['performance', '/performance'],
  ['exposure', '/exposure'],
  ['health', '/health'],
  ['settings', '/settings'],
];

  const out = { routes: {} };

  const describe = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: 'BODY', lost: true };
      const cs = getComputedStyle(el);
      const label =
        el.getAttribute('aria-label') ||
        (el.textContent || '').trim().slice(0, 28) ||
        el.getAttribute('placeholder') ||
        el.id ||
        '';
      const interactive =
        ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ||
        el.hasAttribute('tabindex') ||
        el.getAttribute('role') === 'button';
      const ring =
        cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
          ? `outline:${cs.outlineWidth}`
          : cs.boxShadow && cs.boxShadow !== 'none'
            ? 'box-shadow'
            : 'none';
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        label,
        interactive,
        focusVisible: el.matches(':focus-visible'),
        ring,
        offscreen: r.width === 0 && r.height === 0,
      };
    });

  const tabWalk = async (steps, shift) => {
    const stops = [];
    for (let i = 0; i < steps; i += 1) {
      await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab');
      const d = await describe();
      stops.push(d);
      if (d.lost) break;
    }
    return stops;
  };

  const motionSample = () =>
    page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[style*="transform"], [style*="opacity"], svg path, svg circle, canvas'));
      return nodes.slice(0, 60).map((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return [
          el.tagName,
          cs.opacity,
          cs.transform,
          el.getAttribute('stroke-dashoffset') || cs.strokeDashoffset || '',
          Math.round(r.top),
          Math.round(r.width),
        ].join('|');
      });
    });

  for (const [name, path] of ROUTES) {
    const record = {};

    // --- desktop keyboard pass -------------------------------------------
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const errors = [];
    const onErr = (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 160));
    };
    page.on('console', onErr);
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    const forward = await tabWalk(40, false);
    const back = await tabWalk(forward.length - 1, true);
    record.forward = forward;
    record.reverseLabels = back.map((s) => s.label);
    record.forwardLabels = forward.map((s) => s.label);
    record.lostFocusStops = forward.filter((s) => s.lost).length;
    record.nonInteractiveStops = forward.filter((s) => !s.lost && !s.interactive).map((s) => `${s.tag}:${s.label}`);
    record.noRingStops = forward
      .filter((s) => !s.lost && s.ring === 'none' && !s.focusVisible)
      .map((s) => `${s.tag}:${s.label}`);

    // --- motion sensitivity: default vs reduced ---------------------------
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(120);
    const early = await motionSample();
    await page.waitForTimeout(2200);
    const late = await motionSample();
    record.motionDefaultChanged = early.filter((v, i) => v !== late[i]).length;
    record.motionSampleSize = early.length;

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(120);
    const rEarly = await motionSample();
    await page.waitForTimeout(2200);
    const rLate = await motionSample();
    record.motionReducedChanged = rEarly.filter((v, i) => v !== rLate[i]).length;
    record.motionReducedSampleSize = rEarly.length;
    record.reducedMatches = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

    // --- 390px overflow ---------------------------------------------------
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE + path, { waitUntil: 'load' });
    await page.waitForTimeout(2000);
    record.narrow = await page.evaluate(() => {
      const doc = document.documentElement;
      const overWide = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
          return el.scrollWidth - el.clientWidth > 1 && el.clientWidth > 0;
        })
        .slice(0, 12)
        .map((el) => `${el.tagName}.${(el.className || '').toString().slice(0, 48)}:${el.scrollWidth}>${el.clientWidth}`);
      return {
        pageOverflow: doc.scrollWidth - window.innerWidth,
        innerWidth: window.innerWidth,
        overWide,
      };
    });
    record.consoleErrors = errors;
    page.off('console', onErr);
    out.routes[name] = record;
  }

  return JSON.stringify(out);
}
