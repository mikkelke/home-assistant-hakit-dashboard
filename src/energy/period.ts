/** Pure period math — every function takes explicit ms args, never reads the clock itself. */
import type { Period } from './types';

/** Local-midnight of the day containing `ms`, via component construction (DST-safe). */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** `ms` shifted by `n` calendar days, via component construction (DST-safe: never a fixed 24h offset). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Whole hours spanned by [startMs, endMs) — 23/24/25 on DST transition days, never hardcoded. */
export function hoursInRange(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 3_600_000);
}

export function dayTitle(anchorMs: number, todayStartMs: number): string {
  const anchorStartMs = startOfLocalDay(anchorMs);
  if (anchorStartMs === todayStartMs) return 'Today';
  if (anchorStartMs === addDays(todayStartMs, -1)) return 'Yesterday';
  return new Date(anchorMs).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Local Monday-start of the week containing `ms` — `(getDay() + 6) % 7` days back from local midnight. */
export function startOfLocalWeek(ms: number): number {
  const dayStart = startOfLocalDay(ms);
  const daysBack = (new Date(dayStart).getDay() + 6) % 7;
  return addDays(dayStart, -daysBack);
}

/** Local midnight of the 1st of the month containing `ms`. */
export function startOfLocalMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local midnight of Jan 1st of the year containing `ms`. */
export function startOfLocalYear(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), 0, 1).getTime();
}

/** `ms` shifted by `n` calendar months, normalized to the 1st — component construction so a
 * short target month (e.g. Jan 31 + 1 month) lands on Feb 1 rather than rolling into March. */
export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

/** `ms` shifted by `n` calendar years, via component construction (DST-safe). */
export function addYears(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear() + n, d.getMonth(), d.getDate()).getTime();
}

/** Local start-of-period containing `ms`, dispatched by period kind. */
export function startOfPeriod(period: Period, ms: number): number {
  switch (period) {
    case 'day':
      return startOfLocalDay(ms);
    case 'week':
      return startOfLocalWeek(ms);
    case 'month':
      return startOfLocalMonth(ms);
    case 'year':
      return startOfLocalYear(ms);
  }
}

/** [startMs, endMs) for one period beginning at `anchorStartMs` — all via component
 * construction (DST-safe), never a fixed-duration offset. */
export function rangeFor(period: Period, anchorStartMs: number): { startMs: number; endMs: number } {
  switch (period) {
    case 'day':
      return { startMs: anchorStartMs, endMs: addDays(anchorStartMs, 1) };
    case 'week':
      return { startMs: anchorStartMs, endMs: addDays(anchorStartMs, 7) };
    case 'month':
      return { startMs: anchorStartMs, endMs: addMonths(anchorStartMs, 1) };
    case 'year':
      return { startMs: anchorStartMs, endMs: addYears(anchorStartMs, 1) };
  }
}

/** Step the anchor one period forward/back. */
export function stepAnchor(period: Period, anchorStartMs: number, delta: 1 | -1): number {
  switch (period) {
    case 'day':
      return addDays(anchorStartMs, delta);
    case 'week':
      return addDays(anchorStartMs, 7 * delta);
    case 'month':
      return addMonths(anchorStartMs, delta);
    case 'year':
      return addYears(anchorStartMs, delta);
  }
}

/** True once the period's own range already reaches `nowMs` (it's the in-progress period),
 * meaning there's no further "next" period to step to yet. */
export function nextDisabled(period: Period, anchorStartMs: number, nowMs: number): boolean {
  return rangeFor(period, anchorStartMs).endMs > nowMs;
}

/** True once a period is BOTH fully closed (its own range has already ended) AND older than the
 * immediately-previous period — i.e. it can no longer be revised by a late-arriving recorder
 * write and is safe to cache indefinitely (see cache.ts). The current period and the immediately
 * previous one always revalidate on every fetch; anything older than that is immutable. */
