/** Water and district heating per period, from ista's daily statistics. Pure; all times are epoch ms
 * read in home time.
 *
 * ista delivers each day about a week late and in bursts, so a period is read only up to its data
 * end: the start of the day after the newest `reading_date`. Days past it are missing, not zero use,
 * and the same period last year is cut at the same point so the two compare like for like. HA rounds
 * a statistics request's end up to the end of its bucket and cannot cut a month bucket short, so rows
 * are cut here, and a year view reads its unfinished month by day. */
import { UTILITY_METERS, UTILITY_YEAR_START_MONTH, type UtilityKind } from '../config/utilities';
import { homeMonthStartMs, homeWallTime, homeWallTimeToMs, nextHomeDayStartMs } from './homeTime';
import { HOME_CALENDAR, type PeriodCalendar } from './period';
import type { Period, StatisticsResponse } from './types';

/** Home-time periods whose year is ista's accounting year, starting on 1 December. */
export const UTILITY_CALENDAR: PeriodCalendar = {
  startOf(period, ms) {
    if (period !== 'year') return HOME_CALENDAR.startOf(period, ms);
    const { year, month } = homeWallTime(ms);
    return homeWallTimeToMs(month >= UTILITY_YEAR_START_MONTH ? year : year - 1, UTILITY_YEAR_START_MONTH, 1);
  },
  step: HOME_CALENDAR.step,
};

/** The same home-time midnight a year earlier: 52 weeks back in a week view, so weekdays line up,
 * else the same date. */
export function yearEarlier(period: Period, ms: number): number {
  const { year, month, day } = homeWallTime(ms);
  return period === 'week' ? homeWallTimeToMs(year, month, day - 364) : homeWallTimeToMs(year - 1, month, day);
}

/** Where every meter's data has arrived: the start of the day after the earliest `reading_date`
 * (YYYY-MM-DD). Null when no meter has one. */
export function utilityDataEndMs(readingDates: readonly unknown[]): number | null {
  let endMs: number | null = null;
  for (const value of readingDates) {
    const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
    if (!match) continue;
    const ms = homeWallTimeToMs(Number(match[1]), Number(match[2]), Number(match[3]) + 1);
    if (endMs == null || ms < endMs) endMs = ms;
  }
  return endMs;
}

/** Where a period's counted rows end: its own end, or the data end when that falls inside it. */
export function periodDataEndMs(startMs: number, endMs: number, dataEndMs: number | null): number {
  return dataEndMs == null ? endMs : Math.min(endMs, Math.max(startMs, dataEndMs));
}

export interface UtilityPrice {
  /** kr per unit. */
  kr: number;
  /** ista's estimate for the open period rather than a settled statement price. */
  estimate: boolean;
}

/** A price sensor's state and `source` attribute; null unless the state is a number. */
export function utilityPrice(state: unknown, source: unknown): UtilityPrice | null {
  const kr = typeof state === 'string' && state.trim() !== '' ? Number(state) : NaN;
  return Number.isFinite(kr) ? { kr, estimate: source === 'estimate' } : null;
}

export interface UtilityStatIds {
  amount: string;
  cost: string | null;
}

export type UtilityStatMap = Partial<Record<UtilityKind, UtilityStatIds>>;

/** Each meter's statistic and cost statistic among `statisticIds`, all from the meters' source. */
export function utilityStatIds(statisticIds: readonly string[]): UtilityStatMap {
  const out: UtilityStatMap = {};
  for (const { kind } of UTILITY_METERS) {
    const amount = statisticIds.find(id => id.endsWith(`_${kind}`));
    if (amount) out[kind] = { amount, cost: statisticIds.includes(`${amount}_cost`) ? `${amount}_cost` : null };
  }
  return out;
}

export interface UtilityStatsWindow {
  startMs: number;
  endMs: number;
  bucket: 'day' | 'month';
}

/** The statistics requests covering [startMs, endMs): one by day, or in a year view its whole months
 * by month and an unfinished last month by day. */
export function utilityStatsWindows(period: Period, startMs: number, endMs: number): UtilityStatsWindow[] {
  if (endMs <= startMs) return [];
  if (period !== 'year') return [{ startMs, endMs, bucket: 'day' }];
  const monthStartMs = Math.max(startMs, homeMonthStartMs(endMs));
  const windows: UtilityStatsWindow[] = [];
  if (monthStartMs > startMs) windows.push({ startMs, endMs: monthStartMs, bucket: 'month' });
  if (endMs > monthStartMs) windows.push({ startMs: monthStartMs, endMs, bucket: 'day' });
  return windows;
}

