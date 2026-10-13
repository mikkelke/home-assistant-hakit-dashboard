import { describe, expect, it } from 'vitest';
import { assembleBill, fixedFeesForRange } from '../bill';
import { billHistory, kronerBreakdown, ringFraction } from '../billView';
import type { EnergyBar, EnergyView } from '../types';
import { HOME_CALENDAR, isImmutablePeriod, nextDisabled } from '../period';
import { slotIndexFor } from '../../components/Energy/chartGeometry';
import { bandShares, changeVsPrevious, ordinal, priceRank, rankLabel, sameHourYesterdayMs } from '../usageView';
import { home } from './testUtils';

const HOUR = 3_600_000;

function hours(startMs: number, kWh: number[], level: EnergyBar['level'] = 'normal'): EnergyBar[] {
  return kWh.map((k, i) => ({ startMs: startMs + i * HOUR, endMs: startMs + (i + 1) * HOUR, kWh: k, costKr: k * 2, price: 2, level }));
}

function view(startMs: number, bars: EnergyBar[], endMs = startMs + 24 * HOUR): EnergyView {
  const totals = bars.reduce((s, b) => ({ kWh: s.kWh + b.kWh, costKr: s.costKr + b.costKr }), { kWh: 0, costKr: 0 });
  return { period: 'day', startMs, endMs, bars, totals, complete: false };
}

describe('hour sheet rank', () => {
  const prices = [1.27, 2.94, 2.1, 2.94, 3.4, 1.27];

  it('ranks by price, priciest first, ties sharing the better rank', () => {
    expect(priceRank(prices, 3.4)).toBe(1);
    expect(priceRank(prices, 2.94)).toBe(2);
    expect(priceRank(prices, 2.1)).toBe(4);
    expect(priceRank(prices, 1.27)).toBe(5);
  });

  it('labels the rank in words', () => {
    expect(rankLabel(1, 24, 'hour')).toBe('priciest hour');
    expect(rankLabel(24, 24, 'hour')).toBe('cheapest hour');
    expect(rankLabel(5, 24, 'hour')).toBe('5th priciest hour');
    expect(rankLabel(1, 1, 'hour')).toBe('');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
    ]);
  });
});

describe('usage comparison and band share', () => {
  const yesterday = 0;
  const today = 24 * HOUR;

  it('compares an unfinished day with yesterday cut at the same minute', () => {
    const now = today + 2.5 * HOUR;
    const current = view(today, hours(today, [1, 1, 0.5]));
    const previous = view(yesterday, hours(yesterday, [1, 1, 1, 4, 4]));
    expect(changeVsPrevious(current, previous, now, 'kwh')).toBe(0);
    expect(changeVsPrevious(current, previous, today + 4 * HOUR, 'kwh')).toBe(-64);
    expect(changeVsPrevious(current, null, now, 'kwh')).toBeNull();
  });

  it('splits kWh by band and leaves unknown hours out', () => {
    const bars = [...hours(0, [1], 'cheap'), ...hours(HOUR, [3], 'expensive'), ...hours(2 * HOUR, [6], 'unknown')];
    expect(bandShares(bars)).toEqual({ cheap: 0.25, normal: 0, pricey: 0, expensive: 0.75 });
    expect(bandShares([])).toEqual({ cheap: 0, normal: 0, pricey: 0, expensive: 0 });
  });
});

