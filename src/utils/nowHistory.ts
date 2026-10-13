/** History entries for the `#now` timeline route, written to the window `getAccessibleHistoryWindow`
 * returns. Pure: every function takes the history and location it writes. The grid is the
 * dashboard URL with no hash. A `#now` entry this dashboard owns carries `NOW_ENTRY_KEY` in its
 * state; whatever else the state holds (Home Assistant's `root` and `from`) is kept. */
import { buildNowHash, isNowHash, type NowFocus } from './navigation';

export interface RouteHistory {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  replaceState(data: unknown, unused: string, url?: string | null): void;
  back(): void;
}

export interface RouteLocation {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export const NOW_ENTRY_KEY = 'dashboardNow';

/** What the entry directly below a `#now` entry shows: the grid, or anything else. */
export type NowEntryBelow = 'grid' | 'other';

/** `load`: the app has just mounted on this entry (cold open or iframe reload). `navigation`: the
 * hash changed while the app was running (a warm link, Back or Forward). */
export type NowArrival = 'load' | 'navigation';

export type NowEntryChange = 'none' | 'seeded' | 'adopted';

/** State keys Home Assistant writes on entries it creates. */
const HA_STATE_KEYS: readonly string[] = ['root', 'from'];

type StateRecord = Record<string, unknown>;

function isRecord(value: unknown): value is StateRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function gridUrl(location: RouteLocation): string {
  return `${location.pathname}${location.search}`;
}

/** Below-marker of a `#now` entry this dashboard owns; null for any other entry. */
export function nowEntryBelow(state: unknown): NowEntryBelow | null {
  if (!isRecord(state)) return null;
  const below = state[NOW_ENTRY_KEY];
  return below === 'grid' || below === 'other' ? below : null;
}

/** An entry nothing but Home Assistant has written to: an arriving link. Any other key means this
 * dashboard has handled the entry already, even when an overlay replaced its state wholesale. */
export function isArrivalState(state: unknown): boolean {
  if (!isRecord(state)) return true;
  return Object.keys(state).every(key => HA_STATE_KEYS.includes(key));
}

/** Makes the current `#now` entry this dashboard's own, once. A cold open seeds the grid below it,
 * so Back lands on the grid: the entry keeps its state and loses its hash, and the `#now` entry is
 * pushed on top. A warm link already sits on top of what was showing, so it is only marked;
 * `shownBefore` says whether that was the grid. Iframe reloads, Back and Forward reach entries that
 * are marked already and change nothing. */
export function settleNowEntry(
  history: RouteHistory,
  location: RouteLocation,
  arrival: NowArrival,
  shownBefore: NowEntryBelow = 'other'
): NowEntryChange {
  if (!isNowHash(location.hash) || !isArrivalState(history.state)) return 'none';
  if (arrival === 'load') {
    history.replaceState(history.state, '', gridUrl(location));
    history.pushState({ [NOW_ENTRY_KEY]: 'grid' }, '', `${gridUrl(location)}${location.hash}`);
    return 'seeded';
  }
  const state = isRecord(history.state) ? history.state : {};
  history.replaceState({ ...state, [NOW_ENTRY_KEY]: shownBefore }, '', `${gridUrl(location)}${location.hash}`);
  return 'adopted';
}

/** Opens the timeline from inside the app, on top of what is showing. */
export function pushNowEntry(history: RouteHistory, location: RouteLocation, focus: NowFocus | null, shownBefore: NowEntryBelow): void {
  history.pushState({ [NOW_ENTRY_KEY]: shownBefore }, '', `${gridUrl(location)}${buildNowHash(focus)}`);
}

/** Leaves the current `#now` entry for the grid without adding an entry: back to the grid below it,
 * or else the entry itself becomes the grid. Call it with the `#now` entry current, not an overlay
 * pushed on top of it. */
export function leaveNowEntry(history: RouteHistory, location: RouteLocation): 'back' | 'replaced' {
  if (nowEntryBelow(history.state) === 'grid') {
    history.back();
    return 'back';
  }
  const rest = isRecord(history.state) ? Object.fromEntries(Object.entries(history.state).filter(([key]) => key !== NOW_ENTRY_KEY)) : {};
  history.replaceState(Object.keys(rest).length > 0 ? rest : null, '', gridUrl(location));
  return 'replaced';
}
