import type { Period } from '../../energy';
import { addDays, addMonths, localDayIndex, localMonthIndex } from '../../energy/period';

/** Shared x-geometry for the Usage-tab SVGs (bars + price strip). Both charts use the same
 * viewBox width and left/right padding so a slot maps to the same x in each — the scrub hook,
 * guide lines and callout all rely on that. */
export const CHART_VIEW_WIDTH = 600;
export const CHART_PAD_LEFT = 38;
export const CHART_PAD_RIGHT = 10;
export const CHART_PLOT_WIDTH = CHART_VIEW_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;

/** Bucket index for a bucket-start ms along the visible slots. Day uses hour-quantized ms math
 * (every hour bucket is exactly 3.6M ms, DST or not); week/month/year use the component-based
 * helpers from period.ts so a DST transition or absent bucket never misplaces a bar. */
export function slotIndexFor(period: Period, rangeStartMs: number, ms: number): number {
  switch (period) {
    case 'day':
      return Math.round((ms - rangeStartMs) / 3_600_000);
    case 'week':
    case 'month':
      return localDayIndex(rangeStartMs, ms);
    case 'year':
      return localMonthIndex(rangeStartMs, ms);
  }
}

/** Wall-clock start of hypothetical slot `slot` — label/selection math for slots without data. */
export function slotStartMsFor(period: Period, rangeStartMs: number, slot: number): number {
  switch (period) {
    case 'day':
      return rangeStartMs + slot * 3_600_000;
    case 'week':
    case 'month':
      return addDays(rangeStartMs, slot);
    case 'year':
      return addMonths(rangeStartMs, slot);
  }
}

/** Horizontal center of a slot as a percentage of the full view width (for the HTML callout). */
export function slotCenterPct(slot: number, slots: number): number {
  const slotWidth = CHART_PLOT_WIDTH / Math.max(1, slots);
  return ((CHART_PAD_LEFT + (slot + 0.5) * slotWidth) / CHART_VIEW_WIDTH) * 100;
}

/** Nearest slot that actually has data (bar or price point); ties resolve to the earlier slot.
 * Scrubbing an empty region of the chart then lands on real data instead of dead air. */
export function snapToNearestSlot(slot: number, available: ReadonlySet<number>): number | null {
  if (available.size === 0) return null;
  if (available.has(slot)) return slot;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const candidate of available) {
    const distance = Math.abs(candidate - slot);
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
