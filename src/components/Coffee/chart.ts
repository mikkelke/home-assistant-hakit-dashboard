/** Geometry for the one brew chart grammar: grams over seconds since the first bloom, pours on the same axis. Pure. */
import { planWaterFromPours, recipePlanPours, type CoffeeBaseline, type CoffeeLive, type PlanPour, type Recipe } from '../../coffee/model';

export interface ChartSeries {
  values: readonly (number | null)[];
  stepS: number;
}

export const series = (values: readonly (number | null)[] | null | undefined, stepS: number): ChartSeries | null =>
  values && values.length > 0 ? { values, stepS } : null;

/** The last second a series has a value for; null without any. */
export function lastValidS(data: ChartSeries | null | undefined): number | null {
  if (!data) return null;
  for (let index = data.values.length - 1; index >= 0; index--) if (data.values[index] != null) return index * data.stepS;
  return null;
}

/** The value at or just before `s`; null in a gap. */
export function valueAt(data: ChartSeries | null | undefined, s: number): number | null {
  if (!data || s < 0) return null;
  const index = Math.min(data.values.length - 1, Math.floor(s / data.stepS));
  return index >= 0 ? (data.values[index] ?? null) : null;
}

/** The highest value of a series. */
export function maxOf(data: ChartSeries | null | undefined): number {
  return data ? data.values.reduce<number>((max, value) => (value != null && value > max ? value : max), 0) : 0;
}

/** Time and gram axes wide enough for everything drawn, in whole steps: the time axis in 30 s, the gram axis in 100 g. */
export function chartSpan(
  seconds: readonly (number | null | undefined)[],
  grams: readonly (number | null | undefined)[]
): { tMax: number; yMax: number } {
  const maxS = Math.max(120, ...seconds.filter((value): value is number => value != null && Number.isFinite(value)));
  const maxG = Math.max(100, ...grams.filter((value): value is number => value != null && Number.isFinite(value)));
  return { tMax: Math.ceil((maxS + 15) / 30) * 30, yMax: Math.ceil((maxG * 1.08) / 100) * 100 };
}

/** The seconds a series covers. */
export const spanS = (data: ChartSeries | null | undefined): number | null =>
  data && data.values.length > 0 ? (data.values.length - 1) * data.stepS : null;

export interface Scale {
  x: (s: number) => number;
  y: (grams: number) => number;
}

/** Runs of consecutive values as `M…L…` paths, so a gap stays open. */
export function linePath(data: ChartSeries | null | undefined, scale: Scale, toS = Infinity): string {
  if (!data) return '';
  let d = '';
  let open = false;
  data.values.forEach((value, index) => {
    const s = index * data.stepS;
    if (s > toS || value == null) {
      open = false;
      return;
    }
    d += `${open ? 'L' : 'M'}${scale.x(s).toFixed(1)} ${scale.y(value).toFixed(1)}`;
    open = true;
  });
  return d;
}

/** The area under each run, down to `baseline`. */
export function areaPath(data: ChartSeries | null | undefined, scale: Scale, baseline: number, toS = Infinity): string {
  if (!data) return '';
  let d = '';
  let run: [number, number][] = [];
  const close = () => {
    if (run.length > 1) {
      d += `M${run.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}L${run[run.length - 1][0].toFixed(1)} ${baseline.toFixed(1)}L${run[0][0].toFixed(1)} ${baseline.toFixed(1)}Z`;
    }
    run = [];
  };
  data.values.forEach((value, index) => {
    const s = index * data.stepS;
    if (s > toS || value == null) {
      close();
      return;
    }
    run.push([scale.x(s), scale.y(value)]);
  });
  close();
  return d;
}

/** The band between `lo` and `hi`, where both have values. */
export function bandPath(lo: ChartSeries, hi: ChartSeries, scale: Scale): string {
  const points: { s: number; lo: number; hi: number }[] = [];
  const length = Math.min(lo.values.length, hi.values.length);
  for (let index = 0; index < length; index++) {
    const low = lo.values[index];
    const high = hi.values[index];
    if (low != null && high != null) points.push({ s: index * lo.stepS, lo: Math.min(low, high), hi: Math.max(low, high) });
  }
  if (points.length < 2) return '';
  const top = points.map((point, index) => `${index ? 'L' : 'M'}${scale.x(point.s).toFixed(1)} ${scale.y(point.hi).toFixed(1)}`).join('');
  const bottom = [...points]
    .reverse()
    .map(point => `L${scale.x(point.s).toFixed(1)} ${scale.y(point.lo).toFixed(1)}`)
    .join('');
  return `${top}${bottom}Z`;
}

/** The middle of a band, drawn as its own faint line. */
export function bandMiddle(lo: ChartSeries, hi: ChartSeries): ChartSeries {
  const length = Math.min(lo.values.length, hi.values.length);
  const values: (number | null)[] = [];
  for (let index = 0; index < length; index++) {
    const low = lo.values[index];
    const high = hi.values[index];
    values.push(low != null && high != null ? (low + high) / 2 : null);
  }
  return { values, stepS: lo.stepS };
}

export type LaneState = 'plan' | 'done' | 'cur' | 'next';