export interface UtilityBar {
  startMs: number;
  endMs: number;
  amount: number;
  /** Null when the cost statistic has no row for it. */
  kr: number | null;
  /** Reaches past the data end, so only its days before that count. */
  partial: boolean;
}

export interface UtilityUsage {
  kind: UtilityKind;
  bars: UtilityBar[];
  amount: number;
  kr: number | null;
}

export interface UtilityView {
  period: Period;
  startMs: number;
  endMs: number;
  /** Rows from here on do not count: the period's end, or the data end inside it. */
  dataEndMs: number;
  /** Meters with statistics, in `UTILITY_METERS` order. */
  meters: UtilityUsage[];
  kr: number | null;
}

/** One period's usage per meter, by day or in a year view by month, from the responses to its
 * `utilityStatsWindows` requests. Only rows whose whole bucket lies in [startMs, dataEndMs) count,
 * whatever else HA returned around them. */
export function assembleUtilityView(
  period: Period,
  startMs: number,
  endMs: number,
  dataEndMs: number,
  ids: UtilityStatMap,
  responses: readonly StatisticsResponse[]
): UtilityView {
  const meters: UtilityUsage[] = [];
  for (const { kind } of UTILITY_METERS) {
    const meterIds = ids[kind];
    if (!meterIds) continue;
    const bars = new Map<number, UtilityBar>();
    const add = (statId: string | null, key: 'amount' | 'kr') => {
      if (!statId) return;
      for (const response of responses) {
        for (const row of response[statId] ?? []) {
          if (row.change == null || row.start < startMs || row.end > dataEndMs) continue;
          const barStartMs = period === 'year' ? homeMonthStartMs(row.start) : row.start;
          let bar = bars.get(barStartMs);
          if (!bar) {
            const barEndMs = period === 'year' ? homeMonthStartMs(barStartMs, 1) : nextHomeDayStartMs(barStartMs);
            bar = { startMs: barStartMs, endMs: barEndMs, amount: 0, kr: null, partial: barEndMs > dataEndMs };
            bars.set(barStartMs, bar);
          }
          if (key === 'amount') bar.amount += row.change;
          else bar.kr = (bar.kr ?? 0) + row.change;
        }
      }
    };
    add(meterIds.amount, 'amount');
    add(meterIds.cost, 'kr');
    const sorted = [...bars.values()].sort((a, b) => a.startMs - b.startMs);
    meters.push({
      kind,
      bars: sorted,
      amount: sorted.reduce((sum, bar) => sum + bar.amount, 0),
      kr: knownSum(sorted.map(bar => bar.kr)),
    });
  }
  return { period, startMs, endMs, dataEndMs, meters, kr: knownSum(meters.map(meter => meter.kr)) };
}

function knownSum(values: readonly (number | null)[]): number | null {
  let sum: number | null = null;
  for (const value of values) if (value != null) sum = (sum ?? 0) + value;
  return sum;
}

/** True when every meter's rows start with the view: a span reaching back before the meters' history
 * is no basis for a comparison. */
function coversStart(view: UtilityView, meters: readonly UtilityUsage[]): boolean {
  return meters.length > 0 && meters.every(meter => meter.bars[0]?.startMs === view.startMs);
}

/** A meter's amount or kroner over `view` as a basis for comparison; null without one. */
export function utilityTotal(view: UtilityView | null, kind: UtilityKind, unit: 'amount' | 'kr'): number | null {
  const meter = view?.meters.find(candidate => candidate.kind === kind);
  if (!view || !meter || !coversStart(view, [meter])) return null;
  return unit === 'kr' ? meter.kr : meter.amount;
}

/** Every meter's kroner over `view` as a basis for comparison; null without one. */
export function utilityKr(view: UtilityView | null): number | null {
  return view && coversStart(view, view.meters) ? view.kr : null;
}

/** Whole-percent change from `before` to `now`; null without a positive basis. */
export function changePct(now: number | null, before: number | null): number | null {
  if (now == null || before == null || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}
