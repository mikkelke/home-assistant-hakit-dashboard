import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callSegments, localDay, type CallPoint } from '../../../utils/heatCalls';
import { lastSignalText, readLastSignal } from '../../../utils/heating';
import type { TempPoint } from '../../../utils/temperatureHistory';
import {
  MAX_DAYS_BACK,
  ZONE_AIR,
  ZONE_FLOORS,
  callingAt,
  clearZoneDayCache,
  dayLabel,
  daySummary,
  daysBefore,
  fetchZoneDay,
  highest,
  holdUntil,
  linePath,
  loadZoneDay,
  mergeSeries,
  shiftDay,
  stepPath,
  temperatureTicks,
  valueAt,
  weightedMean,
  zoneDayEntities,
  zoneDayView,
} from '../zoneDay';

/** A moment of 5 November 2026 on the device's clock. */
const at = (hour: number, minute = 0, date = 5) => new Date(2026, 10, date, hour, minute).getTime();
const unix = (hour: number, minute = 0, date = 5) => at(hour, minute, date) / 1000;
const today = localDay(at(11, 35));

describe('the last signal sentence', () => {
  const signal = (raw: Record<string, unknown>) => {
    const read = readLastSignal(raw, new Date(2026, 10, 5, 23, 0));
    return read ? lastSignalText(read) : null;
  };
  const when = new Date(2026, 10, 5, 6, 42).toISOString();

  it('says who turned it up or down, where, and when', () => {
    expect(signal({ who: 'Mikkel', source: 'ha', direction: 'warmer', at: when, effect: 'target_set' })).toBe(
      'Mikkel turned it up in the app at 06:42'
    );
    expect(signal({ who: 'Kristine', source: 'keypad', direction: 'colder', at: new Date(2026, 10, 5, 21, 15).toISOString() })).toBe(
      'Kristine turned it down on the thermostat at 21:15'
    );
  });

  it('names the day when it was not today', () => {
    expect(signal({ who: 'Mikkel', source: 'ha', direction: 'colder', at: new Date(2026, 10, 3, 12, 32).toISOString() })).toBe(
      'Mikkel turned it down in the app on Tue at 12:32'
    );
    expect(signal({ who: 'Mikkel', source: 'ha', direction: 'colder', at: new Date(2026, 9, 20, 12, 32).toISOString() })).toBe(
      'Mikkel turned it down in the app on 20 Oct at 12:32'
    );
  });

  it('capitalises who', () => {
    expect(signal({ who: 'claudia', source: 'ha', direction: 'warmer', at: when })).toBe('Claudia turned it up in the app at 06:42');
  });

  it('reads a button press as the app, and names no place for any other source', () => {
    expect(signal({ who: 'Mikkel', source: 'button', direction: 'warmer', at: when })).toBe('Mikkel turned it up in the app at 06:42');
    expect(signal({ who: 'automation', source: 'automation', direction: 'colder', at: when })).toBe('Automation turned it down at 06:42');
    expect(signal({ who: 'bedroom_comfort', source: 'app', at: when })).toBe('Bedroom comfort changed it at 06:42');
  });

  it('leaves out a direction, a place or a time the controller did not give', () => {
    expect(signal({ who: 'Mikkel', source: 'ha', at: when })).toBe('Mikkel changed it in the app at 06:42');
    expect(signal({ who: 'Mikkel', direction: 'warmer', at: when })).toBe('Mikkel turned it up at 06:42');
    expect(signal({ who: 'Mikkel', source: 'ha', direction: 'warmer' })).toBe('Mikkel turned it up in the app');
    expect(signal({ who: 'Mikkel', source: 'ha', direction: 'warmer', at: 'garbage' })).toBe('Mikkel turned it up in the app');
    expect(signal({ who: 'Mikkel' })).toBe('Mikkel changed it');
  });

  it('never says unknown, and never shows an effect code', () => {
    expect(signal({ who: 'unknown', source: 'keypad', direction: 'colder', at: when })).toBe(
      'Someone turned it down on the thermostat at 06:42'
    );
    expect(signal({ who: 'Unknown', at: when })).toBe('Someone changed it at 06:42');
    expect(signal({ source: 'keypad', at: when })).toBe('Someone changed it on the thermostat at 06:42');
    const text = signal({ who: 'Mikkel', source: 'ha', direction: 'warmer', at: when, effect: 'nudge_limit' });
    expect(text).not.toMatch(/nudge|limit|_/);
  });

  it('is nothing for a signal that is not an object', () => {
    expect(readLastSignal(undefined)).toBeNull();
    expect(readLastSignal('Mikkel')).toBeNull();
    expect(readLastSignal(['Mikkel'])).toBeNull();
  });

  it('keeps the person and the direction for the chip', () => {
    expect(readLastSignal({ who: 'mikkel', source: 'ha', direction: 'warmer', at: when }, new Date(2026, 10, 7, 9, 0))).toEqual({
      who: 'Mikkel',
      direction: 'warmer',
      source: 'ha',
      clock: '06:42',
      day: 'Thu',
    });
    expect(readLastSignal({ who: 'unknown', direction: 'sideways' })).toEqual({
      who: null,
      direction: null,
      source: null,
      clock: null,
      day: null,
    });
  });
});