/** How each planned pour reads on a live brew: done, the current one with how far it got, or still to come. The current
 * pour counts from when it really started, and is done once its planned length has run. */
export function laneStates(
  pours: readonly PlanPour[],
  current: number | null,
  currentStartS: number | null,
  nowS: number
): { state: LaneState; fill: number }[] {
  return pours.map((pour, index) => {
    const number = index + 1;
    if (current == null || current < 1 || number > current) return { state: 'next', fill: 0 };
    if (number < current) return { state: 'done', fill: 1 };
    const start = currentStartS ?? pour.start;
    const fill = (nowS - start) / Math.max(1, pour.end - pour.start);
    return fill >= 1 ? { state: 'done', fill: 1 } : { state: 'cur', fill: Math.max(0, fill) };
  });
}

/** "0:30" axis labels. */
export function axisLabel(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

export interface BrewChartInputs {
  cup: ChartSeries | null;
  water: ChartSeries | null;
  bandLo: ChartSeries | null;
  bandHi: ChartSeries | null;
  planWater: ChartSeries | null;
  planPours: PlanPour[];
  tMax: number;
  yMax: number;
  /** The usual's middle grams, or this brew's final grams once ready. */
  cupEndG: number | null;
  waterEndMl: number | null;
  drawdownEndS: number | null;
}

interface PlanSource {
  planWater: ChartSeries | null;
  planPours: PlanPour[];
}

/** The plan to draw: the brew's own when it carries one, else the usual's from the baseline, else from the recipe. */
export function planOf(
  live: Pick<CoffeeLive, 'planWater' | 'planPours' | 'stepS'> | null,
  baseline: Pick<CoffeeBaseline, 'planWater' | 'planStepS' | 'planPours'> | null,
  recipe: Pick<Recipe, 'pours'> | null
): PlanSource {
  if (live && live.planPours.length > 0) {
    return { planWater: series(live.planWater, live.stepS) ?? series(planWaterFromPours(live.planPours), 1), planPours: live.planPours };
  }
  if (baseline && baseline.planPours.length > 0) {
    return {
      planWater: series(baseline.planWater, baseline.planStepS) ?? series(planWaterFromPours(baseline.planPours), 1),
      planPours: baseline.planPours,
    };
  }
  if (recipe && recipe.pours.length > 0) {
    const pours = recipePlanPours(recipe.pours);
    return { planWater: series(planWaterFromPours(pours), 1), planPours: pours };
  }
  return { planWater: null, planPours: [] };
}

const lastPourEnd = (pours: readonly PlanPour[]) => pours.reduce((end, pour) => Math.max(end, pour.end), 0);

/** Everything one brew chart draws, on axes that fit it all. */
export function chartInputs({
  plan,
  baseline,
  cup = null,
  water = null,
  readyS = null,
  cupEndG = null,
  waterEndMl = null,
  extraS = null,
}: {
  plan: PlanSource;
  baseline: Pick<CoffeeBaseline, 'status' | 'cupLo' | 'cupHi' | 'stepS' | 'totalSMedian' | 'cupGMedian' | 'drawdownSMedian'> | null;
  cup?: ChartSeries | null;
  water?: ChartSeries | null;
  readyS?: number | null;
  cupEndG?: number | null;
  waterEndMl?: number | null;
  /** Another second that must fit, such as now on a brew that ran long. */
  extraS?: number | null;
}): BrewChartInputs {
  const banded = baseline != null && baseline.status === 'ready' && baseline.cupLo.length > 1 && baseline.cupHi.length > 1;
  const bandLo = banded ? series(baseline.cupLo, baseline.stepS) : null;
  const bandHi = banded ? series(baseline.cupHi, baseline.stepS) : null;
  const planEnd = lastPourEnd(plan.planPours);
  const drawdownEndS = baseline?.totalSMedian ?? (planEnd > 0 ? planEnd + 75 : null);
  const planTotal = maxOf(plan.planWater);
  const { tMax, yMax } = chartSpan(
    [drawdownEndS, spanS(bandHi), lastValidS(cup), lastValidS(water), readyS, extraS],
    [planTotal, maxOf(bandHi), maxOf(water), maxOf(cup), cupEndG, waterEndMl]
  );
  return {
    cup,
    water,
    bandLo: holdTo(bandLo, tMax),
    bandHi: holdTo(bandHi, tMax),
    planWater: holdTo(plan.planWater, tMax),
    planPours: plan.planPours,
    tMax,
    yMax,
    cupEndG: cupEndG ?? (banded ? (baseline?.cupGMedian ?? null) : null),
    waterEndMl: waterEndMl ?? (planTotal > 0 ? planTotal : null),
    drawdownEndS,
  };
}

/** A series held at its last value out to `toS`: the plan's water stays poured once the pours are done, and a finished
 * cup keeps its weight. */
export function holdTo(data: ChartSeries | null, toS: number): ChartSeries | null {
  if (!data || data.values.length === 0) return data;
  const last = data.values[data.values.length - 1];
  const count = Math.floor(toS / data.stepS) + 1;
  if (last == null || data.values.length >= count) return data;
  return { values: [...data.values, ...new Array<number>(count - data.values.length).fill(last)], stepS: data.stepS };
}
