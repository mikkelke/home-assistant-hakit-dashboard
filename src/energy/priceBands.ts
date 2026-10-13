/** Relative price bands: each hour ranked within its own home-time calendar day. Pure.
 *
 * Bands are computed on whole days before anything trims the timeline to "from now", so an hour's
 * band never depends on the time of day it is viewed. A day is ranked only when every one of its
 * hours (23, 24 or 25) has a price; otherwise its hours are `unknown`. Hours sharing a price share
 * the band of the cheapest position they occupy. A day whose prices are all equal is `normal`
 * throughout. Bands say nothing about kroner across days; plan decisions use kroner only. */
import { homeDayStartMs, nextHomeDayStartMs } from './homeTime';
import type { PricePointMs } from './priceTimeline';

const HOUR_MS = 3_600_000;

export const PRICE_BANDS = ['cheap', 'normal', 'pricey', 'expensive'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number] | 'unknown';

export const PRICE_BAND_LABEL: Record<PriceBand, string> = {
  cheap: 'cheap',
  normal: 'normal',
  pricey: 'pricey',
  expensive: 'expensive',
  unknown: 'unknown',
};

export interface BandedPricePoint extends PricePointMs {
  band: PriceBand;
}

/** Bands for every point in `timeline` (deduplicated by hour, first wins), sorted by time. */
export function assignPriceBands(timeline: readonly PricePointMs[]): BandedPricePoint[] {
  const byMs = new Map<number, PricePointMs>();
  for (const point of timeline) if (!byMs.has(point.ms)) byMs.set(point.ms, point);

  const days = new Map<number, PricePointMs[]>();
  for (const point of byMs.values()) {
    const dayStart = homeDayStartMs(point.ms);
    const list = days.get(dayStart);
    if (list) list.push(point);
    else days.set(dayStart, [point]);
  }

  const out: BandedPricePoint[] = [];
  for (const [dayStart, points] of days) {
    const expectedHours = Math.round((nextHomeDayStartMs(dayStart) - dayStart) / HOUR_MS);
    const bands = points.length === expectedHours ? rankBands(points.map(p => p.price)) : null;
    points.forEach((point, i) => out.push({ ...point, band: bands ? bands[i] : 'unknown' }));
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** Bands by rank among `values`, quarter by quarter; a null value is `unknown` and takes no part in
 * the ranking. Equal values share the band of the cheapest position they occupy; when every value
 * is equal they are all `normal`. */
export function rankBands(values: readonly (number | null)[]): PriceBand[] {
  const sorted = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  const allEqual = sorted.length > 0 && sorted[0] === sorted[sorted.length - 1];
  return values.map(value => {
    if (value == null) return 'unknown';
    if (allEqual) return 'normal';
    return PRICE_BANDS[Math.floor((PRICE_BANDS.length * lowerBound(sorted, value)) / sorted.length)];
  });
}

function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function bandAt(banded: readonly BandedPricePoint[], ms: number): PriceBand {
  const hourMs = Math.floor(ms / HOUR_MS) * HOUR_MS;
  return banded.find(point => point.ms === hourMs)?.band ?? 'unknown';
}

/** First instant after `nowMs` at which the current hour's band is no longer known to hold: the
 * next hour with a different band, a missing hour, or the end of the data. Null when the current
 * hour's band is unknown. */
export function nextBandChangeMs(banded: readonly BandedPricePoint[], nowMs: number): number | null {
  const byMs = new Map(banded.map(point => [point.ms, point]));
  let hourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const band = byMs.get(hourMs)?.band ?? 'unknown';
  if (band === 'unknown') return null;
  while (byMs.get(hourMs + HOUR_MS)?.band === band) hourMs += HOUR_MS;
  return hourMs + HOUR_MS;
}
