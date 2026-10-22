import { describe, expect, it } from 'vitest';
import { home } from '../../../energy/__tests__/testUtils';
import { formatHomeClock } from '../../../energy/homeTime';
import { houseEpisodes, parseHouseEvents, visibleHouseEvents, type HouseEventViewer } from '../../../home/houseEvents';
import { parseHouseUpcoming } from '../../../home/houseUpcoming';
import feed from '../../../home/__tests__/fixtures/house-events.json';
import { isQuietAt, readQuietHours } from '../../../home/quietHours';
import { readUpcoming, type UpcomingAppliance, type UpcomingEntity } from '../../../home/upcoming';
import archive from '../../Vacuum/__tests__/fixtures/rober2-maps.json';
import { roberRounds } from '../../Vacuum/sessionRooms';
import {
  buildNowTimeline,
  dayBreaks,
  dayLabel,
  episodeAreaId,
  etaInQuietHours,
  rowTone,
  timelineMarkers,
  type PastRow,
  type RoomRow,
} from '../nowModel';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };

const events = parseHouseEvents(feed.attributes.events);
const episodesFor = (viewer: HouseEventViewer) => houseEpisodes(visibleHouseEvents(events, viewer));

const entity = (state: string, attributes: Record<string, unknown> = {}): UpcomingEntity => ({ state, attributes });

describe('past rows from the fixture feed', () => {
  it('lists episodes oldest first and gives each the room a tap opens', () => {
    const { past } = buildNowTimeline(episodesFor(MIKKEL), []);
    expect(past[0].atMs).toBe(Date.parse('2026-10-10T10:17:44.065312+02:00'));
    expect(past.at(-1)?.atMs).toBe(Date.parse('2026-10-13T14:51:12.742031+02:00'));
    expect(past.every((row, i) => i === 0 || row.atMs >= past[i - 1].atMs)).toBe(true);

    const areaOf = (iso: string) => past.find(row => row.atMs === Date.parse(iso))?.areaId;
    expect(areaOf('2026-10-13T14:51:12.742031+02:00')).toBe('hallway');
    expect(areaOf('2026-10-13T13:37:44.605454+02:00')).toBe('guest_bathroom');
    expect(areaOf('2026-10-11T06:14:22.538871+02:00')).toBe('kitchen');
    expect(areaOf('2026-10-12T09:20:00.143551+02:00')).toBe('bedroom');
    expect(areaOf('2026-10-13T10:06:52.493110+02:00')).toBe('kitchen');
  });

  it('gives no room to rows several rooms share or none owns', () => {
    const { past } = buildNowTimeline(episodesFor(MIKKEL), []);
    const areaOf = (iso: string) => past.find(row => row.atMs === Date.parse(iso))?.areaId;
    expect(areaOf('2026-10-13T13:37:44.775803+02:00')).toBeNull();
    expect(areaOf('2026-10-11T20:36:52.778620+02:00')).toBeNull();
    expect(areaOf('2026-10-13T14:20:08.330412+02:00')).toBeNull();
  });

  it('marks rows only part of the household sees, and shows a housemate none of the admin ones', () => {
    const mine = buildNowTimeline(episodesFor(MIKKEL), []).past.filter(row => row.type === 'past');
    expect(mine.filter(row => row.restricted)).toHaveLength(11);
    const hers = buildNowTimeline(episodesFor(KRISTINE), []).past.filter(row => row.type === 'past');
    expect(hers.some(row => row.restricted)).toBe(false);
    expect(hers.some(row => row.episode.kind === 'wake')).toBe(false);
  });

  it('colours a row by what it is about', () => {
    expect(rowTone({ icon: 'mdi:bell-ring' })).toBe('gold');
    expect(rowTone({ icon: 'mdi:washing-machine' })).toBe('sky');
    expect(rowTone({ icon: 'mdi:door-open' })).toBe('rose');
    expect(rowTone({ icon: 'mdi:robot-vacuum' })).toBe('green');
    expect(rowTone({ icon: 'mdi:information-outline' })).toBe('slate');
    expect(rowTone({ icon: 'mdi:watering-can' })).toBe('slate');
  });

  it('shows a plant watered as a plain row of its own, with no room to open', () => {
    const watered = parseHouseEvents([
      { ts: '2026-10-21T08:00:30+02:00', icon: 'mdi:watering-can', text: 'Watered Strelitzia', audience: 'admin' },
      { ts: '2026-10-21T08:00:00+02:00', icon: 'mdi:watering-can', text: 'Watered Fig', audience: 'admin' },
    ]);
    const { past } = buildNowTimeline(houseEpisodes(visibleHouseEvents(watered, MIKKEL)), []);
    expect(
      past.map(row => (row.type === 'past' ? [row.episode.kind, row.areaId, row.restricted, row.episode.rows[0].text] : null))
    ).toEqual([
      ['evt', null, true, 'Watered Fig'],
      ['evt', null, true, 'Watered Strelitzia'],
    ]);
    expect(buildNowTimeline(houseEpisodes(visibleHouseEvents(watered, KRISTINE)), []).past).toEqual([]);
  });

  it('owns a generic row only when all its rows point at one room', () => {
    const episode = (icons: string[]) => ({
      id: '1',
      kind: 'evt' as const,
      startMs: 0,
      endMs: 0,
      rows: icons.map(icon => ({ tsMs: 0, icon, text: icon })),
    });
    expect(episodeAreaId(episode(['mdi:lock-open-variant']))).toBe('hallway');
    expect(episodeAreaId(episode(['mdi:lock-open-variant', 'mdi:television']))).toBeNull();
  });
});