describe('the day browser', () => {
  it('labels today, yesterday and older days with the weekday and date', () => {
    expect(dayLabel(today, today)).toBe('Today');
    expect(dayLabel(shiftDay(today, -1), today)).toBe('Yesterday');
    expect(dayLabel(shiftDay(today, -2), today)).toBe('Tue 3 Nov');
    expect(dayLabel(shiftDay(today, -4), today)).toBe('Sun 1 Nov');
    expect(dayLabel(shiftDay(today, -5), today)).toBe('Sat 31 Oct');
    expect(dayLabel(shiftDay(today, -MAX_DAYS_BACK), today)).toBe('Tue 6 Oct');
  });

  it('never calls a day after today anything but today', () => {
    expect(dayLabel(shiftDay(today, 1), today)).toBe('Today');
  });

  it('moves a whole calendar day, midnight to midnight, whatever the clocks did', () => {
    const before = shiftDay(today, -1);
    expect(before).toEqual({ startMs: at(0, 0, 4), endMs: at(0, 0, 5) });
    expect(shiftDay(before, 1)).toEqual(today);
    const clocksBack = shiftDay(today, -4);
    expect((clocksBack.endMs - clocksBack.startMs) / 3_600_000).toBe(25);
    expect(shiftDay(clocksBack, 1)).toEqual(shiftDay(today, -3));
  });

  it('counts the days between two, across a change of the clocks', () => {
    expect(daysBefore(today, today)).toBe(0);
    expect(daysBefore(shiftDay(today, -1), today)).toBe(1);
    expect(daysBefore(shiftDay(today, -5), today)).toBe(5);
    expect(daysBefore(shiftDay(today, -MAX_DAYS_BACK), today)).toBe(MAX_DAYS_BACK);
  });
});

