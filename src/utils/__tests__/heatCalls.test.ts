import { describe, expect, it, vi } from 'vitest';
import type { HassEntity } from '../../types';
import {
  callPointsOf,
  callSegments,
  callSpans,
  fetchCallPoints,
  liveCallPoint,
  localDay,
  withLiveCall,
  zoneCallSegments,
  type CallPoint,
} from '../heatCalls';
import { HEATING_ZONES, zoneCallSensorId } from '../heating';

const HOUR = 3_600_000;

/** A moment on 5 November 2026 on the device's clock. */
const at = (hour: number, minute = 0) => new Date(2026, 10, 5, hour, minute).getTime();
const day = localDay(at(11, 35));
const on = (ts: number): CallPoint => ({ ts, on: true });
const off = (ts: number): CallPoint => ({ ts, on: false });

const sensor = (state: string, lastChanged?: number): HassEntity => ({
  entity_id: zoneCallSensorId('family'),
  state,
  attributes: {},
  last_changed: lastChanged == null ? undefined : new Date(lastChanged).toISOString(),
});

describe('localDay', () => {
  it('runs from local midnight to the next', () => {
    expect(localDay(at(11, 35))).toEqual({ startMs: new Date(2026, 10, 5).getTime(), endMs: new Date(2026, 10, 6).getTime() });
    expect(localDay(at(0, 0)).startMs).toBe(at(0, 0));
    expect(localDay(at(23, 59)).endMs).toBe(new Date(2026, 10, 6).getTime());
  });

  it('is as long as the day really was when the clocks change', () => {
    const length = (month: number, date: number) => {
      const { startMs, endMs } = localDay(new Date(2026, month, date, 12).getTime());
      return (endMs - startMs) / HOUR;
    };
    expect(length(10, 1)).toBe(25);
    expect(length(2, 8)).toBe(23);
    expect(length(10, 5)).toBe(24);
  });
});

describe('callPointsOf', () => {
  it('reads the compressed rows of the websocket, whose times are unix seconds', () => {
    expect(
      callPointsOf([
        { s: 'off', lu: 1762300000.5 },
        { s: 'on', lu: 1762300600.25 },
      ])
    ).toEqual([
      { ts: 1762300000500, on: false },
      { ts: 1762300600250, on: true },
    ]);
  });

  it('reads full rows with a state and an ISO time', () => {
    expect(
      callPointsOf([
        { state: 'on', last_updated: '2026-11-05T08:00:00.000Z' },
        { state: 'off', last_changed: '2026-11-05T09:30:00+00:00' },
      ])
    ).toEqual([
      { ts: Date.UTC(2026, 10, 5, 8), on: true },
      { ts: Date.UTC(2026, 10, 5, 9, 30), on: false },
    ]);
  });

  it('counts anything but on as not calling', () => {
    expect(
      callPointsOf([{ s: 'unavailable', lu: 1 }, { s: 'unknown', lu: 2 }, { s: 'off', lu: 3 }, { lu: 4 }]).map(point => point.on)
    ).toEqual([false, false, false, false]);
  });

  it('drops rows without a usable time, and anything that is not a list of rows', () => {
    expect(callPointsOf([{ s: 'on' }, { s: 'on', lu: 'x' }, null, 'on', { s: 'on', lu: 5 }])).toEqual([{ ts: 5000, on: true }]);
    expect(callPointsOf(undefined)).toEqual([]);
    expect(callPointsOf({ s: 'on', lu: 5 })).toEqual([]);
  });
});

describe('fetchCallPoints', () => {
  it('asks once for the history of every zone sensor and sorts the rows into zones', async () => {
    const sendMessagePromise = vi.fn().mockResolvedValue({
      [zoneCallSensorId('family')]: [
        { s: 'off', lu: 1762300000 },
        { s: 'on', lu: 1762303600 },
      ],
      [zoneCallSensorId('bathroom')]: [{ s: 'off', lu: 1762300000 }],
      [zoneCallSensorId('claudias_room')]: [],
    });
    const points = await fetchCallPoints({ sendMessagePromise }, at(0), at(11, 35));

    expect(sendMessagePromise).toHaveBeenCalledTimes(1);
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'history/history_during_period',
      start_time: new Date(at(0)).toISOString(),
      end_time: new Date(at(11, 35)).toISOString(),
      entity_ids: HEATING_ZONES.map(zoneCallSensorId),
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
    expect(points).toEqual({
      family: [
        { ts: 1762300000000, on: false },
        { ts: 1762303600000, on: true },
      ],
      bathroom: [{ ts: 1762300000000, on: false }],
    });
  });

  it('has no zones when the server answers with nothing', async () => {
    expect(await fetchCallPoints({ sendMessagePromise: vi.fn().mockResolvedValue(null) }, at(0), at(1))).toEqual({});
  });

  it('lets a failed read reach the caller', async () => {
    await expect(fetchCallPoints({ sendMessagePromise: vi.fn().mockRejectedValue(new Error('closed')) }, at(0), at(1))).rejects.toThrow(
      'closed'
    );
  });
});

