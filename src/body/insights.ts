/** What the weighings say beyond the latest number: how far a weighing sits from the trend, the trend's up and down legs,
 * where it was last this low or high, the weekday and the season. Everything is derived from the weighings and their
 * 7-day trend; local time decides weekdays, months and years. */
import { DAY_MS, GAP_MS, trend, weeklyRate, type TrendPoint, type Weighing } from './weighings';

const SWING_MIN_WEIGHINGS = 20;
const SWING_SHARE = 0.8;
const LEG_MIN_KG = 2;
const SINCE_MIN_AGE_MS = 180 * DAY_MS;
const FOUR_WEEKS_MS = 28 * DAY_MS;
const WEEKDAY_TAU_MS = 7 * DAY_MS;
const WEEKDAY_MAX_GAP_MS = 14 * DAY_MS;
const WEEKDAY_MIN_WEIGHINGS = 10;
const YEAR_TAU_MS = 14 * DAY_MS;
const SEASON_MIN_MONTHS = 10;
const SEASON_MIN_YEARS = 3;
const SEASON_MIN_SHARE = 0.7;

/** Indices where a series changes direction by at least `thr`, plus its first and last index. */
export function turningPoints(v: readonly number[], thr = 2): number[] {
  if (v.length < 2) return v.length ? [0] : [];
  const out = [0];
  let dir = 0,
    ext = 0,
    lo = 0,
    hi = 0;
  for (let i = 1; i < v.length; i++) {
    if (dir === 0) {
      if (v[i] < v[lo]) lo = i;
      if (v[i] > v[hi]) hi = i;
      if (v[hi] - v[lo] >= thr) {
        dir = lo < hi ? 1 : -1;
        ext = lo < hi ? hi : lo;
        const first = lo < hi ? lo : hi;
        if (first !== 0) out.push(first);
      }
    } else if (dir * (v[i] - v[ext]) >= 0) ext = i;
    else if (dir * (v[ext] - v[i]) >= thr) {
      out.push(ext);
      dir = -dir;
      ext = i;
    }
  }
  if (out[out.length - 1] !== v.length - 1) out.push(v.length - 1);
  return out;
}

export type LegDirection = 'down' | 'up' | 'steady';

export interface Leg {
  startIndex: number;
  endIndex: number;
  startTs: number;
  endTs: number;
  /** The trend's change over the leg, in kg. */
  delta: number;
  direction: LegDirection;
  /** A bigger move than every other leg of its direction, and there is another to compare with. */
  largest: boolean;
}

function legsOf(trend7: readonly TrendPoint[]): Leg[] {
  const points = turningPoints(trend7.map(p => p.value));
  const legs: Leg[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const from = trend7[points[k]];
    const to = trend7[points[k + 1]];
    const delta = to.value - from.value;
    legs.push({
      startIndex: points[k],
      endIndex: points[k + 1],
      startTs: from.ts,
      endTs: to.ts,
      delta,
      direction: Math.abs(delta) < LEG_MIN_KG ? 'steady' : delta < 0 ? 'down' : 'up',
      largest: false,
    });
  }
  return legs.map(leg => {
    if (leg.direction === 'steady') return leg;
    const others = legs.filter(other => other !== leg && other.direction === leg.direction);
    return { ...leg, largest: others.length > 0 && others.every(other => Math.abs(leg.delta) > Math.abs(other.delta)) };
  });
}

export interface Since {
  direction: 'down' | 'up';
  /** When the trend was last this low (down) or this high (up); null when it never was in the record. */
  ts: number | null;
}

/** Where the trend last stood at today's level, before the current leg began; null unless that is at least 180 days ago. */
function sinceOf(trend7: readonly TrendPoint[], legs: readonly Leg[]): Since | null {
  const current = legs[legs.length - 1];
  if (!current || current.direction === 'steady') return null;
  const now = trend7[trend7.length - 1];
  let ts: number | null = null;
  for (let i = current.startIndex - 1; i >= 0; i--) {
    if (current.direction === 'down' ? trend7[i].value <= now.value : trend7[i].value >= now.value) {
      ts = trend7[i].ts;
      break;
    }
  }
  return now.ts - (ts ?? trend7[0].ts) >= SINCE_MIN_AGE_MS ? { direction: current.direction, ts } : null;
}