export function isImmutablePeriod(period: Period, anchorStartMs: number, endMs: number, nowMs: number): boolean {
  const previousPeriodStartMs = stepAnchor(period, startOfPeriod(period, nowMs), -1);
  return endMs <= nowMs && anchorStartMs < previousPeriodStartMs;
}

/** ISO 8601 week number (Monday-start weeks; week 1 is the week containing the year's first
 * Thursday). Calendar dates are extracted as local y/m/d, then walked in UTC so the day-count
 * division below is never perturbed by local DST offsets. */
export function isoWeekNumber(ms: number): number {
  const d = new Date(ms);
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1; // Monday=1 .. Sunday=7
  date.setUTCDate(date.getUTCDate() + 4 - isoWeekday); // shift to this week's Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((Math.round((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

/** "13" — bare day-of-month, browser-default locale (see `toLocaleDateString(undefined, …)` convention). */
function formatDayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric' });
}

/** "19 Jul" — day-of-month plus abbreviated month, browser-default locale. */
function formatDayMonthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Header label for the visible period, browser-default locale. */
export function labelFor(period: Period, anchorStartMs: number, todayStartMs: number): string {
  switch (period) {
    case 'day':
      return dayTitle(anchorStartMs, todayStartMs);
    case 'week': {
      const { startMs, endMs } = rangeFor('week', anchorStartMs);
      const lastDayMs = addDays(endMs, -1); // endMs is exclusive; last visible day is one before it
      const startDate = new Date(startMs);
      const lastDate = new Date(lastDayMs);
      const sameMonth = startDate.getFullYear() === lastDate.getFullYear() && startDate.getMonth() === lastDate.getMonth();
      const startLabel = sameMonth ? formatDayLabel(startMs) : formatDayMonthLabel(startMs);
      const endLabel = formatDayMonthLabel(lastDayMs);
      return `Week ${isoWeekNumber(anchorStartMs)} · ${startLabel}–${endLabel}`;
    }
    case 'month':
      return new Date(anchorStartMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    case 'year':
      return String(new Date(anchorStartMs).getFullYear());
  }
}

/** Statistics bucket granularity to request for a period — period.ts owns this so useEnergyView
 * doesn't need its own copy of the period → bucket mapping. */
export function bucketPeriodFor(period: Period): 'hour' | 'day' | 'month' {
  switch (period) {
    case 'day':
      return 'hour';
    case 'week':
    case 'month':
      return 'day';
    case 'year':
      return 'month';
  }
}

/** Whole local calendar days between `rangeStartMs` and `ms`. UTC-anchored on the extracted
 * local y/m/d components (same trick as `isoWeekNumber`) so the division is never perturbed by
 * a DST transition falling inside the range. */
export function localDayIndex(rangeStartMs: number, ms: number): number {
  const start = new Date(rangeStartMs);
  const point = new Date(ms);
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const pointUtc = Date.UTC(point.getFullYear(), point.getMonth(), point.getDate());
  return Math.round((pointUtc - startUtc) / 86_400_000);
}

/** Whole calendar months between `rangeStartMs` and `ms`. */
export function localMonthIndex(rangeStartMs: number, ms: number): number {
  const start = new Date(rangeStartMs);
  const point = new Date(ms);
  return (point.getFullYear() - start.getFullYear()) * 12 + (point.getMonth() - start.getMonth());
}

/** Number of chart slots spanning a period's visible range — day buckets by hour (23–25 on DST
 * days), week always 7, month by its actual day count, year always 12. Never derived from the
 * fetched bar count: absent buckets (DST gaps, months before Dec 2025) must not shrink the axis. */
export function slotsInRange(period: Period, startMs: number, endMs: number): number {
  switch (period) {
    case 'day':
      return hoursInRange(startMs, endMs);
    case 'week':
      return 7;
    case 'month':
      return localDayIndex(startMs, endMs);
    case 'year':
      return 12;
  }
}
