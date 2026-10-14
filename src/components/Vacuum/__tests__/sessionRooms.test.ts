import { describe, expect, it } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events-2026-10-13.json';
import { houseEpisodes, parseHouseEvents } from '../../../home/houseEvents';
import type { MapEntry } from '../maps';
import {
  SESSION_LOOKBACK_MS,
  SESSION_MAP_LAG_MS,
  mapEntryMs,
  roberRoomAreaId,
  roberSessions,
  roomsInWindow,
  sessionRooms,
} from '../sessionRooms';
import archive from './fixtures/rober2-maps-2026-10-14.json';

const START = ['Nobody home', 'Vacuum starting its cleaning round'] as const;
const FINISH = ['All queued rooms cleaned', 'Vacuum finished its round - heading to the dock'] as const;
const STOP = ['Someone came home', 'Vacuum stopped cleaning'] as const;

/** A Rober2 feed row as HouseEvents writes it, at a Copenhagen summer-time wall clock reading. */
const row = (wall: string, [cause, effect]: readonly [string, string]) => ({
  ts: `${wall}+02:00`,
  icon: 'mdi:robot-vacuum',
  text: `${cause} -> ${effect}`,
  cause,
  effect,
});

/** An index entry as the app writes it: wall clock time without an offset. */
const map = (room: string, wall: string): MapEntry => {
  const stamp = wall.slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
  return {
    filename: `rober2_map_${stamp}_${room}.png`,
    timestamp: stamp,
    datetime: wall,
    room,
    url: `/local/rober2_maps/rober2_map_${stamp}_${room}.png`,
  };
};

const episodesOf = (rows: unknown[]) => houseEpisodes(parseHouseEvents([...rows].reverse()));
const roomsOf = (rows: unknown[], entries: readonly MapEntry[]) => [...sessionRooms(roberSessions(episodesOf(rows)), entries).values()];
const names = (maps: readonly MapEntry[] | undefined) => maps?.map(entry => entry.room);
const at = (wall: string) => Date.parse(`${wall}+02:00`);

describe('the rooms of a finished round', () => {
  const episodes = houseEpisodes(parseHouseEvents(feed.attributes.events));
  const finishOf = (wall: string) => episodes.find(episode => episode.startMs === at(wall))!.id;
  const rooms = sessionRooms(roberSessions(episodes), archive.maps);

  it('are the maps saved from the start row to just after the finish row, in cleaning order', () => {
    expect(rooms.get(finishOf('2026-10-13T08:41:47.432'))?.map(entry => entry.filename)).toEqual([
      'rober2_map_20261013_075536_hallway.png',
      'rober2_map_20261013_080153_kitchen.png',
      'rober2_map_20261013_081055_kitchen_2.png',
      'rober2_map_20261013_082722_living_room.png',
      'rober2_map_20261013_084147_dining_room.png',
    ]);
    expect(rooms.get(finishOf('2026-10-12T11:41:37.244'))?.map(entry => entry.filename)).toEqual([
      'rober2_map_20261012_094914_hallway.png',
      'rober2_map_20261012_100227_kitchen.png',
      'rober2_map_20261012_101108_kitchen_2.png',
      'rober2_map_20261012_102815_living_room.png',
      'rober2_map_20261012_114137_dining_room.png',
    ]);
  });

  it('go only on finish rows', () => {
    expect([...rooms.keys()].sort()).toEqual([finishOf('2026-10-12T11:41:37.244'), finishOf('2026-10-13T08:41:47.432')].sort());
  });
});

describe('roomsInWindow', () => {
  const from = at('2026-10-14T09:00:00');
  const to = at('2026-10-14T10:00:00');

  it('keeps maps inside the window, edges included, and drops those outside it', () => {
    const entries = [
      map('hallway', '2026-10-14T08:59:59.999000'),
      map('kitchen', '2026-10-14T09:00:00'),
      map('living_room', '2026-10-14T09:30:00.500000'),
      map('dining_room', '2026-10-14T10:00:00'),
      map('bedroom', '2026-10-14T10:00:00.001000'),
    ];
    expect(names(roomsInWindow(entries, from, to))).toEqual(['kitchen', 'living_room', 'dining_room']);
  });

  it('shows a room cleaned twice once, at its newest map, and no stuck-robot snapshot', () => {
    const entries = [
      map('kitchen', '2026-10-14T09:05:00'),
      map('stuck_in_the_kitchen', '2026-10-14T09:10:00'),
      map('hallway', '2026-10-14T09:20:00'),
      map('kitchen', '2026-10-14T09:40:00'),
    ];
    expect(roomsInWindow(entries, from, to).map(entry => entry.datetime)).toEqual(['2026-10-14T09:20:00', '2026-10-14T09:40:00']);
  });
});

