import { readArchiveIndex } from '../../utils/haArchive';

// The AbbWelcomeBridge AppDaemon app archives one snapshot per ring episode, plus the clip, with an index.json in HA's
// private media folder (see utils/haArchive). The archive only exists after the first ring, so a missing one means
// "no rings recorded yet" - not an error.

export type DoorbellEventType = 'ring_auto_opened' | 'ring_missed' | 'ring_answered' | 'ring';

export type DoorbellClip = {
  /** Clip filename, abb_ringclip_YYYYmmdd_HHMMSS_<station>.mp4. */
  filename: string;
  /** Clip path (h264 mp4), /media/local/... */
  url: string;
};

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
  /** The latest video clip's filename, if the bridge recorded one for this ring. Absent or "" = no clip. */
  clip_filename?: string;
  /** The latest video clip's path (h264 mp4), like `url`. Absent or "" = no clip. */
  clip_url?: string;
  /** Every clip of the ring, oldest first: a visitor who rings again brings another. Absent on entries from before the
   * bridge kept them all, whose `clip_url` is their only clip - read both through `ringClips`. */
  clips?: DoorbellClip[];
};

/** The clips of one ring, oldest first: the entry's `clips`, else its single `clip_url`. Entries with neither have none. */
export function ringClips(image: Pick<DoorbellImage, 'clips' | 'clip_filename' | 'clip_url'>): DoorbellClip[] {
  const listed = Array.isArray(image.clips) ? image.clips.filter(clip => typeof clip?.url === 'string' && clip.url !== '') : [];
  if (listed.length > 0) return listed.map(clip => ({ filename: clip.filename ?? '', url: clip.url }));
  return image.clip_url ? [{ filename: image.clip_filename ?? '', url: image.clip_url }] : [];
}

const CLIP_START = /^abb_(?:ring)?clip_\d{8}_([01]\d|2[0-3])([0-5]\d)([0-5]\d)[_.]/;

/** The caption of a ring's `number`th clip (counting from 1): "Ring 2 · 10:47:58" when the filename carries the clip's
 * start (house wall clock, read as written and never converted), else "Ring 2". */
export function clipLabel(number: number, clip: DoorbellClip): string {
  const start = CLIP_START.exec(clip.filename || clip.url.split('/').pop() || '');
  return start ? `Ring ${number} · ${start[1]}:${start[2]}:${start[3]}` : `Ring ${number}`;
}

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
