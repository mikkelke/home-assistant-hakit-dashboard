import { describe, expect, it } from 'vitest';
import { home } from '../../energy/__tests__/testUtils';
import { nowFocusAt } from '../../utils/navigation';
import type { HouseEventViewer } from '../houseEvents';
import { timelineMarkers } from '../markers';
import { nextUp } from '../nextUp';
import { resolveNowFocus } from '../nowResolve';
import { readQuietHours } from '../quietHours';
import {
  nextTimedItem,
  nextWakeMs,
  readUpcoming,
  upcomingCandidates,
  upcomingFocus,
  type UpcomingEntity,
  type UpcomingItem,
} from '../upcoming';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const CLAUDIA: HouseEventViewer = { isAdmin: false, name: 'Claudia' };
const RESOLVING: HouseEventViewer = { isAdmin: null, name: null };

const entity = (state: string, attributes: Record<string, unknown> = {}): UpcomingEntity => ({ state, attributes });
const reader = (entities: Record<string, UpcomingEntity>) => (id: string) => entities[id];
const summary = (items: UpcomingItem[]) => items.map(item => `${item.id}@${item.atMs == null ? '-' : new Date(item.atMs).toISOString()}`);

const WASHER_START = '2026-10-13T16:50:00Z';

const evening = {
  'sensor.washer_state': entity('Running', { estimated_end_time: '20:23', progress_pct: 62, cycle_start_time: WASHER_START }),
  'sensor.dishwasher_state': entity('Running', { estimated_end_time: '2026-10-13T19:34:00Z', cycle_start_time: '2026-10-13T17:30:00Z' }),
  'sensor.dryer_state': entity('Paused', { progress_pct: 30, cycle_start_time: '2026-10-13T16:00:00Z' }),
  'input_boolean.washer_announce': entity('on'),
  'input_boolean.dryer_announce': entity('unavailable'),
  'input_boolean.wakeup_bedroom': entity('on'),
  'input_datetime.wakeup_bedroom': entity('08:45:00', { has_date: false, has_time: true }),
  'vacuum.rober2': entity('docked'),
  'input_text.rober2_cleaning_narrative': entity('Waiting for an empty home'),
  'input_boolean.rober2_clean_kitchen_2': entity('on'),
  'input_boolean.rober2_clean_claudias_room': entity('on'),
  'input_boolean.rober2_clean_bedroom': entity('off'),
};
const EVENING_MS = home(2026, 10, 13, 19, 42);

describe('nextWakeMs across the 25.10.2026 change to winter time', () => {
  it('rings at 06:30 CET the morning after the change, 9.5 h after 22:00 CEST', () => {
    const before = home(2026, 10, 24, 22);
    expect(before).toBe(Date.parse('2026-10-24T20:00:00Z'));
    const wake = nextWakeMs('06:30:00', before);
    expect(wake).toBe(Date.parse('2026-10-25T05:30:00Z'));
    expect(wake! - before).toBe(9.5 * 3_600_000);
  });

  it('keeps 06:30 house time on both sides of the change', () => {
    expect(nextWakeMs('06:30', home(2026, 10, 24, 5))).toBe(Date.parse('2026-10-24T04:30:00Z'));
    expect(nextWakeMs('06:30', home(2026, 10, 25, 7))).toBe(Date.parse('2026-10-26T05:30:00Z'));
  });

  it('takes the first of a repeated time, and moves a skipped spring time forward', () => {
    expect(nextWakeMs('02:30', home(2026, 10, 24, 22))).toBe(Date.parse('2026-10-25T00:30:00Z'));
    expect(nextWakeMs('02:30', home(2027, 3, 27, 22))).toBe(Date.parse('2027-03-28T01:30:00Z'));
  });

  it('is strictly after now, and null for anything but a clock time', () => {
    expect(nextWakeMs('08:45:00', home(2026, 10, 13, 8, 45))).toBe(home(2026, 10, 14, 8, 45));
    for (const clock of [undefined, '', 'unknown', '25:00', '6.30', '08:60']) expect(nextWakeMs(clock, EVENING_MS)).toBeNull();
  });
});

