import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query. The settings surface needs this because the
 * reference renders two different structures — a list on narrow screens and a
 * nav column beside one pane on wide ones — and rendering both at once would
 * duplicate every control id in the accessibility tree.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` breakpoint, the width at which the nav column appears. */
export const DESKTOP_QUERY = '(min-width: 1024px)';
