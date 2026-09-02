/** Pure math for pricing one finished appliance run — no React, no clock reads; every function
 * takes explicit ms args (or nullable data), mirroring assemble.ts/bill.ts's purity conventions. */
import type { RawTodayPoint } from './assemble';
import type { StatisticValue } from './types';

const HOUR_MS = 3_600_000;

/** Sanity ceiling for a single kr/kWh reading. Real Danish retail prices don't get near this even
 * at worst-case ToU peak plus a spot spike — it exists purely to catch a glitched upstream value
 * (sensor.energi_data_service briefly published 109.57, an ~83x spike, on 2026-09-02) before it
 * reaches a displayed run cost. Mirrors the same-value ceiling added server-side that day in
 * washer_monitor.py and smart_cooling.py. */
const PRICE_SANITY_CEILING_KR = 15;

function isSanePrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price <= PRICE_SANITY_CEILING_KR;
}

/** Builds an epoch-hour-keyed price map spanning exactly the hours a finished run may need pricing
 * for. Precedence mirrors `assemblePriceSeries` in assemble.ts (LTS beats the live entity's raw
 * attributes, which is the settled-vs-provisional distinction), just built in the opposite
 * insertion order since here the settled source arrives second: (a) every raw point across
 * `rawPointArrays` (today + tomorrow) is set first — the loosest, most provisional source; (b) if
 * `currentPrice` is known, it fills the in-progress hour, but only if nothing already covers it; (c)
 * every long-term-statistics row with a non-null `state` then unconditionally overwrites — it's the
 * settled value once the recorder has compiled it, so it always wins regardless of what raw data
 * already claimed that hour. An implausible reading (see `isSanePrice`) is dropped at each source
 * rather than inserted, so a glitched upstream value degrades to "no price for this hour" (excluded
 * via `MIN_COVERAGE` below) instead of skewing the average. */
export function buildWindowPriceMap(
  priceRows: StatisticValue[] | null,
  rawPointArrays: Array<RawTodayPoint[] | null>,
  currentPrice: number | null,
  nowMs: number
): Map<number, number> {
  const priceByHourStart = new Map<number, number>();

  for (const points of rawPointArrays) {
    for (const point of points ?? []) {
      const ms = Date.parse(point.hour);
      if (Number.isFinite(ms) && isSanePrice(point.price)) priceByHourStart.set(ms, point.price);
    }
  }

  if (currentPrice != null && isSanePrice(currentPrice)) {
    const currentHourStartMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    if (!priceByHourStart.has(currentHourStartMs)) priceByHourStart.set(currentHourStartMs, currentPrice);
  }

  for (const row of priceRows ?? []) {
    if (row.state != null && isSanePrice(row.state)) priceByHourStart.set(row.start, row.state);
  }

  return priceByHourStart;
}

export interface RunCostEstimate {
  costKr: number;
  avgPriceKrPerKwh: number;
  coverage: number;
}

/** Below this fraction of the run's duration having a known price, the average would be built on
 * too little basis to present as a number — same "don't show a guess" stance as
 * `deviceCostExact`'s 10%-unpriced cutoff in assemble.ts, just phrased as the inverse (coverage). */
const MIN_COVERAGE = 0.9;

/** A run spanning more than this is almost certainly a bad timestamp (e.g. a stale `last_changed`
 * from before an HA restart), not a real appliance cycle — refuse to price it rather than produce a
 * misleading number. */
const MAX_RUN_HOURS = 48;

/** Prices a finished run by duration-weighting `priceByHourStart` across [startMs, endMs). Walks
 * whole epoch-hour buckets (DST-safe here: Denmark's UTC offset is always a whole number of hours,
 * so both recorder `row.start` values and Energi Data Service's hour timestamps land on exact
 * epoch-hour boundaries — there's no half-hour DST shift to misalign the buckets against), splitting
 * each bucket's overlap with the run between "priced" (a known rate) and merely "elapsed". Returns
 * null when the inputs aren't usable (non-finite times, a non-positive or implausibly long span,
 * negative energy) or when less than `MIN_COVERAGE` of the run's duration falls in priced hours. */
export function estimateRunCost(
  startMs: number,
  endMs: number,
  energyKwh: number,
  priceByHourStart: Map<number, number>
): RunCostEstimate | null {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(energyKwh)) return null;
  if (endMs <= startMs) return null;
  if (endMs - startMs > MAX_RUN_HOURS * HOUR_MS) return null;
  if (energyKwh < 0) return null;

  let totalMs = 0;
  let pricedMs = 0;
  let weightedPriceSum = 0;

  for (let bucketStartMs = Math.floor(startMs / HOUR_MS) * HOUR_MS; bucketStartMs < endMs; bucketStartMs += HOUR_MS) {
    const overlapMs = Math.min(endMs, bucketStartMs + HOUR_MS) - Math.max(startMs, bucketStartMs);
    totalMs += overlapMs;

    const price = priceByHourStart.get(bucketStartMs);
    if (price != null) {
      pricedMs += overlapMs;
      weightedPriceSum += price * overlapMs;
    }
  }

  const coverage = pricedMs / totalMs;
  if (coverage < MIN_COVERAGE) return null;

  const avgPriceKrPerKwh = weightedPriceSum / pricedMs;
  return { costKr: energyKwh * avgPriceKrPerKwh, avgPriceKrPerKwh, coverage };
}
