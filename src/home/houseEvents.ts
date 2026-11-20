/** The `sensor.house_events` feed (AppDaemon HouseEvents): its rows, who may see each, the kind a
 * row's icon names, and the episodes rows of one cause make together. Pure. */
import type { NowFocusKind } from '../utils/navigation';
import type { NowCandidate } from './nowResolve';

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

/** Yale's operator words, "<how> <what>" such as "One-Touch Lock", and the integration's own: they say
 * how the lock moved, never who moved it. */
const YALE_OPERATOR = /^(?:(?:Auto|One-Touch|Bluetooth|Manual) (?:Lock|Unlock|Unlatch)|Home Assistant(?: user|-bruger)?)$/;

/** The recorder still holds rows in older forms: the apartment door's lock under the label "Front
 * door", Yale operator words as `by`, speaker resets, vacuum door skips written before the vacuum got
 * there, and Wolt rows for the admin alone. Rows are read as the backend writes them now, before any
 * row is matched by its time and text. */
const LEGACY_LOCK_PREFIX = 'Front door ';
const isRetired = (text: string) =>
  text.includes('default volume and ungrouped') || text.startsWith('Doors closed to queued rooms -> ');
const isFoodDelivery = (text: string) => text.startsWith('Wolt order from ');
const currentText = (text: string) =>
  text.startsWith(LEGACY_LOCK_PREFIX) && !text.includes(' -> ') ? `Apartment door ${text.slice(LEGACY_LOCK_PREFIX.length)}` : text;

/** Defensive parse of `attributes.events`: rows without a string `ts` and `text` or with an
 * unparseable `ts` are dropped, the order is trusted as newest first, and at most `max` are kept. */
export function parseHouseEvents(value: unknown, max = MAX_HOUSE_EVENTS): HouseEvent[] {
  if (!Array.isArray(value)) return [];

  const events: HouseEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.ts !== 'string' || typeof item.text !== 'string') continue;
    if (isRetired(item.text)) continue;

    const tsMs = new Date(item.ts).getTime();
    if (!Number.isFinite(tsMs)) continue;

    const cause = typeof item.cause === 'string' ? item.cause.trim() : '';
    const effect = typeof item.effect === 'string' ? item.effect.trim() : '';
    const hasCauseEffect = cause.length > 0 && effect.length > 0;

    const rawBy = typeof item.by === 'string' ? item.by.trim() : '';
    const by = YALE_OPERATOR.test(rawBy) ? '' : rawBy;

    const audienceUsers =
      item.audience !== 'admin' && Array.isArray(item.audience_users)
        ? item.audience_users
            .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
            .map(u => u.trim())
            .slice(0, 8)
        : [];

    events.push({
      tsMs,
      text: currentText(item.text),
      icon: typeof item.icon === 'string' ? item.icon : 'mdi:information-outline',
      cause: hasCauseEffect ? cause : undefined,
      effect: hasCauseEffect ? effect : undefined,
      by: by.length > 0 ? by : undefined,
      audience: item.audience === 'admin' && !isFoodDelivery(item.text) ? 'admin' : undefined,
      audienceUsers: audienceUsers.length > 0 ? audienceUsers : undefined,
    });
    if (events.length >= max) break;
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
  ['mdi:coffee', 'coffee'],
  ['mdi:weather-sunset-up', 'wake'],
]);

export function houseEventKind(event: Pick<HouseEvent, 'icon'>): NowFocusKind {
  return KIND_BY_ICON.get(event.icon) ?? 'evt';
}

/** One word for what a row's icon says happened, for icons only one kind of row carries. */
const LABEL_BY_ICON: ReadonlyMap<string, string> = new Map([
  ['mdi:door-open', 'Opened'],
  ['mdi:bell-ring', 'Rang'],
  ['mdi:bell-off', 'Missed'],
  ['mdi:basket-check', 'Emptied'],
  ['mdi:washing-machine', 'Done'],
  ['mdi:tumble-dryer', 'Done'],
  ['mdi:dishwasher', 'Done'],
  ['mdi:lock-open-variant', 'Unlocked'],
  ['mdi:weather-sunset-up', 'Wake'],
]);

export function houseEventLabel(event: Pick<HouseEvent, 'icon'>): string | null {
  return LABEL_BY_ICON.get(event.icon) ?? null;
}

/** Time of the newest row of `kind` in a raw `attributes.events` value, in epoch ms; null without
 * one. Rows are newest first. */
export function newestEventMs(value: unknown, kind: NowFocusKind): number | null {
  return parseHouseEvents(value).find(event => houseEventKind(event) === kind)?.tsMs ?? null;
}

export interface HouseEventViewer {
  /** null while the HA user lookup resolves. */
  isAdmin: boolean | null;
  name: string | null;
}

/** Kinds only admins see, whatever a row's own audience says. */
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

/** Every row of every episode as a resolver candidate, at the row's own time and kind. */
export function episodeCandidates(episodes: readonly HouseEpisode[]): NowCandidate[] {
  return episodes.flatMap(episode => episode.rows.map(row => ({ id: episode.id, kind: houseEventKind(row), atMs: row.tsMs, live: false })));
}
