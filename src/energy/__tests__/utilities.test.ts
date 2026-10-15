import { describe, expect, it } from 'vitest';
import type { StatisticValue, StatisticsResponse } from '../types';
import {
  assembleUtilityView,
  changePct,
  periodDataEndMs,
  UTILITY_CALENDAR,
  utilityDataEndMs,
  utilityKr,
  utilityPrice,
  utilityStatIds,
  utilityStatsWindows,
  utilityTotal,
  yearEarlier,
} from '../utilities';
import { home } from './testUtils';

const IDS = utilityStatIds([
  'ista_dk:1_cold_water',
  'ista_dk:1_cold_water_cost',
  'ista_dk:1_hot_water',
  'ista_dk:1_hot_water_cost',
  'ista_dk:1_heat',
  'ista_dk:1_heat_cost',
]);

/** HA day-bucket rows from a Copenhagen date, one per change. */
function dayRows(year: number, month: number, day: number, changes: number[]): StatisticValue[] {
  return changes.map((change, i) => ({ start: home(year, month, day + i), end: home(year, month, day + i + 1), change }));
}

/** HA month-bucket rows from a Copenhagen month, one per change. */
function monthRows(year: number, month: number, changes: number[]): StatisticValue[] {
  return changes.map((change, i) => ({ start: home(year, month + i, 1), end: home(year, month + i + 1, 1), change }));
}

/** The same rows for every meter, costs at 10 kr per unit. */
function response(rows: StatisticValue[]): StatisticsResponse {
  const out: StatisticsResponse = {};
  for (const meter of Object.values(IDS)) {
    if (!meter?.cost) continue;
    out[meter.amount] = rows;
    out[meter.cost] = rows.map(row => ({ ...row, change: row.change == null ? null : row.change * 10 }));
  }
  return out;
}

describe('cut-off at the delay', () => {
  it('ends the data at the day after the earliest reading date', () => {
    expect(utilityDataEndMs(['2026-10-07', '2026-10-09', undefined, 'unknown'])).toBe(home(2026, 10, 8));
    expect(utilityDataEndMs(['2026-10-07T00:00:00+02:00'])).toBe(home(2026, 10, 8));
    expect(utilityDataEndMs(['', null])).toBeNull();
  });

  it('cuts a period at the data end only when it falls inside', () => {
    const start = home(2026, 10, 1);
    const end = home(2026, 11, 1);
    expect(periodDataEndMs(start, end, home(2026, 10, 8))).toBe(home(2026, 10, 8));
    expect(periodDataEndMs(start, end, home(2026, 12, 3))).toBe(end);
    expect(periodDataEndMs(start, end, home(2026, 9, 20))).toBe(start);
    expect(periodDataEndMs(start, end, null)).toBe(end);
  });

  it('counts days before the data end, zero-use days included, and never the days after', () => {
    const start = home(2026, 10, 1);
    const dataEnd = home(2026, 10, 8);
    // HA rounds the request's end up to the bucket's end, so the data end's own day comes back too.
    const rows = dayRows(2026, 10, 1, [0.2, 0.1, 0, 0.3, 0.1, 0.1, 0.2, 9]);
    const view = assembleUtilityView('month', start, home(2026, 11, 1), dataEnd, IDS, [response(rows)]);

    const cold = view.meters.find(meter => meter.kind === 'cold_water');
    expect(cold?.bars.map(bar => bar.startMs)).toEqual(dayRows(2026, 10, 1, [0, 0, 0, 0, 0, 0, 0]).map(row => row.start));
    expect(cold?.bars[2].amount).toBe(0);
    expect(cold?.bars.at(-1)?.endMs).toBe(dataEnd);
    expect(cold?.bars.some(bar => bar.partial)).toBe(false);
    expect(cold?.amount).toBeCloseTo(1);
    expect(cold?.kr).toBeCloseTo(10);
    expect(view.kr).toBeCloseTo(30);
  });

  it('cuts last year at the same point, so an unfinished month compares like for like', () => {
    const dataEnd = home(2026, 10, 8);
    expect(yearEarlier('month', home(2026, 10, 1))).toBe(home(2025, 10, 1));
    expect(yearEarlier('month', dataEnd)).toBe(home(2025, 10, 8));

    const now = assembleUtilityView('month', home(2026, 10, 1), home(2026, 11, 1), dataEnd, IDS, [
      response(dayRows(2026, 10, 1, [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])),
    ]);
    const lastOctober = dayRows(
      2025,
      10,
      1,
      Array.from({ length: 31 }, () => 0.2)
    );
    const before = assembleUtilityView('month', home(2025, 10, 1), home(2025, 11, 1), home(2025, 10, 8), IDS, [response(lastOctober)]);

    expect(before.meters[0].bars).toHaveLength(7);
    expect(changePct(utilityTotal(now, 'cold_water', 'amount'), utilityTotal(before, 'cold_water', 'amount'))).toBe(-50);
    expect(changePct(now.kr, utilityKr(before))).toBe(-50);
  });

  it('keeps weekdays together when a week looks a year back', () => {
    const monday = home(2026, 10, 5);
    expect(yearEarlier('week', monday)).toBe(home(2025, 10, 6));
    expect(new Date(yearEarlier('week', monday) + 12 * 3_600_000).getUTCDay()).toBe(1);
  });

  it('reads an unfinished month of a year view by day, not as HA whole month', () => {
    const start = home(2025, 12, 1);
    const dataEnd = home(2026, 10, 8);
    expect(utilityStatsWindows('year', start, dataEnd)).toEqual([
      { startMs: start, endMs: home(2026, 10, 1), bucket: 'month' },
      { startMs: home(2026, 10, 1), endMs: dataEnd, bucket: 'day' },
    ]);

    // HA answers the month request through the whole of October, and the day request through 8 October.
    const months = monthRows(2025, 12, [5, 4, 4, 5, 5, 3, 6, 5, 5, 4, 4.4]);
    const days = dayRows(2026, 10, 1, [0.2, 0.2, 0.2, 0.3, 0.1, 0.1, 0.1, 0.4]);
    const view = assembleUtilityView('year', start, home(2026, 12, 1), dataEnd, IDS, [response(months), response(days)]);
    const bars = view.meters[0].bars;

    expect(bars).toHaveLength(11);
    expect(bars.at(-1)?.startMs).toBe(home(2026, 10, 1));
    expect(bars.at(-1)?.amount).toBeCloseTo(1.2);
    expect(bars.at(-1)?.partial).toBe(true);
    expect(bars.slice(0, -1).every(bar => !bar.partial)).toBe(true);
    expect(view.meters[0].amount).toBeCloseTo(47.2);
  });

  it('asks for nothing when the period starts at the data end', () => {
    expect(utilityStatsWindows('week', home(2026, 10, 12), home(2026, 10, 12))).toEqual([]);
  });
});

