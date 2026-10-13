import { describe, expect, it } from 'vitest';
import { PLAN_APPLIANCES, PRESS_WINDOW_TOLERANCE_KR } from '../../config/plan';
import { buildHourlyPrices, isPlanPrice } from '../priceTimeline';
import {
  chainProgrammes,
  cheapestBlock,
  costCurve,
  indexPrices,
  passesSavingRule,
  planStart,
  runCost,
  startCost,
  type PlanProgramme,
  type StartPlan,
} from '../startPlan';
import { fixtureProgramme, fixtureTimeline, home, hourly, HOUR_MS, MINUTE_MS, programme } from './testUtils';
import type { PricePointMs } from '../priceTimeline';

const washerSteps = PLAN_APPLIANCES.find(a => a.key === 'washer')!.knobStepsMin;
const dishwasherSteps = PLAN_APPLIANCES.find(a => a.key === 'dishwasher')!.knobStepsMin;
const dryerSteps = PLAN_APPLIANCES.find(a => a.key === 'dryer')!.knobStepsMin;

function cost(p: PlanProgramme, timeline: PricePointMs[], startMs: number): number {
  const result = runCost(p, indexPrices(timeline), startMs);
  if (!result) throw new Error('unpriced');
  return result.kr;
}

/** Every whole-minute press in the advertised window is feasible and within tolerance. */
function expectWindowHolds(p: PlanProgramme, timeline: PricePointMs[], plan: StartPlan, doneByMs: number | null = null) {
  const choice = plan.plan!;
  const prices = indexPrices(timeline);
  const hourEnd = Math.floor(plan.pressFromMs / HOUR_MS) * HOUR_MS + HOUR_MS;
  expect(choice.pressFromMs).toBeGreaterThanOrEqual(plan.pressFromMs);
  expect(choice.pressUntilMs).toBeLessThan(hourEnd);
  for (let t = choice.pressFromMs; t <= choice.pressUntilMs; t = Math.floor(t / MINUTE_MS) * MINUTE_MS + MINUTE_MS) {
    const c = startCost(p, prices, t + choice.knobMin * MINUTE_MS, doneByMs);
    expect(c).not.toBeNull();
    expect(c!.kr).toBeLessThanOrEqual(choice.costKr + PRESS_WINDOW_TOLERANCE_KR + 1e-9);
  }
}

describe('knob steps', () => {
  it('uses 30-minute steps up to 3 h, then hourly to 24 h; dryer hourly', () => {
    expect(washerSteps.slice(0, 8)).toEqual([0, 30, 60, 90, 120, 150, 180, 240]);
    expect(washerSteps[washerSteps.length - 1]).toBe(1440);
    expect(washerSteps).toHaveLength(28);
    expect(dishwasherSteps).toEqual(washerSteps);
    expect(dryerSteps.slice(0, 3)).toEqual([0, 60, 120]);
    expect(dryerSteps).toHaveLength(25);
  });
});