describe('callSegments', () => {
  it('turns on and off changes into the stretches called', () => {
    const points = [off(at(0)), on(at(6)), off(at(7, 30)), on(at(9)), off(at(9, 20))];
    expect(callSegments(points, day.startMs, at(11, 35))).toEqual([
      { startMs: at(6), endMs: at(7, 30) },
      { startMs: at(9), endMs: at(9, 20) },
    ]);
  });

  it('runs a call that is still on to the end', () => {
    expect(callSegments([off(at(0)), on(at(10))], day.startMs, at(11, 35))).toEqual([{ startMs: at(10), endMs: at(11, 35) }]);
  });

  it('starts a call from before the day at the start of the day', () => {
    expect(callSegments([on(at(0) - HOUR), off(at(1))], day.startMs, at(11, 35))).toEqual([{ startMs: at(0), endMs: at(1) }]);
  });

  it('ignores changes after the end', () => {
    expect(callSegments([off(at(0)), on(at(12)), off(at(12, 20))], day.startMs, at(11, 35))).toEqual([]);
    expect(callSegments([on(at(10)), off(at(12))], day.startMs, at(11, 35))).toEqual([{ startMs: at(10), endMs: at(11, 35) }]);
  });

  it('does not split a call on repeated on points, and drops a call of no length', () => {
    expect(callSegments([on(at(6)), on(at(6, 10)), off(at(7))], day.startMs, at(11, 35))).toEqual([{ startMs: at(6), endMs: at(7) }]);
    expect(callSegments([on(at(6)), off(at(6))], day.startMs, at(11, 35))).toEqual([]);
  });

  it('has no segments without points', () => {
    expect(callSegments([], day.startMs, at(11, 35))).toEqual([]);
  });
});

describe('liveCallPoint', () => {
  it('is the state of the sensor from when it last changed', () => {
    expect(liveCallPoint(sensor('on', at(10)))).toEqual({ ts: at(10), on: true });
    expect(liveCallPoint(sensor('off', at(10)))).toEqual({ ts: at(10), on: false });
    expect(liveCallPoint(sensor('unavailable', at(10)))).toEqual({ ts: at(10), on: false });
  });

  it('is nothing without a sensor or a time', () => {
    expect(liveCallPoint(undefined)).toBeNull();
    expect(liveCallPoint(sensor('on'))).toBeNull();
  });
});

describe('withLiveCall', () => {
  it('adds the live state when it changed after the last row', () => {
    expect(withLiveCall([off(at(6))], on(at(10)))).toEqual([off(at(6)), on(at(10))]);
    expect(withLiveCall([on(at(6))], off(at(8)))).toEqual([on(at(6)), off(at(8))]);
  });

  it('adds nothing when the live state is the last row already', () => {
    expect(withLiveCall([off(at(6)), on(at(10))], on(at(10, 1)))).toEqual([off(at(6)), on(at(10))]);
  });

  it('puts a live change dated before the last row at that row', () => {
    expect(withLiveCall([off(at(6))], on(at(5)))).toEqual([off(at(6)), on(at(6))]);
  });

  it('is the live state alone while the history is empty, and the history alone without a live state', () => {
    expect(withLiveCall([], on(at(10)))).toEqual([on(at(10))]);
    expect(withLiveCall([off(at(6))], null)).toEqual([off(at(6))]);
  });

  it('leaves the history it was given as it was', () => {
    const history = [off(at(6))];
    withLiveCall(history, on(at(10)));
    expect(history).toEqual([off(at(6))]);
  });
});

describe('zoneCallSegments', () => {
  it('extends a call that began since the history was read to now', () => {
    const history = [off(at(0)), on(at(6)), off(at(7))];
    expect(zoneCallSegments(history, sensor('on', at(10)), day, at(11, 35))).toEqual([
      { startMs: at(6), endMs: at(7) },
      { startMs: at(10), endMs: at(11, 35) },
    ]);
  });

  it('ends a call that stopped since the history was read at the moment it stopped', () => {
    expect(zoneCallSegments([off(at(0)), on(at(10))], sensor('off', at(11)), day, at(11, 35))).toEqual([
      { startMs: at(10), endMs: at(11) },
    ]);
  });

  it('draws the live call alone while the history is still loading', () => {
    expect(zoneCallSegments(undefined, sensor('on', at(10)), day, at(11, 35))).toEqual([{ startMs: at(10), endMs: at(11, 35) }]);
    expect(zoneCallSegments(undefined, sensor('off', at(10)), day, at(11, 35))).toEqual([]);
    expect(zoneCallSegments(undefined, undefined, day, at(11, 35))).toEqual([]);
  });
});

describe('callSpans', () => {
  it('gives each segment as a share of the day in percent', () => {
    expect(callSpans([{ startMs: at(6), endMs: at(7, 30) }], day)).toEqual([{ left: 25, width: 6.25 }]);
    expect(callSpans([{ startMs: at(0), endMs: at(24) }], day)).toEqual([{ left: 0, width: 100 }]);
  });

  it('measures a day with a clock change by its real length', () => {
    const long = localDay(new Date(2026, 10, 1, 12).getTime());
    const [span] = callSpans([{ startMs: long.startMs, endMs: long.startMs + 5 * HOUR }], long);
    expect(span.width).toBeCloseTo((5 / 25) * 100, 9);
  });

  it('has no spans without segments', () => {
    expect(callSpans([], day)).toEqual([]);
  });
});
