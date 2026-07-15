/** Pure "Power" strip / "Best time to run" advice assembly — no React, no clock reads; every
 * function takes explicit ms args, so it stays independently testable (mirrors assemble.ts/bill.ts).
 * Advises WHEN (today during the day, vs overnight) a housemate should start an appliance, and how
 * many hours to dial into its physical delay-start knob to land there. */
import { PRICE_ADVICE } from '../config/energy';
import { priceLevel } from './assemble';
import type { RawTodayPoint } from './assemble';

const HOUR_MS = 3_600_000;

/** One hour's price, ms-keyed — the Power Advisor's own timeline point (mirrors `PricePoint` in
 * types.ts, kept separate since this timeline always starts at the CURRENT hour, never a day/period
 * boundary, and only ever looks forward). */
export interface PricePointMs {
  ms: number;
  price: number;
}

/** Merges `raw_today`/`raw_tomorrow` (the live price entity's own hourly point arrays) into one
 * sorted, forward-looking timeline: every hour from the current one (floor of `nowMs`) through the
 * end of whatever data is available. `raw_tomorrow` is only trustworthy once `tomorrowValid` — before
 * that it can still be yesterday's stale carry-over, worse than not having it at all, so it's
 * dropped entirely rather than risk pricing a window off a stale hour. Hours already in the past
 * (before the current one) are dropped too — nothing here should ever suggest starting an appliance
 * in the past. Skips any point whose hour or price fails to parse to a finite number — external
 * attribute data, never trusted blind (mirrors `assemblePriceSeries`'s own `Date.parse` guard). */
export function buildPriceTimeline(
  rawToday: RawTodayPoint[] | null,
  rawTomorrow: RawTodayPoint[] | null,
  tomorrowValid: boolean,
  nowMs: number
): PricePointMs[] {
  const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const byMs = new Map<number, number>();

  const addPoints = (points: RawTodayPoint[] | null) => {
    for (const point of points ?? []) {
      const ms = Date.parse(point.hour);
      if (!Number.isFinite(ms) || !Number.isFinite(point.price) || ms < currentHourStartMs) continue;
      byMs.set(ms, point.price);
    }
  };

  addPoints(rawToday);
  if (tomorrowValid) addPoints(rawTomorrow);

  return Array.from(byMs, ([ms, price]) => ({ ms, price })).sort((a, b) => a.ms - b.ms);
}

export interface PriceWindow {
  startMs: number;
  avgPrice: number;
}

/** Cheapest `durationHours`-long run starting on an hour boundary within [earliestStartMs,
 * latestStartMs] (inclusive both ends) — ties keep the earliest start, so a genuinely flat price
 * stretch never nudges the suggestion later than it needs to be. A candidate start only counts when
 * the timeline has real data for EVERY one of its `durationHours` hours: a data gap (or the search
 * simply running off the end of what's known) must never silently shrink the averaging window, which
 * would understate — or overstate — that window's true cost in a way the UI can't detect. Returns
 * null when no candidate start has full coverage (including whenever `earliestStartMs >
 * latestStartMs`, i.e. an empty search range). */
export function cheapestWindow(
  timeline: PricePointMs[],
  durationHours: number,
  earliestStartMs: number,
  latestStartMs: number
): PriceWindow | null {
  if (durationHours <= 0) return null;
  const priceByMs = new Map(timeline.map(point => [point.ms, point.price]));

  let best: PriceWindow | null = null;
  for (let startMs = earliestStartMs; startMs <= latestStartMs; startMs += HOUR_MS) {
    let sum = 0;
    let coversAllHours = true;
    for (let hour = 0; hour < durationHours; hour++) {
      const price = priceByMs.get(startMs + hour * HOUR_MS);
      if (price == null) {
        coversAllHours = false;
        break;
      }
      sum += price;
    }
    if (!coversAllHours) continue;

    const avgPrice = sum / durationHours;
    if (!best || avgPrice < best.avgPrice) best = { startMs, avgPrice };
  }
  return best;
}