describe('mergeSeries', () => {
  const series = (...points: [number, number][]): TempPoint[] => points.map(([ts, value]) => ({ ts, value }));

  it('weighs the family rooms like the controller, each holding its value until it changes', () => {
    const living = series([1, 22], [3, 23]);
    const dining = series([2, 21]);
    const kitchen = series([4, 20]);
    const merged = mergeSeries(
      [
        { points: living, weight: ZONE_AIR.family[0].weight },
        { points: dining, weight: ZONE_AIR.family[1].weight },
        { points: kitchen, weight: ZONE_AIR.family[2].weight },
      ],
      weightedMean
    );
    expect(merged.map(point => point.ts)).toEqual([1, 2, 3, 4]);
    expect(merged[0].value).toBe(22);
    expect(merged[1].value).toBeCloseTo((22 * 19 + 21 * 18.5) / 37.5, 9);
    expect(merged[2].value).toBeCloseTo((23 * 19 + 21 * 18.5) / 37.5, 9);
    expect(merged[3].value).toBeCloseTo((23 * 19 + 21 * 18.5 + 20 * 18.5) / 56, 9);
  });

  it('uses the family weights the controller is configured with', () => {
    expect(ZONE_AIR.family).toEqual([
      { entityId: 'sensor.living_room_feel', weight: 19 },
      { entityId: 'sensor.dining_room_feel', weight: 18.5 },
      { entityId: 'sensor.kitchen_feel', weight: 18.5 },
    ]);
  });

  it('lets the sensors that read carry the value until the others start', () => {
    const merged = mergeSeries(
      [
        { points: series([10, 21]), weight: 19 },
        { points: series([20, 25]), weight: 1 },
      ],
      weightedMean
    );
    expect(merged).toEqual([
      { ts: 10, value: 21 },
      { ts: 20, value: (21 * 19 + 25) / 20 },
    ]);
  });

  it('takes the warmest floor at every moment', () => {
    const merged = mergeSeries(
      [
        { points: series([1, 23], [5, 25]), weight: 1 },
        { points: series([2, 24], [6, 22]), weight: 1 },
      ],
      highest
    );
    expect(merged).toEqual([
      { ts: 1, value: 23 },
      { ts: 2, value: 24 },
      { ts: 5, value: 25 },
    ]);
  });

  it('drops points that repeat the value, merges equal times, and is empty without readings', () => {
    expect(mergeSeries([{ points: series([1, 21], [2, 21], [3, 22], [4, 22]), weight: 1 }], weightedMean)).toEqual([
      { ts: 1, value: 21 },
      { ts: 3, value: 22 },
    ]);
    expect(
      mergeSeries(
        [
          { points: series([1, 20]), weight: 1 },
          { points: series([1, 22]), weight: 1 },
        ],
        weightedMean
      )
    ).toEqual([{ ts: 1, value: 21 }]);
    expect(mergeSeries([], weightedMean)).toEqual([]);
    expect(mergeSeries([{ points: [], weight: 1 }], weightedMean)).toEqual([]);
  });
});

describe('held series', () => {
  const points: TempPoint[] = [
    { ts: 10, value: 21 },
    { ts: 20, value: 22 },
  ];

  it('carries a series on to the end at its last value, and leaves one that already reaches it', () => {
    expect(holdUntil(points, 30)).toEqual([...points, { ts: 30, value: 22 }]);
    expect(holdUntil(points, 20)).toEqual(points);
    expect(holdUntil(points, 15)).toEqual(points);
    expect(holdUntil([], 30)).toEqual([]);
  });

  it('reads the value at a moment: the latest point at or before it', () => {
    expect(valueAt(points, 9)).toBeNull();
    expect(valueAt(points, 10)).toBe(21);
    expect(valueAt(points, 19.9)).toBe(21);
    expect(valueAt(points, 20)).toBe(22);
    expect(valueAt(points, 1e9)).toBe(22);
    expect(valueAt([], 10)).toBeNull();
  });

  it('knows whether a call covers a moment', () => {
    const segments = [{ startMs: 10, endMs: 20 }];
    expect([9, 10, 19, 20].map(ts => callingAt(segments, ts))).toEqual([false, true, true, false]);
  });
});

