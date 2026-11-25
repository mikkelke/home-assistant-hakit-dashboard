import { FAT_STAT, IMPEDANCE_STAT, LAST_MEASUREMENT_ENTITY, WEIGHT_STAT } from '../../src/body/weighings';
import type { HouseBuilder } from './builder';
import { DAY, HOUR, MINUTE, iso, rng } from './time';
import type { StatSource } from './types';

/** `years`: eight years of readings with a high every late summer and a long fall since February. `steady`: fifteen
 * months that ended flat. `weeks`: three weeks, too little for most of the page. */
export type BodyScenario = 'years' | 'steady' | 'weeks';

type Anchor = readonly [date: string, kg: number];

/** Where the weight would be without the daily noise: straight lines between these dates. */
const YEARS: Anchor[] = [
  ['2018-05-14', 86.0],
  ['2018-08-06', 88.6],
  ['2019-01-22', 85.2],
  ['2019-08-04', 90.1],
  ['2020-03-02', 86.6],
  ['2020-08-09', 89.8],
  ['2020-11-01', 88.9],
  ['2021-03-10', 86.0],
  ['2021-08-02', 89.3],
  ['2021-11-10', 87.0],
  ['2022-08-07', 92.4],
  ['2023-02-26', 88.4],
  ['2023-08-06', 91.0],
  ['2024-02-18', 87.8],
  ['2024-08-11', 90.6],
  ['2025-01-26', 88.1],
  ['2025-08-03', 91.8],
  ['2026-02-12', 93.9],
  ['2026-10-21', 86.9],
];

const STEADY: Anchor[] = [
  ['2025-07-08', 85.4],
  ['2025-11-04', 89.0],
  ['2026-02-10', 85.2],
  ['2026-05-20', 87.6],
  ['2026-10-21', 86.4],
];

/** From Sunday: a little heavier at the start of the week, lighter in the middle of it. */
const WEEKDAY = [0.25, 0.35, 0, -0.12, -0.12, -0.1, 0];

interface Reading {
  ts: number;
  kg: number;
  fat: number;
}

const tenth = (value: number) => Math.round(value * 10) / 10;

function levelAt(anchors: readonly Anchor[]): (ms: number) => number {
  const points = anchors.map(([date, kg]) => [Date.parse(`${date}T00:00:00Z`), kg] as const);
  return ms => {
    for (let i = 1; i < points.length; i += 1) {
      const [t0, k0] = points[i - 1];
      const [t1, k1] = points[i];
      if (ms <= t1) return k0 + ((k1 - k0) * Math.max(0, ms - t0)) / (t1 - t0);
    }
    return points[points.length - 1][1];
  };
}

interface Plan {
  anchors: readonly Anchor[];
  /** The share of days with a reading. */
  chance: number;
  /** Days between the days that may have one. */
  step?: number;
  /** Nothing is measured from the first date up to the second. */
  gap?: readonly [string, string];
  seed: number;
}

/** Morning readings in the house's time zone, the last one this morning. */
function readings(now: number, { anchors, chance, step = 1, gap, seed }: Plan): Reading[] {
  const level = levelAt(anchors);
  const next = rng(seed);
  const today = Math.floor(now / DAY) * DAY;
  const gapFrom = gap ? Date.parse(`${gap[0]}T00:00:00Z`) : Infinity;
  const gapTo = gap ? Date.parse(`${gap[1]}T00:00:00Z`) : Infinity;
  const out: Reading[] = [];
  for (let day = Date.parse(`${anchors[0][0]}T00:00:00Z`); day < today; day += step * DAY) {
    const roll = next();
    const ts = day + 5 * HOUR + next() * 150 * MINUTE;
    const noise = (next() + next() - 1) * 0.7;
    const fat = (next() - 0.5) * 0.8;
    if (roll > chance || (day >= gapFrom && day < gapTo)) continue;
    const kg = level(ts) + WEEKDAY[new Date(ts).getUTCDay()] + noise;
    out.push({ ts, kg: tenth(kg), fat: tenth(21.5 + (kg - 88) * 0.45 + fat) });
  }
  const ts = today + 5 * HOUR + 12 * MINUTE;
  const kg = level(ts) + 0.4;
  out.push({ ts, kg: tenth(kg), fat: tenth(21.5 + (kg - 88) * 0.45) });
  return out;
}

const PLANS: Record<BodyScenario, (now: number) => Plan> = {
  years: () => ({ anchors: YEARS, chance: 0.34, gap: ['2020-11-02', '2021-01-24'], seed: 11 }),
  steady: () => ({ anchors: STEADY, chance: 0.5, seed: 23 }),
  weeks: now => ({
    anchors: [
      [iso(now - 20 * DAY).slice(0, 10), 88.4],
      [iso(now).slice(0, 10), 88.0],
    ],
    chance: 1,
    step: 2,
    seed: 5,
  }),
};

/** One imported-style row per reading: the hour it was made, with the value as mean, min and max. */
function rows(values: ReadonlyArray<readonly [number, number]>): StatSource {
  const byHour = new Map(values.map(([ts, value]) => [Math.floor(ts / HOUR) * HOUR, value]));
  return start => {
    const value = byHour.get(start);
    return value === undefined ? null : { mean: value, min: value, max: value };
  };
}

/** The scale's sensors and their statistics, with made-up readings. */
export function addBody(h: HouseBuilder, scenario: BodyScenario): void {
  const list = readings(h.now, PLANS[scenario](h.now));
  const last = list[list.length - 1];
  const ago = Math.round((h.now - last.ts) / MINUTE);
  h.statistics[WEIGHT_STAT] = rows(list.map(r => [r.ts, r.kg]));
  h.statistics[FAT_STAT] = rows(list.map(r => [r.ts, r.fat]));
  h.put(WEIGHT_STAT, last.kg, { friendly_name: 'Weight', unit_of_measurement: 'kg', state_class: 'measurement' }, { ago });
  h.put(FAT_STAT, last.fat, { friendly_name: 'Body fat', unit_of_measurement: '%', state_class: 'measurement' }, { ago });
  h.put(IMPEDANCE_STAT, 470, { friendly_name: 'Impedance', unit_of_measurement: 'Ω', state_class: 'measurement' }, { ago });
  h.put(LAST_MEASUREMENT_ENTITY, iso(last.ts), { friendly_name: 'Last measurement', device_class: 'timestamp' }, { ago });
}
