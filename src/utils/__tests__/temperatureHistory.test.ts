import { describe, expect, it } from 'vitest';
import { holdToNow, rangeStartMs, rollingMean, type TempPoint } from '../temperatureHistory';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-25T12:00:00Z');

const hourly = (values: number[], fromMs = NOW - values.length * HOUR): TempPoint[] =>
  values.map((value, i) => ({ ts: fromMs + i * HOUR, value }));

describe('holdToNow', () => {
  const series = hourly([1, 2, 3], NOW - 3 * HOUR);

  it('carries the last point to now at the live reading', () => {
    expect(holdToNow(series, 0.5, NOW)).toEqual([...series, { ts: NOW, value: 0.5 }]);
  });

  it('leaves a series alone that already reaches now', () => {
    const fresh = [...series, { ts: NOW - 30_000, value: 4 }];
    expect(holdToNow(fresh, 0.5, NOW)).toBe(fresh);
  });

  it('leaves a series alone when the live reading is not known', () => {
    expect(holdToNow(series, null, NOW)).toBe(series);
    expect(holdToNow(series, undefined, NOW)).toBe(series);
    expect(holdToNow(series, Number.NaN, NOW)).toBe(series);
  });

  it('has nothing to hold in an empty series', () => {
    expect(holdToNow([], 1, NOW)).toEqual([]);
  });
});

describe('rollingMean', () => {
  it('is each point itself when the window holds only that point', () => {
    expect(rollingMean(hourly([3, 5, 7]), 0).map(p => p.value)).toEqual([3, 5, 7]);
  });

  it('averages the points inside the window that ends at each point', () => {
    // A window of 3 h holds a point and the two before it: a point exactly a window back has dropped out.
    const mean = rollingMean(hourly([0, 3, 6, 9, 12]), 3 * HOUR);
    expect(mean.map(p => p.value)).toEqual([0, 1.5, 3, 6, 9]);
  });

  it('keeps every timestamp and the order', () => {
    const points = hourly([1, 2, 3, 4]);
    expect(rollingMean(points, 2 * HOUR).map(p => p.ts)).toEqual(points.map(p => p.ts));
  });

  it('averages what there is of the window at the start, so a caller wanting whole windows fetches the day before', () => {
    const air = hourly([5, 5, -5, -5], NOW - 4 * HOUR);
    const mean = rollingMean(air, 2 * DAY);
    expect(mean[0].value).toBe(5);
    expect(mean[3].value).toBe(0);
  });

  it('spans gaps by time, not by count', () => {
    const points: TempPoint[] = [
      { ts: NOW - 30 * HOUR, value: 10 },
      { ts: NOW - 2 * HOUR, value: 0 },
      { ts: NOW, value: 4 },
    ];
    // 24 h before the last point is NOW - 24 h: the 30 h old point is outside, the one 2 h back is inside.
    expect(rollingMean(points, DAY).map(p => p.value)).toEqual([10, 0, 2]);
  });

  it('gives nothing for nothing', () => {
    expect(rollingMean([], DAY)).toEqual([]);
  });
});

describe('rangeStartMs', () => {
  it('reaches a week and a day back for the 8 day range, which carries a 24 h mean over the whole week', () => {
    expect(NOW - rangeStartMs('24h', NOW)).toBe(DAY);
    expect(NOW - rangeStartMs('7d', NOW)).toBe(7 * DAY);
    expect(NOW - rangeStartMs('8d', NOW)).toBe(8 * DAY);
  });
});
