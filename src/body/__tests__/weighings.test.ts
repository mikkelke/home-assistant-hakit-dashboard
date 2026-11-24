import { describe, expect, it } from 'vitest';
import type { StatisticValue } from '../../energy/types';
import { bodyModel, ownWeighings, trend, weighingsFromStatistics, withLiveReading, type Weighing } from '../weighings';

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 9, 31, 9);
const row = (ts: number, mean: number, min = mean, max = mean): StatisticValue => ({ start: ts, end: ts + H, mean, min, max });

describe('weighingsFromStatistics', () => {
  it('keeps every imported row and only the changed live hours', () => {
    const imported = [row(T0 - 30 * D, 74.0), row(T0 - 29 * D, 74.0)];
    const live = [row(T0, 72.6), row(T0 + H, 72.6), row(T0 + 2 * H, 72.9, 72.6, 73.5), row(T0 + 3 * H, 73.5)];
    const fat = [
      row(T0 - 30 * D, 20),
      row(T0 - 29 * D, 20.1),
      row(T0, 19.6),
      row(T0 + H, 19.6),
      row(T0 + 2 * H, 19.9, 19.6, 20.1),
      row(T0 + 3 * H, 20.1),
    ];
    const impedance = live.map(r => row(r.start, 480));
    const out = weighingsFromStatistics([...imported, ...live], fat, impedance);
    expect(out.map(w => [w.ts, w.kg, w.fatPct])).toEqual([
      [T0 - 30 * D, 74.0, 20],
      [T0 - 29 * D, 74.0, 20.1],
      [T0, 72.6, 19.6],
      [T0 + 2 * H, 73.5, 20.1],
    ]);
  });

  it('counts a live hour where only the body fat moved', () => {
    const w = [row(T0, 72), row(T0 + H, 72)];
    const f = [row(T0, 19), row(T0 + H, 19.2, 19, 19.4)];
    const out = weighingsFromStatistics(w, f, w);
    expect(out.map(x => x.fatPct)).toEqual([19, 19.4]);
  });
});

describe('withLiveReading', () => {
  const base: Weighing[] = [{ ts: T0, kg: 72, fatPct: 19 }];
  it('gives the latest hour its exact time', () => {
    expect(withLiveReading(base, { ts: T0 + 20 * 60_000, kg: 72, fatPct: 19 })[0].ts).toBe(T0 + 20 * 60_000);
  });
  it('appends a reading whose hour is not compiled yet', () => {
    expect(withLiveReading(base, { ts: T0 + 5 * H, kg: 71.8, fatPct: 19 })).toHaveLength(2);
  });
});

describe('ownWeighings', () => {
  it('drops readings without body fat and far from their neighbours', () => {
    const w: Weighing[] = [72, 72.4, 86.2, 72.1, 71.9].map((kg, i) => ({ ts: T0 + i * D, kg, fatPct: 19 }));
    w.push({ ts: T0 + 6 * D, kg: 72, fatPct: null });
    expect(ownWeighings(w).map(x => x.kg)).toEqual([72, 72.4, 72.1, 71.9]);
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

  it('reports deltas and a weekly rate from steady loss', () => {
    const w = Array.from({ length: 60 }, (_, i) => ({ ts: T0 + i * D, kg: 75 - i * 0.05, fatPct: 20 }));
    const m = bodyModel(w);
    expect(m.rateKgPerWeek).toBeCloseTo(-0.35, 2);
    expect(m.weightDeltas.map(d => d.key)).toEqual(['7d', '30d']);
    expect(m.weightDeltas[0].value).toBeLessThan(0);
  });
});
