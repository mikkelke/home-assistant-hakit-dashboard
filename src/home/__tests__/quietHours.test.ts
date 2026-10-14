import { describe, expect, it } from 'vitest';
import { home } from '../../energy/__tests__/testUtils';
import { isQuietAt, nextQuietStartMs, quietEndClock, readQuietHours } from '../quietHours';

const LIVE = readQuietHours('22:00:00', '07:00:00');

describe('readQuietHours', () => {
  it('reads the two time-only helpers', () => {
    expect(LIVE).toEqual({ startMin: 22 * 60, endMin: 7 * 60 });
    expect(readQuietHours('23:30', '06:15:00')).toEqual({ startMin: 23 * 60 + 30, endMin: 6 * 60 + 15 });
  });

  it("falls back to SonosNotifier's 22:00-07:00, each helper on its own", () => {
    for (const [start, end] of [
      [undefined, undefined],
      ['unavailable', 'unknown'],
      ['', '25:00:00'],
      ['2026-10-14 22:00:00', 'late'],
    ]) {
      expect(readQuietHours(start, end)).toEqual(LIVE);
    }
    expect(readQuietHours('23:00:00', 'unavailable')).toEqual({ startMin: 23 * 60, endMin: 7 * 60 });
    expect(readQuietHours('unknown', '06:00:00')).toEqual({ startMin: 22 * 60, endMin: 6 * 60 });
  });
});

describe('isQuietAt through the night', () => {
  it('is quiet from the start up to, not including, the end', () => {
    const at = (day: number, hour: number, minute: number) => isQuietAt(LIVE, home(2026, 10, day, hour, minute));
    expect(isQuietAt(LIVE, home(2026, 10, 13, 21, 59, 59) + 999)).toBe(false);
    expect([at(13, 21, 59), at(13, 22, 0), at(13, 23, 0), at(14, 0, 30), at(14, 6, 59), at(14, 7, 0)]).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('starts next at the coming start, strictly after now', () => {
    expect(nextQuietStartMs(LIVE, home(2026, 10, 13, 21, 59))).toBe(home(2026, 10, 13, 22, 0));
    expect(nextQuietStartMs(LIVE, home(2026, 10, 14, 7, 0))).toBe(home(2026, 10, 14, 22, 0));
    expect(nextQuietStartMs(LIVE, home(2026, 10, 13, 22, 0))).toBe(home(2026, 10, 14, 22, 0));
    expect(quietEndClock(LIVE)).toBe('07:00');
    expect(quietEndClock(readQuietHours('22:00:00', '06:05:00'))).toBe('06:05');
  });
});

describe('quiet hours across the 25.10.2026 change to winter time', () => {
  it('runs 22:00 CEST to 07:00 CET, ten hours, and starts again at 22:00 CET', () => {
    expect(isQuietAt(LIVE, Date.parse('2026-10-24T19:59:00Z'))).toBe(false);
    expect(nextQuietStartMs(LIVE, Date.parse('2026-10-24T19:00:00Z'))).toBe(Date.parse('2026-10-24T20:00:00Z'));
    expect(isQuietAt(LIVE, Date.parse('2026-10-24T20:00:00Z'))).toBe(true);
    // 02:30 happens twice that night, once in summer time and once in winter time.
    expect(isQuietAt(LIVE, Date.parse('2026-10-25T00:30:00Z'))).toBe(true);
    expect(isQuietAt(LIVE, Date.parse('2026-10-25T01:30:00Z'))).toBe(true);
    expect(isQuietAt(LIVE, Date.parse('2026-10-25T05:59:00Z'))).toBe(true);
    expect(isQuietAt(LIVE, Date.parse('2026-10-25T06:00:00Z'))).toBe(false);
    expect(nextQuietStartMs(LIVE, Date.parse('2026-10-25T06:00:00Z'))).toBe(Date.parse('2026-10-25T21:00:00Z'));
  });
});