describe('the rooms of Rober2 rounds on the rail', () => {
  const at = (iso: string) => Date.parse(iso);
  const timelineFor = (viewer: HouseEventViewer) =>
    buildNowTimeline(episodesFor(viewer), [], [], [], roberRounds(episodesFor(viewer), archive.maps)).past;
  const describeRow = (row: PastRow | RoomRow) => [
    formatHomeClock(row.atMs),
    row.type === 'room' ? row.map.room : row.episode.rows[0].icon,
    row.round,
  ];
  const span = (past: (PastRow | RoomRow)[], fromIso: string, toIso: string) =>
    past.filter(row => row.atMs >= at(fromIso) && row.atMs <= at(toIso)).map(describeRow);

  it('sit between the start and finish rows of their round, each at the time it was done, on one line', () => {
    expect(span(timelineFor(KRISTINE), '2026-10-13T10:06:52.493+02:00', '2026-10-13T10:57:19.084+02:00')).toEqual([
      ['10:06', 'mdi:robot-vacuum', 'first'],
      ['10:11', 'hallway', 'inner'],
      ['10:18', 'kitchen', 'inner'],
      ['10:27', 'kitchen_2', 'inner'],
      ['10:43', 'living_room', 'inner'],
      ['10:57', 'dining_room', 'inner'],
      ['10:57', 'mdi:robot-vacuum', 'last'],
    ]);
  });

  it('step through their own round from the map sheet, and open the room they lie in', () => {
    const past = timelineFor(KRISTINE);
    const kitchen = past.find(row => row.id === 'rober2:rober2_map_20261013_102731_kitchen_2.png');
    expect(kitchen?.type).toBe('room');
    if (kitchen?.type !== 'room') return;
    expect(kitchen.maps.map(map => map.room)).toEqual(['hallway', 'kitchen', 'kitchen_2', 'living_room', 'dining_room']);
    expect([kitchen.index, kitchen.areaId]).toEqual([2, 'kitchen']);
  });

  it("put other rows that fell in a round on the round's line", () => {
    expect(span(timelineFor(MIKKEL), '2026-10-12T12:49:27.035+02:00', '2026-10-12T14:38:02.716+02:00')).toEqual([
      ['12:49', 'mdi:robot-vacuum', 'first'],
      ['12:54', 'hallway', 'inner'],
      ['13:01', 'mdi:speaker-multiple', 'inner'],
      ['13:06', 'kitchen', 'inner'],
      ['13:17', 'kitchen_2', 'inner'],
      ['13:33', 'living_room', 'inner'],
      ['14:05', 'mdi:speaker-multiple', 'inner'],
      ['14:38', 'dining_room', 'inner'],
      ['14:38', 'mdi:robot-vacuum', 'last'],
    ]);
  });

  it('end the line of a round without an end row at its last room, and leave other rows off any line', () => {
    const past = timelineFor(MIKKEL);
    expect(span(past, '2026-10-14T00:00:00+02:00', '2026-10-15T00:00:00+02:00')).toEqual([
      ['11:02', 'hallway', 'first'],
      ['11:09', 'kitchen', 'inner'],
      ['11:18', 'kitchen_2', 'inner'],
      ['11:34', 'living_room', 'inner'],
      ['11:49', 'dining_room', 'last'],
    ]);
    expect(past.filter(row => row.type === 'past' && row.episode.kind === 'ring').every(row => row.round == null)).toBe(true);
  });

  it('draw no line for a round of one row', () => {
    const finish = {
      ts: '2026-10-14T11:49:05.180+02:00',
      icon: 'mdi:robot-vacuum',
      text: 'x',
      cause: 'All queued rooms cleaned',
      effect: 'Vacuum finished its round - heading to the dock',
    };
    const episodes = houseEpisodes(parseHouseEvents([finish]));
    expect(buildNowTimeline(episodes, [], [], [], roberRounds(episodes, [])).past.map(describeRow)).toEqual([
      ['11:49', 'mdi:robot-vacuum', null],
    ]);
  });
});

