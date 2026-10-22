/** The `sensor.house_upcoming` rows (AppDaemon HouseUpcoming): maintenance, Kristine's train and rain
 * while a terrace door is open. Pure. */
import type { HouseEventViewer } from './houseEvents';

export type HouseUpcomingKind = 'rain' | 'train' | 'maint';

export interface HouseUpcomingRow {
  id: string;
  kind: HouseUpcomingKind;
  /** null for an untimed row. */
  atMs: number | null;
  icon: string;
  title: string;
  detail: string | null;
  chip: string | null;
  /** HA area id a tap opens; null when no room owns the row. */
  areaId: string | null;
  /** Only admins see it: every `maint` row, whatever its audience says. */
  adminOnly: boolean;
  /** HA display names who see it besides admins. */
  users: string[] | null;
  /** The next chip passes over it (`next: "skip"`): a row timed at now that can stay so for days. */
  skipNext: boolean;
  /** A maintenance row an admin closes with a Done button (`done: "tap"`). */
  tapDone: boolean;
  /** The short lines of its sheet: the interval, when it was last done. */
  info: string[];
  /** What to do, in order, and the safety note that goes with it (`steps`, `warn`). */
  steps: string[];
  warn: string | null;
  /** The short lines of an overview row, one per thing it covers (`items`); none without a list of strings. */
  items: string[];
}

/** Whether a tap on the row opens its sheet instead of its room: it has a Done button, a guide, info lines or a list. */
export const hasSheet = (row: HouseUpcomingRow): boolean =>
  row.tapDone || row.steps.length > 0 || row.info.length > 0 || row.items.length > 0;

/** Whether the row is due: it has no time, and does not ask the next chip to pass over it (a log row). */
export const isDue = (row: HouseUpcomingRow): boolean => row.atMs == null && !row.skipNext;

/** The maintenance rows whose room panel holds a card for the thing itself: the appliances' own (washer, dryer, dishwasher,
 * xBloom) and Rober2's. */
const ROOM_CARD_PREFIXES = ['maint:washer:', 'maint:dryer:', 'maint:dishwasher:', 'maint:coffee:', 'maint:rober2:'];

/** Whether a tap may take the viewer to the row's room: the row names one, and a maintenance row only if that room holds a card
 * for it or lists it as due (see `dueRows`). A plant, a battery or a one-off task that is not due yet has nothing there. */
export const opensRoom = (row: HouseUpcomingRow): boolean =>
  row.areaId != null && (row.kind !== 'maint' || isDue(row) || ROOM_CARD_PREFIXES.some(prefix => row.id.startsWith(prefix)));

/** The publisher keeps at most this many rows. */
export const MAX_HOUSE_UPCOMING_ROWS = 30;

/** The most lines an overview row lists. */
export const MAX_ROW_ITEMS = 20;

const KINDS: readonly string[] = ['rain', 'train', 'maint'];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The non-empty lines of a list of strings; none for anything else. */
const lines = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(line => (typeof line === 'string' && line.trim() ? [line.trim()] : [])) : [];

/** The non-empty lines of `items`, at most MAX_ROW_ITEMS; none unless it is a list of strings. */
const itemLines = (value: unknown): string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string') ? lines(value).slice(0, MAX_ROW_ITEMS) : [];

/** One row, or null when it breaks the contract: every value a string or a list of strings, an id,
 * a known kind and a title, an `at` that parses. A row that names an audience it gets wrong, or a
 * train row that names no one, is dropped rather than shown to everyone. */
function parseRow(raw: unknown): HouseUpcomingRow | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  // A bad `items` costs the row nothing: it is left out of the contract below and read on its own.
  const { items, ...rest } = row;
  const values = Object.values(rest);
  if (!values.every(v => typeof v === 'string' || (Array.isArray(v) && v.every(item => typeof item === 'string')))) return null;
  const id = text(row.id);
  const title = text(row.title);
  const kind = row.kind as HouseUpcomingKind;
  if (!id || !title || !KINDS.includes(kind)) return null;
  const atMs = row.at === undefined ? null : typeof row.at === 'string' ? Date.parse(row.at) : Number.NaN;
  if (atMs !== null && !Number.isFinite(atMs)) return null;
  const listed = row.audience_users;
  if (listed !== undefined && !Array.isArray(listed)) return null;
  const users = listed ? (listed as string[]).map(name => name.trim()).filter(Boolean) : null;
  if (row.audience !== undefined && (row.audience !== 'admin' || listed)) return null;
  if (listed && (!users?.length || users.length !== listed.length)) return null;
  if (kind === 'train' && !users) return null;
  const adminOnly = kind === 'maint' || row.audience === 'admin';
  // Only a maintenance row, which only admins see, has a sheet.
  const sheet = kind === 'maint';
  return {
    id,
    kind,
    atMs,
    icon: typeof row.icon === 'string' && row.icon.startsWith('mdi:') ? row.icon : 'mdi:information-outline',
    title,
    detail: text(row.detail),
    chip: text(row.chip),
    areaId: text(row.area),
    adminOnly,
    users: adminOnly ? null : users,
    skipNext: row.next === 'skip',
    tapDone: sheet && row.done === 'tap',
    info: sheet ? lines(row.info) : [],
    steps: sheet ? lines(row.steps) : [],
    warn: sheet ? text(row.warn) : null,
    items: sheet ? itemLines(items) : [],
  };
}

/** The rows of `attributes`, in publish order; none once the lease in `expires` has run out, since a
 * stopped publisher would otherwise leave them up for good. */
export function parseHouseUpcoming(attributes: unknown, nowMs: number): HouseUpcomingRow[] {
  const attrs = (attributes ?? {}) as Record<string, unknown>;
  const expires = typeof attrs.expires === 'string' ? Date.parse(attrs.expires) : Number.NaN;
  if (!(expires > nowMs) || !Array.isArray(attrs.rows)) return [];
  return attrs.rows
    .map(parseRow)
    .filter((row): row is HouseUpcomingRow => row != null)
    .slice(0, MAX_HOUSE_UPCOMING_ROWS);
}

const names = (row: HouseUpcomingRow, viewer: HouseEventViewer) =>
  row.users?.some(user => user.toLowerCase() === viewer.name?.trim().toLowerCase()) === true;

/** Admins see every row; anyone else, including a viewer still resolving, the rows for everyone and
 * the rows that name them. */
export function canViewerSeeUpcoming(row: HouseUpcomingRow, viewer: HouseEventViewer): boolean {
  if (viewer.isAdmin === true) return true;
  return !row.adminOnly && (row.users == null || names(row, viewer));
}

/** The rows that are due in a room and that `viewer` may see, in publish order: what needs doing where. A rain row is always
 * due: the publisher has one for each open terrace door, and only while rain is forecast or falling. */
export const dueRows = (rows: readonly HouseUpcomingRow[], viewer: HouseEventViewer): HouseUpcomingRow[] =>
  rows.filter(row => (row.kind === 'rain' || isDue(row)) && row.areaId != null && canViewerSeeUpcoming(row, viewer));

/** Whether the next chip may offer `row`: the row does not ask to be passed over, the viewer sees it,
 * and a row that names people names them, so an admin's chip never offers someone else's train. */
export function isUpcomingFor(row: HouseUpcomingRow, viewer: HouseEventViewer): boolean {
  return !row.skipNext && canViewerSeeUpcoming(row, viewer) && (row.users == null || names(row, viewer));
}