describe('measured acceptance cases', () => {
  const washer = fixtureProgramme('washer');
  const dishwasher = fixtureProgramme('dishwasher');

  it('01.10 washer Bomuld 60 without delay: 20:05 -> 3,94 kr, 20:50 -> 3,18 kr', () => {
    const timeline = fixtureTimeline('2026-10-01', '2026-10-02');
    expect(cost(washer, timeline, home(2026, 10, 1, 20, 5))).toBeCloseTo(3.94, 1);
    expect(Math.abs(cost(washer, timeline, home(2026, 10, 1, 20, 5)) - 3.94)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(cost(washer, timeline, home(2026, 10, 1, 20, 50)) - 3.18)).toBeLessThanOrEqual(0.02);
  });

  it('01.10 washer with the 6 h knob: 1,98 vs 1,99, and the planner picks 6 h at 20:05', () => {
    const timeline = fixtureTimeline('2026-10-01', '2026-10-02');
    expect(Math.abs(cost(washer, timeline, home(2026, 10, 1, 20, 5) + 6 * HOUR_MS) - 1.98)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(cost(washer, timeline, home(2026, 10, 1, 20, 50) + 6 * HOUR_MS) - 1.99)).toBeLessThanOrEqual(0.02);

    const plan = planStart(washer, timeline, { nowMs: home(2026, 10, 1, 20, 5), knobStepsMin: washerSteps });
    expect(plan.plan?.kind).toBe('knob');
    expect(plan.plan?.knobMin).toBe(360);
    expect(Math.abs(plan.plan!.costKr - 1.98)).toBeLessThanOrEqual(0.02);
    expect(plan.savingKr).toBeCloseTo(plan.noDelay!.kr - plan.plan!.costKr);
    expectWindowHolds(washer, timeline, plan);
  });

  it('09.10 dishwasher ECO at 20:05: knob 8 h, 0,33 kr, press by 20:30', () => {
    const timeline = fixtureTimeline('2026-10-09', '2026-10-10');
    const plan = planStart(dishwasher, timeline, { nowMs: home(2026, 10, 9, 20, 5), knobStepsMin: dishwasherSteps });
    const choice = plan.plan!;
    expect(choice.kind).toBe('knob');
    expect(choice.knobMin).toBe(480);
    expect(Math.abs(choice.costKr - 0.33)).toBeLessThanOrEqual(0.01);
    expect(choice.pressFromMs).toBe(home(2026, 10, 9, 20, 5));
    expect(Math.abs(choice.pressUntilMs - home(2026, 10, 9, 20, 30))).toBeLessThanOrEqual(MINUTE_MS);
    expect(choice.showPressBy).toBe(true);
    expect(Math.abs(cost(dishwasher, timeline, home(2026, 10, 9, 20, 50) + 8 * HOUR_MS) - 0.48)).toBeLessThanOrEqual(0.01);
    expectWindowHolds(dishwasher, timeline, plan);
  });
});

describe('press window (A4)', () => {
  const washer = fixtureProgramme('washer');
  const dishwasher = fixtureProgramme('dishwasher');
  const timeline = fixtureTimeline('2026-10-09', '2026-10-10');

  it('never runs past the end of the current hour', () => {
    for (const minute of [0, 20, 45, 58]) {
      const plan = planStart(washer, timeline, { nowMs: home(2026, 10, 9, 20, minute, 30), knobStepsMin: washerSteps });
      expectWindowHolds(washer, timeline, plan);
    }
  });

  it('respects done-by for every press in the window', () => {
    const doneByMs = home(2026, 10, 10, 7);
    for (const minute of [5, 40]) {
      const plan = planStart(dishwasher, timeline, { nowMs: home(2026, 10, 9, 20, minute), knobStepsMin: dishwasherSteps, doneByMs });
      const choice = plan.plan!;
      expect(choice.pressUntilMs + choice.knobMin * MINUTE_MS + dishwasher.completionMin! * MINUTE_MS).toBeLessThanOrEqual(doneByMs);
      expectWindowHolds(dishwasher, timeline, plan, doneByMs);
    }
  });

  it('cuts the window at the done-by deadline', () => {
    const p = programme(Array(60).fill(10), 60);
    const flat = hourly(home(2026, 10, 9, 20), Array(10).fill(1));
    const doneByMs = home(2026, 10, 9, 21, 30);
    const plan = planStart(p, flat, { nowMs: home(2026, 10, 9, 20, 5), knobStepsMin: [0], doneByMs });
    expect(plan.plan?.pressUntilMs).toBe(home(2026, 10, 9, 20, 30));
  });

  it('reports a done-by that even an immediate start misses', () => {
    const plan = planStart(dishwasher, timeline, {
      nowMs: home(2026, 10, 9, 20, 5),
      knobStepsMin: dishwasherSteps,
      doneByMs: home(2026, 10, 9, 22),
    });
    expect(plan.doneByMissed).toBe(true);
    expect(plan.plan).toBeNull();
  });

  it('makes no finish claim and applies no done-by when completion is unknown', () => {
    const p = programme(Array(60).fill(10), null);
    const flat = hourly(home(2026, 10, 9, 20), Array(10).fill(1));
    const doneByMs = home(2026, 10, 9, 20, 30);
    const plan = planStart(p, flat, { nowMs: home(2026, 10, 9, 20, 5), knobStepsMin: [0], doneByMs });
    expect(plan.doneByMissed).toBe(false);
    expect(plan.plan?.doneMs).toBeNull();
    expect(plan.plan?.costKr).toBeCloseTo(0.6);
    const curve = costCurve(p, flat, { pressFromMs: home(2026, 10, 9, 20, 5), knobStepsMin: [0], doneByMs });
    expect(curve.points.some(point => point.tooLate)).toBe(false);
  });

  it('plans from the earliest press time of a running appliance, not from now', () => {
    const plan = planStart(washer, timeline, {
      nowMs: home(2026, 10, 9, 19, 10),
      earliestPressMs: home(2026, 10, 9, 21, 40),
      knobStepsMin: washerSteps,
    });
    expect(plan.pressFromMs).toBe(home(2026, 10, 9, 21, 40));
    expect(plan.plan!.pressFromMs).toBeGreaterThanOrEqual(home(2026, 10, 9, 21, 40));
    expect(plan.plan!.pressUntilMs).toBeLessThan(home(2026, 10, 9, 22));
    expect(plan.noDelay!.kr).toBeCloseTo(cost(washer, timeline, home(2026, 10, 9, 21, 40)));
  });

  it('offers pressing later this hour only when it passes the saving rule', () => {
    const p = programme(Array(60).fill(20));
    const t0 = home(2026, 10, 9, 20);
    const prices = hourly(t0, [2, 2, 2, 2, 2, 0, 2, 2, 2, 2]);
    const plan = planStart(p, prices, { nowMs: home(2026, 10, 9, 20, 5), knobStepsMin: dryerSteps });
    expect(plan.plan?.kind).toBe('wait');
    expect(plan.plan?.knobMin).toBe(240);
    expect(plan.plan?.pressFromMs).toBe(home(2026, 10, 9, 20, 58));
    expect(plan.plan?.pressUntilMs).toBe(home(2026, 10, 9, 20, 59));
    expect(plan.plan?.costKr).toBeCloseTo(0.08);
  });
});