function percentile(sorted: readonly number[], share: number): number {
  const at = (sorted.length - 1) * share;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below] + (sorted[above] - sorted[below]) * (at - below);
}

/** How far four out of five weighings sit from the trend, in kg; null with too few weighings to say. */
function swingOf(weighings: readonly Weighing[], trend7: readonly TrendPoint[]): number | null {
  if (weighings.length < SWING_MIN_WEIGHINGS) return null;
  const gaps: number[] = [];
  for (let i = 1; i < weighings.length; i++) gaps.push(Math.abs(weighings[i].kg - trend7[i].value));
  return percentile(
    gaps.sort((a, b) => a - b),
    SWING_SHARE
  );
}

export interface WeekdayOffset {
  /** As Date.getDay: 0 is Sunday. */
  day: number;
  /** Mean kg above the trend on this weekday, relative to all weekdays. */
  offset: number;
  n: number;
}

interface Prior {
  value: number;
  weight: number;
}

/** For each weighing, the average of the weighings on one side of it (just before the weighing itself is folded in),
 * weighted by how close in time the neighbour is; none across a long gap. */
function sidePriors(weighings: readonly Weighing[], step: 1 | -1): (Prior | null)[] {
  const out: (Prior | null)[] = weighings.map(() => null);
  let level: number | null = null;
  let previousTs = 0;
  for (let k = 0; k < weighings.length; k++) {
    const i = step === 1 ? k : weighings.length - 1 - k;
    const w = weighings[i];
    if (level == null) level = w.kg;
    else {
      const gap = Math.abs(w.ts - previousTs);
      const weight = Math.exp(-gap / WEEKDAY_TAU_MS);
      if (gap <= WEEKDAY_MAX_GAP_MS) out[i] = { value: level, weight };
      level += (1 - weight) * (w.kg - level);
    }
    previousTs = w.ts;
  }
  return out;
}

/** The weekdays (Monday first) with at least ten weighings, each with how far its weighings sit from what the weighings
 * on either side of them predict. */
export function weekdayOffsets(weighings: readonly Weighing[]): WeekdayOffset[] {
  const before = sidePriors(weighings, 1);
  const after = sidePriors(weighings, -1);
  const residuals: number[][] = Array.from({ length: 7 }, () => []);
  weighings.forEach((w, i) => {
    const priors = [before[i], after[i]].filter((p): p is Prior => p != null);
    const weight = priors.reduce((sum, p) => sum + p.weight, 0);
    if (weight === 0) return;
    const expected = priors.reduce((sum, p) => sum + p.value * p.weight, 0) / weight;
    residuals[new Date(w.ts).getDay()].push(w.kg - expected);
  });
  const all = residuals.flat();
  if (all.length === 0) return [];
  const overall = all.reduce((sum, r) => sum + r, 0) / all.length;
  return [1, 2, 3, 4, 5, 6, 0].flatMap(day => {
    const own = residuals[day];
    if (own.length < WEEKDAY_MIN_WEIGHINGS) return [];
    return [{ day, offset: own.reduce((sum, r) => sum + r, 0) / own.length - overall, n: own.length }];
  });
}

export interface YearPoint {
  ts: number;
  /** Position within the year, 0 at 1 January and 1 at the next 1 January. */
  x: number;
  value: number;
}

export interface YearLine {
  year: number;
  /** Runs of the 14-day trend, cut where nothing was measured for a long time. */
  segments: YearPoint[][];
  peak: YearPoint;
  /** Calendar months of the year that have a weighing. */
  months: number;
}