describe('readUpcoming', () => {
  it("lists Mikkel's evening soonest first, untimed last", () => {
    const items = readUpcoming(reader(evening), EVENING_MS, MIKKEL);
    expect(summary(items)).toEqual([
      'washer@2026-10-13T18:23:00.000Z',
      'dish@2026-10-13T19:34:00.000Z',
      'wake@2026-10-14T06:45:00.000Z',
      'dryer@-',
      'rober2@-',
    ]);
    const [washer] = items;
    expect(washer.type === 'appliance' && washer.announce).toBe(true);
    const dryer = items[3];
    expect(dryer.type === 'appliance' && [dryer.cycle.status, dryer.cycle.progressPct, dryer.announce]).toEqual(['paused', 30, null]);
    const dish = items[1];
    expect(dish.type === 'appliance' && [dish.appliance.areaId, dish.announce]).toEqual(['kitchen', null]);
  });

  it('shows the wake alarm to Mikkel only, also while disabled', () => {
    expect(readUpcoming(reader(evening), EVENING_MS, CLAUDIA).some(item => item.type === 'wake')).toBe(false);
    expect(readUpcoming(reader(evening), EVENING_MS, RESOLVING).some(item => item.type === 'wake')).toBe(false);
    const off = readUpcoming(reader({ ...evening, 'input_boolean.wakeup_bedroom': entity('off') }), EVENING_MS, MIKKEL);
    expect(off.find(item => item.type === 'wake')).toMatchObject({ enabled: false, clock: '08:45', areaId: 'bedroom' });
  });

  it('leaves out finished and idle appliances and a missing alarm', () => {
    const quiet = reader({
      'sensor.washer_state': entity('Unemptied', { energy_used: 0.99 }),
      'sensor.dryer_state': entity('Off'),
      'input_datetime.wakeup_bedroom': entity('08:45:00'),
    });
    expect(readUpcoming(quiet, EVENING_MS, MIKKEL)).toEqual([]);
  });

  it('shows the Rober2 queue for display only', () => {
    const rober2 = readUpcoming(reader(evening), EVENING_MS, CLAUDIA).find(item => item.type === 'rober2');
    expect(rober2).toEqual({
      type: 'rober2',
      id: 'rober2',
      areaId: 'kitchen',
      rooms: ['Kitchen dining side', 'Claudias room'],
      vacuumState: 'docked',
      narrative: 'Waiting for an empty home',
      atMs: null,
    });
    expect(readUpcoming(reader({ 'vacuum.rober2': entity('docked') }), EVENING_MS, CLAUDIA)).toEqual([]);
    expect(readUpcoming(reader({ 'vacuum.rober2': entity('cleaning') }), EVENING_MS, CLAUDIA)).toMatchObject([{ id: 'rober2', rooms: [] }]);
  });
});

describe('next chip and live identity', () => {
  it('shows the soonest timed item, skipping a disabled alarm', () => {
    const items = readUpcoming(reader(evening), EVENING_MS, MIKKEL);
    expect(nextTimedItem(items)?.id).toBe('washer');
    const alarmOnly = readUpcoming(
      reader({ ...evening, 'sensor.washer_state': entity('Off'), 'sensor.dishwasher_state': entity('Off') }),
      EVENING_MS,
      MIKKEL
    );
    expect(nextTimedItem(alarmOnly)?.id).toBe('wake');
    const alarmOff = readUpcoming(
      reader({
        ...evening,
        'sensor.washer_state': entity('Off'),
        'sensor.dishwasher_state': entity('Off'),
        'input_boolean.wakeup_bedroom': entity('off'),
      }),
      EVENING_MS,
      MIKKEL
    );
    expect(nextTimedItem(alarmOff)).toBeNull();
  });

  it('keeps the sun and quiet hours out of the items, and the next chip offers whichever comes first', () => {
    const items = readUpcoming(
      reader({
        ...evening,
        'sensor.washer_state': entity('Off'),
        'sensor.dishwasher_state': entity('Off'),
        'sun.sun': entity('below_horizon', { next_rising: '2026-10-14T05:37:12+00:00', next_setting: '2026-10-14T16:13:29+00:00' }),
        'input_datetime.quiet_hours_start': entity('22:00:00'),
        'input_datetime.quiet_hours_end': entity('07:00:00'),
      }),
      EVENING_MS,
      MIKKEL
    );
    expect(items.map(item => item.id)).toEqual(['wake', 'dryer', 'rober2']);
    expect(nextTimedItem(items)?.id).toBe('wake');
    const markers = timelineMarkers(
      '2026-10-14T05:37:12+00:00',
      '2026-10-14T16:13:29+00:00',
      readQuietHours('22:00:00', '07:00:00'),
      EVENING_MS
    );
    expect(nextUp(items, markers, [], MIKKEL)).toMatchObject({ itemId: 'quiet', atMs: home(2026, 10, 13, 22, 0), icon: 'mdi:volume-off' });
  });

  it('focuses a running appliance by its cycle start, so a link for an older cycle does not', () => {
    const items = readUpcoming(reader(evening), EVENING_MS, MIKKEL);
    const candidates = upcomingCandidates(items);
    expect(candidates.map(c => c.id)).toEqual(['washer', 'dish', 'wake', 'dryer']);

    const washerFocus = upcomingFocus(items[0]);
    expect(washerFocus).toEqual(nowFocusAt('washer', Date.parse(WASHER_START)));
    expect(resolveNowFocus(washerFocus, candidates, true)).toEqual({ status: 'found', id: 'washer' });
    expect(resolveNowFocus(nowFocusAt('washer', Date.parse('2026-10-13T08:55:30Z')), candidates, true)).toEqual({ status: 'unavailable' });
    expect(resolveNowFocus(upcomingFocus(items[2]), candidates, true)).toEqual({ status: 'found', id: 'wake' });
    expect(upcomingFocus(items[4])).toBeNull();
  });
});
