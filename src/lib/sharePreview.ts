// Development-only preview of a "full read-only" share link: every page the
// owner sees except settings, with no import, add, edit, delete or repair
// controls. `?sharePreview=full` turns it on for the tab, `?sharePreview=off`
// turns it off. Production builds never read the flag, so this is a layout
// prototype, not a share scope.
const STORAGE_KEY = 'dca-share-preview';

function readSharePreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('sharePreview');
  try {
    if (param === 'full') window.sessionStorage.setItem(STORAGE_KEY, 'full');
    if (param === 'off') window.sessionStorage.removeItem(STORAGE_KEY);
    return window.sessionStorage.getItem(STORAGE_KEY) === 'full';
  } catch {
    return param === 'full';
  }
}

export const READ_ONLY_SHARE = import.meta.env.DEV ? readSharePreview() : false;