/** First hour-start strictly after `nowMs` where `priceLevel()` differs from the current hour's —
 * i.e. when the "cheap"/"normal"/"expensive" word on the strip stops being true. Null both when the
 * band never changes across the rest of the known timeline, and when the current hour itself isn't
 * in the timeline (nothing to compare later hours against). Relies on `buildPriceTimeline`'s own
 * contract that its first point, if any, IS the current hour. */
export function currentBandEndMs(timeline: PricePointMs[], nowMs: number): number | null {
  const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  if (timeline.length === 0 || timeline[0].ms !== currentHourStartMs) return null;

  const currentLevel = priceLevel(timeline[0].price);
  const changed = timeline.find(point => point.ms > currentHourStartMs && priceLevel(point.price) !== currentLevel);
  return changed?.ms ?? null;
}

export interface ApplianceAdvice {
  /** The window starting right now — the "run it immediately" baseline every other option is judged
   * against. Null only when the current hour's own price isn't in the timeline. */
  nowWindow: PriceWindow | null;
  /** Best start left today, during the day — always searched from the current hour forward, so once
   * `nowMs` is already past `dayEndHour` this naturally comes back null (there's no "today, daytime"
   * left to suggest) rather than needing a separate special case. */
  bestDay: PriceWindow | null;
  /** Best start in the overnight window (today's `nightStartHour` through tomorrow's `nightEndHour`).
   * Clamped to start no earlier than the current hour too — once it's already past `nightStartHour`,
   * a candidate at the nominal night-start hour would be a moment that's already elapsed, and this
   * function must never suggest starting in the past. */
  bestNight: PriceWindow | null;
  /** False while the overnight search is missing part of its own range — `raw_tomorrow` only lands
   * around 13:20–13:35, so any `bestNight` found before then is drawn from a truncated search and
   * could still be beaten by an early-morning hour that simply isn't known yet. */
  nightHorizonComplete: boolean;
}

/** Assembles one appliance's "run it now vs today vs overnight" advice from the shared timeline —
 * the three windows a "Best time to run" row needs, each a `durationHours`-long run. */
export function adviseAppliance(timeline: PricePointMs[], nowMs: number, durationHours: number): ApplianceAdvice {
  const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const nowWindow = cheapestWindow(timeline, durationHours, currentHourStartMs, currentHourStartMs);

  // Local wall-clock hours via component Date construction (render-pure — same convention as
  // utils/format.ts's hourRangeLabel and period.ts's addDays).
  const nowDate = new Date(nowMs);
  const dayEndMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), PRICE_ADVICE.dayEndHour).getTime();
  const bestDay = cheapestWindow(timeline, durationHours, currentHourStartMs, dayEndMs - HOUR_MS);

  const todayNightStartMs = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), PRICE_ADVICE.nightStartHour).getTime();
  const tomorrowNightEndMs = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate() + 1,
    PRICE_ADVICE.nightEndHour
  ).getTime();
  const nightEarliestStartMs = Math.max(currentHourStartMs, todayNightStartMs);
  const bestNight = cheapestWindow(timeline, durationHours, nightEarliestStartMs, tomorrowNightEndMs - HOUR_MS);

  const nightHorizonComplete = timeline.length > 0 && timeline[timeline.length - 1].ms >= tomorrowNightEndMs - HOUR_MS;

  return { nowWindow, bestDay, bestNight, nightHorizonComplete };
}

/** Whole hours from `nowMs` until `startMs`, rounded UP — the number a housemate dials into the
 * machine's physical delay-start knob. Ceil, not round or floor: arriving into a cheap window a few
 * minutes after it opens is harmless (the window stays cheap for its whole span), but the knob
 * landing even a few minutes EARLY would start the cycle in the still-expensive hour just before it
 * — so the delay must never round down past the window's actual start. */
export function delayHours(startMs: number, nowMs: number): number {
  return Math.ceil((startMs - nowMs) / HOUR_MS);
}
