/** Start-time cost model for delay-start appliances. Pure; all times are epoch ms.
 *
 * Profile minute 0 is power onset, taken to be the instant the cycle starts (press time + knob
 * delay). Costs integrate fractional-minute overlap with each price hour, so a start at 20:59:30 is
 * priced as such, not rounded to 21:00. One feasibility predicate (`startCost`) gates every knob
 * choice, every press window minute and every curve point: all energy-carrying hours priced, and
 * completion no later than done-by. */
import { COST_CURVE, PLAN_SAVING_RULE, PRESS_BY_MIN_SLACK_MIN, PRESS_WINDOW_TOLERANCE_KR } from '../config/plan';
import type { PricePointMs } from './priceTimeline';
import { energyBetweenWh, type RunProfileProgramme } from './runProfiles';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const EPSILON_KR = 1e-9;

export type PlanProgramme = Pick<RunProfileProgramme, 'whPerMin' | 'cumWh' | 'energyMin' | 'completionMin'>;
export type PriceIndex = ReadonlyMap<number, PricePointMs>;

export interface CostResult {
  kr: number;
  /** At least one energy-carrying hour is priced from the forecast. */
  estimated: boolean;
}

export function indexPrices(timeline: readonly PricePointMs[]): PriceIndex {
  return new Map(timeline.map(point => [point.ms, point]));
}

