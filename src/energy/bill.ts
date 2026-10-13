/** Pure "Bill" assembly — no React, no clock reads; every
 * function takes explicit ms args, so it stays independently testable (mirrors assemble.ts). */
import { FIXED_FEES_EXCL_MOMS_KR_PER_MONTH, MOMS_FACTOR } from '../config/energy';
import { homeDayStartMs, homeDaysInMonth, nextHomeDayStartMs } from './homeTime';
import type { EnergyView } from './types';

/** Full month's fixed subscription fees, VAT included — mirrors the Vindstød invoice's line
 * items (only the fees need ×VAT; HA's cost stat is already all-in on the variable side). */
export function monthlyFixedFeesInclMoms(): number {
  const exclMoms = Object.values(FIXED_FEES_EXCL_MOMS_KR_PER_MONTH).reduce<number>((sum, fee) => sum + fee, 0);
  return exclMoms * MOMS_FACTOR;
}

/** Σ over each Copenhagen calendar day in [startMs, endMs) of that day's share of the monthly fee
 * (monthlyFee ÷ days in ITS OWN month) — correct across a month boundary, and a full calendar
 * month sums back to exactly the monthly fee (dayCount × monthlyFee/dayCount). */
export function fixedFeesForRange(startMs: number, endMs: number): number {
  const monthlyFee = monthlyFixedFeesInclMoms();
  let total = 0;
  for (let day = homeDayStartMs(startMs); day < endMs; day = nextHomeDayStartMs(day)) {
    total += monthlyFee / homeDaysInMonth(day);
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