describe('the NOW line and what comes after it', () => {
  const nowMs = home(2026, 10, 13, 19, 42);
  const upcoming = readUpcoming(
    id =>
      ({
        'sensor.washer_state': entity('Running', {
          estimated_end_time: '20:23',
          progress_pct: 62,
          cycle_start_time: '2026-10-13T16:50:00Z',
        }),
        'sensor.dryer_state': entity('Paused', { progress_pct: 30, cycle_start_time: '2026-10-13T16:00:00Z' }),
        'input_boolean.wakeup_bedroom': entity('off'),
        'input_datetime.wakeup_bedroom': entity('06:45:00'),
        'vacuum.rober2': entity('docked'),
        'input_boolean.rober2_clean_kitchen': entity('on'),
      })[id],
    nowMs,
    MIKKEL
  );

  it('puts running and paused appliances on the line, and no separate done row for them', () => {
    const { running, future } = buildNowTimeline([], upcoming);
    expect(running.map(row => [row.id, row.areaId])).toEqual([
      ['dryer', 'guest_bathroom'],
      ['washer', 'guest_bathroom'],
    ]);
    expect(running[1].atMs).toBe(Date.parse('2026-10-13T16:50:00Z'));
    expect(running[1].item.atMs).toBe(home(2026, 10, 13, 20, 23));
    expect(future.map(row => row.id)).toEqual(['wake', 'rober2']);
    expect(future[0].atMs).toBe(home(2026, 10, 14, 6, 45));
    expect(future[1].atMs).toBeNull();
  });

  it('orders running appliances on the rail by when they started', () => {
    const items = readUpcoming(
      id =>
        ({
          'sensor.washer_state': entity('Running', { estimated_end_time: '22:00', cycle_start_time: '2026-10-13T14:41:00Z' }),
          'sensor.dishwasher_state': entity('Running', {
            estimated_end_time: '2026-10-13T16:36:00Z',
            cycle_start_time: '2026-10-13T15:38:00Z',
          }),
        })[id],
      home(2026, 10, 13, 18, 19),
      MIKKEL
    );
    expect(items.map(item => item.id)).toEqual(['dish', 'washer']);
    expect(buildNowTimeline([], items).running.map(row => row.id)).toEqual(['washer', 'dish']);
  });

  it('shows a housemate no wake row', () => {
    const theirs = readUpcoming(
      id => ({ 'input_boolean.wakeup_bedroom': entity('on'), 'input_datetime.wakeup_bedroom': entity('06:45:00') })[id],
      nowMs,
      KRISTINE
    );
    expect(buildNowTimeline([], theirs).future).toEqual([]);
  });
});

