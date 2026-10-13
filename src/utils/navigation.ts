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

/** An entry's state with `patch` on top. Whatever else the entry holds, such as Home Assistant's
 * `root`, is kept. */
export function mergeHistoryState(state: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const base = typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {};
  return { ...base, ...patch };
}

/** Replaces the current entry of `targetWindow`'s history, keeping its state under `patch`. */
export function replaceHistoryState(targetWindow: Window, patch: Record<string, unknown>, url: string): void {
  targetWindow.history.replaceState(mergeHistoryState(targetWindow.history.state, patch), '', url);
}

/** What a `#now=<kind>-<epochS>` link can focus. `evt` is an in-app tap on any feed row. */
export const NOW_FOCUS_KINDS = ['ring', 'washer', 'dryer', 'dish', 'wake', 'evt'] as const;
export type NowFocusKind = (typeof NOW_FOCUS_KINDS)[number];

/** An event the timeline opens on: its kind and its time in Unix seconds. */
export interface NowFocus {
  kind: NowFocusKind;
  epochS: number;
}

/** Opens the timeline, focused on `focus` when one is given. */
export type OpenNow = (focus?: NowFocus | null) => void;

export type NowView = { kind: 'now'; focus: NowFocus | null };

export type DashboardView = { kind: 'room'; roomId: string; openClimate?: boolean } | { kind: 'energy' } | NowView | { kind: 'none' };

/** Build a `#room=<id>` hash, optionally with `&climate=1` to request the climate sheet open on
 * arrival (deep link for the room-card temperature/humidity tap - see RoomCard/Dashboard). */
export function buildRoomHash(roomId: string, openClimate?: boolean): string {
  return openClimate ? `#room=${roomId}&climate=1` : `#room=${roomId}`;
}

const NOW_FOCUS_PATTERN = new RegExp(`^(${NOW_FOCUS_KINDS.join('|')})-(\\d{1,11})$`);

function isNowFocus(focus: NowFocus): boolean {
  return (NOW_FOCUS_KINDS as readonly string[]).includes(focus.kind) && Number.isSafeInteger(focus.epochS) && focus.epochS > 0;
}

export function isNowHash(hash: string): boolean {
  return hash === '#now' || hash.startsWith('#now=') || hash.startsWith('#now&');
}

/** The focus of a `#now=<kind>-<epochS>` hash. Plain `#now`, a malformed focus and any other hash
 * give null; parameters after `&` are ignored. */
export function parseNowFocus(hash: string): NowFocus | null {
  if (!hash.startsWith('#now=')) return null;
  const match = NOW_FOCUS_PATTERN.exec(hash.slice(5).split('&')[0]);
  if (!match) return null;
  const focus = { kind: match[1] as NowFocusKind, epochS: Number(match[2]) };
  return isNowFocus(focus) ? focus : null;
}

/** `#now`, or `#now=<kind>-<epochS>` for a valid focus. */
export function buildNowHash(focus?: NowFocus | null): string {
  return focus && isNowFocus(focus) ? `#now=${focus.kind}-${focus.epochS}` : '#now';
}

/** The focus for an event at `ms` epoch milliseconds. */
export function nowFocusAt(kind: NowFocusKind, ms: number): NowFocus {
  return { kind, epochS: Math.floor(ms / 1000) };
}

export function parseDashboardHash(hash: string): DashboardView {
  if (hash === '#energy' || hash.startsWith('#energy=')) return { kind: 'energy' };
  if (isNowHash(hash)) return { kind: 'now', focus: parseNowFocus(hash) };
  if (hash.startsWith('#room=')) {
    const [roomId, ...rest] = hash.slice(6).split('&');
    const openClimate = rest.includes('climate=1');
    return { kind: 'room', roomId, openClimate };
  }
  return { kind: 'none' };
}

/** The view named by the history window's hash. A `#now` hash reads as no view here; use
 * `parseDashboardHash` for the full grammar. */
export function getViewFromHistoryHash(targetWindow: Window | null = getAccessibleHistoryWindow()): Exclude<DashboardView, NowView> {
  if (!targetWindow) return { kind: 'none' };
  const view = parseDashboardHash(targetWindow.location.hash);
  return view.kind === 'now' ? { kind: 'none' } : view;
}

export function getRoomIdFromHistoryHash(targetWindow: Window | null = getAccessibleHistoryWindow()): string | null {
  const view = getViewFromHistoryHash(targetWindow);
  return view.kind === 'room' ? view.roomId : null;
}