describe('roberSessions with mapped rooms', () => {
  it('leaves out maps saved before the start row or after the lag past the finish row', () => {
    const rows = [row('2026-10-14T09:11:29.357', START), row('2026-10-14T10:03:11.835', FINISH)];
    expect(SESSION_MAP_LAG_MS).toBe(30_000);
    const entries = [
      map('bathroom', '2026-10-14T09:11:29.300000'),
      map('hallway', '2026-10-14T09:15:58.354052'),
      map('dining_room', '2026-10-14T10:03:11.873893'),
      map('bedroom', '2026-10-14T10:03:41.835000'),
      map('guest_bathroom', '2026-10-14T10:03:41.836000'),
    ];
    expect(names(roomsOf(rows, entries)[0])).toEqual(['hallway', 'dining_room', 'bedroom']);
  });

  it('keeps two rounds on one day apart', () => {
    const rows = [
      row('2026-10-14T09:00:00', START),
      row('2026-10-14T09:40:00', FINISH),
      row('2026-10-14T14:00:00', START),
      row('2026-10-14T14:50:00', FINISH),
    ];
    const entries = [
      map('hallway', '2026-10-14T09:10:00'),
      map('kitchen', '2026-10-14T09:25:00'),
      map('dining_room', '2026-10-14T09:40:00.050000'),
      map('living_room', '2026-10-14T14:20:00'),
      map('dining_room', '2026-10-14T14:50:00.030000'),
    ];
    const [morning, afternoon] = roomsOf(rows, entries);
    expect(names(morning)).toEqual(['hallway', 'kitchen', 'dining_room']);
    expect(names(afternoon)).toEqual(['living_room', 'dining_room']);
  });

  it('reaches back at most the lookback when the start row has left the feed', () => {
    const finish = '2026-10-14T10:03:11.835';
    const [session] = roberSessions(episodesOf([row(finish, FINISH)]));
    expect(session.fromMs).toBe(at(finish) - SESSION_LOOKBACK_MS);
    const entries = [
      map('hallway', '2026-10-14T08:33:00'),
      map('kitchen', '2026-10-14T08:34:00'),
      map('dining_room', '2026-10-14T10:03:11.873893'),
    ];
    expect(names(roomsOf([row(finish, FINISH)], entries)[0])).toEqual(['kitchen', 'dining_room']);
  });

  it('starts just after a stop row when the restart left no start row', () => {
    const rows = [row('2026-09-09T08:36:39.759', START), row('2026-09-09T09:18:40.008', STOP), row('2026-09-09T10:30:00', FINISH)];
    const entries = [
      map('hallway', '2026-09-09T08:41:00'),
      map('kitchen_2', '2026-09-09T09:18:40.100000'),
      map('living_room', '2026-09-09T09:50:00'),
      map('dining_room', '2026-09-09T10:30:00.050000'),
    ];
    expect(names(roomsOf(rows, entries)[0])).toEqual(['living_room', 'dining_room']);
  });

  it('starts at the previous finish row plus the lag when there is no start row', () => {
    const rows = [row('2026-10-14T09:40:00', FINISH), row('2026-10-14T10:20:00', FINISH)];
    const entries = [
      map('dining_room', '2026-10-14T09:40:00.050000'),
      map('bedroom', '2026-10-14T10:05:00'),
      map('bathroom', '2026-10-14T10:20:00.040000'),
    ];
    const [first, second] = roomsOf(rows, entries);
    expect(names(first)).toEqual(['dining_room']);
    expect(names(second)).toEqual(['bedroom', 'bathroom']);
  });

  it('gives no round rooms from an empty index, and no rounds without a finish row', () => {
    const rows = [row('2026-10-14T09:11:29.357', START), row('2026-10-14T10:03:11.835', FINISH)];
    expect(roomsOf(rows, [])).toEqual([]);
    expect(roberSessions(episodesOf([row('2026-10-14T09:11:29.357', START)]))).toEqual([]);
    expect(roberSessions([])).toEqual([]);
  });

  it('ignores rows of other kinds that share a cause', () => {
    const shade = {
      ts: '2026-10-14T09:11:30+02:00',
      icon: 'mdi:blinds',
      text: 'x',
      cause: 'Nobody home',
      effect: 'Closing the blinds fully',
    };
    const rows = [row('2026-10-14T09:11:29.357', START), shade, row('2026-10-14T10:03:11.835', FINISH)];
    expect(names(roomsOf(rows, [map('hallway', '2026-10-14T09:15:58')])[0])).toEqual(['hallway']);
  });
});

describe('mapEntryMs', () => {
  it('reads the wall clock as Copenhagen time whatever the device zone', () => {
    expect(mapEntryMs({ datetime: '2026-10-14T10:03:11.873893', timestamp: '20261014_100311' })).toBe(
      Date.parse('2026-10-14T10:03:11.873+02:00')
    );
    expect(mapEntryMs({ datetime: '2026-12-13T16:07:23', timestamp: '' })).toBe(Date.parse('2026-12-13T16:07:23+01:00'));
  });

  it('falls back to the filename stamp, and gives null without either', () => {
    expect(mapEntryMs({ timestamp: '20261014_100311' })).toBe(Date.parse('2026-10-14T10:03:11+02:00'));
    expect(mapEntryMs({ datetime: 'soon', timestamp: '' })).toBeNull();
    expect(mapEntryMs({ timestamp: '' })).toBeNull();
  });
});

describe('roberRoomAreaId', () => {
  it('puts both kitchen sides in the kitchen and Claudias room in its old area id', () => {
    expect(['kitchen', 'kitchen_2', 'claudias_room', 'hallway'].map(roberRoomAreaId)).toEqual(['kitchen', 'kitchen', 'office', 'hallway']);
  });
});
