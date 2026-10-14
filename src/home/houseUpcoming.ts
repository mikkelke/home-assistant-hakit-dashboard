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
}

/** The publisher keeps at most this many rows. */
export const MAX_HOUSE_UPCOMING_ROWS = 30;

const KINDS: readonly string[] = ['rain', 'train', 'maint'];

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** One row, or null when it breaks the contract: every value a string or a list of strings, an id,
 * a known kind and a title, an `at` that parses. A row that names an audience it gets wrong, or a
 * train row that names no one, is dropped rather than shown to everyone. */
function parseRow(raw: unknown): HouseUpcomingRow | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const values = Object.values(row);
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

/** Whether the next chip may offer `row`: the viewer sees it, and a row that names people names
 * them, so an admin's chip never offers someone else's train. */
export function isUpcomingFor(row: HouseUpcomingRow, viewer: HouseEventViewer): boolean {
  return canViewerSeeUpcoming(row, viewer) && (row.users == null || names(row, viewer));
}
