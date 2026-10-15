/** The Rober2 rounds the house feed shows, and the rooms each cleaned by the archived room maps. Pure. */
import { homeWallTimeToMs } from '../../energy/homeTime';
import type { HouseEpisode, HouseEvent } from '../../home/houseEvents';
import type { MapEntry } from './maps';

/** How long after its finish or stop row a round's last map may be saved. The app reports the finish first, then saves
 * the last room's map, giving its download 10 s. */
export const SESSION_MAP_LAG_MS = 30_000;

/** One room the robot finished. */
export interface RoberRoom {
  map: MapEntry;
  /** When the room was done: its map's save time, never after its round's finish or stop row, which the app writes
   * before it saves the last room's map. */
  atMs: number;
}

/** One Rober2 round: the episodes of its start row and of its finish or stop row, null where the feed shows none, and
 * the rooms it cleaned, oldest first. */
export interface RoberRound {
  startId: string | null;
  endId: string | null;
  rooms: RoberRoom[];
}

type Boundary = 'start' | 'end';

/** The rober2 app's wording for a round starting, and for one ending: finished, or stopped by someone coming home or an
 * error. */
function boundaryOf(row: HouseEvent): Boundary | null {
  if (row.icon !== 'mdi:robot-vacuum') return null;
  if (row.effect === 'Vacuum starting its cleaning round') return 'start';
  if (row.cause === 'All queued rooms cleaned' || row.effect?.startsWith('Vacuum stopped') || row.effect?.startsWith('Cleaning stopped')) {
    return 'end';
  }
  return null;
}

/** The rounds among `episodes`, oldest first, with a room for every map saved since the oldest episode began. A start
 * row opens a round and a finish or stop row ends it, keeping the maps saved within the lag after it. A map saved while
 * no round is open opens one without a start row, which the next finish or stop row ends. A stuck-robot snapshot is no
 * room. */
export function roberRounds(episodes: readonly HouseEpisode[], entries: readonly MapEntry[]): RoberRound[] {
  if (episodes.length === 0) return [];
  const fromMs = Math.min(...episodes.map(episode => episode.startMs));
  const marks = episodes.flatMap(episode =>
    episode.rows.flatMap(row => {
      const boundary = boundaryOf(row);
      return boundary ? [{ atMs: row.tsMs, boundary, episode }] : [];
    })
  );
  const passes = entries.flatMap(map => {
    const atMs = mapEntryMs(map);
    return atMs != null && atMs >= fromMs && map.room && !map.room.startsWith('stuck') ? [{ atMs, map }] : [];
  });

  const rounds: RoberRound[] = [];
  let open: RoberRound | null = null;
  let ended: { round: RoberRound; beforeMs: number; untilMs: number } | null = null;
  for (const item of [...marks, ...passes].sort((a, b) => a.atMs - b.atMs)) {
    if ('map' in item) {
      if (ended && item.atMs <= ended.untilMs) {
        ended.round.rooms.push({ map: item.map, atMs: Math.min(item.atMs, ended.beforeMs) });
        continue;
      }
      if (!open) rounds.push((open = { startId: null, endId: null, rooms: [] }));
      open.rooms.push({ map: item.map, atMs: item.atMs });
    } else if (item.boundary === 'start') {
      rounds.push((open = { startId: item.episode.id, endId: null, rooms: [] }));
      ended = null;
    } else {
      const round: RoberRound = open ?? { startId: null, endId: null, rooms: [] };
      if (!open) rounds.push(round);
      round.endId = item.episode.id;
      open = null;
      ended = { round, beforeMs: item.episode.startMs, untilMs: item.atMs + SESSION_MAP_LAG_MS };
    }
  }
  return rounds;
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

/** The HA area a Rober2 room lies in: both kitchen sides are the kitchen, and Claudia's room is still the area `office`. */
export function roberRoomAreaId(room: string | undefined): string | undefined {
  if (room === 'kitchen_2') return 'kitchen';
  if (room === 'claudias_room') return 'office';
  return room;
}