describe('bill breakdown (Copenhagen months, phone abroad: tests run in America/Los_Angeles)', () => {
  const october = home(2026, 10, 1);
  const november = home(2026, 11, 1);
  const monthView: EnergyView = {
    period: 'month',
    startMs: october,
    endMs: november,
    bars: [],
    totals: { kWh: 128.4, costKr: 271.47 },
    complete: false,
  };
  const now = home(2026, 10, 13, 14, 20);

  it('splits the bill into consumption and fees that sum to the assembled total', () => {
    const bill = assembleBill(monthView, now);
    const { segments, totalKr } = kronerBreakdown(bill);
    expect(segments.map(s => s.key)).toEqual(['consumption', 'fees']);
    expect(segments[0].kr).toBe(271.47);
    expect(segments[1].kr).toBeCloseTo(70.525);
    expect(Math.abs(totalKr - bill.totalKr) / bill.totalKr).toBeLessThan(0.01);
    expect(totalKr).toBeCloseTo(bill.totalKr, 9);
  });

  it('prorates fees over Copenhagen days, so a full home month is exactly one monthly fee', () => {
    expect(fixedFeesForRange(home(2026, 2, 1), home(2026, 3, 1))).toBeCloseTo(70.525, 9);
    expect(fixedFeesForRange(home(2026, 3, 1), home(2026, 4, 1))).toBeCloseTo(70.525, 9);
    expect(fixedFeesForRange(home(2026, 2, 1), home(2026, 2, 15))).toBeCloseTo(70.525 / 2, 9);
  });

  it('fills the ring with the bill so far against the projection, full once settled', () => {
    const bill = assembleBill(monthView, now);
    expect(ringFraction(bill)).toBeCloseTo(bill.totalKr / bill.projectedTotalKr!);
    expect(ringFraction(assembleBill(monthView, november + HOUR))).toBe(1);
  });

  it('lists months since December 2025 with full fees and the current month projected', () => {
    const monthBar = (year: number, month: number, costKr: number): EnergyBar => ({
      startMs: home(year, month, 1),
      endMs: home(year, month + 1, 1),
      kWh: costKr / 2,
      costKr,
      price: 2,
      level: 'normal',
    });
    const bars = [monthBar(2025, 12, 600), monthBar(2026, 1, 620), monthBar(2026, 10, 271.47)];
    const months = billHistory(bars, now);
    expect(months).toHaveLength(11);
    expect(months[0]).toEqual({ startMs: home(2025, 12, 1), kr: 600 + 70.525, projected: false });
    expect(months[1].kr).toBeCloseTo(620 + 70.525);
    expect(months[2].kr).toBeNull();
    const last = months[months.length - 1];
    expect(last.startMs).toBe(october);
    expect(last.projected).toBe(true);
    expect(last.kr).toBeCloseTo(assembleBill(monthView, now).projectedTotalKr!);
    expect(billHistory(bars, home(2027, 6, 2)).map(m => m.startMs)).toEqual(Array.from({ length: 12 }, (_, i) => home(2026, 7 + i, 1)));
  });
});

describe('home calendar (phone in America/Los_Angeles)', () => {
  const now = home(2026, 10, 13, 1, 30);

  it('starts and steps periods at Copenhagen midnights', () => {
    expect(HOME_CALENDAR.startOf('day', now)).toBe(home(2026, 10, 13));
    expect(HOME_CALENDAR.startOf('week', now)).toBe(home(2026, 10, 12));
    expect(HOME_CALENDAR.startOf('month', now)).toBe(home(2026, 10, 1));
    expect(HOME_CALENDAR.startOf('year', now)).toBe(home(2026, 1, 1));
    expect(HOME_CALENDAR.step('month', home(2026, 10, 1), 1)).toBe(home(2026, 11, 1));
    expect(HOME_CALENDAR.step('month', home(2026, 1, 1), -1)).toBe(home(2025, 12, 1));
    expect(HOME_CALENDAR.step('day', home(2026, 10, 25), 1) - home(2026, 10, 25)).toBe(25 * HOUR);
    expect(HOME_CALENDAR.step('year', home(2026, 1, 1), 1)).toBe(home(2027, 1, 1));
  });

  it('decides the in-progress and immutable periods in home time', () => {
    expect(nextDisabled('month', home(2026, 10, 1), now, HOME_CALENDAR)).toBe(true);
    expect(nextDisabled('month', home(2026, 9, 1), now, HOME_CALENDAR)).toBe(false);
    expect(isImmutablePeriod('month', home(2026, 9, 1), home(2026, 10, 1), now, HOME_CALENDAR)).toBe(false);
    expect(isImmutablePeriod('month', home(2026, 8, 1), home(2026, 9, 1), now, HOME_CALENDAR)).toBe(true);
  });
});

describe('same hour yesterday', () => {
  it('matches the previous home day and wall-clock hour across DST, unlike the elapsed-hour slot', () => {
    const tapped = home(2026, 3, 29, 3);
    const elapsedSlot = home(2026, 3, 28) + slotIndexFor('day', home(2026, 3, 29), tapped) * HOUR;
    expect(elapsedSlot).toBe(home(2026, 3, 28, 2));
    expect(sameHourYesterdayMs(tapped)).toBe(home(2026, 3, 28, 3));
    expect(sameHourYesterdayMs(home(2026, 10, 25, 3))).toBe(home(2026, 10, 24, 3));
    expect(sameHourYesterdayMs(home(2026, 10, 13, 14))).toBe(home(2026, 10, 12, 14));
  });

  it('takes the first of a repeated hour and has none for a skipped one', () => {
    expect(sameHourYesterdayMs(home(2026, 10, 26, 2))).toBe(home(2026, 10, 25, 2));
    expect(sameHourYesterdayMs(home(2026, 10, 25, 2) + HOUR)).toBe(home(2026, 10, 24, 2));
    expect(sameHourYesterdayMs(home(2026, 3, 30, 2))).toBeNull();
  });
});
