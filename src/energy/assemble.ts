/** Pure view-model assembly for the Energy page — no React, no clock reads; every function takes
 * explicit ms args (or nullable data), so it stays independently testable. */
import { PRICE_BAND_THRESHOLDS } from '../config/energy';
import { addDays } from './period';
import type { EnergyBar, Period, PricePoint, PriceSeries, StatisticValue } from './types';

/** One hour's raw all-in price, straight from the live price entity's `raw_today` attribute. */
export interface RawTodayPoint {
  hour: string;
  price: number;
}

/** Price band for coloring a bar. `PRICE_BAND_THRESHOLDS` are inclusive upper bounds: `low` stays
 * strictly below `lowMaxKrPerKWh`, `mid` reaches up to and including `midMaxKrPerKWh`. */
export function priceLevel(price: number | null): EnergyBar['level'] {
  if (price == null) return 'unknown';
  if (price < PRICE_BAND_THRESHOLDS.lowMaxKrPerKWh) return 'low';
  if (price <= PRICE_BAND_THRESHOLDS.midMaxKrPerKWh) return 'mid';
  return 'high';
}

/** Joins grid/cost/price statistic rows (by bucket-start ms) into chart-ready bars. Day-view
 * price prefers the price stat's own hourly `state`; week/month/year (and any day hour missing a
 * price row) fall back to the effective price cost÷kWh. A missing cost row (no cost stat
 * configured at all) falls back to kWh × the known price where one exists — a theoretical path in
 * this deployment (a cost stat always resolves), so it goes no further than that. */
export function assembleBars(
  period: Period,
  rangeStartMs: number,
  rangeEndMs: number,
  gridRows: StatisticValue[],
  costRows: StatisticValue[],
  priceRows: StatisticValue[] | null
): EnergyBar[] {
  const costByStart = new Map(costRows.map(row => [row.start, row]));
  const priceByStart = new Map((priceRows ?? []).map(row => [row.start, row]));

  return gridRows
    .filter(row => row.start >= rangeStartMs && row.start < rangeEndMs)
    .map(row => {
      const kWh = Math.max(0, row.change ?? 0);
      const costRow = costByStart.get(row.start);
      const ltsPrice = period === 'day' ? (priceByStart.get(row.start)?.state ?? null) : null;

      let costKr: number;
      let price: number | null;
      if (costRow) {
        costKr = Math.max(0, costRow.change ?? 0);
        price = ltsPrice ?? (kWh > 0 ? costKr / kWh : null);
      } else if (ltsPrice != null) {
        price = ltsPrice; // no cost stat configured — derive cost from kWh × the known price
        costKr = kWh * ltsPrice;
      } else {
        costKr = 0;
        price = null;
      }

      return { startMs: row.start, endMs: row.end, kWh, costKr, price, level: priceLevel(price) };
    });
}

/** Merges long-term-statistics hourly price rows with the live entity's `raw_today` (LTS wins on
 * overlap — it's the settled value), producing the day view's price curve. `nowMs`/`currentPrice`
 * only populate `now` when the anchor day is the day actually containing `nowMs`. */
export function assemblePriceSeries(
  anchorDayStartMs: number,
  priceRows: StatisticValue[],
  rawToday: RawTodayPoint[] | null,
  nowMs: number | null,
  currentPrice: number | null
): PriceSeries | null {
  const byMs = new Map<number, number>();

  for (const row of priceRows) {
    if (row.state != null) byMs.set(row.start, row.state);
  }
  for (const point of rawToday ?? []) {
    const ms = Date.parse(point.hour);
    if (!Number.isNaN(ms) && !byMs.has(ms)) byMs.set(ms, point.price);
  }

  const points: PricePoint[] = Array.from(byMs, ([ms, price]) => ({ ms, price })).sort((a, b) => a.ms - b.ms);
  if (points.length === 0) return null;

  const min = points.reduce((lowest, point) => (point.price < lowest.price ? point : lowest));
  const max = points.reduce((highest, point) => (point.price > highest.price ? point : highest));

  const anchor = new Date(anchorDayStartMs);
  const peakStartMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 17).getTime();
  const peakEndMs = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 21).getTime();

  const dayEndMs = addDays(anchorDayStartMs, 1);
  let now: { ms: number; price: number } | undefined;
  if (nowMs != null && currentPrice != null && nowMs >= anchorDayStartMs && nowMs < dayEndMs) {
    now = { ms: nowMs, price: currentPrice };
  }

  return { points, min, max, peakStartMs, peakEndMs, now };
}

/** Sums the in-progress hour's 5-minute rows into a synthetic bar (marked `partial`) — used while
 * the recorder hasn't compiled the hourly row yet (~until :12 past the hour). Returns null rather
 * than fabricating a zero bar when there's no grid data at all yet. */
export function synthesizePartialBar(
  hourStartMs: number,
  fiveMinGridRows: StatisticValue[],
  fiveMinCostRows: StatisticValue[],
  price: number | null
): EnergyBar | null {
  if (fiveMinGridRows.length === 0) return null;
  const kWh = Math.max(
    0,
    fiveMinGridRows.reduce((sum, row) => sum + (row.change ?? 0), 0)
  );
  const costKr = Math.max(
    0,
    fiveMinCostRows.reduce((sum, row) => sum + (row.change ?? 0), 0)
  );
  return {
    startMs: hourStartMs,
    endMs: hourStartMs + 3_600_000,
    kWh,
    costKr,
    price,
    level: priceLevel(price),
    partial: true,
  };
}