describe('day labels on the house calendar', () => {
  it('names today, yesterday and older days', () => {
    const nowMs = home(2026, 10, 13, 18, 30);
    expect(dayLabel(home(2026, 10, 13, 7, 51), nowMs)).toBe('Today');
    expect(dayLabel(home(2026, 10, 12, 23, 59), nowMs)).toBe('Yesterday');
    expect(dayLabel(home(2026, 10, 11, 13, 37), nowMs)).toBe('Sunday 11.10');
  });

  it('names tomorrow', () => {
    expect(dayLabel(home(2026, 10, 14, 8, 45), home(2026, 10, 13, 18, 30))).toBe('Tomorrow');
    expect(dayLabel(home(2026, 10, 26, 6, 30), home(2026, 10, 25, 23, 30))).toBe('Tomorrow');
  });

  it('breaks the rows where the day changes, from today on', () => {
    const nowMs = home(2026, 10, 13, 18, 30);
    expect(
      dayBreaks([home(2026, 10, 11, 13, 37), home(2026, 10, 11, 18, 11), home(2026, 10, 12, 8, 45), home(2026, 10, 13, 7, 51)], nowMs)
    ).toEqual(['Sunday 11.10', null, 'Yesterday', 'Today']);
    expect(dayBreaks([home(2026, 10, 13, 9, 0), home(2026, 10, 13, 10, 0)], nowMs)).toEqual([null, null]);
    expect(dayBreaks([home(2026, 10, 13, 19, 41), home(2026, 10, 14, 8, 45), null], nowMs)).toEqual([null, 'Tomorrow', null]);
  });

  it('finds yesterday by the calendar the night after the spring change', () => {
    const nowMs = home(2027, 3, 29, 0, 30);
    expect(dayLabel(home(2027, 3, 28, 12, 0), nowMs)).toBe('Yesterday');
    expect(dayLabel(home(2027, 3, 27, 12, 0), nowMs)).toBe('Saturday 27.03');
  });
});

const QUIET = readQuietHours('22:00:00', '07:00:00');
/** `sun.sun` on the evening of 13.10.2026: the next sunrise and sunset are both tomorrow. */
const RISING = '2026-10-14T05:37:12.410000+00:00';
const SETTING = '2026-10-14T16:13:29.927374+00:00';

describe('house_upcoming rows after the NOW line', () => {
  const nowMs = home(2026, 10, 13, 21, 0);
  const plans = readUpcoming(
    id =>
      ({
        'input_boolean.wakeup_bedroom': entity('on'),
        'input_datetime.wakeup_bedroom': entity('06:45:00'),
        'vacuum.rober2': entity('docked'),
        'input_boolean.rober2_clean_kitchen': entity('on'),
      })[id],
    nowMs,
    MIKKEL
  );
  const publish = (rows: Record<string, string>[]) =>
    parseHouseUpcoming({ expires: new Date(nowMs + 15 * 60_000).toISOString(), rows }, nowMs);
  const upRows = publish([
    { id: 'rain:terrace', kind: 'rain', title: 'Rain forecast', at: new Date(home(2026, 10, 13, 21, 30)).toISOString() },
    { id: 'maint:washer:drum', kind: 'maint', title: 'Washer drum clean', audience: 'admin' },
  ]);

  it('sorts timed rows in among the markers and plans, and an untimed row, which is due now, before them all', () => {
    const { future } = buildNowTimeline([], plans, timelineMarkers(RISING, SETTING, QUIET, nowMs), upRows);
    expect(future.map(row => [row.type, row.id, row.atMs == null ? null : formatHomeClock(row.atMs)])).toEqual([
      ['up', 'maint:washer:drum', null],
      ['up', 'rain:terrace', '21:30'],
      ['marker', 'quiet', '22:00'],
      ['plan', 'wake', '06:45'],
      ['marker', 'sun:rise', '07:37'],
      ['marker', 'sun:set', '18:13'],
      ['plan', 'rober2', null],
    ]);
    expect(future[1]).toEqual({ type: 'up', id: 'rain:terrace', row: upRows[0], atMs: home(2026, 10, 13, 21, 30) });
  });

  it('keeps the rows that are due in the order they were published, and an untimed row the next chip skips last', () => {
    const rows = publish([
      { id: 'maint:dryer:plinth', kind: 'maint', title: 'Dryer plinth filter', audience: 'admin', next: 'skip' },
      { id: 'maint:plant:first', kind: 'maint', title: 'Water the first plant', audience: 'admin' },
      { id: 'maint:filter', kind: 'maint', title: 'A filter', audience: 'admin', at: new Date(home(2027, 1, 5, 9, 0)).toISOString() },
      { id: 'maint:plant:second', kind: 'maint', title: 'Water the second plant', audience: 'admin' },
    ]);
    const { future } = buildNowTimeline([], plans, [], rows);
    expect(future.map(row => row.id)).toEqual([
      'maint:plant:first',
      'maint:plant:second',
      'wake',
      'maint:filter',
      'rober2',
      'maint:dryer:plinth',
    ]);
  });
});

