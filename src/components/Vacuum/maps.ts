import { ROBOT_MAPS_PATH } from '../../config/entities';

// The rober2 AppDaemon app drops one PNG per finished room pass plus an index.json
// under HA's /local/<ROBOT_MAPS_PATH>/. Entries carry the SAME room slugs as the
// robot_clean_* request booleans (the kitchen sides are "kitchen" / "kitchen_2"),
// which is what lets a request row find its own last run.

export type MapEntry = {
  filename: string;
  timestamp: string;
  datetime?: string;
  room?: string;
  url: string;
};

const haBase = (
  import.meta.env.VITE_HA_URL && import.meta.env.VITE_HA_URL.length > 0
    ? import.meta.env.VITE_HA_URL
    : typeof window !== 'undefined'
      ? window.location.origin
      : ''
)?.replace(/\/$/, '');

/** Fetch the maps index. Relative URLs in dev (Vite proxy) and same-origin prod;
 * absolute only in a cross-origin prod scenario — same rules the Rober2 card always used. */
export async function fetchMapsIndex(): Promise<MapEntry[]> {
  const haOrigin = (() => {
    try {
      return new URL(haBase).origin;
    } catch {
      return '';
    }
  })();
  const sameOrigin = typeof window !== 'undefined' && haOrigin === window.location.origin;
  const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const toHaUrl = (path: string) => (path.startsWith('http') ? path : `${haBase}${path}`);
  const indexUrl = sameOrigin || isDev ? `/local/${ROBOT_MAPS_PATH}/index.json` : toHaUrl(`/local/${ROBOT_MAPS_PATH}/index.json`);
  const res = await fetch(indexUrl, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.maps) ? data.maps.map((m: MapEntry) => ({ ...m, url: sameOrigin || isDev ? m.url : toHaUrl(m.url) })) : [];
}

/** Latest entry for one room slug, by datetime (falls back to the filename timestamp). */
export function latestMapForRoom(entries: MapEntry[], roomSlug: string): MapEntry | null {
  const key = (e: MapEntry) => e.datetime || e.timestamp || '';
  let best: MapEntry | null = null;
  for (const e of entries) {
    if (e.room !== roomSlug) continue;
    if (!best || key(e) > key(best)) best = e;
  }
  return best;
}

export function formatMapDate(datetime?: string, timestamp?: string): string {
  const formatDateFriendly = (date: Date) => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diffDays = Math.floor((startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return `Today ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  };

  if (datetime) {
    try {
      const date = new Date(datetime);
      return formatDateFriendly(date);
    } catch {
      return datetime;
    }
  }
  if (timestamp) {
    // Format YYYYMMDD_HHMMSS to readable date
    try {
      const year = timestamp.substring(0, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.substring(9, 11);
      const minute = timestamp.substring(11, 13);
      const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
      return formatDateFriendly(date);
    } catch {
      return timestamp;
    }
  }
  return 'Unknown date';
}
