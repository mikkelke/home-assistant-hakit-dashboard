import { describe, expect, it } from 'vitest';
import type { StatisticValue } from '../../energy/types';
import { bodyModel, ownWeighings, trend, weeklyRate, weighingsFromStatistics, withLiveReading, type Weighing } from '../weighings';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2025, 2, 12, 9);
const row = (ts: number, mean: number, min = mean, max = mean): StatisticValue => ({ start: ts, end: ts + H, mean, min, max });

describe('weighingsFromStatistics', () => {
  it('keeps every imported row and only the changed live hours', () => {
    const imported = [row(T0 - 30 * D, 81.0), row(T0 - 29 * D, 81.0)];
    const live = [row(T0, 79.4), row(T0 + H, 79.4), row(T0 + 2 * H, 79.8, 79.4, 80.4), row(T0 + 3 * H, 80.4)];
    const fat = [
      row(T0 - 30 * D, 22),
      row(T0 - 29 * D, 22.1),
      row(T0, 21.3),
      row(T0 + H, 21.3),
      row(T0 + 2 * H, 21.6, 21.3, 21.8),
      row(T0 + 3 * H, 21.8),
    ];
    const impedance = live.map(r => row(r.start, 480));
    const out = weighingsFromStatistics([...imported, ...live], fat, impedance);
    expect(out.map(w => [w.ts, w.kg, w.fatPct])).toEqual([
      [T0 - 30 * D, 81.0, 22],
      [T0 - 29 * D, 81.0, 22.1],
      [T0, 79.4, 21.3],
      [T0 + 2 * H, 80.4, 21.8],
    ]);
  });

  it('counts a live hour where only the body fat moved', () => {
    const w = [row(T0, 80), row(T0 + H, 80)];
    const f = [row(T0, 21), row(T0 + H, 21.2, 21, 21.4)];
    const out = weighingsFromStatistics(w, f, w);
    expect(out.map(x => x.fatPct)).toEqual([21, 21.4]);
  });
});

describe('withLiveReading', () => {
  const base: Weighing[] = [{ ts: T0, kg: 80, fatPct: 21 }];
  it('gives the latest hour its exact time', () => {
    expect(withLiveReading(base, { ts: T0 + 20 * 60_000, kg: 80, fatPct: 21 })[0].ts).toBe(T0 + 20 * 60_000);
  });
  it('appends a reading whose hour is not compiled yet', () => {
    expect(withLiveReading(base, { ts: T0 + 5 * H, kg: 79.8, fatPct: 21 })).toHaveLength(2);
  });
});

describe('ownWeighings', () => {
  it('drops readings without body fat and far from their neighbours', () => {
    const w: Weighing[] = [80, 80.4, 95.2, 80.1, 79.9].map((kg, i) => ({ ts: T0 + i * D, kg, fatPct: 21 }));
    w.push({ ts: T0 + 6 * D, kg: 80, fatPct: null });
    expect(ownWeighings(w).map(x => x.kg)).toEqual([80, 80.4, 80.1, 79.9]);
  });
});

describe('trend and model', () => {
  it('jumps to the next reading after a long gap', () => {
    const t = trend([
      { ts: 0, value: 80 },
      { ts: 400 * D, value: 70 },
    ]);
    expect(t[1].value).toBeCloseTo(70, 3);
  });

  it('measures a weekly rate from a steady loss', () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ ts: T0 + i * D, value: 75 - i * 0.05 }));
    expect(weeklyRate(points)).toBeCloseTo(-0.35, 2);
  });

  it('has no weekly rate from too little to go on', () => {
    expect(weeklyRate([])).toBeNull();
    expect(weeklyRate([0, 1, 2].map(i => ({ ts: T0 + i * D, value: 75 })))).toBeNull();
  });

  it('keeps the readings with their trend and the latest one', () => {
    const w: Weighing[] = [80, 79.5, 79].map((kg, i) => ({ ts: T0 + i * D, kg, fatPct: 21 }));
    const m = bodyModel(w);
    expect(m.latest).toBe(w[2]);
    expect(m.weightTrend).toHaveLength(3);
    expect(m.weightTrend[0].value).toBe(80);
  });
});
