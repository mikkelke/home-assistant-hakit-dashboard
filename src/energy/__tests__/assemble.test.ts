import { describe, expect, it } from 'vitest';
import { applyBarBands } from '../assemble';
import type { EnergyBar, PriceSeries } from '../types';
import { home, HOUR_MS } from './testUtils';

function bar(startMs: number, price: number | null): EnergyBar {
  return { startMs, endMs: startMs + HOUR_MS, kWh: 1, costKr: price ?? 0, price, level: 'unknown' };
}

describe('applyBarBands', () => {
  it('bands day bars by their hour within the whole day, not only the hours with usage', () => {
    const day = home(2026, 10, 13);
    const points = Array.from({ length: 24 }, (_, h) => ({ ms: day + h * HOUR_MS, price: 1 + h / 10 }));
    const series: PriceSeries = { points, min: points[0], max: points[23], peakStartMs: 0, peakEndMs: 0 };
    const bars = [bar(day, 1), bar(day + 23 * HOUR_MS, 3.3), bar(day + 12 * HOUR_MS, null)];
    expect(applyBarBands('day', bars, series).map(b => b.level)).toEqual(['cheap', 'expensive', 'pricey']);
  });

  it('ranks week, month and year bars against each other by the price paid', () => {
    const bars = [bar(0, 2), bar(1, 1), bar(2, null), bar(3, 4), bar(4, 3)];
    expect(applyBarBands('month', bars, null).map(b => b.level)).toEqual(['normal', 'cheap', 'unknown', 'expensive', 'pricey']);
  });

  it('leaves day bars unknown without the full home day of prices, never ranking the rows it has', () => {
    const day = home(2026, 10, 13);
    const bars = [bar(day, 1), bar(day + HOUR_MS, 3)];
    expect(applyBarBands('day', bars, null).map(b => b.level)).toEqual(['unknown', 'unknown']);
    const points = Array.from({ length: 20 }, (_, h) => ({ ms: day + h * HOUR_MS, price: 1 + h / 10 }));
    const partial: PriceSeries = { points, min: points[0], max: points[19], peakStartMs: 0, peakEndMs: 0 };
    expect(applyBarBands('day', bars, partial).map(b => b.level)).toEqual(['unknown', 'unknown']);
  });
});
