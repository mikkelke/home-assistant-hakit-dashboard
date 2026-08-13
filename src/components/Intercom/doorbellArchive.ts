import { DOORBELL_ARCHIVE_PATH } from '../../config/entities';

// The AbbWelcomeBridge AppDaemon app archives one snapshot per ring episode plus an
// index.json under HA's /local/<DOORBELL_ARCHIVE_PATH>/. The directory is only created on
// the first ring, so a 404 on the index means "no rings recorded yet" - not an error.

export type DoorbellEventType = 'ring_auto_opened' | 'ring_missed' | 'ring_answered' | 'ring';

export type DoorbellImage = {
  /** Filename timestamp, YYYYmmdd_HHMMSS. */
  ts: string;
  /** ISO timestamp of the ring. */
  datetime: string;
  /** Intercom station id the ring came from. */
  station: string;
  /** "front door" | "back door" | free label from the bridge. */
  door: string;
  event_type: DoorbellEventType | string;
  filename: string;
  url: string;
  /** Video clip filename, if the bridge recorded one for this ring. Absent or "" = no clip. */
  clip_filename?: string;
  /** Video clip URL (h264 mp4), resolved the same way as `url`. Absent or "" = no clip. */
  clip_url?: string;
};

const haBase = (
  import.meta.env.VITE_HA_URL && import.meta.env.VITE_HA_URL.length > 0
    ? import.meta.env.VITE_HA_URL
    : typeof window !== 'undefined'
      ? window.location.origin
      : ''
)?.replace(/\/$/, '');

const toHaUrl = (path: string) => (path.startsWith('http') ? path : `${haBase}${path}`);

/** Resolve an archive-relative path (snapshot or clip) to a fetchable URL - relative in dev
 * (Vite proxy) and same-origin prod, absolute (via toHaUrl) otherwise, the same rule
 * fetchDoorbellIndex applies to `url`. Empty/absent paths pass through unchanged, so a missing
 * clip_url stays falsy instead of becoming a bogus HA-origin URL. */
export function resolveArchiveUrl(path: string | undefined, sameOrigin: boolean, isDev: boolean): string {
  if (!path) return path ?? '';
  return sameOrigin || isDev ? path : toHaUrl(path);
}

/** Fetch the ring archive index, newest first. Relative URLs in dev (Vite proxy) and
 * same-origin prod; absolute only in a cross-origin prod scenario - the same rules as the
 * Rober2 maps index (see Vacuum/maps.ts). A 404 resolves to [] ("no rings recorded yet");
 * other failures throw and the caller treats them as empty too. */
export async function fetchDoorbellIndex(): Promise<DoorbellImage[]> {
  const haOrigin = (() => {
    try {
      return new URL(haBase).origin;
    } catch {
      return '';
    }
  })();
  const sameOrigin = typeof window !== 'undefined' && haOrigin === window.location.origin;
  const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const indexUrl =
    sameOrigin || isDev ? `/local/${DOORBELL_ARCHIVE_PATH}/index.json` : toHaUrl(`/local/${DOORBELL_ARCHIVE_PATH}/index.json`);
  const res = await fetch(indexUrl, { cache: 'no-cache' });
  if (res.status === 404) return []; // Archive dir not created yet - nobody has rung.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const images: DoorbellImage[] = Array.isArray(data?.images)
    ? data.images.map((m: DoorbellImage) => ({
        ...m,
        url: resolveArchiveUrl(m.url, sameOrigin, isDev),
        clip_url: resolveArchiveUrl(m.clip_url, sameOrigin, isDev),
      }))
    : [];
  const key = (e: DoorbellImage) => e.datetime || e.ts || '';
  return images.sort((a, b) => key(b).localeCompare(key(a)));
}

/** "12/08 19:42" - Danish day-month order, the household rule. Parses only the archive's
 * own timestamps (never "now"), so it is safe to call during render. */
export function formatRingTime(img: Pick<DoorbellImage, 'datetime' | 'ts'>): string {
  if (img.datetime) {
    const d = new Date(img.datetime);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  // Fall back to the filename timestamp, YYYYmmdd_HHMMSS.
  if (img.ts && img.ts.length >= 13) {
    return `${img.ts.slice(6, 8)}/${img.ts.slice(4, 6)} ${img.ts.slice(9, 11)}:${img.ts.slice(11, 13)}`;
  }
  return '';
}

/** Tile door word: "front door" -> "Front", "back door" -> "Back"; other labels kept as-is
 * bar an initial capital. */
export function doorWord(door: string | undefined): string {
  const raw = (door ?? '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'front door') return 'Front';
  if (lower === 'back door') return 'Back';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Outcome tag - words are states. A plain "ring" (or an unknown type) carries no tag. */
export function outcomeTag(eventType: string | undefined): { word: string; kind: 'opened' | 'missed' | 'answered' } | null {
  switch (eventType) {
    case 'ring_auto_opened':
      return { word: 'Opened', kind: 'opened' };
    case 'ring_missed':
      return { word: 'Missed', kind: 'missed' };
    case 'ring_answered':
      return { word: 'Answered', kind: 'answered' };
    default:
      return null;
  }
}