describe('daySummary', () => {
  const day = shiftDay(today, -1);
  const call = (hourOn: number, minuteOn: number, hourOff: number, minuteOff: number) => [
    { ts: at(hourOn, minuteOn, 4), on: true },
    { ts: at(hourOff, minuteOff, 4), on: false },
  ];
  const air: TempPoint[] = [
    { ts: at(0, 0, 4), value: 21.4 },
    { ts: at(8, 0, 4), value: 22.9 },
    { ts: at(20, 0, 4), value: 21.1 },
  ];

  it('sums the hours called, the heat they estimate and the range of the air', () => {
    const segments = callSegments([{ ts: at(0, 0, 4), on: false }, ...call(6, 0, 7, 30), ...call(9, 0, 9, 20)], day.startMs, day.endMs);
    const summary = daySummary('family', segments, air);
    expect(summary.hours).toBeCloseTo(1.5 + 20 / 60, 9);
    expect(summary.kwh).toBeCloseTo((1.5 + 20 / 60) * 1.11, 9);
    expect(summary.airMinC).toBe(21.1);
    expect(summary.airMaxC).toBe(22.9);
  });

  it('has no heat estimate for the guest bathroom, which the meter cannot see', () => {
    const segments = callSegments(call(6, 0, 7, 0), day.startMs, day.endMs);
    expect(daySummary('guest_bathroom', segments, air)).toMatchObject({ hours: 1, kwh: null });
  });

  it('has no hours without a call history, and no range without air', () => {
    expect(daySummary('family', null, [])).toEqual({ hours: null, kwh: null, airMinC: null, airMaxC: null });
    expect(daySummary('family', [], air)).toMatchObject({ hours: 0, kwh: 0 });
  });
});

describe('the chart geometry', () => {
  it('gives low, middle and high gridlines in whole degrees with room around the lines', () => {
    expect(temperatureTicks(21.1, 23.4)).toEqual([20, 22, 24]);
    expect(temperatureTicks(21, 21)).toEqual([19, 21, 23]);
    expect(temperatureTicks(20.2, 22.6)).toEqual([19, 22, 25]);
    const [low, mid, high] = temperatureTicks(18.4, 26.9);
    expect(low).toBeLessThan(18.4);
    expect(high).toBeGreaterThan(26.9);
    expect(mid - low).toBe(high - mid);
  });

  it('draws a line through the points, and a step line that holds each level up to the next change', () => {
    const points = [
      { x: 10, y: 50 },
      { x: 40, y: 30 },
      { x: 70, y: 40 },
    ];
    expect(linePath(points)).toBe('M10.0 50.0 L40.0 30.0 L70.0 40.0');
    expect(stepPath(points, 100)).toBe('M10.0 50.0 H40.0 V30.0 H70.0 V40.0 H100.0');
    expect(linePath([])).toBe('');
    expect(stepPath([], 100)).toBe('');
  });
});

/** What the websocket sends for `history/history_during_period` with `minimal_response`. */
const row = (state: string, lu: number) => ({ s: state, lu });

const familyHistory = () => ({
  'binary_sensor.family_room_heating_active': [row('off', unix(0, 0, 4)), row('on', unix(6, 0, 4)), row('off', unix(7, 30, 4))],
  'sensor.heating_zone_family': [row('21.5', unix(0, 0, 4)), row('21.5', unix(3, 0, 4)), row('22.0', unix(15, 0, 4))],
  'sensor.living_room_feel': [row('22.0', unix(0, 0, 4)), row('23.0', unix(12, 0, 4))],
  'sensor.dining_room_feel': [row('21.0', unix(0, 0, 4))],
  'sensor.kitchen_feel': [row('unavailable', unix(0, 0, 4)), row('20.0', unix(18, 0, 4))],
  'sensor.living_room_floor_thermometer_temperature': [row('23.0', unix(0, 0, 4)), row('24.5', unix(7, 0, 4))],
  'sensor.dining_room_floor_thermometer_temperature': [row('23.5', unix(0, 0, 4))],
});

const connectionOf = (answer: (request: Record<string, unknown>) => Promise<unknown>) => {
  const sendMessagePromise = vi.fn(answer);
  return { sendMessagePromise: sendMessagePromise as never, requests: sendMessagePromise };
};

