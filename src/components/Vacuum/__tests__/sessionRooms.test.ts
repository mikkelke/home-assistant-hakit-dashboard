import { describe, expect, it } from 'vitest';
import feed from '../../../home/__tests__/fixtures/house-events.json';
import { houseEpisodes, parseHouseEvents, type HouseEpisode } from '../../../home/houseEvents';
import type { MapEntry } from '../maps';
import { SESSION_MAP_LAG_MS, mapEntryMs, roberRoomAreaId, roberRounds, type RoberRoom } from '../sessionRooms';
import archive from './fixtures/rober2-maps.json';

const START = ['Nobody home', 'Vacuum starting its cleaning round'] as const;
const FINISH = ['All queued rooms cleaned', 'Vacuum finished its round - heading to the dock'] as const;
const STOP = ['Someone came home', 'Vacuum stopped cleaning'] as const;
const ERROR = ['Vacuum error: Main Brush Jammed', "Cleaning stopped - automation paused until it's rescued"] as const;

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
const names = (rooms: readonly RoberRoom[]) => rooms.map(room => room.map.room);
const at = (wall: string) => Date.parse(`${wall}+02:00`);
const idAt = (episodes: readonly HouseEpisode[], wall: string) => episodes.find(episode => episode.startMs === at(wall))!.id;

describe('the rounds of the fixture feed', () => {
  const episodes = houseEpisodes(parseHouseEvents(feed.attributes.events));
  const rounds = roberRounds(episodes, archive.maps);

  it('run from each start row to its finish row, with a room per map saved between them, oldest first', () => {
    expect(rounds.slice(0, 2).map(round => ({ ...round, rooms: round.rooms.map(room => room.map.filename) }))).toEqual([
      {
        startId: idAt(episodes, '2026-10-12T12:49:27.035'),
        endId: idAt(episodes, '2026-10-12T14:38:02.716'),
        rooms: [
          'rober2_map_20261012_125409_hallway.png',
          'rober2_map_20261012_130651_kitchen.png',
          'rober2_map_20261012_131738_kitchen_2.png',
          'rober2_map_20261012_133312_living_room.png',
          'rober2_map_20261012_143802_dining_room.png',
        ],
      },
      {
        startId: idAt(episodes, '2026-10-13T10:06:52.493'),
        endId: idAt(episodes, '2026-10-13T10:57:19.084'),
        rooms: [
          'rober2_map_20261013_101103_hallway.png',
          'rober2_map_20261013_101847_kitchen.png',
          'rober2_map_20261013_102731_kitchen_2.png',
          'rober2_map_20261013_104305_living_room.png',
          'rober2_map_20261013_105719_dining_room.png',
        ],
      },
    ]);
  });

  it('time each room by its map on the Copenhagen clock, the last no later than its finish row', () => {
    const [, round] = rounds;
    expect(round.rooms.map(room => room.atMs)).toEqual([
      at('2026-10-13T10:11:03.508'),
      at('2026-10-13T10:18:47.913'),
      at('2026-10-13T10:27:31.640'),
      at('2026-10-13T10:43:05.117'),
      at('2026-10-13T10:57:19.084'),
    ]);
  });

  it('leave out maps saved before the oldest row, and give the maps no row bounds an open round of their own', () => {
    expect(rounds).toHaveLength(3);
    expect(rounds[2]).toMatchObject({ startId: null, endId: null });
    expect(names(rounds[2].rooms)).toEqual(['hallway', 'kitchen', 'kitchen_2', 'living_room', 'dining_room']);
  });
});