describe('advertised plan (A15 at the advertised start)', () => {
  it('prices the advertised start and keeps the saving rule for every press in the window', () => {
    const p = programme(Array(60).fill(10));
    const timeline = hourly(home(2026, 10, 9, 20), [2, 2, 2.22, 2.22, 1.78, 2.22, 2.22, 2.22]);
    const plan = planStart(p, timeline, { nowMs: home(2026, 10, 9, 20, 30), knobStepsMin: dryerSteps });
    const choice = plan.plan!;
    expect(choice.kind).toBe('wait');
    expect(choice.knobMin).toBe(180);
    expect(choice.costKr).toBeCloseTo(cost(p, timeline, choice.startMs), 9);
    expect(plan.savingKr).toBeCloseTo(plan.noDelay!.kr - choice.costKr, 9);
    expect(passesSavingRule(plan.noDelay!.kr, choice.costKr)).toBe(true);
    for (let t = choice.pressFromMs; t <= choice.pressUntilMs; t += MINUTE_MS) {
      expect(passesSavingRule(plan.noDelay!.kr, cost(p, timeline, t + choice.knobMin * MINUTE_MS))).toBe(true);
    }
    expect(choice.pressFromMs).toBe(home(2026, 10, 9, 20, 58));
  });
});

describe('cost model', () => {
  it('integrates fractional-minute overlap instead of rounding the start (A6)', () => {
    const p = programme(Array(60).fill(60));
    const prices = hourly(home(2026, 10, 9, 20), [1, 2]);
    expect(cost(p, prices, home(2026, 10, 9, 20, 59, 30))).toBeCloseTo(0.03 + 3.57 * 2, 9);
    expect(cost(p, prices, home(2026, 10, 9, 20, 59, 30))).not.toBeCloseTo(cost(p, prices, home(2026, 10, 9, 21)), 3);
  });

  it('needs prices only for hours that carry energy', () => {
    const p = programme([...Array(60).fill(10), ...Array(60).fill(0), ...Array(60).fill(10)]);
    const t0 = home(2026, 10, 9, 20);
    expect(runCost(p, indexPrices(hourly(t0, [1, null, 1])), t0)?.kr).toBeCloseTo(1.2);
    expect(runCost(p, indexPrices(hourly(t0, [1, 1, null])), t0)).toBeNull();
  });

  it('flags estimated hours', () => {
    const p = programme(Array(90).fill(10));
    const t0 = home(2026, 10, 9, 20);
    const prices = [...hourly(t0, [1]), ...hourly(t0 + HOUR_MS, [1], true)];
    expect(runCost(p, indexPrices(prices), t0)?.kr).toBeCloseTo(0.9);
    expect(runCost(p, indexPrices(prices), t0)?.estimated).toBe(true);
    expect(runCost(p, indexPrices(prices), t0 - 40 * MINUTE_MS)).toBeNull();
    const plan = planStart(p, prices, { nowMs: t0, knobStepsMin: [0] });
    expect(plan.plan?.estimated).toBe(true);
  });

  it('drops starts that touch an unpriced hour and reports the priced horizon', () => {
    const p = programme(Array(60).fill(10));
    const t0 = home(2026, 10, 9, 20);
    const prices = hourly(t0, [3, 3, 1]);
    expect(startCost(p, indexPrices(prices), t0 + 2 * HOUR_MS, null)?.kr).toBeCloseTo(0.6);
    expect(startCost(p, indexPrices(prices), t0 + 2 * HOUR_MS + 5 * MINUTE_MS, null)).toBeNull();
    const plan = planStart(p, prices, { nowMs: t0 + 5 * MINUTE_MS, knobStepsMin: dryerSteps });
    expect(plan.pricedUntilMs).toBe(t0 + 3 * HOUR_MS);
    expect(plan.plan?.kind).toBe('wait');
    expect(plan.plan?.knobMin).toBe(60);
    expect(plan.plan?.pressUntilMs).toBe(t0 + 59 * MINUTE_MS);
  });

  it('prices free and negative hours', () => {
    expect([0, -0.3, -5, 15].every(isPlanPrice)).toBe(true);
    expect([-5.01, 15.01, NaN, Infinity, null, '1'].some(isPlanPrice)).toBe(false);
    const t0 = home(2026, 10, 9, 20);
    const timeline = buildHourlyPrices(
      [
        { hour: new Date(t0).toISOString(), price: 0.5 },
        { hour: new Date(t0 + HOUR_MS).toISOString(), price: 0 },
        { hour: new Date(t0 + 2 * HOUR_MS).toISOString(), price: -0.4 },
        { hour: new Date(t0 + 3 * HOUR_MS).toISOString(), price: 109.57 },
      ],
      null,
      false,
      null
    );
    expect(timeline.map(p => p.price)).toEqual([0.5, 0, -0.4]);
    const p = programme(Array(60).fill(10));
    expect(cost(p, timeline, t0 + 2 * HOUR_MS)).toBeCloseTo(-0.24);
    const plan = planStart(p, timeline, { nowMs: t0, knobStepsMin: dryerSteps });
    expect(plan.plan?.knobMin).toBe(120);
    expect(plan.savingKr).toBeCloseTo(0.54);
  });

  it('applies the one saving rule', () => {
    expect(passesSavingRule(1, 0.9)).toBe(true);
    expect(passesSavingRule(0.5, 0.41)).toBe(false);
    expect(passesSavingRule(2, 1.85)).toBe(false);
    expect(passesSavingRule(0, -0.1)).toBe(true);
    expect(passesSavingRule(-1, -1.05)).toBe(false);
    expect(passesSavingRule(-1, -1.1)).toBe(true);
  });

  it('starts right away when a delay would not pass the saving rule', () => {
    const p = programme(Array(60).fill(10));
    const t0 = home(2026, 10, 9, 20);
    const plan = planStart(p, hourly(t0, [1, 0.95, 0.95]), { nowMs: t0, knobStepsMin: dryerSteps });
    expect(plan.plan?.kind).toBe('now');
    expect(plan.plan?.knobMin).toBe(0);
    expect(plan.savingKr).toBeNull();
  });

  it('uses half-hour knob steps below 3 h', () => {
    const p = programme(Array(30).fill(20));
    const t0 = home(2026, 10, 9, 20);
    const plan = planStart(p, hourly(t0, [2, 0.1, 2, 2]), { nowMs: t0 + 30 * MINUTE_MS, knobStepsMin: washerSteps });
    expect(plan.plan?.knobMin).toBe(30);
    expect(plan.plan?.kind).toBe('knob');
  });
});

