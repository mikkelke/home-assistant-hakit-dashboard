/** Display helpers for the Energy page's Bill tab. Pure; amounts come from `assembleBill`. */
import { BILL_HISTORY_MAX_MONTHS, BILL_HISTORY_START } from '../config/energy';
import { assembleBill, fixedFeesForRange, type BillBreakdown } from './bill';
import { homeMonthStartMs, homeWallTimeToMs } from './homeTime';
import { isPlanPrice } from './priceTimeline';
import type { EnergyBar, StatisticValue } from './types';

export interface KronerSegment {
  key: 'consumption' | 'fees';
  label: string;
  kr: number;
}

/** Where the bill's kroner go, as far as the data shows: metered consumption (all-in hourly
 * prices, VAT included) and the fixed monthly fees. Sums to the bill's total. */
export function kronerBreakdown(bill: BillBreakdown): { segments: KronerSegment[]; totalKr: number } {
  const segments: KronerSegment[] = [
    { key: 'consumption', label: 'Consumption', kr: bill.variableKr },
    { key: 'fees', label: 'Fees', kr: bill.feesKr },
  ];
  return { segments, totalKr: segments.reduce((sum, segment) => sum + segment.kr, 0) };
}

/** How full the month ring is: the bill so far against the projected bill; full once settled. */
export function ringFraction(bill: BillBreakdown): number {
  if (bill.projectedTotalKr == null || bill.projectedTotalKr <= 0) return 1;
  return Math.min(1, Math.max(0, bill.totalKr / bill.projectedTotalKr));
}

export interface BillMonth {
  startMs: number;
  /** The month's bill (consumption plus full fees); the current month's projection. Null without data. */
  kr: number | null;
  projected: boolean;
}

/** First month with a bill, as its Copenhagen start. */
export function billHistoryStartMs(): number {
  return homeWallTimeToMs(BILL_HISTORY_START.year, BILL_HISTORY_START.monthIndex + 1, 1);
}

/** One entry per Copenhagen month from `BILL_HISTORY_START` (at most the last `maxMonths`) to the
 * month of `nowMs`, priced like `assembleBill` from monthly bars. */
export function billHistory(monthBars: readonly EnergyBar[], nowMs: number, maxMonths = BILL_HISTORY_MAX_MONTHS): BillMonth[] {
  const current = homeMonthStartMs(nowMs);
  let start = Math.max(billHistoryStartMs(), homeMonthStartMs(nowMs, -(maxMonths - 1)));
  const out: BillMonth[] = [];
  for (; start <= current; start = homeMonthStartMs(start, 1)) {
    const endMs = homeMonthStartMs(start, 1);
    const bar = monthBars.find(candidate => candidate.startMs === start);
    if (!bar) {
      out.push({ startMs: start, kr: null, projected: false });
      continue;
    }
    if (start === current) {
      const bill = assembleBill(
        { period: 'month', startMs: start, endMs, bars: [bar], totals: { kWh: bar.kWh, costKr: bar.costKr }, complete: false },
        nowMs
      );
      out.push({ startMs: start, kr: bill.projectedTotalKr ?? bill.totalKr, projected: bill.projectedTotalKr != null });
    } else {
      out.push({ startMs: start, kr: bar.costKr + fixedFeesForRange(start, endMs), projected: false });
    }
  }
  return out;
}

export interface HourPrice {
  startMs: number;
  price: number;
}

/** Cheapest and priciest hour among hourly price statistics rows starting in [startMs, endMs), by
 * their `state`; ties keep the first row (HA returns rows in time order). Null without a usable row. */
export function hourPriceExtremes(
  rows: readonly StatisticValue[],
  startMs: number,
  endMs: number
): { min: HourPrice; max: HourPrice } | null {
  let min: HourPrice | null = null;
  let max: HourPrice | null = null;
  for (const row of rows) {
    if (row.start < startMs || row.start >= endMs || !isPlanPrice(row.state)) continue;
    const hour = { startMs: row.start, price: row.state };
    if (!min || hour.price < min.price) min = hour;
    if (!max || hour.price > max.price) max = hour;
  }
  return min && max ? { min, max } : null;
}
