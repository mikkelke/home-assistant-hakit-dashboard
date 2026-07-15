/** Pure "Power" price-indicator / "Best time to run" advice assembly — no React, no clock reads;
 * every function takes explicit ms args, so it stays independently testable (mirrors
 * assemble.ts/bill.ts). Advises WHEN (today during the day, vs overnight) a housemate should start
 * an appliance, and how many hours to dial into its physical delay-start knob to land there. */
import { PRICE_ADVICE } from '../config/energy';
import { priceLevel } from './assemble';
import type { RawTodayPoint } from './assemble';

const HOUR_MS = 3_600_000;

/** One hour's price, ms-keyed — the Power Advisor's own timeline point (mirrors `PricePoint` in
 * types.ts, kept separate since this timeline always starts at the CURRENT hour, never a day/period
 * boundary, and only ever looks forward). `estimated` is set only for an hour filled in from the
 * Carnot `forecast` attribute rather than settled/near-settled price data. */
export interface PricePointMs {
  ms: number;
  price: number;
  estimated?: true;
}

/** Merges `raw_today`/`raw_tomorrow` (the live price entity's own hourly point arrays) and that same
 * entity's `forecast` attribute (Carnot's own hourly predictions, days ahead — same `{hour, price}`
 * shape) into one sorted, forward-looking timeline: every hour from the current one (floor of
 * `nowMs`) through the end of whatever data is available. `raw_tomorrow` is only trustworthy once
 * `tomorrowValid` — before that it can still be yesterday's stale carry-over, worse than not having
 * it at all, so it's dropped entirely rather than risk pricing a window off a stale hour. `forecast`
 * only ever fills hours neither `raw_today` nor a valid `raw_tomorrow` already covers — real,
 * settled-or-near-settled data always wins over a prediction for the same hour — and every hour it
 * fills is marked `estimated`, so the UI can flag whichever windows lean on it (better than nothing,
 * but not a firm price). Hours already in the past (before the current one) are dropped too —
 * nothing here should ever suggest starting an appliance in the past. Skips any point whose hour or
 * price fails to parse to a finite number — external attribute data, never trusted blind (mirrors
 * `assemblePriceSeries`'s own `Date.parse` guard). */
export function buildPriceTimeline(
  rawToday: RawTodayPoint[] | null,
  rawTomorrow: RawTodayPoint[] | null,
  tomorrowValid: boolean,
  forecast: RawTodayPoint[] | null,
  nowMs: number
): PricePointMs[] {
  const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const byMs = new Map<number, PricePointMs>();

  const addPoints = (points: RawTodayPoint[] | null, estimated: boolean) => {
    for (const point of points ?? []) {
      const ms = Date.parse(point.hour);
      if (!Number.isFinite(ms) || !Number.isFinite(point.price) || ms < currentHourStartMs) continue;
      if (estimated && byMs.has(ms)) continue; // real data (added first, below) always wins over a forecast hour
      byMs.set(ms, estimated ? { ms, price: point.price, estimated: true } : { ms, price: point.price });
    }
  };

  addPoints(rawToday, false);
  if (tomorrowValid) addPoints(rawTomorrow, false);
  addPoints(forecast, true);

  return Array.from(byMs.values()).sort((a, b) => a.ms - b.ms);
}

export interface PriceWindow {
  startMs: number;
  avgPrice: number;
  /** True when at least one of this window's hours came from the Carnot forecast rather than
   * settled/near-settled data (see `PricePointMs.estimated`) — the UI marks the window's cost as an
   * estimate rather than implying it's as firm as a real-data window. */
  usesForecast: boolean;
}

/** Cheapest `durationHours`-long run starting on an hour boundary within [earliestStartMs,
 * latestStartMs] (inclusive both ends) — ties keep the earliest start, so a genuinely flat price
 * stretch never nudges the suggestion later than it needs to be. A candidate start only counts when
 * the timeline has a point — real OR forecast-estimated, `buildPriceTimeline` marks which — for EVERY
 * one of its `durationHours` hours: a data gap (or the search simply running off the end of what's
 * known) must never silently shrink the averaging window, which would understate — or overstate —
 * that window's true cost in a way the UI can't detect. `usesForecast` is true whenever any one of
 * the winning window's hours leaned on the forecast. Returns null when no candidate start has full
 * coverage (including whenever `earliestStartMs > latestStartMs`, i.e. an empty search range). */
export function cheapestWindow(
  timeline: PricePointMs[],
  durationHours: number,
  earliestStartMs: number,
  latestStartMs: number
): PriceWindow | null {
  if (durationHours <= 0) return null;
  const pointByMs = new Map(timeline.map(point => [point.ms, point]));

  let best: PriceWindow | null = null;
  for (let startMs = earliestStartMs; startMs <= latestStartMs; startMs += HOUR_MS) {
    let sum = 0;
    let coversAllHours = true;
    let usesForecast = false;
    for (let hour = 0; hour < durationHours; hour++) {
      const point = pointByMs.get(startMs + hour * HOUR_MS);
      if (point == null) {
        coversAllHours = false;
        break;
      }
      sum += point.price;
      if (point.estimated) usesForecast = true;
    }
    if (!coversAllHours) continue;

    const avgPrice = sum / durationHours;
    if (!best || avgPrice < best.avgPrice) best = { startMs, avgPrice, usesForecast };
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
   * could still be beaten by an early-morning hour that simply isn't known (or predicted) yet.
   * Computed from the caller's merged `timeline`, so the Carnot `forecast` folded in there (see
   * `buildPriceTimeline`) can complete this horizon early, before `raw_tomorrow` itself even lands. */
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
