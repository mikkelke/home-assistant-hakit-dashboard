/** Pure period math — every function takes explicit ms args, never reads the clock itself. */

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
  if (anchorStartMs === todayStartMs) return 'I dag';
  if (anchorStartMs === addDays(todayStartMs, -1)) return 'I går';
  return new Date(anchorMs).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
}
