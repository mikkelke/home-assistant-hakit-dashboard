export function getAccessibleHistoryWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (window.parent === window) return window;

  try {
    void window.parent.location.pathname;
    return window.parent;
  } catch {
    return window;
  }
}

export function getHistoryUrl(targetWindow: Window | null = getAccessibleHistoryWindow()): string {
  if (!targetWindow) return '';
  const { pathname, search, hash } = targetWindow.location;
  return `${pathname}${search}${hash}`;
}

export function buildHistoryUrlWithHash(targetWindow: Window, hash: string | null): string {
  const { pathname, search } = targetWindow.location;
  return hash ? `${pathname}${search}${hash}` : `${pathname}${search}`;
}

export function getRoomIdFromHistoryHash(targetWindow: Window | null = getAccessibleHistoryWindow()): string | null {
  if (!targetWindow) return null;
  const { hash } = targetWindow.location;
  return hash.startsWith('#room=') ? hash.slice(6) : null;
}
