import { homeWallTimeToMs } from '../homeTime';
import type { PricePointMs } from '../priceTimeline';
import { buildHourlyPrices } from '../priceTimeline';
import { parseRunProfiles, type RunProfileProgramme } from '../runProfiles';
import prices from './fixtures/prices-2026-10.json';
import entity from './fixtures/run-profiles.json';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/** Epoch ms of a Europe/Copenhagen wall clock reading. */
export function home(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return homeWallTimeToMs(year, month, day, hour, minute) + second * 1000;
}

export function fixtureTimeline(...days: (keyof typeof prices)[]): PricePointMs[] {
  return buildHourlyPrices(
    days.flatMap(day => prices[day]),
    null,
    false,
    null
  );
}

export function fixtureProgramme(appliance: 'washer' | 'dishwasher' | 'dryer'): RunProfileProgramme {
  const result = parseRunProfiles(entity.attributes);
  if (!result.ok) throw new Error(result.error);
  return result.profiles.appliances[appliance][0];
}

/** A programme from Wh per minute. */
export function programme(whPerMin: number[], completionMin = whPerMin.length): RunProfileProgramme {
  const result = parseRunProfiles({
    schema: 1,
    appliances: {
      test: {
        programmes: [{ key: 't', label: 'T', n: 5, completion_min: completionMin, p: whPerMin.map(wh => Math.round(wh * 10)).join(',') }],
      },
    },
  });
  if (!result.ok) throw new Error(result.error);
  return result.profiles.appliances.test[0];
}

/** Consecutive hourly points from `startMs`; null leaves the hour out. */
export function hourly(startMs: number, values: (number | null)[], estimated = false): PricePointMs[] {
  return values.flatMap((price, i) =>
    price == null ? [] : [estimated ? { ms: startMs + i * HOUR_MS, price, estimated: true as const } : { ms: startMs + i * HOUR_MS, price }]
  );
}