describe('fetchZoneDay', () => {
  const yesterday = shiftDay(today, -1);

  it('reads the call sensor, the target, every feel sensor and every floor of the zone in one call for the day', async () => {
    const connection = connectionOf(async () => familyHistory());
    await fetchZoneDay(connection, 'family', yesterday, yesterday.endMs);
    expect(connection.requests).toHaveBeenCalledTimes(1);
    expect(connection.requests.mock.calls[0][0]).toEqual({
      type: 'history/history_during_period',
      start_time: new Date(at(0, 0, 4)).toISOString(),
      end_time: new Date(at(0, 0, 5)).toISOString(),
      entity_ids: [
        'binary_sensor.family_room_heating_active',
        'sensor.heating_zone_family',
        'sensor.living_room_feel',
        'sensor.dining_room_feel',
        'sensor.kitchen_feel',
        'sensor.living_room_floor_thermometer_temperature',
        'sensor.dining_room_floor_thermometer_temperature',
      ],
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
  });

  it('reads one feel sensor and one floor for each other zone', () => {
    expect(zoneDayEntities('kristines_room')).toEqual([
      'binary_sensor.kristines_room_heating_active',
      'sensor.heating_zone_kristines_room',
      'sensor.kristines_room_feel',
      'sensor.kristines_room_floor_thermometer_temperature',
    ]);
    expect(zoneDayEntities('claudias_room')).toContain('sensor.claudias_room_feel');
    expect(zoneDayEntities('bathroom')).toContain('sensor.bathroom_floor_thermometer_temperature');
    expect(zoneDayEntities('guest_bathroom')).toEqual([
      'binary_sensor.guest_bathroom_heating_active',
      'sensor.heating_zone_guest_bathroom',
      'sensor.guest_bathroom_feel',
      'sensor.guest_bathroom_floor_thermometer_temperature',
    ]);
    expect(ZONE_FLOORS.family).toHaveLength(2);
  });

  it('turns the answer into calls, a weighted air, a stepped target and the warmest floor', async () => {
    const data = await fetchZoneDay(
      connectionOf(async () => familyHistory()),
      'family',
      yesterday,
      yesterday.endMs
    );
    expect(data.calls).toEqual<CallPoint[]>([
      { ts: at(0, 0, 4), on: false },
      { ts: at(6, 0, 4), on: true },
      { ts: at(7, 30, 4), on: false },
    ]);
    expect(data.target).toEqual([
      { ts: at(0, 0, 4), value: 21.5 },
      { ts: at(15, 0, 4), value: 22 },
    ]);
    expect(data.air.map(point => point.ts)).toEqual([at(0, 0, 4), at(12, 0, 4), at(18, 0, 4)]);
    expect(data.air[0].value).toBeCloseTo((22 * 19 + 21 * 18.5) / 37.5, 9);
    expect(data.air[1].value).toBeCloseTo((23 * 19 + 21 * 18.5) / 37.5, 9);
    expect(data.air[2].value).toBeCloseTo((23 * 19 + 21 * 18.5 + 20 * 18.5) / 56, 9);
    expect(data.floor).toEqual([
      { ts: at(0, 0, 4), value: 23.5 },
      { ts: at(7, 0, 4), value: 24.5 },
    ]);
  });

  it('copes with an answer that has nothing in it', async () => {
    for (const answer of [null, {}, { 'sensor.heating_zone_family': [] }]) {
      const data = await fetchZoneDay(
        connectionOf(async () => answer),
        'family',
        yesterday,
        yesterday.endMs
      );
      expect(data).toEqual({ calls: [], air: [], target: [], floor: [] });
    }
  });
});

describe('loadZoneDay', () => {
  const yesterday = shiftDay(today, -1);
  const nowMs = at(11, 35);

  beforeEach(() => clearZoneDayCache());

  it('remembers a day that is over, per zone', async () => {
    const connection = connectionOf(async () => familyHistory());
    const first = await loadZoneDay(connection, 'family', yesterday, nowMs);
    const second = await loadZoneDay(connection, 'family', yesterday, nowMs);
    expect(second).toBe(first);
    expect(connection.requests).toHaveBeenCalledTimes(1);
    await loadZoneDay(connection, 'bathroom', yesterday, nowMs);
    await loadZoneDay(connection, 'family', shiftDay(today, -2), nowMs);
    expect(connection.requests).toHaveBeenCalledTimes(3);
  });

  it('reads the whole of a day that is over, and a day still running only up to now, every time', async () => {
    const connection = connectionOf(async () => familyHistory());
    await loadZoneDay(connection, 'family', yesterday, nowMs);
    expect(connection.requests.mock.calls[0][0].end_time).toBe(new Date(at(0, 0, 5)).toISOString());
    await loadZoneDay(connection, 'family', today, nowMs);
    await loadZoneDay(connection, 'family', today, nowMs + 1000);
    expect(connection.requests).toHaveBeenCalledTimes(3);
    expect(connection.requests.mock.calls[1][0].end_time).toBe(new Date(nowMs).toISOString());
    expect(connection.requests.mock.calls[2][0].end_time).toBe(new Date(nowMs + 1000).toISOString());
  });

  it('does not remember a failed read, nor an empty one', async () => {
    const failing = connectionOf(() => Promise.reject(new Error('connection closed')));
    await expect(loadZoneDay(failing, 'family', yesterday, nowMs)).rejects.toThrow('connection closed');
    await expect(loadZoneDay(failing, 'family', yesterday, nowMs)).rejects.toThrow('connection closed');
    expect(failing.requests).toHaveBeenCalledTimes(2);

    const empty = connectionOf(async () => ({}));
    await loadZoneDay(empty, 'family', yesterday, nowMs);
    await loadZoneDay(empty, 'family', yesterday, nowMs);
    expect(empty.requests).toHaveBeenCalledTimes(2);

    const recovered = connectionOf(async () => familyHistory());
    await loadZoneDay(recovered, 'family', yesterday, nowMs);
    await loadZoneDay(recovered, 'family', yesterday, nowMs);
    expect(recovered.requests).toHaveBeenCalledTimes(1);
  });
});

describe('zoneDayView', () => {
  const yesterday = shiftDay(today, -1);

  it('carries every series on to the end of a past day and totals the day', async () => {
    const data = await fetchZoneDay(
      connectionOf(async () => familyHistory()),
      'family',
      yesterday,
      yesterday.endMs
    );
    const view = zoneDayView('family', data, yesterday, yesterday.endMs);
    expect(view.air[view.air.length - 1].ts).toBe(yesterday.endMs);
    expect(view.target[view.target.length - 1]).toEqual({ ts: yesterday.endMs, value: 22 });
    expect(view.floor[view.floor.length - 1]).toEqual({ ts: yesterday.endMs, value: 24.5 });
    expect(view.segments).toEqual([{ startMs: at(6, 0, 4), endMs: at(7, 30, 4) }]);
    expect(view.spans[0].left).toBeCloseTo(25, 9);
    expect(view.spans[0].width).toBeCloseTo(6.25, 9);
    expect(view.summary.hours).toBe(1.5);
    expect(view.summary.kwh).toBeCloseTo(1.5 * 1.11, 9);
    expect(view.summary.airMinC).toBeCloseTo((23 * 19 + 21 * 18.5 + 20 * 18.5) / 56, 9);
    expect(view.summary.airMaxC).toBeCloseTo((23 * 19 + 21 * 18.5) / 37.5, 9);
  });

  it('stops today at now, and ends a call still on there', async () => {
    const nowMs = at(11, 35);
    const view = zoneDayView(
      'family',
      {
        calls: [
          { ts: at(0, 0), on: false },
          { ts: at(10, 0), on: true },
        ],
        air: [{ ts: at(0, 0), value: 21.5 }],
        target: [{ ts: at(0, 0), value: 21.5 }],
        floor: [],
      },
      today,
      nowMs
    );
    expect(view.air).toEqual([
      { ts: at(0, 0), value: 21.5 },
      { ts: nowMs, value: 21.5 },
    ]);
    expect(view.floor).toEqual([]);
    expect(view.segments).toEqual([{ startMs: at(10, 0), endMs: nowMs }]);
    expect(view.summary.hours).toBeCloseTo(1 + 35 / 60, 9);
  });
});
