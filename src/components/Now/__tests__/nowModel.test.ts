import { describe, expect, it } from 'vitest';
import { home } from '../../../energy/__tests__/testUtils';
import { houseEpisodes, parseHouseEvents, visibleHouseEvents, type HouseEventViewer } from '../../../home/houseEvents';
import feed from '../../../home/__tests__/fixtures/house-events-2026-10-13.json';
import { readUpcoming, type UpcomingEntity } from '../../../home/upcoming';
import { buildNowTimeline, episodeAreaId, rowTone } from '../nowModel';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };

const events = parseHouseEvents(feed.attributes.events);
const episodesFor = (viewer: HouseEventViewer) => houseEpisodes(visibleHouseEvents(events, viewer));

const entity = (state: string, attributes: Record<string, unknown> = {}): UpcomingEntity => ({ state, attributes });

describe('past rows from the live feed', () => {
  it('lists episodes oldest first and gives each the room a tap opens', () => {
    const { past } = buildNowTimeline(episodesFor(MIKKEL), []);
    expect(past[0].atMs).toBe(Date.parse('2026-10-10T11:46:22.486964+02:00'));
    expect(past.at(-1)?.atMs).toBe(Date.parse('2026-10-13T12:26:01.941170+02:00'));
    expect(past.every((row, i) => i === 0 || row.atMs >= past[i - 1].atMs)).toBe(true);

    const areaOf = (iso: string) => past.find(row => row.atMs === Date.parse(iso))?.areaId;
    expect(areaOf('2026-10-13T12:26:01.941170+02:00')).toBe('hallway');
    expect(areaOf('2026-10-13T10:55:30.468247+02:00')).toBe('guest_bathroom');
    expect(areaOf('2026-10-11T04:59:40.607696+02:00')).toBe('kitchen');
    expect(areaOf('2026-10-12T08:45:00.109202+02:00')).toBe('bedroom');
    expect(areaOf('2026-10-13T07:51:17.251896+02:00')).toBe('kitchen');
  });

  it('gives no room to rows several rooms share or none owns', () => {
    const { past } = buildNowTimeline(episodesFor(MIKKEL), []);
    const areaOf = (iso: string) => past.find(row => row.atMs === Date.parse(iso))?.areaId;
    expect(areaOf('2026-10-13T10:55:30.638596+02:00')).toBeNull();
    expect(areaOf('2026-10-11T21:18:14.045847+02:00')).toBeNull();
    expect(areaOf('2026-10-13T11:30:25.897469+02:00')).toBeNull();
  });

  it('marks rows only part of the household sees, and shows a housemate none of the admin ones', () => {
    const mine = buildNowTimeline(episodesFor(MIKKEL), []).past;
    expect(mine.filter(row => row.restricted)).toHaveLength(11);
    const hers = buildNowTimeline(episodesFor(KRISTINE), []).past;
    expect(hers.some(row => row.restricted)).toBe(false);
    expect(hers.some(row => row.episode.kind === 'wake')).toBe(false);
  });

  it('colours a row by what it is about', () => {
    expect(rowTone({ icon: 'mdi:bell-ring' })).toBe('gold');
    expect(rowTone({ icon: 'mdi:washing-machine' })).toBe('sky');
    expect(rowTone({ icon: 'mdi:door-open' })).toBe('rose');
    expect(rowTone({ icon: 'mdi:robot-vacuum' })).toBe('green');
    expect(rowTone({ icon: 'mdi:information-outline' })).toBe('slate');
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

  it('puts running and paused appliances on the line and a done row at a running one ETA', () => {
    const { running, plans } = buildNowTimeline([], upcoming);
    expect(running.map(row => [row.id, row.areaId])).toEqual([
      ['washer', 'guest_bathroom'],
      ['dryer', 'guest_bathroom'],
    ]);
    expect(running[0].atMs).toBe(Date.parse('2026-10-13T16:50:00Z'));
    expect(plans.map(row => row.id)).toEqual(['washer-done', 'wake', 'rober2']);
    expect(plans[0].atMs).toBe(home(2026, 10, 13, 20, 23));
    expect(plans[1].atMs).toBe(home(2026, 10, 14, 6, 45));
    expect(plans[2].atMs).toBeNull();
  });

  it('shows a housemate no wake row', () => {
    const theirs = readUpcoming(
      id => ({ 'input_boolean.wakeup_bedroom': entity('on'), 'input_datetime.wakeup_bedroom': entity('06:45:00') })[id],
      nowMs,
      KRISTINE
    );
    expect(buildNowTimeline([], theirs).plans).toEqual([]);
  });
});
