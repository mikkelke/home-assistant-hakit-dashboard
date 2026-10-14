import { describe, expect, it } from 'vitest';
import { home } from '../../energy/__tests__/testUtils';
import { nowFocusAt } from '../../utils/navigation';
import type { HouseEventViewer } from '../houseEvents';
import { parseHouseUpcoming } from '../houseUpcoming';
import { timelineMarkers } from '../markers';
import { nextUp } from '../nextUp';
import { readQuietHours } from '../quietHours';
import { readUpcoming, type UpcomingEntity } from '../upcoming';

const MIKKEL: HouseEventViewer = { isAdmin: true, name: 'Mikkel' };
const KRISTINE: HouseEventViewer = { isAdmin: false, name: 'Kristine' };
const CLAUDIA: HouseEventViewer = { isAdmin: false, name: 'Claudia' };

const QUIET = readQuietHours('22:00:00', '07:00:00');
const entity = (state: string, attributes: Record<string, unknown> = {}): UpcomingEntity => ({ state, attributes });

/** The house with nothing running, the wake alarm at `wake` (or off), and sun.sun's next times. */
function chip(
  nowMs: number,
  viewer: HouseEventViewer,
  sun: { rising: string; setting: string },
  wake: string | null,
  rows: unknown[] = []
) {
  const entities: Record<string, UpcomingEntity> = {
    'input_boolean.wakeup_bedroom': entity(wake ? 'on' : 'off'),
    'input_datetime.wakeup_bedroom': entity(wake ?? '08:45:00'),
  };
  return nextUp(
    readUpcoming(id => entities[id], nowMs, viewer),
    timelineMarkers(sun.rising, sun.setting, QUIET, nowMs),
    parseHouseUpcoming({ expires: new Date(nowMs + 15 * 60_000).toISOString(), rows }, nowMs),
    viewer
  );
}

/** sun.sun on 14.10.2026: sunset 18:13 today, sunrise 07:39 tomorrow. */
const AFTERNOON_SUN = { setting: '2026-10-14T16:13:29+00:00', rising: '2026-10-15T05:39:15+00:00' };
/** Seen from the small hours of 15.10: sunrise 07:39 and sunset 18:11. */
const NIGHT_SUN = { rising: '2026-10-15T05:39:15+00:00', setting: '2026-10-15T16:11:02+00:00' };

describe('the next chip offers the soonest item of any kind', () => {
  it('sunset before the alarm', () => {
    const next = chip(home(2026, 10, 14, 14, 0), MIKKEL, AFTERNOON_SUN, '08:45:00');
    expect(next).toEqual({
      itemId: 'sun:set',
      focus: null,
      atMs: Date.parse(AFTERNOON_SUN.setting),
      icon: 'mdi:weather-sunset-down',
      name: 'Sunset',
    });
  });

  it('the alarm before sunrise at night', () => {
    const nowMs = home(2026, 10, 15, 1, 0);
    const next = chip(nowMs, MIKKEL, NIGHT_SUN, '06:30:00');
    expect(next?.itemId).toBe('wake');
    expect(next?.atMs).toBe(home(2026, 10, 15, 6, 30));
    expect(next?.focus).toEqual(nowFocusAt('wake', home(2026, 10, 15, 6, 30)));
    expect(next?.icon).toBe('mdi:alarm');
  });

  it('skips quiet hours that are on now: the NOW line says them, they are no future item', () => {
    const nowMs = home(2026, 10, 14, 23, 0);
    expect(timelineMarkers(NIGHT_SUN.rising, NIGHT_SUN.setting, QUIET, nowMs).map(marker => marker.id)).not.toContain('quiet');
    const next = chip(nowMs, MIKKEL, NIGHT_SUN, null);
    expect(next?.itemId).toBe('sun:rise');
    expect(next?.atMs).toBe(Date.parse(NIGHT_SUN.rising));
  });

  it('offers the start of the next quiet hours by its icon and time', () => {
    const next = chip(home(2026, 10, 14, 20, 0), CLAUDIA, AFTERNOON_SUN, null);
    expect(next).toMatchObject({ itemId: 'quiet', atMs: home(2026, 10, 14, 22, 0), icon: 'mdi:volume-off', name: 'Quiet' });
  });

  it('gives Kristine her train before sunset, and nobody else her train', () => {
    const nowMs = home(2026, 10, 14, 7, 0);
    const train = {
      id: 'train:kristine',
      kind: 'train',
      at: new Date(home(2026, 10, 14, 7, 46)).toISOString(),
      icon: 'mdi:train',
      title: 'Train to Odense',
      detail: '07:46, 08:02',
      audience_users: ['Kristine'],
    };
    expect(chip(nowMs, KRISTINE, AFTERNOON_SUN, null, [train])).toEqual({
      itemId: 'train:kristine',
      focus: null,
      atMs: home(2026, 10, 14, 7, 46),
      icon: 'mdi:train',
      name: 'Train to Odense',
    });
    expect(chip(nowMs, MIKKEL, AFTERNOON_SUN, null, [train])?.itemId).toBe('sun:set');
    expect(chip(nowMs, CLAUDIA, AFTERNOON_SUN, null, [train])?.itemId).toBe('sun:set');
  });

  it('never offers an untimed row, a disabled alarm or a row whose lease ran out', () => {
    const nowMs = home(2026, 10, 14, 14, 0);
    const maint = { id: 'maint:washer:drum', kind: 'maint', title: 'Washer drum clean', audience: 'admin' };
    const rain = { id: 'rain:terrace', kind: 'rain', title: 'Rain forecast', at: new Date(nowMs + 3_600_000).toISOString() };
    expect(chip(nowMs, MIKKEL, AFTERNOON_SUN, null, [maint])?.itemId).toBe('sun:set');
    expect(chip(nowMs, MIKKEL, AFTERNOON_SUN, null, [rain])?.itemId).toBe('rain:terrace');
    const expired = nextUp([], [], parseHouseUpcoming({ expires: new Date(nowMs - 1).toISOString(), rows: [rain] }, nowMs), MIKKEL);
    expect(expired).toBeNull();
  });
});