describe('markers after the NOW line', () => {
  const nowMs = home(2026, 10, 13, 19, 42);
  const plans = readUpcoming(
    id =>
      ({
        'input_boolean.wakeup_bedroom': entity('on'),
        'input_datetime.wakeup_bedroom': entity('06:45:00'),
        'vacuum.rober2': entity('docked'),
        'input_boolean.rober2_clean_kitchen': entity('on'),
      })[id],
    nowMs,
    MIKKEL
  );

  it('sorts the sun and quiet hours in among the plans, soonest first, untimed last', () => {
    const { future } = buildNowTimeline([], plans, timelineMarkers(RISING, SETTING, QUIET, nowMs));
    expect(future.map(row => [row.id, row.atMs == null ? null : formatHomeClock(row.atMs)])).toEqual([
      ['quiet', '22:00'],
      ['wake', '06:45'],
      ['sun:rise', '07:37'],
      ['sun:set', '18:13'],
      ['rober2', null],
    ]);
    expect(future[0]).toEqual({ type: 'marker', id: 'quiet', atMs: home(2026, 10, 13, 22, 0), until: '07:00' });
    expect(future[2]).toEqual({ type: 'marker', id: 'sun:rise', atMs: Date.parse(RISING), until: null });
  });

  it('gives the markers the day labels the other rows get', () => {
    const { future } = buildNowTimeline([], plans, timelineMarkers(RISING, SETTING, QUIET, nowMs));
    expect(
      dayBreaks(
        future.map(row => row.atMs),
        nowMs
      )
    ).toEqual([null, 'Tomorrow', null, null, null]);
    const morning = home(2026, 10, 14, 8, 0);
    const later = timelineMarkers('2026-10-15T05:39:15.581237+00:00', SETTING, QUIET, morning);
    expect(later.map(row => [row.id, dayBreaks([row.atMs], morning)[0]])).toEqual([
      ['sun:rise', 'Tomorrow'],
      ['sun:set', null],
      ['quiet', null],
    ]);
  });

  it('leaves out a sun time that is not ahead of now, or not a time', () => {
    expect(timelineMarkers('2026-10-13T05:35:00+00:00', '2026-10-13T16:15:00+00:00', QUIET, nowMs).map(row => row.id)).toEqual(['quiet']);
    expect(timelineMarkers(undefined, 'unavailable', QUIET, nowMs).map(row => row.id)).toEqual(['quiet']);
    expect(timelineMarkers(Date.parse(RISING), null, QUIET, nowMs).map(row => row.id)).toEqual(['quiet']);
    expect(timelineMarkers(new Date(nowMs).toISOString(), SETTING, QUIET, nowMs).map(row => row.id)).toEqual(['sun:set', 'quiet']);
  });

  it('marks the next quiet hours before they start, and none while they are on', () => {
    const cases: [string, number, number | null][] = [
      ['21:59', home(2026, 10, 13, 21, 59), home(2026, 10, 13, 22, 0)],
      ['22:00', home(2026, 10, 13, 22, 0), null],
      ['23:00', home(2026, 10, 13, 23, 0), null],
      ['00:30', home(2026, 10, 14, 0, 30), null],
      ['06:59', home(2026, 10, 14, 6, 59), null],
      ['07:00', home(2026, 10, 14, 7, 0), home(2026, 10, 14, 22, 0)],
    ];
    for (const [clock, atMs, markerAt] of cases) {
      const marker = timelineMarkers(undefined, undefined, QUIET, atMs).find(row => row.id === 'quiet');
      expect([clock, marker?.atMs ?? null, marker?.until ?? null, isQuietAt(QUIET, atMs)]).toEqual([
        clock,
        markerAt,
        markerAt == null ? null : '07:00',
        markerAt == null,
      ]);
    }
  });

  it("uses SonosNotifier's 22:00-07:00 while the helpers are unavailable", () => {
    const fallback = readQuietHours('unavailable', 'unknown');
    expect(timelineMarkers(undefined, undefined, fallback, home(2026, 10, 13, 21, 0))).toEqual([
      { type: 'marker', id: 'quiet', atMs: home(2026, 10, 13, 22, 0), until: '07:00' },
    ]);
    expect(timelineMarkers(undefined, undefined, fallback, home(2026, 10, 13, 23, 0))).toEqual([]);
  });
});

