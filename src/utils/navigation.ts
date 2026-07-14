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

export type DashboardView = { kind: 'room'; roomId: string } | { kind: 'energy' } | { kind: 'none' };

export function getViewFromHistoryHash(targetWindow: Window | null = getAccessibleHistoryWindow()): DashboardView {
  if (!targetWindow) return { kind: 'none' };
  const { hash } = targetWindow.location;
  if (hash === '#energy' || hash.startsWith('#energy=')) return { kind: 'energy' };
  if (hash.startsWith('#room=')) return { kind: 'room', roomId: hash.slice(6) };
  return { kind: 'none' };
}

export function getRoomIdFromHistoryHash(targetWindow: Window | null = getAccessibleHistoryWindow()): string | null {
  const view = getViewFromHistoryHash(targetWindow);
  return view.kind === 'room' ? view.roomId : null;
}
