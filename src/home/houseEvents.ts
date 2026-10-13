/** The `sensor.house_events` feed (AppDaemon HouseEvents): its rows, who may see each, the kind a
 * row's icon names, and the episodes rows of one cause make together. Pure. */
import type { NowFocusKind } from '../utils/navigation';

/** One feed row. `cause` and `effect` are set together or not at all. */
export interface HouseEvent {
  tsMs: number;
  icon: string;
  text: string;
  cause?: string;
  effect?: string;
  /** Display name of the person who acted. */
  by?: string;
  /** 'admin': only admin viewers see the row. Any other backend value is dropped, so a typo can
   * never hide a row from the admin. */
  audience?: 'admin';
  /** HA user display names, matched case-insensitively, who see the row besides admins. Never set
   * together with `audience`; an empty or junk list degrades to everyone. */
  audienceUsers?: string[];
}

/** The backend keeps at most this many rows, newest first. */
export const MAX_HOUSE_EVENTS = 40;

/** Defensive parse of `attributes.events`: rows without a string `ts` and `text` or with an
 * unparseable `ts` are dropped, the order is trusted as newest first, and the count is capped. */
export function parseHouseEvents(value: unknown): HouseEvent[] {
  if (!Array.isArray(value)) return [];

  const events: HouseEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.ts !== 'string' || typeof item.text !== 'string') continue;

    const tsMs = new Date(item.ts).getTime();
    if (!Number.isFinite(tsMs)) continue;

    const cause = typeof item.cause === 'string' ? item.cause.trim() : '';
    const effect = typeof item.effect === 'string' ? item.effect.trim() : '';
    const hasCauseEffect = cause.length > 0 && effect.length > 0;

    const by = typeof item.by === 'string' ? item.by.trim() : '';

    const audienceUsers =
      item.audience !== 'admin' && Array.isArray(item.audience_users)
        ? item.audience_users
            .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
            .map(u => u.trim())
            .slice(0, 8)
        : [];

    events.push({
      tsMs,
      text: item.text,
      icon: typeof item.icon === 'string' ? item.icon : 'mdi:information-outline',
      cause: hasCauseEffect ? cause : undefined,
      effect: hasCauseEffect ? effect : undefined,
      by: by.length > 0 ? by : undefined,
      audience: item.audience === 'admin' ? 'admin' : undefined,
      audienceUsers: audienceUsers.length > 0 ? audienceUsers : undefined,
    });
    if (events.length >= MAX_HOUSE_EVENTS) break;
  }
  return events;
}

/** Icons only one producer writes, and the kind each names. Every other icon is a generic `evt`,
 * including the shared ones: `mdi:basket-check` (any appliance emptied) and `mdi:door-open` (a door
 * opened, rung for or not). */
const KIND_BY_ICON: ReadonlyMap<string, NowFocusKind> = new Map([
  ['mdi:bell-ring', 'ring'],
  ['mdi:bell-off', 'ring'],
  ['mdi:washing-machine', 'washer'],
  ['mdi:tumble-dryer', 'dryer'],
  ['mdi:dishwasher', 'dish'],
  ['mdi:weather-sunset-up', 'wake'],
]);

export function houseEventKind(event: Pick<HouseEvent, 'icon'>): NowFocusKind {
  return KIND_BY_ICON.get(event.icon) ?? 'evt';
}

export interface HouseEventViewer {
  /** null while the HA user lookup resolves. */
  isAdmin: boolean | null;
  name: string | null;
}

/** Kinds only admins see, whatever a row's own audience says. Mikkel is the admin. */
const ADMIN_ONLY_KINDS: ReadonlySet<NowFocusKind> = new Set(['wake']);

export function canViewerSeeKind(kind: NowFocusKind, viewer: HouseEventViewer): boolean {
  return viewer.isAdmin === true || !ADMIN_ONLY_KINDS.has(kind);
}

/** Admins see every row. Everyone else, including a viewer still resolving, sees the rows with no
 * audience and the rows that name them, never an admin row or an admin-only kind. */
export function canViewerSee(event: HouseEvent, viewer: HouseEventViewer): boolean {
  if (viewer.isAdmin === true) return true;
  if (event.audience === 'admin' || !canViewerSeeKind(houseEventKind(event), viewer)) return false;
  if (event.audienceUsers) {
    const name = viewer.name?.trim().toLowerCase();
    return name != null && event.audienceUsers.some(u => u.toLowerCase() === name);
  }
  return true;
}

/** The rows `viewer` may see; the same array for an admin. Filter before merging episodes, picking
 * ticker rows or resolving a link. */
export function visibleHouseEvents(events: HouseEvent[], viewer: HouseEventViewer): HouseEvent[] {
  return viewer.isAdmin === true ? events : events.filter(event => canViewerSee(event, viewer));
}

/** Rows with the same cause this close after an episode's first row join it. A ring writes its two
 * rows 3 to 5 s apart. */
export const EPISODE_MERGE_MS = 60_000;

export interface HouseEpisode {
  /** The first row's time in ms, suffixed when two episodes start in the same millisecond. */
  id: string;
  /** The first row kind other than `evt`, else `evt`. */
  kind: NowFocusKind;
  startMs: number;
  endMs: number;
  /** Oldest first. */
  rows: HouseEvent[];
}

/** Episodes newest first. Rows without a cause stay on their own. */
export function houseEpisodes(events: readonly HouseEvent[]): HouseEpisode[] {
  const chronological = [...events].reverse().sort((a, b) => a.tsMs - b.tsMs);
  const episodes: HouseEpisode[] = [];
  const openByCause = new Map<string, HouseEpisode>();
  const idCounts = new Map<number, number>();
  for (const row of chronological) {
    const open = row.cause != null ? openByCause.get(row.cause) : undefined;
    if (open && row.tsMs - open.startMs <= EPISODE_MERGE_MS) {
      open.rows.push(row);
      open.endMs = row.tsMs;
      if (open.kind === 'evt') open.kind = houseEventKind(row);
      continue;
    }
    const count = (idCounts.get(row.tsMs) ?? 0) + 1;
    idCounts.set(row.tsMs, count);
    const episode: HouseEpisode = {
      id: count === 1 ? String(row.tsMs) : `${row.tsMs}-${count}`,
      kind: houseEventKind(row),
      startMs: row.tsMs,
      endMs: row.tsMs,
      rows: [row],
    };
    episodes.push(episode);
    if (row.cause != null) openByCause.set(row.cause, episode);
  }
  return episodes.reverse();
}
