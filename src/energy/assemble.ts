/** Pure view-model assembly for the Energy page — no React, no clock reads; every function takes
 * explicit ms args (or nullable data), so it stays independently testable. */
import { PRICE_BAND_THRESHOLDS } from '../config/energy';
import { addDays } from './period';
import type {
  DevicePref,
  DeviceUsage,
  EnergyBar,
  EnergyDevices,
  Period,
  PricePoint,
  PriceSeries,
  StatisticsResponse,
  StatisticValue,
} from './types';

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

/** Σcost ÷ Σkwh across a set of bars — the period-level effective price used as a fallback
 * wherever a per-bucket price can't be established. Null when the bars carry no consumption at
 * all (nothing to derive a rate from). */
function computePeriodEffectivePrice(bars: EnergyBar[]): number | null {
  let kWh = 0;
  let costKr = 0;
  for (const bar of bars) {
    kWh += bar.kWh;
    costKr += bar.costKr;
  }
  return kWh > 0 ? costKr / kWh : null;
}

/** A bar's own effective rate (kr/kWh) — null when it carries no usable per-kWh basis (a
 * non-positive kWh or cost never yields a meaningful rate). */
function barEffectivePrice(bar: EnergyBar): number | null {
  return bar.kWh > 0 && bar.costKr > 0 ? bar.costKr / bar.kWh : null;
}

/** Approximates a device's period cost from its own statistics rows. A row is matched to a bar
 * only when BOTH its start AND end coincide with the bar's — true for every month in the year
 * view, where device rows and chart bars are both fetched at month granularity — and is then
 * priced at that bar's own effective rate. Every other row falls back to the period-level
 * effective price: day/week/month devices are fetched as a single whole-period row (a coarser
 * bucket than the view's hourly/daily bars), so no bar genuinely describes it even though its
 * start can coincide with the period's first bar — matching on start alone would wrongly price
 * the whole period at just that first bucket's rate, which is exactly what requiring the end to
 * match as well rules out. Returns null only when no price basis exists anywhere. */
export function deviceCostApprox(deviceRows: StatisticValue[], viewBars: EnergyBar[]): number | null {
  const barByBucket = new Map(viewBars.map(bar => [`${bar.startMs}|${bar.endMs}`, bar]));
  const periodPrice = computePeriodEffectivePrice(viewBars);

  let costKr = 0;
  let hasBasis = false;

  for (const row of deviceRows) {
    const rowKWh = Math.max(0, row.change ?? 0);
    const matchingBar = barByBucket.get(`${row.start}|${row.end}`);
    const price = (matchingBar && barEffectivePrice(matchingBar)) ?? periodPrice;
    if (price == null) continue;
    costKr += rowKWh * price;
    hasBasis = true;
  }

  return hasBasis ? costKr : null;
}

/** Groups device stats into a top-level + nested-children tree (mirroring HA's own
 * `included_in_stat` semantics: a child's kWh is already part of its parent's own reported total,
 * so a parent and its children are never summed together) and derives the untracked remainder
 * against the grid's exact totals. A child whose declared parent isn't itself among
 * `devicePrefs` (a config inconsistency) is defensively promoted to top-level so its consumption
 * is never silently dropped from the sums. */
export function assembleDevices(
  devicePrefs: DevicePref[],
  rowsByStatId: StatisticsResponse,
  viewBars: EnergyBar[],
  gridTotals: { kWh: number; costKr: number }
): EnergyDevices {
  const knownStatIds = new Set(devicePrefs.map(pref => pref.statId));
  const usageByStatId = new Map<string, DeviceUsage>();

  for (const pref of devicePrefs) {
    const rows = rowsByStatId[pref.statId] ?? [];
    const kWh = rows.reduce((sum, row) => sum + Math.max(0, row.change ?? 0), 0);
    usageByStatId.set(pref.statId, {
      statId: pref.statId,
      name: pref.name,
      kWh,
      costKr: deviceCostApprox(rows, viewBars),
      costExact: false,
      parentStatId: pref.parentStatId,
    });
  }

  const topLevel: DeviceUsage[] = [];
  for (const pref of devicePrefs) {
    const usage = usageByStatId.get(pref.statId);
    if (!usage) continue; // unreachable — every pref was inserted into the map above
    const parent = pref.parentStatId != null ? usageByStatId.get(pref.parentStatId) : undefined;
    if (parent && knownStatIds.has(pref.parentStatId!)) {
      (parent.children ??= []).push(usage);
    } else {
      topLevel.push(usage); // no parent declared, or an orphaned child promoted to top-level
    }
  }

  const byKWhDesc = (a: DeviceUsage, b: DeviceUsage) => b.kWh - a.kWh;
  for (const usage of usageByStatId.values()) usage.children?.sort(byKWhDesc);
  topLevel.sort(byKWhDesc);

  const totalTrackedKWh = topLevel.reduce((sum, usage) => sum + usage.kWh, 0);
  // Null-propagating sum: once any top-level device's cost is unknown, the aggregate is unknown too.
  const topLevelCostKr = topLevel.reduce<number | null>(
    (sum, usage) => (sum == null || usage.costKr == null ? null : sum + usage.costKr),
    0
  );

  const untrackedKWh = Math.max(0, gridTotals.kWh - totalTrackedKWh);
  let untrackedCostKr: number | null;
  if (topLevelCostKr != null) {
    untrackedCostKr = Math.max(0, gridTotals.costKr - topLevelCostKr);
  } else {
    const periodPrice = computePeriodEffectivePrice(viewBars);
    untrackedCostKr = periodPrice != null ? Math.max(0, untrackedKWh * periodPrice) : null;
  }

  return {
    devices: topLevel,
    untracked: { kWh: untrackedKWh, costKr: untrackedCostKr },
    totalTrackedKWh,
    complete: true,
  };
}

/** Hourly join of a device's own consumption against the price entity's hourly `state` (its
 * long-term-statistics id) for an exact, on-demand cost — used only when a device row is tapped.
 * Skips hours without a price match (still counting their kWh); returns null when more than 10%
 * of the device's kWh falls in unpriced hours, i.e. too little basis to call the result "exact". */
export function deviceCostExact(deviceRows: StatisticValue[], priceRows: StatisticValue[]): number | null {
  const priceByStart = new Map(priceRows.map(row => [row.start, row.state]));

  let totalKWh = 0;
  let unpricedKWh = 0;
  let costKr = 0;

  for (const row of deviceRows) {
    const kWh = Math.max(0, row.change ?? 0);
    totalKWh += kWh;
    const price = priceByStart.get(row.start);
    if (price == null) {
      unpricedKWh += kWh;
      continue;
    }
    costKr += kWh * price;
  }

  if (totalKWh > 0 && unpricedKWh / totalKWh > 0.1) return null;
  return costKr;
}
