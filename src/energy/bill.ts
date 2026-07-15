/** Pure "Bill" assembly + day-ahead price forecast — no React, no clock reads; every
 * function takes explicit ms args, so it stays independently testable (mirrors assemble.ts). */
import { FIXED_FEES_EXCL_MOMS_KR_PER_MONTH, MOMS_FACTOR } from '../config/energy';
import { addDays, startOfLocalDay } from './period';
import type { RawTodayPoint } from './assemble';
import type { EnergyView } from './types';

const HOUR_MS = 3_600_000;

/** Full month's fixed subscription fees, VAT included — mirrors the Vindstød invoice's line
 * items (only the fees need ×VAT; HA's cost stat is already all-in on the variable side). */
export function monthlyFixedFeesInclMoms(): number {
  const exclMoms = Object.values(FIXED_FEES_EXCL_MOMS_KR_PER_MONTH).reduce<number>((sum, fee) => sum + fee, 0);
  return exclMoms * MOMS_FACTOR;
}

/** Days in the calendar month containing `dayStartMs` — component Date math (DST-safe: day 0 of
 * the following month is always the last day of this one, regardless of any DST shift inside it). */
function daysInMonthOf(dayStartMs: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Σ over each local calendar day in [startMs, endMs) of that day's share of the monthly fee
 * (monthlyFee ÷ days in ITS OWN month) — correct across a month boundary, and a full calendar
 * month sums back to exactly the monthly fee (dayCount × monthlyFee/dayCount). */
export function fixedFeesForRange(startMs: number, endMs: number): number {
  const monthlyFee = monthlyFixedFeesInclMoms();
  let total = 0;
  for (let day = startOfLocalDay(startMs); day < endMs; day = addDays(day, 1)) {
    total += monthlyFee / daysInMonthOf(day);
  }
  return total;
}

/** Same daily walk as `fixedFeesForRange`, but stops once it reaches a day that hasn't started yet
 * (a day counts once `nowMs` is past its local midnight) — the fee share accrued "to date" within
 * an in-progress period. Not wired into `assembleBill` (a bill always carries its full period's
 * fees — see there); exported for a future "to date" breakdown. */
export function proratedFeesToDate(startMs: number, endMs: number, nowMs: number): number {
  const monthlyFee = monthlyFixedFeesInclMoms();
  let total = 0;
  for (let day = startOfLocalDay(startMs); day < endMs && nowMs > day; day = addDays(day, 1)) {
    total += monthlyFee / daysInMonthOf(day);
  }
  return total;
}

export interface BillBreakdown {
  variableKr: number;
  feesKr: number;
  totalKr: number;
  projectedTotalKr: number | null;
}

/** Minimum elapsed fraction of the period before a "Projected" total is shown — earlier than
 * this, a straight-line projection would be extrapolating from noise. */
const MIN_PROJECTION_FRACTION = 0.02;

/** "Bill" for one view's period: exact variable cost (HA's own cost stat, already incl. VAT)
 * plus the period's full share of the fixed subscription fees — a bill is a period commitment, so
 * even a past, fully-settled period always carries its whole fees; that's what reconciles with the
 * actual invoice. The in-progress period additionally gets a simple, honestly-labelled ≈
 * projection: variable cost so far, straight-lined to the full period by its elapsed fraction, plus
 * the (already full) fees. */
export function assembleBill(view: EnergyView, nowMs: number): BillBreakdown {
  const variableKr = view.totals.costKr;
  const feesKr = fixedFeesForRange(view.startMs, view.endMs);
  const totalKr = variableKr + feesKr;

  let projectedTotalKr: number | null = null;
  if (view.startMs <= nowMs && nowMs < view.endMs) {
    const elapsedFraction = (nowMs - view.startMs) / (view.endMs - view.startMs);
    if (elapsedFraction >= MIN_PROJECTION_FRACTION) {
      projectedTotalKr = variableKr / elapsedFraction + feesKr;
    }
  }

  return { variableKr, feesKr, totalKr, projectedTotalKr };
}

/** One forecast hour's price, flagged by where it came from — `tomorrow` (the price entity's own
 * day-ahead `raw_tomorrow`, real settled-tomorrow prices, only once `tomorrow_valid`) or `carnot`
 * (the entity's longer, less certain `forecast` attribute) — so the UI can render forecast hours
 * visually distinct from the one real day-ahead source. */
export interface ForecastSeries {
  points: Array<{ ms: number; price: number; source: 'tomorrow' | 'carnot' }>;
  peakWindows: Array<{ startMs: number; endMs: number }>;
  outlook: DayOutlook[];
}

/** One extended-outlook day's price range, Carnot-only — no hourly detail this far out, just the
 * day's shape (mirrors what a week-ahead weather forecast shows: low/high, not an hourly curve). */
export interface DayOutlook {
  dayStartMs: number;
  minPrice: number;
  meanPrice: number;
  maxPrice: number;
  /** True only for a possible first entry whose day was already partway through when the near-term
   * hourly horizon ended — its range reflects just the leftover hours, not the whole day. */
  partial: boolean;
}

const MIN_FORECAST_POINTS = 6;
/** A day needs at least half its hours present in Carnot's `forecast` attribute to be summarized —
 * below that, it's the ragged tail end of Carnot's own horizon, not a real day. */
const MIN_OUTLOOK_DAY_COVERAGE_HOURS = 12;
/** Generous cap — Carnot's own horizon (~7 days from today) rarely reaches this once the near-term
 * hourly chart's own 2 days are excluded; it exists as a backstop, not a target to hit. */
const MAX_OUTLOOK_DAYS = 6;

/** ms of the next whole hour strictly after `ms` — the forecast starts here; the current/settled
 * hour is already shown by the day view's own price curve. */
function nextHourStartMs(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS + HOUR_MS;
}

/** Every 17:00–21:00 local window that intersects [horizonStartMs, horizonEndMs), one per local
 * calendar day the horizon touches — component Date math (DST-safe), mirrors
 * `assemblePriceSeries`'s single-day peak window in assemble.ts. */
function peakWindowsFor(horizonStartMs: number, horizonEndMs: number): Array<{ startMs: number; endMs: number }> {
  const windows: Array<{ startMs: number; endMs: number }> = [];
  for (let day = startOfLocalDay(horizonStartMs); day < horizonEndMs; day = addDays(day, 1)) {
    const d = new Date(day);
    const windowStartMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 17).getTime();
    const windowEndMs = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21).getTime();
    if (windowEndMs > horizonStartMs && windowStartMs < horizonEndMs) {
      windows.push({ startMs: windowStartMs, endMs: windowEndMs });
    }
  }
  return windows;
}