export function yearLines(weighings: readonly Weighing[]): YearLine[] {
  const smooth = trend(
    weighings.map(w => ({ ts: w.ts, value: w.kg })),
    YEAR_TAU_MS
  );
  const years = new Map<number, { points: YearPoint[]; months: Set<number> }>();
  smooth.forEach(p => {
    const date = new Date(p.ts);
    const year = date.getFullYear();
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const entry = years.get(year) ?? { points: [], months: new Set<number>() };
    entry.points.push({ ts: p.ts, x: (p.ts - start) / (end - start), value: p.value });
    entry.months.add(date.getMonth());
    years.set(year, entry);
  });
  const lines: YearLine[] = [];
  for (const [year, { points, months }] of years) {
    if (points.length < 2) continue;
    const segments: YearPoint[][] = [];
    for (const point of points) {
      const run = segments[segments.length - 1];
      if (run && point.ts - run[run.length - 1].ts <= GAP_MS) run.push(point);
      else segments.push([point]);
    }
    const peak = points.reduce((best, p) => (p.value > best.value ? p : best));
    lines.push({ year, segments, peak, months: months.size });
  }
  return lines.sort((a, b) => a.year - b.year);
}

export interface SeasonalPeak {
  /** 1 for January to 12 for December. */
  month: number;
  /** Full years whose peak fell within a month of `month`. */
  hits: number;
  /** Full years counted. */
  of: number;
}

const apart = (a: number, b: number) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b));

/** The month the yearly peak usually falls in, from years with at least ten months of weighings other than `currentYear`;
 * null when there are too few such years or their peaks are spread out. */
export function seasonalPeak(lines: readonly YearLine[], currentYear: number): SeasonalPeak | null {
  const peaks = lines
    .filter(line => line.months >= SEASON_MIN_MONTHS && line.year !== currentYear)
    .map(line => new Date(line.peak.ts).getMonth() + 1);
  if (peaks.length < SEASON_MIN_YEARS) return null;
  const within = (month: number) => peaks.filter(peak => apart(peak, month) <= 1).length;
  let best = { month: 0, count: 0, hits: 0 };
  for (let month = 1; month <= 12; month++) {
    const count = peaks.filter(peak => peak === month).length;
    const hits = within(month);
    if (count > best.count || (count === best.count && count > 0 && hits > best.hits)) best = { month, count, hits };
  }
  return best.hits / peaks.length < SEASON_MIN_SHARE ? null : { month: best.month, hits: best.hits, of: peaks.length };
}

export interface BodyInsights {
  /** Time from the first to the latest weighing. */
  spanMs: number;
  firstYear: number | null;
  /** How far four out of five weighings sit from the trend, in kg. */
  swing: number | null;
  /** The latest weighing minus the trend at it, in kg. */
  offset: number | null;
  legs: Leg[];
  since: Since | null;
  /** kg change per four weeks, from the last four weeks of weighings. */
  fourWeek: number | null;
  weekdays: WeekdayOffset[];
  yearLines: YearLine[];
  seasonal: SeasonalPeak | null;
}

export function bodyInsights(weighings: readonly Weighing[], trend7: readonly TrendPoint[]): BodyInsights {
  const first = weighings[0];
  const last = weighings[weighings.length - 1];
  const legs = legsOf(trend7);
  const lines = yearLines(weighings);
  const rate = weeklyRate(
    weighings.map(w => ({ ts: w.ts, value: w.kg })),
    FOUR_WEEKS_MS
  );
  return {
    spanMs: first ? last.ts - first.ts : 0,
    firstYear: first ? new Date(first.ts).getFullYear() : null,
    swing: swingOf(weighings, trend7),
    offset: last ? last.kg - trend7[trend7.length - 1].value : null,
    legs,
    since: sinceOf(trend7, legs),
    fourWeek: rate == null ? null : rate * 4,
    weekdays: weekdayOffsets(weighings),
    yearLines: lines,
    seasonal: last ? seasonalPeak(lines, new Date(last.ts).getFullYear()) : null,
  };
}
