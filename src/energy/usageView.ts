/** Display helpers for the Energy page's Usage tab. Pure. */
import { PRICE_BANDS, type PriceBand } from './priceBands';
import type { EnergyBar, EnergyView, Period } from './types';

/** Rank of `value` among `values` by price, 1 = priciest; equal prices share the better rank. */
export function priceRank(values: readonly number[], value: number): number {
  return values.filter(other => other > value).length + 1;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "priciest hour", "cheapest hour", "5th priciest hour". */
export function rankLabel(rank: number, count: number, unit: string): string {
  if (count <= 1) return '';
  if (rank === 1) return `priciest ${unit}`;
  if (rank === count) return `cheapest ${unit}`;
  return `${ordinal(rank)} priciest ${unit}`;
}

export const PERIOD_UNIT: Record<Period, string> = { day: 'hour', week: 'day', month: 'day', year: 'month' };
export const PREVIOUS_PERIOD: Record<Period, string> = { day: 'yesterday', week: 'last week', month: 'last month', year: 'last year' };

/** What the previous period had used by the same point into it: whole bars before the cutoff and
 * the elapsed fraction of the bar it falls in. */
export function comparableTotal(previous: EnergyView, elapsedMs: number, unit: 'kwh' | 'kr'): number {
  const cutoff = previous.startMs + elapsedMs;
  let sum = 0;
  for (const bar of previous.bars) {
    const fraction = Math.min(1, Math.max(0, (cutoff - bar.startMs) / (bar.endMs - bar.startMs)));
    sum += (unit === 'kr' ? bar.costKr : bar.kWh) * fraction;
  }
  return sum;
}

/** Change against the previous period, in whole percent, compared like for like: an in-progress
 * period against the previous one cut at the same point. Null without a basis. */
export function changeVsPrevious(view: EnergyView, previous: EnergyView | null, nowMs: number, unit: 'kwh' | 'kr'): number | null {
  if (!previous || previous.bars.length === 0) return null;
  const elapsedMs = Math.min(nowMs, view.endMs) - view.startMs;
  if (elapsedMs <= 0) return null;
  const before = comparableTotal(previous, elapsedMs, unit);
  if (before <= 0) return null;
  const now = unit === 'kr' ? view.totals.costKr : view.totals.kWh;
  return Math.round(((now - before) / before) * 100);
}

/** Each band's share of the bars' kWh, 0..1; `unknown` bars count in no band. */
export function bandShares(bars: readonly EnergyBar[]): Record<(typeof PRICE_BANDS)[number], number> {
  const kWh: Record<PriceBand, number> = { cheap: 0, normal: 0, pricey: 0, expensive: 0, unknown: 0 };
  for (const bar of bars) kWh[bar.level] += bar.kWh;
  const total = PRICE_BANDS.reduce((sum, band) => sum + kWh[band], 0);
  const out = { cheap: 0, normal: 0, pricey: 0, expensive: 0 };
  if (total > 0) for (const band of PRICE_BANDS) out[band] = kWh[band] / total;
  return out;
}