/** Daily min/mean/max summaries for the Carnot-only hours beyond the near-term hourly horizon (the
 * extended "This week" outlook) — the same already-fetched `forecast` attribute, just not
 * truncated at `horizonHours`. Excludes every hour `< horizonEndMs` (the hourly chart already shows
 * those, so never repeat one) and starts counting days from the calendar day that CONTAINS
 * `horizonEndMs` — that day's own leftover hours (e.g. Friday 08:00–24:00 when the 48h cutoff lands
 * mid-Friday) still form a real, if partial, day and must not be dropped, or that day's prices go
 * missing everywhere (neither the hourly chart nor the outlook shows them — a visible gap). Only
 * that first day is allowed to be partial; it's skipped (not treated as "Carnot ran out") if it has
 * too little leftover, but every day after it must be a genuinely full day or the loop stops. */
function outlookFor(carnotForecast: RawTodayPoint[] | null, horizonEndMs: number): DayOutlook[] {
  const pricesByDay = new Map<number, number[]>();
  for (const point of carnotForecast ?? []) {
    const ms = Date.parse(point.hour);
    if (Number.isNaN(ms) || ms < horizonEndMs) continue;
    const day = startOfLocalDay(ms);
    const prices = pricesByDay.get(day);
    if (prices) prices.push(point.price);
    else pricesByDay.set(day, [point.price]);
  }

  const outlook: DayOutlook[] = [];
  let day = startOfLocalDay(horizonEndMs);
  for (let i = 0; i < MAX_OUTLOOK_DAYS; i++, day = addDays(day, 1)) {
    const prices = pricesByDay.get(day);
    if (!prices || prices.length < MIN_OUTLOOK_DAY_COVERAGE_HOURS) {
      if (i === 0) continue; // this day's leftover is too thin a sliver to summarize — try the next
      break; // any later day is either whole or absent; absent means Carnot's horizon ended here
    }
    outlook.push({
      dayStartMs: day,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      meanPrice: prices.reduce((sum, price) => sum + price, 0) / prices.length,
      partial: prices.length < 24,
    });
  }
  return outlook;
}

/** Day-ahead price forecast for the "Price forecast" strip, assembled purely from the live price
 * entity's own attributes (no extra WS calls): `raw_tomorrow` (only once `tomorrowValid`) wins on
 * any hour it covers — it's the real day-ahead settlement — the Carnot `forecast` attribute fills
 * every other hour in the horizon. Returns null when there's too little to plot (<6 points): a
 * genuinely-empty state, never a zero-filled fake one. */
export function assembleForecast(
  rawTomorrow: RawTodayPoint[] | null,
  tomorrowValid: boolean,
  carnotForecast: RawTodayPoint[] | null,
  nowMs: number,
  horizonHours = 48
): ForecastSeries | null {
  const horizonStartMs = nextHourStartMs(nowMs);
  const horizonEndMs = nowMs + horizonHours * HOUR_MS;

  const byMs = new Map<number, { price: number; source: 'tomorrow' | 'carnot' }>();

  for (const point of carnotForecast ?? []) {
    const ms = Date.parse(point.hour);
    if (Number.isNaN(ms) || ms < horizonStartMs || ms >= horizonEndMs) continue;
    byMs.set(ms, { price: point.price, source: 'carnot' });
  }

  if (tomorrowValid) {
    for (const point of rawTomorrow ?? []) {
      const ms = Date.parse(point.hour);
      if (Number.isNaN(ms) || ms < horizonStartMs || ms >= horizonEndMs) continue;
      byMs.set(ms, { price: point.price, source: 'tomorrow' }); // real day-ahead wins on overlap
    }
  }

  const points = Array.from(byMs, ([ms, v]) => ({ ms, price: v.price, source: v.source })).sort((a, b) => a.ms - b.ms);
  if (points.length < MIN_FORECAST_POINTS) return null;

  return {
    points,
    peakWindows: peakWindowsFor(horizonStartMs, horizonEndMs),
    outlook: outlookFor(carnotForecast, horizonEndMs),
  };
}