describe('markers across the 25.10.2026 change to winter time', () => {
  it('starts quiet hours at 22:00 house time on both sides of the change', () => {
    const before = timelineMarkers(undefined, undefined, QUIET, Date.parse('2026-10-24T19:00:00Z'));
    expect(before).toEqual([{ type: 'marker', id: 'quiet', atMs: Date.parse('2026-10-24T20:00:00Z'), until: '07:00' }]);
    expect(timelineMarkers(undefined, undefined, QUIET, Date.parse('2026-10-25T01:30:00Z'))).toEqual([]);
    expect(timelineMarkers(undefined, undefined, QUIET, Date.parse('2026-10-25T05:59:00Z'))).toEqual([]);
    const after = timelineMarkers(undefined, undefined, QUIET, Date.parse('2026-10-25T06:00:00Z'));
    expect(after).toEqual([{ type: 'marker', id: 'quiet', atMs: Date.parse('2026-10-25T21:00:00Z'), until: '07:00' }]);
    expect(formatHomeClock(after[0].atMs)).toBe('22:00');
  });

  it('labels the sunrise after the change night by the house calendar', () => {
    const lateMs = home(2026, 10, 25, 23, 30);
    const [rise] = timelineMarkers('2026-10-26T06:18:00+00:00', undefined, QUIET, lateMs);
    expect([rise.id, formatHomeClock(rise.atMs), dayBreaks([rise.atMs], lateMs)[0]]).toEqual(['sun:rise', '07:18', 'Tomorrow']);
  });
});

describe('the finish announcement on a running card', () => {
  const washerAt = (nowMs: number, sensor: UpcomingEntity) =>
    readUpcoming(
      id => ({ 'sensor.washer_state': sensor, 'input_boolean.washer_announce': entity('on') })[id],
      nowMs,
      MIKKEL
    )[0] as UpcomingAppliance;
  const running = (eta?: string) =>
    entity('Running', { progress_pct: 40, cycle_start_time: '2026-10-13T18:00:00Z', ...(eta ? { estimated_end_time: eta } : {}) });

  it('says the ETA falls in quiet hours only for a known ETA still ahead', () => {
    const inWindow = washerAt(home(2026, 10, 13, 21, 30), running('22:30'));
    expect([inWindow.announce, etaInQuietHours(inWindow.cycle, QUIET)]).toEqual([true, true]);
    const outside = washerAt(home(2026, 10, 13, 21, 30), running('21:50'));
    expect([outside.announce, etaInQuietHours(outside.cycle, QUIET)]).toEqual([true, false]);
    const overdue = washerAt(home(2026, 10, 13, 22, 20), running('22:10'));
    expect([overdue.cycle.overrun, etaInQuietHours(overdue.cycle, QUIET)]).toEqual([true, false]);
    const paused = washerAt(home(2026, 10, 13, 22, 20), entity('Paused', { progress_pct: 40, cycle_start_time: '2026-10-13T18:00:00Z' }));
    expect([paused.cycle.status, etaInQuietHours(paused.cycle, QUIET)]).toEqual(['paused', false]);
    const missing = washerAt(home(2026, 10, 13, 22, 20), running());
    expect([missing.cycle.etaMs, etaInQuietHours(missing.cycle, QUIET)]).toEqual([null, false]);
  });

  it('judges an ETA after the change to winter time on the house clock', () => {
    const night = washerAt(Date.parse('2026-10-25T04:00:00Z'), running('06:30'));
    expect([night.cycle.etaMs, etaInQuietHours(night.cycle, QUIET)]).toEqual([Date.parse('2026-10-25T05:30:00Z'), true]);
    const morning = washerAt(Date.parse('2026-10-25T05:30:00Z'), running('07:15'));
    expect(etaInQuietHours(morning.cycle, QUIET)).toBe(false);
  });
});
