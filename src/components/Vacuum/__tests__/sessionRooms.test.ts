import { describe, expect, it } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events.json';
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
import archive from './fixtures/rober2-maps.json';

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
    url: `/media/local/rober2_maps/rober2_map_${stamp}_${room}.png`,
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
    expect(rooms.get(finishOf('2026-10-13T10:57:19.084'))?.map(entry => entry.filename)).toEqual([
      'rober2_map_20261013_101103_hallway.png',
      'rober2_map_20261013_101847_kitchen.png',
      'rober2_map_20261013_102731_kitchen_2.png',
      'rober2_map_20261013_104305_living_room.png',
      'rober2_map_20261013_105719_dining_room.png',
    ]);
    expect(rooms.get(finishOf('2026-10-12T14:38:02.716'))?.map(entry => entry.filename)).toEqual([
      'rober2_map_20261012_125409_hallway.png',
      'rober2_map_20261012_130651_kitchen.png',
      'rober2_map_20261012_131738_kitchen_2.png',
      'rober2_map_20261012_133312_living_room.png',
      'rober2_map_20261012_143802_dining_room.png',
    ]);
  });

  it('go only on finish rows', () => {
    expect([...rooms.keys()].sort()).toEqual([finishOf('2026-10-12T14:38:02.716'), finishOf('2026-10-13T10:57:19.084')].sort());
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
    const rows = [row('2026-10-14T11:00:41.226', START), row('2026-10-14T11:49:05.180', FINISH)];
    expect(SESSION_MAP_LAG_MS).toBe(30_000);
    const entries = [
      map('bathroom', '2026-10-14T11:00:41.169000'),
      map('hallway', '2026-10-14T11:02:14.318842'),
      map('dining_room', '2026-10-14T11:49:05.226485'),
      map('bedroom', '2026-10-14T11:49:35.180000'),
      map('guest_bathroom', '2026-10-14T11:49:35.181000'),
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
    const finish = '2026-10-14T11:49:05.180';
    const [session] = roberSessions(episodesOf([row(finish, FINISH)]));
    expect(session.fromMs).toBe(at(finish) - SESSION_LOOKBACK_MS);
    const entries = [
      map('hallway', '2026-10-14T10:18:53'),
      map('kitchen', '2026-10-14T10:19:53'),
      map('dining_room', '2026-10-14T11:49:05.226485'),
    ];
    expect(names(roomsOf([row(finish, FINISH)], entries)[0])).toEqual(['kitchen', 'dining_room']);
  });

  it('starts just after a stop row when the restart left no start row', () => {
    const rows = [row('2026-09-09T13:12:08.415', START), row('2026-09-09T13:47:51.632', STOP), row('2026-09-09T15:05:00', FINISH)];
    const entries = [
      map('hallway', '2026-09-09T13:16:00'),
      map('kitchen_2', '2026-09-09T13:47:51.724000'),
      map('living_room', '2026-09-09T14:25:00'),
      map('dining_room', '2026-09-09T15:05:00.050000'),
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
    const rows = [row('2026-10-14T11:00:41.226', START), row('2026-10-14T11:49:05.180', FINISH)];
    expect(roomsOf(rows, [])).toEqual([]);
    expect(roberSessions(episodesOf([row('2026-10-14T11:00:41.226', START)]))).toEqual([]);
    expect(roberSessions([])).toEqual([]);
  });

  it('ignores rows of other kinds that share a cause', () => {
    const shade = {
      ts: '2026-10-14T11:00:42+02:00',
      icon: 'mdi:blinds',
      text: 'x',
      cause: 'Nobody home',
      effect: 'Closing the blinds fully',
    };
    const rows = [row('2026-10-14T11:00:41.226', START), shade, row('2026-10-14T11:49:05.180', FINISH)];
    expect(names(roomsOf(rows, [map('hallway', '2026-10-14T11:02:14')])[0])).toEqual(['hallway']);
  });
});

describe('mapEntryMs', () => {
  it('reads the wall clock as Copenhagen time whatever the device zone', () => {
    expect(mapEntryMs({ datetime: '2026-10-14T11:49:05.226485', timestamp: '20261014_114905' })).toBe(
      Date.parse('2026-10-14T11:49:05.226+02:00')
    );
    expect(mapEntryMs({ datetime: '2026-12-05T14:28:03', timestamp: '' })).toBe(Date.parse('2026-12-05T14:28:03+01:00'));
  });

  it('falls back to the filename stamp, and gives null without either', () => {
    expect(mapEntryMs({ timestamp: '20261014_114905' })).toBe(Date.parse('2026-10-14T11:49:05+02:00'));
    expect(mapEntryMs({ datetime: 'soon', timestamp: '' })).toBeNull();
    expect(mapEntryMs({ timestamp: '' })).toBeNull();
  });
});

describe('roberRoomAreaId', () => {
  it('puts both kitchen sides in the kitchen and Claudias room in its old area id', () => {
    expect(['kitchen', 'kitchen_2', 'claudias_room', 'hallway'].map(roberRoomAreaId)).toEqual(['kitchen', 'kitchen', 'office', 'hallway']);
  });
});
