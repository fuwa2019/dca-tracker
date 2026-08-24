// The in-page assertions the cross-browser record runs, shared by both engines
// so Chrome and Safari are answering exactly the same questions.
//
// Exported as a source string because it has to cross into the page through
// CDP `Runtime.evaluate` and WebDriver `Execute Script`, neither of which can
// take a function reference.

export const PAYLOAD = `(() => {
  const root = document.getElementById('root');
  const doc = document.documentElement;

  // A boot marker that does not depend on any particular route's copy: the app
  // mounts into #root, so an empty #root means the bundle threw.
  const booted = !!root && root.children.length > 0;

  // 1.4.10 reflow: the page itself must never scroll sideways. Wide tables are
  // allowed to scroll inside their own container.
  const pageOverflowPx = Math.max(0, doc.scrollWidth - doc.clientWidth);

  const cssSupports = {
    // The WCAG 2.4.11 fix from 2026-08-23 is a scroll-margin rule. If an engine
    // does not support it, focused controls sit under the fixed bottom nav.
    scrollMarginBottom: CSS.supports('scroll-margin-bottom', '96px'),
    customProperties: CSS.supports('--x', 'red'),
    colorMix: CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'),
    has: (() => { try { document.querySelector(':has(*)'); return true; } catch { return false; } })(),
    safeAreaInset: CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)'),
    gap: CSS.supports('gap', '1rem'),
    aspectRatio: CSS.supports('aspect-ratio', '1 / 1'),
  };

  const jsSupports = {
    structuredClone: typeof structuredClone === 'function',
    intlCurrency: (() => {
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(1234.5);
      } catch (e) { return 'ERROR: ' + e.message; }
    })(),
    resizeObserver: typeof ResizeObserver === 'function',
    matchMediaAddEventListener: typeof window.matchMedia('(min-width: 1px)').addEventListener === 'function',
    serviceWorker: 'serviceWorker' in navigator,
  };

  // Form defaults must use the local calendar date, not a UTC truncation.
  // PROJECT.md calls this out as a stable contract, and it is exactly the kind
  // of thing that differs between engines and time zones.
  const now = new Date();
  const localDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const dateContract = {
    localDate,
    utcSlice: now.toISOString().slice(0, 10),
    swedishLocale: now.toLocaleDateString('sv-SE'),
    localeMatchesManual: now.toLocaleDateString('sv-SE') === localDate,
  };

  // The Flexoki token layer has to resolve, in whichever theme the engine
  // picked, or the whole surface renders unstyled.
  const styles = getComputedStyle(doc);
  const theme = {
    dataTheme: doc.getAttribute('data-theme'),
    background: styles.getPropertyValue('--background').trim(),
    foreground: styles.getPropertyValue('--foreground').trim(),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
  };

  return JSON.stringify({
    booted,
    pageOverflowPx,
    innerWidth: window.innerWidth,
    cssSupports,
    jsSupports,
    dateContract,
    theme,
    title: document.title,
  });
})()`;

export const ROUTES = ['/', '/performance', '/exposure', '/transactions', '/health', '/settings'];

export const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'reflow-320', width: 320, height: 812 },
];
