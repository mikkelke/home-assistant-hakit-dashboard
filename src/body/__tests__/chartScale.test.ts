import { describe, expect, it } from 'vitest';
import { dateLabel, durationLabel, monthName, monthTicks, signed, spanLabel } from '../chartScale';

const DAY = 24 * 3_600_000;
const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 9).getTime();

describe('signed', () => {
  it('puts a sign on the value and keeps the decimals', () => {
    expect(signed(0.34)).toBe('+0,3');
    expect(signed(-5.71)).toBe('−5,7');
    expect(signed(0.125, 2)).toBe('+0,13');
  });

  it('reads ± for a value that rounds to zero', () => {
    expect(signed(0)).toBe('±0,0');
    expect(signed(0.04)).toBe('±0,0');
    expect(signed(-0.04)).toBe('±0,0');
    expect(signed(-0.05)).toBe('−0,1');
  });
});

describe('labels', () => {
  it('names months from 1 for January', () => {
    expect(monthName(1)).toBe('Jan');
    expect(monthName(12)).toBe('Dec');
  });

  it('adds the year to a date only when it is not this year', () => {
    const now = at(2026, 11, 25);
    expect(dateLabel(at(2026, 3, 9), now)).toBe('9 Mar');
    expect(dateLabel(at(2025, 12, 31), now)).toBe('31 Dec 2025');
  });

  it('spells a stretch of months as briefly as it can', () => {
    expect(spanLabel(at(2021, 3, 2), at(2021, 8, 20))).toBe('Mar – Aug 2021');
    expect(spanLabel(at(2019, 11, 20), at(2020, 3, 5))).toBe('Nov 2019 – Mar 2020');
    expect(spanLabel(at(2021, 3, 2), at(2021, 3, 28))).toBe('Mar 2021');
  });

  it('counts days up to two weeks and weeks beyond', () => {
    expect(durationLabel(0)).toBe('1 d');
    expect(durationLabel(13 * DAY)).toBe('13 d');
    expect(durationLabel(14 * DAY)).toBe('2 wk');
    expect(durationLabel(40 * 7 * DAY)).toBe('40 wk');
  });
});

describe('monthTicks', () => {
  it('lays the twelve months over one year, each with its middle inside it', () => {
    const ticks = monthTicks();
    expect(ticks.map(t => t.label)).toHaveLength(12);
    expect(ticks[0].start).toBe(0);
    ticks.forEach((tick, i) => {
      const next = ticks[i + 1]?.start ?? 1;
      expect(tick.mid).toBeGreaterThan(tick.start);
      expect(tick.mid).toBeLessThan(next);
    });
    expect(ticks[1].start).toBeCloseTo(31 / 365, 6);
  });
});