describe('roberRounds', () => {
  it('ends a round at a stop row as well, so an interrupted round keeps the rooms it cleaned', () => {
    const rows = [
      row('2026-09-14T08:49:36.230', START),
      row('2026-09-14T09:16:27.760', STOP),
      row('2026-09-14T10:44:27.101', START),
      row('2026-09-14T11:14:18.363', FINISH),
    ];
    const episodes = episodesOf(rows);
    const entries = [
      map('hallway', '2026-09-14T08:56:10.120000'),
      map('kitchen', '2026-09-14T09:04:41.500000'),
      map('kitchen_2', '2026-09-14T10:52:03'),
      map('living_room', '2026-09-14T11:14:18.410000'),
    ];
    const [stopped, resumed] = roberRounds(episodes, entries);
    expect(stopped.startId).toBe(idAt(episodes, '2026-09-14T08:49:36.230'));
    expect(stopped.endId).toBe(idAt(episodes, '2026-09-14T09:16:27.760'));
    expect(names(stopped.rooms)).toEqual(['hallway', 'kitchen']);
    expect(resumed.endId).toBe(idAt(episodes, '2026-09-14T11:14:18.363'));
    expect(names(resumed.rooms)).toEqual(['kitchen_2', 'living_room']);
  });

  it('ends a round at an error row too', () => {
    const rows = [row('2026-10-14T09:00:00', START), row('2026-10-14T09:30:00', ERROR), row('2026-10-14T13:00:00', START)];
    const entries = [map('hallway', '2026-10-14T09:10:00'), map('kitchen', '2026-10-14T13:20:00')];
    const [stopped, next] = roberRounds(episodesOf(rows), entries);
    expect(stopped.endId).not.toBeNull();
    expect(names(stopped.rooms)).toEqual(['hallway']);
    expect(names(next.rooms)).toEqual(['kitchen']);
  });

  it('keeps a round open without an end row, while it runs or after it stopped without one', () => {
    const rows = [row('2026-10-15T07:34:19.411', START), row('2026-10-15T13:00:00', START)];
    const entries = [
      map('hallway', '2026-10-15T07:38:51.319490'),
      map('kitchen', '2026-10-15T07:44:07.753620'),
      map('bedroom', '2026-10-15T13:15:00'),
    ];
    const rounds = roberRounds(episodesOf(rows), entries);
    expect(rounds.map(round => [round.endId, names(round.rooms)])).toEqual([
      [null, ['hallway', 'kitchen']],
      [null, ['bedroom']],
    ]);
  });

  it('gives a room cleaned twice in a round a room each time', () => {
    const rows = [row('2026-10-14T09:00:00', START), row('2026-10-14T10:00:00', FINISH)];
    const entries = [map('kitchen', '2026-10-14T09:05:00'), map('hallway', '2026-10-14T09:20:00'), map('kitchen', '2026-10-14T09:40:00')];
    const [round] = roberRounds(episodesOf(rows), entries);
    expect(names(round.rooms)).toEqual(['kitchen', 'hallway', 'kitchen']);
    expect(round.rooms.map(room => room.atMs)).toEqual([at('2026-10-14T09:05:00'), at('2026-10-14T09:20:00'), at('2026-10-14T09:40:00')]);
  });

  it('leaves out stuck-robot snapshots and maps of no room', () => {
    const rows = [row('2026-10-14T09:00:00', START), row('2026-10-14T10:00:00', FINISH)];
    const entries = [
      map('hallway', '2026-10-14T09:10:00'),
      map('stuck_in_the_kitchen', '2026-10-14T09:20:00'),
      map('stuck_trying_to_leave_the_bathroom', '2026-10-14T09:25:00'),
      { ...map('bedroom', '2026-10-14T09:30:00'), room: undefined },
    ];
    expect(roberRounds(episodesOf(rows), entries).map(round => names(round.rooms))).toEqual([['hallway']]);
  });

  it('keeps the maps saved up to the lag after the end row, timed at that row, and opens a new round after it', () => {
    expect(SESSION_MAP_LAG_MS).toBe(30_000);
    const rows = [row('2026-10-14T11:00:41.226', START), row('2026-10-14T11:49:05.180', FINISH)];
    const entries = [
      map('hallway', '2026-10-14T11:02:14.318842'),
      map('dining_room', '2026-10-14T11:49:05.226485'),
      map('bedroom', '2026-10-14T11:49:35.180000'),
      map('guest_bathroom', '2026-10-14T11:49:35.181000'),
    ];
    const [round, after] = roberRounds(episodesOf(rows), entries);
    expect(names(round.rooms)).toEqual(['hallway', 'dining_room', 'bedroom']);
    expect(round.rooms.map(room => room.atMs).slice(1)).toEqual([at('2026-10-14T11:49:05.180'), at('2026-10-14T11:49:05.180')]);
    expect(after).toMatchObject({ startId: null, endId: null });
    expect(names(after.rooms)).toEqual(['guest_bathroom']);
  });

  it('starts a round at the first map after a stop row when the restart left no start row', () => {
    const rows = [row('2026-09-09T13:12:08.415', START), row('2026-09-09T13:47:51.632', STOP), row('2026-09-09T15:05:00', FINISH)];
    const episodes = episodesOf(rows);
    const entries = [
      map('hallway', '2026-09-09T13:16:00'),
      map('kitchen_2', '2026-09-09T13:47:51.724000'),
      map('living_room', '2026-09-09T14:25:00'),
      map('dining_room', '2026-09-09T15:05:00.050000'),
    ];
    const [stopped, restarted] = roberRounds(episodes, entries);
    expect(names(stopped.rooms)).toEqual(['hallway', 'kitchen_2']);
    expect(restarted.startId).toBeNull();
    expect(restarted.endId).toBe(idAt(episodes, '2026-09-09T15:05:00'));
    expect(names(restarted.rooms)).toEqual(['living_room', 'dining_room']);
  });

  it('gives a finish row with no start row the maps saved since the previous end row', () => {
    const rows = [row('2026-10-14T09:40:00', FINISH), row('2026-10-14T10:20:00', FINISH)];
    const entries = [
      map('dining_room', '2026-10-14T09:40:00.050000'),
      map('bedroom', '2026-10-14T10:05:00'),
      map('bathroom', '2026-10-14T10:20:00.040000'),
    ];
    expect(roberRounds(episodesOf(rows), entries).map(round => names(round.rooms))).toEqual([['dining_room'], ['bedroom', 'bathroom']]);
  });

  it('leaves out maps saved before the oldest row, as when the start row has left the feed', () => {
    const unlocked = { ts: '2026-10-14T11:00:00+02:00', icon: 'mdi:lock-open-variant', text: 'Front door unlocked' };
    const rows = [unlocked, row('2026-10-14T11:49:05.180', FINISH)];
    const entries = [
      map('hallway', '2026-10-14T10:58:53'),
      map('kitchen', '2026-10-14T11:20:00'),
      map('dining_room', '2026-10-14T11:49:05.226485'),
    ];
    const [round] = roberRounds(episodesOf(rows), entries);
    expect(round.startId).toBeNull();
    expect(names(round.rooms)).toEqual(['kitchen', 'dining_room']);
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
    const rounds = roberRounds(episodesOf(rows), [map('hallway', '2026-10-14T11:02:14')]);
    expect(rounds.map(round => names(round.rooms))).toEqual([['hallway']]);
  });

  it('gives no rounds without rows, and rounds without rooms from an empty index', () => {
    expect(roberRounds([], archive.maps)).toEqual([]);
    const rows = [row('2026-10-14T11:00:41.226', START), row('2026-10-14T11:49:05.180', FINISH)];
    expect(roberRounds(episodesOf(rows), []).map(round => round.rooms)).toEqual([[]]);
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
