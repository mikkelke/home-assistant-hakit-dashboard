/** Mikkel's weighings from the bathroom scale, rebuilt from long-term statistics.
 *
 * Imported Huawei Health history has one hourly row per weighing. Since the scale was connected to HA the sensors write
 * a row every hour, so a weighing there is an hour whose closing value differs from the hour before. The impedance
 * sensor only has live rows, which tells the two kinds of row apart. */
import type { StatisticValue } from '../energy/types';

export const WEIGHT_STAT = 'sensor.mikkel_weight';
export const FAT_STAT = 'sensor.mikkel_body_fat';
export const IMPEDANCE_STAT = 'sensor.mikkel_impedance';
export const LAST_MEASUREMENT_ENTITY = 'sensor.mikkel_last_measurement';
export const BODY_PERSON = 'person.mikkel';

export interface Weighing {
  ts: number;
  kg: number;
  fatPct: number | null;
}

const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** A trend segment across a longer gap than this is not drawn: nothing was measured in between. */
export const GAP_MS = 60 * DAY_MS;
/** A reading further than this from its neighbours' median is someone else on the scale. */
const STRANGER_KG = 4;
const NEIGHBOUR_WINDOW_MS = 30 * DAY_MS;
/** Time constant of the trend line. */
const TREND_TAU_MS = 7 * DAY_MS;

function startMs(row: StatisticValue): number {
  const raw = row.start as unknown;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  return new Date(String(raw)).getTime();
}

const num = (v: number | null | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The value an hour closed on: the side of the hour's range that differs from where the previous hour closed. */
function closingValue(row: StatisticValue, previous: number | null): number | null {
  const mean = num(row.mean);
  const min = num(row.min) ?? mean;
  const max = num(row.max) ?? mean;
  if (min == null || max == null) return mean;
  if (min === max) return min;
  if (previous === max) return min;
  if (previous === min) return max;
  return mean != null && Math.abs(mean - max) < Math.abs(mean - min) ? max : min;
}

interface Closing {
  ts: number;
  value: number;
  changed: boolean;
}

function closings(rows: readonly StatisticValue[]): Closing[] {
  const sorted = [...rows].sort((a, b) => startMs(a) - startMs(b));
  const out: Closing[] = [];
  let previous: number | null = null;
  for (const row of sorted) {
    const ts = startMs(row);
    const value = closingValue(row, previous);
    if (!Number.isFinite(ts) || value == null) continue;
    out.push({ ts, value, changed: value !== previous });
    previous = value;
  }
  return out;
}

/** One weighing per imported row and per live hour in which the weight or body fat changed. */
export function weighingsFromStatistics(
  weightRows: readonly StatisticValue[],
  fatRows: readonly StatisticValue[],
  impedanceRows: readonly StatisticValue[]
): Weighing[] {
  const live = new Set(impedanceRows.map(startMs));
  const fat = new Map(closings(fatRows).map(c => [c.ts, c]));
  const out: Weighing[] = [];
  for (const w of closings(weightRows)) {
    const f = fat.get(w.ts);
    if (live.has(w.ts) && !w.changed && !f?.changed) continue;
    out.push({ ts: w.ts, kg: w.value, fatPct: f ? f.value : null });
  }
  return out;
}

/** Adds the live reading when the statistics have not compiled its hour yet, and gives the latest hour its exact time. */
export function withLiveReading(weighings: Weighing[], live: Weighing | null): Weighing[] {
  if (!live) return weighings;
  const last = weighings[weighings.length - 1];
  if (last && live.ts >= last.ts && live.ts < last.ts + HOUR_MS) return [...weighings.slice(0, -1), { ...last, ts: live.ts }];
  if (!last || live.ts >= last.ts + HOUR_MS) return [...weighings, live];
  return weighings;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Drops readings with no body fat (the scale measured someone without a profile) and readings far from the
 * weighings around them. */
export function ownWeighings(weighings: readonly Weighing[]): Weighing[] {
  const withFat = weighings.filter(w => w.fatPct != null && w.fatPct > 0 && w.kg > 0);
  return withFat.filter((w, i) => {
    const near: number[] = [];
    for (let j = i - 1; j >= 0 && near.length < 3 && w.ts - withFat[j].ts <= NEIGHBOUR_WINDOW_MS; j--) near.push(withFat[j].kg);
    for (let j = i + 1, n = 0; j < withFat.length && n < 3 && withFat[j].ts - w.ts <= NEIGHBOUR_WINDOW_MS; j++, n++)
      near.push(withFat[j].kg);
    return near.length < 2 || Math.abs(w.kg - median(near)) <= STRANGER_KG;
  });
}

export interface TrendPoint {
  ts: number;
  value: number;
}

/** A time-aware exponential average: a long gap lets the trend jump to the next reading. */
export function trend(points: readonly { ts: number; value: number }[], tauMs = TREND_TAU_MS): TrendPoint[] {
  const out: TrendPoint[] = [];
  let value: number | null = null;
  let ts = 0;
  for (const p of points) {
    if (value == null) value = p.value;
    else value += (1 - Math.exp(-(p.ts - ts) / tauMs)) * (p.value - value);
    ts = p.ts;
    out.push({ ts, value });
  }
  return out;
}

/** Least-squares slope of the readings in the last `windowMs`, in units per week; null with too little to go on. */
export function weeklyRate(points: readonly { ts: number; value: number }[], windowMs = 28 * DAY_MS): number | null {
  if (points.length === 0) return null;
  const end = points[points.length - 1].ts;
  const recent = points.filter(p => p.ts >= end - windowMs);
  if (recent.length < 3 || end - recent[0].ts < 10 * DAY_MS) return null;
  const mx = recent.reduce((s, p) => s + p.ts, 0) / recent.length;
  const my = recent.reduce((s, p) => s + p.value, 0) / recent.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of recent) {
    sxy += (p.ts - mx) * (p.value - my);
    sxx += (p.ts - mx) ** 2;
  }
  return sxx > 0 ? (sxy / sxx) * 7 * DAY_MS : null;
}

export type BodyRange = '3m' | '1y' | 'all';

export const RANGE_MS: Record<Exclude<BodyRange, 'all'>, number> = {
  '3m': 92 * DAY_MS,
  '1y': 365 * DAY_MS,
};

/** The x-domain of a range: back from now, or from the first reading for all of it. */
export function rangeDomain(range: BodyRange, weighings: readonly Weighing[], nowMs: number): [number, number] {
  if (range === 'all') return [weighings[0]?.ts ?? nowMs - RANGE_MS['1y'], nowMs];
  return [nowMs - RANGE_MS[range], nowMs];
}

export interface BodyModel {
  weighings: Weighing[];
  weightTrend: TrendPoint[];
  latest: Weighing | null;
}

export function bodyModel(weighings: Weighing[]): BodyModel {
  return {
    weighings,
    weightTrend: trend(weighings.map(w => ({ ts: w.ts, value: w.kg }))),
    latest: weighings[weighings.length - 1] ?? null,
  };
}
