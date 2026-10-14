import { readArchiveIndex } from '../../utils/haArchive';

// The AbbWelcomeBridge AppDaemon app archives one snapshot per ring episode, plus the clip, with an index.json in HA's
// private media folder (see utils/haArchive). The archive only exists after the first ring, so a missing one means
// "no rings recorded yet" - not an error.

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
  /** Snapshot filename - "" for a clip-only entry (the ring's snapshot never arrived). */
  filename: string;
  /** Snapshot path, /media/local/... - "" for a clip-only entry; the tile renders a video placeholder then. */
  url: string;
  /** Video clip filename, if the bridge recorded one for this ring. Absent or "" = no clip. */
  clip_filename?: string;
  /** Video clip path (h264 mp4), like `url`. Absent or "" = no clip. */
  clip_url?: string;
};

/** The ring archive index, newest first, with the files' unsigned /media/local paths: whatever shows one signs it
 * (components/Archive). [] while nothing has rung yet; a failed read rejects. */
export async function fetchDoorbellIndex(): Promise<DoorbellImage[]> {
  const data = (await readArchiveIndex('doorbell_archive_index')) as { images?: unknown } | null;
  const images = Array.isArray(data?.images) ? (data.images as DoorbellImage[]) : [];
  const key = (e: DoorbellImage) => e.datetime || e.ts || '';
  return [...images].sort((a, b) => key(b).localeCompare(key(a)));
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
