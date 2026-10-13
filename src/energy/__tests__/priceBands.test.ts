import { describe, expect, it } from 'vitest';
import { PLAN_APPLIANCES } from '../../config/plan';
import { homeDayKey, homeDayStartMs, homeWallTimeToMs, nextHomeClockMs, nextHomeDayStartMs } from '../homeTime';
import { assignPriceBands, bandAt, nextBandChangeMs, type BandedPricePoint, type PriceBand } from '../priceBands';
import { buildHourlyPrices } from '../priceTimeline';
import { costCurve, runCost, indexPrices } from '../startPlan';
import { fixtureProgramme, fixtureTimeline, home, hourly, HOUR_MS } from './testUtils';

function counts(points: readonly BandedPricePoint[]): Record<PriceBand, number> {
  const out: Record<PriceBand, number> = { cheap: 0, normal: 0, pricey: 0, expensive: 0, unknown: 0 };
  for (const p of points) out[p.band]++;
  return out;
}

/** Distinct prices in a scrambled order, so rank is not hour order. */
function scrambled(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 1 + ((i * 7) % n) / 10);
}

function rawDay(hours: string[], prices: number[]) {
  return hours.map((hour, i) => ({ hour, price: prices[i] }));
}

const autumnHours = [
  '2026-10-25T00:00:00+02:00',
  '2026-10-25T01:00:00+02:00',
  '2026-10-25T02:00:00+02:00',
  '2026-10-25T02:00:00+01:00',
  ...Array.from({ length: 21 }, (_, i) => `2026-10-25T${String(i + 3).padStart(2, '0')}:00:00+01:00`),
];
const springHours = [
  '2027-03-28T00:00:00+01:00',
  '2027-03-28T01:00:00+01:00',
  ...Array.from({ length: 21 }, (_, i) => `2027-03-28T${String(i + 3).padStart(2, '0')}:00:00+02:00`),
];

describe('home time', () => {
  it('runs in a device zone other than the house zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Los_Angeles');
    expect(new Date(home(2026, 10, 1, 12)).getTimezoneOffset()).toBe(420);
  });

  it('uses Copenhagen calendar days, not the device zone', () => {
    const ms = Date.parse('2026-10-02T03:00:00+02:00');
    expect(homeDayKey(ms)).toBe('2026-10-02');
    expect(new Date(ms).getDate()).toBe(1);
    expect(homeDayStartMs(ms)).toBe(Date.parse('2026-10-02T00:00:00+02:00'));
  });

  it('handles 25-hour and 23-hour days', () => {
    const autumn = homeDayStartMs(Date.parse('2026-10-25T12:00:00+01:00'));
    expect(autumn).toBe(Date.parse('2026-10-25T00:00:00+02:00'));
    expect(nextHomeDayStartMs(autumn) - autumn).toBe(25 * HOUR_MS);
    const spring = homeDayStartMs(Date.parse('2027-03-28T12:00:00+02:00'));
    expect(nextHomeDayStartMs(spring) - spring).toBe(23 * HOUR_MS);
    expect(homeWallTimeToMs(2026, 10, 25, 2, 30)).toBe(Date.parse('2026-10-25T02:30:00+02:00'));
    expect(homeWallTimeToMs(2027, 3, 28, 2, 30)).toBe(Date.parse('2027-03-28T03:30:00+02:00'));
  });

  it('finds the next home clock time', () => {
    expect(nextHomeClockMs(home(2026, 10, 9, 20, 5), 7)).toBe(Date.parse('2026-10-10T07:00:00+02:00'));
    expect(nextHomeClockMs(home(2026, 10, 10, 6, 59), 7)).toBe(Date.parse('2026-10-10T07:00:00+02:00'));
    expect(nextHomeClockMs(home(2026, 10, 10, 7), 7)).toBe(Date.parse('2026-10-11T07:00:00+02:00'));
  });
});

