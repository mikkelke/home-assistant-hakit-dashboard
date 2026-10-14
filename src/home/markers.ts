/** Thin markers after the NOW line: the next sunrise and sunset `sun.sun` names, and the next start of
 * quiet hours. Pure. */
import { isQuietAt, nextQuietStartMs, quietEndClock, type QuietHours } from './quietHours';

/** Its time, an icon and one word; nothing to press. */
export interface MarkerRow {
  type: 'marker';
  id: 'sun:rise' | 'sun:set' | 'quiet';
  atMs: number;
  /** "HH:MM" the quiet hours end at; null for the sun. */
  until: string | null;
}

export const MARKERS: Record<MarkerRow['id'], { icon: string; word: string; tone: string }> = {
  'sun:rise': { icon: 'mdi:weather-sunset-up', word: 'Sunrise', tone: 'sun' },
  'sun:set': { icon: 'mdi:weather-sunset-down', word: 'Sunset', tone: 'sun' },
  quiet: { icon: 'mdi:volume-off', word: 'Quiet', tone: 'slate' },
};

function sunMarker(id: 'sun:rise' | 'sun:set', iso: unknown, nowMs: number): MarkerRow[] {
  const atMs = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
  return atMs > nowMs ? [{ type: 'marker', id, atMs, until: null }] : [];
}

/** The next sunrise and sunset `sun.sun` names, and the start of the next quiet hours unless they are
 * on now, which the NOW line says instead. A time not after `nowMs` gets no marker. */
export function timelineMarkers(nextRising: unknown, nextSetting: unknown, quiet: QuietHours, nowMs: number): MarkerRow[] {
  const quietRow: MarkerRow[] = isQuietAt(quiet, nowMs)
    ? []
    : [{ type: 'marker', id: 'quiet', atMs: nextQuietStartMs(quiet, nowMs), until: quietEndClock(quiet) }];
  return [...sunMarker('sun:rise', nextRising, nowMs), ...sunMarker('sun:set', nextSetting, nowMs), ...quietRow];
}