describe('accounting years', () => {
  it('starts the year on 1 December', () => {
    expect(UTILITY_CALENDAR.startOf('year', home(2026, 11, 30, 23, 59))).toBe(home(2025, 12, 1));
    expect(UTILITY_CALENDAR.startOf('year', home(2026, 12, 1))).toBe(home(2026, 12, 1));
    expect(UTILITY_CALENDAR.startOf('year', home(2026, 1, 15))).toBe(home(2025, 12, 1));
    expect(UTILITY_CALENDAR.step('year', home(2025, 12, 1), 1)).toBe(home(2026, 12, 1));
    expect(UTILITY_CALENDAR.step('year', home(2025, 12, 1), -1)).toBe(home(2024, 12, 1));
    expect(yearEarlier('year', home(2025, 12, 1))).toBe(home(2024, 12, 1));
  });

  it('keeps the other periods on the house calendar', () => {
    expect(UTILITY_CALENDAR.startOf('month', home(2026, 10, 15, 12))).toBe(home(2026, 10, 1));
    expect(UTILITY_CALENDAR.startOf('week', home(2026, 10, 7, 12))).toBe(home(2026, 10, 5));
    expect(UTILITY_CALENDAR.startOf('day', home(2026, 10, 7, 12))).toBe(home(2026, 10, 7));
  });

  it('splits a settled year into December to November and leaves the next year out', () => {
    const start = home(2024, 12, 1);
    const end = home(2025, 12, 1);
    expect(utilityStatsWindows('year', start, end)).toEqual([{ startMs: start, endMs: end, bucket: 'month' }]);

    // HA rounds the end up, so December 2025 comes back as well.
    const rows = monthRows(2024, 12, [5.3, 5.0, 3.3, 4.9, 4.8, 5.8, 4.8, 5.6, 5.8, 5.2, 4.4, 3.9, 5.5]);
    const bars = assembleUtilityView('year', start, end, end, IDS, [response(rows)]).meters[0].bars;

    expect(bars).toHaveLength(12);
    expect(bars[0].startMs).toBe(home(2024, 12, 1));
    expect(bars[11].startMs).toBe(home(2025, 11, 1));
    expect(bars[11].endMs).toBe(end);
    expect(bars.some(bar => bar.partial)).toBe(false);
  });
});

describe('estimate marking', () => {
  it('marks a price as an estimate only when ista says so', () => {
    expect(utilityPrice('56.36', 'estimate')).toEqual({ kr: 56.36, estimate: true });
    expect(utilityPrice('92.39', 'settled')).toEqual({ kr: 92.39, estimate: false });
    expect(utilityPrice('1.031', undefined)).toEqual({ kr: 1.031, estimate: false });
  });

  it('has no price without a number', () => {
    expect(utilityPrice('unavailable', 'estimate')).toBeNull();
    expect(utilityPrice('', 'estimate')).toBeNull();
    expect(utilityPrice(undefined, undefined)).toBeNull();
  });
});

describe('statistic ids', () => {
  it('finds each meter and its cost statistic by suffix', () => {
    expect(IDS.cold_water).toEqual({ amount: 'ista_dk:1_cold_water', cost: 'ista_dk:1_cold_water_cost' });
    expect(IDS.hot_water?.amount).toBe('ista_dk:1_hot_water');
    expect(utilityStatIds(['ista_dk:1_heat'])).toEqual({ heat: { amount: 'ista_dk:1_heat', cost: null } });
  });
});

describe('comparison basis', () => {
  it('compares nothing against a year the history does not reach back to', () => {
    const start = home(2021, 12, 1);
    const lastYear = assembleUtilityView('year', start, home(2022, 12, 1), home(2022, 12, 1), IDS, [
      response(monthRows(2022, 1, [2.9, 2.9, 4.6, 4.2, 4.7, 4.6, 4.8, 4.6, 6, 3.8, 3.6])),
    ]);
    expect(utilityTotal(lastYear, 'cold_water', 'amount')).toBeNull();
    expect(utilityKr(lastYear)).toBeNull();
    expect(changePct(4, null)).toBeNull();
    expect(changePct(4, 0)).toBeNull();
    expect(changePct(4.4, 4)).toBe(10);
  });
});