describe('assignPriceBands', () => {
  it('ranks each Copenhagen day into 6/6/6/6', () => {
    const banded = assignPriceBands(fixtureTimeline('2026-10-01', '2026-10-02'));
    expect(banded).toHaveLength(48);
    for (const day of ['2026-10-01', '2026-10-02']) {
      const own = banded.filter(p => homeDayKey(p.ms) === day);
      expect(counts(own)).toEqual({ cheap: 6, normal: 6, pricey: 6, expensive: 6, unknown: 0 });
    }
  });

  it('ranks whole days, so tomorrow or the time of viewing never moves a band', () => {
    const oneDay = assignPriceBands(fixtureTimeline('2026-10-01'));
    const twoDays = assignPriceBands(fixtureTimeline('2026-10-01', '2026-10-02'));
    for (const p of oneDay) expect(bandAt(twoDays, p.ms)).toBe(p.band);
    const lateEvening = home(2026, 10, 1, 23);
    expect(bandAt(oneDay, lateEvening)).not.toBe('unknown');
  });

  it('lets ties share a band', () => {
    const t0 = home(2026, 10, 9);
    const prices = [...Array(7).fill(1), ...Array.from({ length: 17 }, (_, i) => 2 + i)];
    const banded = assignPriceBands(hourly(t0, prices));
    expect(counts(banded)).toEqual({ cheap: 7, normal: 5, pricey: 6, expensive: 6, unknown: 0 });
    const boundaryTie = assignPriceBands(
      hourly(t0, [...Array.from({ length: 5 }, (_, i) => i), 9, 9, ...Array.from({ length: 17 }, (_, i) => 10 + i)])
    );
    expect(boundaryTie[5].band).toBe('cheap');
    expect(boundaryTie[6].band).toBe('cheap');
  });

  it('makes an all-equal day normal and an incomplete day unknown', () => {
    const t0 = home(2026, 10, 9);
    expect(counts(assignPriceBands(hourly(t0, Array(24).fill(1.5)))).normal).toBe(24);
    const withGap = hourly(t0, [...scrambled(23), null]);
    expect(counts(assignPriceBands(withGap)).unknown).toBe(23);
    const partialTomorrow = [...hourly(t0, scrambled(24)), ...hourly(t0 + 24 * HOUR_MS, [1, 2, 3])];
    const banded = assignPriceBands(partialTomorrow);
    expect(counts(banded)).toEqual({ cheap: 6, normal: 6, pricey: 6, expensive: 6, unknown: 3 });
  });

  it('handles the 25-hour autumn day with 25 points and with 24', () => {
    const full = buildHourlyPrices(rawDay(autumnHours, scrambled(25)), null, false, null);
    expect(full).toHaveLength(25);
    expect(counts(assignPriceBands(full))).toEqual({ cheap: 7, normal: 6, pricey: 6, expensive: 6, unknown: 0 });

    const missingRepeat = buildHourlyPrices(
      rawDay(
        autumnHours.filter(h => h !== '2026-10-25T02:00:00+01:00'),
        scrambled(24)
      ),
      null,
      false,
      null
    );
    expect(counts(assignPriceBands(missingRepeat)).unknown).toBe(24);

    const duplicated = buildHourlyPrices(
      rawDay(
        autumnHours.map(h => (h === '2026-10-25T02:00:00+01:00' ? '2026-10-25T02:00:00+02:00' : h)),
        scrambled(25)
      ),
      null,
      false,
      null
    );
    expect(duplicated).toHaveLength(24);
    expect(counts(assignPriceBands(duplicated)).unknown).toBe(24);
  });

  it('handles the 23-hour spring day', () => {
    const full = buildHourlyPrices(rawDay(springHours, scrambled(23)), null, false, null);
    expect(counts(assignPriceBands(full))).toEqual({ cheap: 6, normal: 6, pricey: 6, expensive: 5, unknown: 0 });
  });
});

describe('nextBandChangeMs', () => {
  const t0 = home(2026, 10, 9);
  const banded = assignPriceBands([
    ...hourly(
      t0,
      Array.from({ length: 24 }, (_, i) => i + 1)
    ),
    ...hourly(t0 + 24 * HOUR_MS, [1, 2]),
  ]);

  it('returns the next hour whose band differs', () => {
    expect(nextBandChangeMs(banded, t0 + 2.5 * HOUR_MS)).toBe(t0 + 6 * HOUR_MS);
    expect(nextBandChangeMs(banded, t0 + 11 * HOUR_MS)).toBe(t0 + 12 * HOUR_MS);
  });

  it('stops where the band is no longer known, and is null for an unknown hour', () => {
    expect(nextBandChangeMs(banded, t0 + 20 * HOUR_MS)).toBe(t0 + 24 * HOUR_MS);
    expect(nextBandChangeMs(banded, t0 + 24.5 * HOUR_MS)).toBeNull();
    expect(nextBandChangeMs(banded, t0 - HOUR_MS)).toBeNull();
  });
});

describe('planning across the autumn change', () => {
  const washer = fixtureProgramme('washer');
  const start = Date.parse('2026-10-25T01:30:00+02:00');

  it('prices both 02:00 hours with 25 points and refuses the gap with 24', () => {
    const full = buildHourlyPrices(rawDay(autumnHours, Array(25).fill(1)), null, false, null);
    expect(runCost(washer, indexPrices(full), start)?.kr).toBeCloseTo(washer.kwh, 9);
    const missingRepeat = buildHourlyPrices(
      rawDay(
        autumnHours.filter(h => h !== '2026-10-25T02:00:00+01:00'),
        Array(24).fill(1)
      ),
      null,
      false,
      null
    );
    expect(runCost(washer, indexPrices(missingRepeat), start)).toBeNull();

    const steps = PLAN_APPLIANCES[0].knobStepsMin;
    const curve = costCurve(washer, full, { pressFromMs: Date.parse('2026-10-25T00:00:00+02:00'), knobStepsMin: steps });
    expect(curve.points).toHaveLength(288);
    const curveGap = costCurve(washer, missingRepeat, { pressFromMs: Date.parse('2026-10-25T00:00:00+02:00'), knobStepsMin: steps });
    expect(curveGap.points[0].costKr).toBeNull();
    expect(curveGap.points.find(p => p.startMs === Date.parse('2026-10-25T03:00:00+01:00'))?.costKr).toBeCloseTo(washer.kwh, 9);
  });
});