function floorHour(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

/** Cost of a run starting at `startMs`, or null when an hour that carries energy has no price. */
export function runCost(programme: PlanProgramme, prices: PriceIndex, startMs: number): CostResult | null {
  const endMs = startMs + programme.energyMin * MINUTE_MS;
  let kr = 0;
  let estimated = false;
  for (let hourMs = floorHour(startMs); hourMs < endMs; hourMs += HOUR_MS) {
    const wh = energyBetweenWh(programme, (hourMs - startMs) / MINUTE_MS, (hourMs + HOUR_MS - startMs) / MINUTE_MS);
    if (wh <= 0) continue;
    const point = prices.get(hourMs);
    if (!point) return null;
    kr += (wh / 1000) * point.price;
    if (point.estimated) estimated = true;
  }
  return { kr, estimated };
}

/** When a run starting at `startMs` is done; null when the programme's completion is unknown. */
export function completionMs(programme: PlanProgramme, startMs: number): number | null {
  return programme.completionMin == null ? null : startMs + programme.completionMin * MINUTE_MS;
}

function missesDoneBy(programme: PlanProgramme, startMs: number, doneByMs: number | null): boolean {
  const doneMs = completionMs(programme, startMs);
  return doneByMs != null && doneMs != null && doneMs > doneByMs;
}

/** `runCost` for a start that is also allowed: completion no later than `doneByMs` when both are known. */
export function startCost(programme: PlanProgramme, prices: PriceIndex, startMs: number, doneByMs: number | null): CostResult | null {
  if (missesDoneBy(programme, startMs, doneByMs)) return null;
  return runCost(programme, prices, startMs);
}

/** The one saving rule: at least `minKr` and at least `minPct` of the baseline, the percentage
 * skipped when the baseline costs <= 0 kr. */
export function passesSavingRule(baselineKr: number, planKr: number): boolean {
  const saving = baselineKr - planKr;
  if (saving + EPSILON_KR < PLAN_SAVING_RULE.minKr) return false;
  return baselineKr <= 0 || saving + EPSILON_KR >= (baselineKr * PLAN_SAVING_RULE.minPct) / 100;
}

export interface PlanInput {
  nowMs: number;
  /** When the machine can next be pressed, e.g. a running cycle's ETA. Defaults to `nowMs`. */
  earliestPressMs?: number | null;
  /** Knob positions in minutes; 0 (no delay) is always included. */
  knobStepsMin: readonly number[];
  doneByMs?: number | null;
}

export type PlanKind = 'now' | 'knob' | 'wait';

export interface PlanChoice {
  kind: PlanKind;
  knobMin: number;
  /** Press window, inclusive at both ends, never past the end of the hour it starts in. Every press
   * in it is feasible, costs at most `PRESS_WINDOW_TOLERANCE_KR` more than the cheapest one, and
   * passes the saving rule against the alternative the plan is offered over. */
  pressFromMs: number;
  pressUntilMs: number;
  /** The window closes early enough in the hour to be worth saying "press by". */
  showPressBy: boolean;
  /** Start, completion (null when unknown) and cost when pressed at `pressFromMs`. */
  startMs: number;
  doneMs: number | null;
  costKr: number;
  /** Some press in the window prices an hour from the forecast. */
  estimated: boolean;
}

export interface StartPlan {
  /** Earliest press: now, or when a running cycle frees the machine. */
  pressFromMs: number;
  /** Pressing at `pressFromMs` with no delay; the baseline every saving is measured against. */
  noDelay: CostResult | null;
  plan: PlanChoice | null;
  /** `noDelay.kr - plan.costKr` when it passes the saving rule; otherwise null (nothing to claim). */
  savingKr: number | null;
  /** Even an immediate start misses done-by. */
  doneByMissed: boolean;
  /** End of the priced stretch that starts in the press hour; null when that hour has no price. */
  pricedUntilMs: number | null;
}

function normaliseSteps(steps: readonly number[]): number[] {
  return Array.from(new Set([0, ...steps.filter(s => Number.isFinite(s) && s >= 0)])).sort((a, b) => a - b);
}

/** Press instants considered: the earliest press itself, then each whole minute before the hour ends. */
function pressGrid(pressFromMs: number): number[] {
  const hourEndMs = floorHour(pressFromMs) + HOUR_MS;
  const grid = [pressFromMs];
  for (let t = Math.floor(pressFromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS; t < hourEndMs; t += MINUTE_MS) grid.push(t);
  return grid;
}

function pricedUntil(prices: PriceIndex, fromMs: number): number | null {
  let hourMs = floorHour(fromMs);
  if (!prices.has(hourMs)) return null;
  while (prices.has(hourMs + HOUR_MS)) hourMs += HOUR_MS;
  return hourMs + HOUR_MS;
}

/** Picks knob and press window for one programme. Pressing now with the cheapest knob (ties: the
 * shorter delay) is offered when it beats starting right away by the saving rule, else start right
 * away. Pressing later within the same hour is offered only when it beats that by the saving rule. */
export function planStart(programme: PlanProgramme, timeline: readonly PricePointMs[], input: PlanInput): StartPlan {
  const prices = indexPrices(timeline);
  const pressFromMs = Math.max(input.nowMs, input.earliestPressMs ?? input.nowMs);
  const doneByMs = input.doneByMs ?? null;
  const steps = normaliseSteps(input.knobStepsMin);
  const grid = pressGrid(pressFromMs);

  const costs = steps.map(knob => grid.map(press => startCost(programme, prices, press + knob * MINUTE_MS, doneByMs)));
  const noDelay = costs[0][0];
  const doneByMissed = missesDoneBy(programme, pressFromMs, doneByMs);
  const pricedUntilMs = pricedUntil(prices, pressFromMs);

  let nowBest: { k: number; cost: CostResult } | null = null;
  for (let k = 0; k < steps.length; k++) {
    const cost = costs[k][0];
    if (cost && (!nowBest || cost.kr < nowBest.cost.kr - EPSILON_KR)) nowBest = { k, cost };
  }
  const nowChoice =
    nowBest && nowBest.k > 0 && noDelay && !passesSavingRule(noDelay.kr, nowBest.cost.kr) ? { k: 0, cost: noDelay } : nowBest;

  let best: { k: number; p: number; cost: CostResult } | null = null;
  for (let p = 0; p < grid.length; p++) {
    for (let k = 0; k < steps.length; k++) {
      const cost = costs[k][p];
      if (cost && (!best || cost.kr < best.cost.kr - EPSILON_KR)) best = { k, p, cost };
    }
  }

  const waitWins = best != null && best.p > 0 && (!nowChoice || passesSavingRule(nowChoice.cost.kr, best.cost.kr));
  const chosen = waitWins ? best : nowChoice ? { ...nowChoice, p: 0 } : null;
  if (!chosen) return { pressFromMs, noDelay, plan: null, savingKr: null, doneByMissed, pricedUntilMs };

  const row = costs[chosen.k];
  const ref = chosen.cost;
  const chosenP = chosen.p;
  // What the plan has to beat by the saving rule at every press in its window: pressing now (with
  // the best knob) for a wait plan, starting right away for a knob plan.
  const baselineKr = chosenP > 0 ? (nowChoice?.cost.kr ?? null) : steps[chosen.k] > 0 ? (noDelay?.kr ?? null) : null;
  const within = (c: CostResult | null) =>
    c != null && c.kr <= ref.kr + PRESS_WINDOW_TOLERANCE_KR + EPSILON_KR && (baselineKr == null || passesSavingRule(baselineKr, c.kr));
  let first = chosenP;
  while (first > 0 && within(row[first - 1])) first--;
  let last = chosenP;
  while (last + 1 < grid.length && within(row[last + 1])) last++;

  const knobMin = steps[chosen.k];
  const kind: PlanKind = first > 0 ? 'wait' : knobMin > 0 ? 'knob' : 'now';
  const startMs = grid[first] + knobMin * MINUTE_MS;
  const costKr = row[first]!.kr;
  const hourEndMs = floorHour(pressFromMs) + HOUR_MS;
  const plan: PlanChoice = {
    kind,
    knobMin,
    pressFromMs: grid[first],
    pressUntilMs: grid[last],
    showPressBy: grid[last] < hourEndMs - PRESS_BY_MIN_SLACK_MIN * MINUTE_MS,
    startMs,
    doneMs: completionMs(programme, startMs),
    costKr,
    estimated: row.slice(first, last + 1).some(c => c?.estimated),
  };
  const savingKr = noDelay && passesSavingRule(noDelay.kr, costKr) ? noDelay.kr - costKr : null;
  return { pressFromMs, noDelay, plan, savingKr, doneByMissed, pricedUntilMs };
}

export interface CostCurvePoint {
  startMs: number;
  /** Null when the start touches an unpriced energy-carrying hour. */
  costKr: number | null;
  estimated: boolean;
  /** Completion would miss done-by. */
  tooLate: boolean;
}

export interface KnobMarker extends CostCurvePoint {
  knobMin: number;
}

export interface CostCurve {
  points: CostCurvePoint[];
  /** Starts reachable by pressing at `pressFromMs`, one per knob step inside the curve's range. */
  knobs: KnobMarker[];
}

function curvePoint(programme: PlanProgramme, prices: PriceIndex, startMs: number, doneByMs: number | null): CostCurvePoint {
  const cost = runCost(programme, prices, startMs);
  return {
    startMs,
    costKr: cost?.kr ?? null,
    estimated: cost?.estimated ?? false,
    tooLate: missesDoneBy(programme, startMs, doneByMs),
  };
}

/** Cost by start time for charting: one point every `COST_CURVE.stepMin` over `COST_CURVE.horizonMin`,
 * the first at `pressFromMs` and the rest on the step grid. */
export function costCurve(
  programme: PlanProgramme,
  timeline: readonly PricePointMs[],
  input: { pressFromMs: number; knobStepsMin: readonly number[]; doneByMs?: number | null }
): CostCurve {
  const prices = indexPrices(timeline);
  const doneByMs = input.doneByMs ?? null;
  const stepMs = COST_CURVE.stepMin * MINUTE_MS;
  const endMs = input.pressFromMs + COST_CURVE.horizonMin * MINUTE_MS;
  const points = [curvePoint(programme, prices, input.pressFromMs, doneByMs)];
  for (let t = Math.floor(input.pressFromMs / stepMs) * stepMs + stepMs; t < endMs; t += stepMs) {
    points.push(curvePoint(programme, prices, t, doneByMs));
  }
  const knobs = normaliseSteps(input.knobStepsMin)
    .filter(knob => knob <= COST_CURVE.horizonMin)
    .map(knob => ({ knobMin: knob, ...curvePoint(programme, prices, input.pressFromMs + knob * MINUTE_MS, doneByMs) }));
  return { points, knobs };
}

export interface PriceBlock {
  startMs: number;
  endMs: number;
  avgPrice: number;
  estimated: boolean;
}

/** Cheapest run of `hours` consecutive priced hours starting no earlier than the hour containing
 * `fromMs`; ties keep the earliest. */
export function cheapestBlock(timeline: readonly PricePointMs[], hours: number, fromMs: number): PriceBlock | null {
  if (!(hours >= 1)) return null;
  const prices = indexPrices(timeline);
  const fromHourMs = floorHour(fromMs);
  let best: PriceBlock | null = null;
  for (const point of timeline) {
    if (point.ms < fromHourMs) continue;
    let sum = 0;
    let estimated = false;
    let complete = true;
    for (let h = 0; h < hours; h++) {
      const p = prices.get(point.ms + h * HOUR_MS);
      if (!p) {
        complete = false;
        break;
      }
      sum += p.price;
      if (p.estimated) estimated = true;
    }
    if (!complete) continue;
    const avgPrice = sum / hours;
    if (!best || avgPrice < best.avgPrice - EPSILON_KR)
      best = { startMs: point.ms, endMs: point.ms + hours * HOUR_MS, avgPrice, estimated };
  }
  return best;
}