describe('cheapestBlock', () => {
  it('finds the cheapest 3 consecutive hours from the current hour', () => {
    const timeline = fixtureTimeline('2026-10-01', '2026-10-02');
    const from = home(2026, 10, 1, 20, 5);
    const block = cheapestBlock(timeline, 3, from)!;
    let best = Infinity;
    for (let s = home(2026, 10, 1, 20); s + 3 * HOUR_MS <= home(2026, 10, 3); s += HOUR_MS) {
      const avg = timeline.filter(p => p.ms >= s && p.ms < s + 3 * HOUR_MS).reduce((a, p) => a + p.price, 0) / 3;
      best = Math.min(best, avg);
    }
    expect(block.avgPrice).toBeCloseTo(best, 9);
    expect(block.endMs - block.startMs).toBe(3 * HOUR_MS);
  });

  it('skips blocks with a missing hour', () => {
    const t0 = home(2026, 10, 9, 0);
    const block = cheapestBlock(hourly(t0, [1, 1, null, 0.1, 0.1, 5, 5]), 3, t0);
    expect(block?.startMs).toBe(t0 + 3 * HOUR_MS);
    expect(cheapestBlock(hourly(t0, [1, null, 1]), 3, t0)).toBeNull();
  });
});

describe('costCurve', () => {
  it('gives at most 300 points over 24 h with reachable knob markers', () => {
    const washer = fixtureProgramme('washer');
    const timeline = fixtureTimeline('2026-10-01', '2026-10-02');
    const pressFromMs = home(2026, 10, 1, 20, 5, 20);
    const doneByMs = home(2026, 10, 2, 7);
    const curve = costCurve(washer, timeline, { pressFromMs, knobStepsMin: washerSteps, doneByMs });
    expect(curve.points.length).toBeGreaterThanOrEqual(288);
    expect(curve.points.length).toBeLessThanOrEqual(300);
    expect(curve.points[0].startMs).toBe(pressFromMs);
    expect(curve.points[1].startMs % (5 * MINUTE_MS)).toBe(0);
    const six = curve.knobs.find(k => k.knobMin === 360)!;
    expect(Math.abs(six.costKr! - 1.98)).toBeLessThanOrEqual(0.02);
    expect(six.tooLate).toBe(false);
    expect(curve.knobs.find(k => k.knobMin === 720)!.tooLate).toBe(true);
    expect(curve.knobs).toHaveLength(28);
  });
});

describe('chainProgrammes', () => {
  it('runs the second programme after the first one is done plus the gap, with no energy in between', () => {
    const chained = chainProgrammes(programme([10, 20, 30], 5), programme([40, 50], 3), 10);
    expect(chained.energyMin).toBe(17);
    expect(Array.from(chained.whPerMin)).toEqual([10, 20, 30, ...Array(12).fill(0), 40, 50]);
    expect(chained.cumWh[chained.energyMin]).toBeCloseTo(150, 9);
    expect(chained.completionMin).toBe(5 + 10 + 3);
  });

  it('places the second programme after the first one energy when its completion is unknown', () => {
    const chained = chainProgrammes(programme([10, 20, 30], null), programme([40, 50], 3), 10);
    expect(chained.energyMin).toBe(15);
    expect(Array.from(chained.whPerMin.slice(13))).toEqual([40, 50]);
    expect(chained.completionMin).toBeNull();
    expect(chainProgrammes(programme([10], 1), programme([40, 50], null), 10).completionMin).toBeNull();
  });
});
