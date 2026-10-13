/** Hourly all-in price timeline for planning and relative bands. Pure. Unlike `buildPriceTimeline`
 * it keeps elapsed hours (bands rank whole days) and accepts free and negative prices. */
import { PLAN_PRICE_RANGE_KR } from '../config/plan';
import type { RawTodayPoint } from './assemble';

const HOUR_MS = 3_600_000;

/** One hour's all-in price in kr/kWh, keyed by the hour's start. `estimated` marks an hour priced
 * from the Carnot forecast rather than the published day-ahead price. */
export interface PricePointMs {
  ms: number;
  price: number;
  estimated?: true;
}

export function isPlanPrice(price: unknown): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price >= PLAN_PRICE_RANGE_KR.min && price <= PLAN_PRICE_RANGE_KR.max;
}

/** Merges `raw_today`, `raw_tomorrow` (only when `tomorrowValid`) and the Carnot `forecast` into one
 * sorted list with one point per hour. Published prices win over forecast ones; forecast hours are
 * marked `estimated`. Points that are not on an hour boundary, fail to parse, or fall outside
 * `PLAN_PRICE_RANGE_KR` are dropped, leaving that hour unpriced. */
export function buildHourlyPrices(
  rawToday: readonly RawTodayPoint[] | null,
  rawTomorrow: readonly RawTodayPoint[] | null,
  tomorrowValid: boolean,
  forecast: readonly RawTodayPoint[] | null
): PricePointMs[] {
  const byMs = new Map<number, PricePointMs>();
  const add = (points: readonly RawTodayPoint[] | null, estimated: boolean) => {
    for (const point of points ?? []) {
      const ms = Date.parse(point.hour);
      if (!Number.isFinite(ms) || ms % HOUR_MS !== 0 || !isPlanPrice(point.price) || byMs.has(ms)) continue;
      byMs.set(ms, estimated ? { ms, price: point.price, estimated: true } : { ms, price: point.price });
    }
  };
  add(rawToday, false);
  if (tomorrowValid) add(rawTomorrow, false);
  add(forecast, true);
  return Array.from(byMs.values()).sort((a, b) => a.ms - b.ms);
}
