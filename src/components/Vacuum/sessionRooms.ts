/** Which archived room maps belong to each Rober2 round that the house feed reports as finished. Pure. */
import { homeWallTimeToMs } from '../../energy/homeTime';
import type { HouseEpisode, HouseEvent } from '../../home/houseEvents';
import type { MapEntry } from './maps';

/** How long after its finish row a round's last map may be saved. The app reports the finish first, then saves the
 * last room's map, giving its download 10 s. */
export const SESSION_MAP_LAG_MS = 30_000;

/** How far back from its finish row a round may reach when no earlier Rober2 row bounds it. Longer than an ordinary
 * round, and shorter than the gap to the maps of a round that was stopped and then restarted the same morning. */
export const SESSION_LOOKBACK_MS = 90 * 60_000;

/** One finished round: the episode of its finish row, and when its rooms' maps were saved. */
export interface RoberSession {
  episodeId: string;
  fromMs: number;
  toMs: number;
}

type Boundary = 'start' | 'finish' | 'stop';

/** The rober2 app's wording for a round starting, finishing, and being stopped by someone coming home or an error. */
function boundaryOf(row: HouseEvent): Boundary | null {
  if (row.icon !== 'mdi:robot-vacuum') return null;
  if (row.effect === 'Vacuum starting its cleaning round') return 'start';
  if (row.cause === 'All queued rooms cleaned') return 'finish';
  if (row.effect?.startsWith('Vacuum stopped') || row.effect?.startsWith('Cleaning stopped')) return 'stop';
  return null;
}

/** A round per finish row, oldest first. It starts at its start row; without one, just after the nearest earlier
 * finish or stop row, and never more than the lookback before its finish row. */
export function roberSessions(episodes: readonly HouseEpisode[]): RoberSession[] {
  const marks: { boundary: Boundary; atMs: number; episodeId: string }[] = [];
  for (const episode of episodes) {
    for (const row of episode.rows) {
      const boundary = boundaryOf(row);
      if (boundary) marks.push({ boundary, atMs: row.tsMs, episodeId: episode.id });
    }
  }
  marks.sort((a, b) => a.atMs - b.atMs);
  return marks.flatMap((mark, index) => {
    if (mark.boundary !== 'finish') return [];
    const previous = marks[index - 1];
    const fromMs =
      previous?.boundary === 'start'
        ? previous.atMs
        : Math.max(mark.atMs - SESSION_LOOKBACK_MS, previous ? previous.atMs + SESSION_MAP_LAG_MS : -Infinity);
    return [{ episodeId: mark.episodeId, fromMs, toMs: mark.atMs + SESSION_MAP_LAG_MS }];
  });
}

const WALL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const WALL_STAMP = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;

/** When a map was saved, in epoch ms. The app writes `datetime`, and `timestamp` as YYYYMMDD_HHMMSS, on the house's
 * wall clock without an offset. Null when neither parses. */
export function mapEntryMs(entry: Pick<MapEntry, 'datetime' | 'timestamp'>): number | null {
  const parts = WALL_DATETIME.exec(entry.datetime ?? '') ?? WALL_STAMP.exec(entry.timestamp ?? '');
  if (!parts) return null;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const millis = Number((parts[7] ?? '').padEnd(3, '0').slice(0, 3));
  return homeWallTimeToMs(year, month, day, hour, minute) + second * 1000 + millis;
}

/** The maps saved within the window, one per room (its newest), in cleaning order. A stuck-robot snapshot is no room. */
export function roomsInWindow(entries: readonly MapEntry[], fromMs: number, toMs: number): MapEntry[] {
  const timed = entries
    .map(entry => ({ entry, atMs: mapEntryMs(entry) }))
    .filter((item): item is { entry: MapEntry; atMs: number } => item.atMs != null && item.atMs >= fromMs && item.atMs <= toMs)
    .sort((a, b) => a.atMs - b.atMs);
  const byRoom = new Map<string, MapEntry>();
  for (const { entry } of timed) {
    if (!entry.room || entry.room.startsWith('stuck')) continue;
    byRoom.delete(entry.room);
    byRoom.set(entry.room, entry);
  }
  return [...byRoom.values()];
}

/** The room maps of each finished round, by the episode id of its finish row; rounds without maps are left out. */
export function sessionRooms(sessions: readonly RoberSession[], entries: readonly MapEntry[]): Map<string, MapEntry[]> {
  const out = new Map<string, MapEntry[]>();
  for (const session of sessions) {
    const rooms = roomsInWindow(entries, session.fromMs, session.toMs);
    if (rooms.length > 0) out.set(session.episodeId, rooms);
  }
  return out;
}

/** The HA area a Rober2 room lies in: both kitchen sides are the kitchen, and Claudia's room is still the area `office`. */
export function roberRoomAreaId(room: string | undefined): string | undefined {
  if (room === 'kitchen_2') return 'kitchen';
  if (room === 'claudias_room') return 'office';
  return room;
}
