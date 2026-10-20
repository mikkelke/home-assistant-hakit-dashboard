import { describe, expect, it } from 'vitest';
import {
  coffeeCycle,
  formatMinSec,
  formatRatio,
  inferPlanStep,
  isEventful,
  parseCoffeeAdvice,
  parseCoffeeBaseline,
  parseCoffeeBeans,
  parseCoffeeBrews,
  parseCoffeeLive,
  parseCoffeeRecipes,
  parseCoffeeState,
  parsePlanPours,
  parseRecipePours,
  parseTenths,
  phaseWord,
  planWaterFromPours,
  recipePlanPours,
  secondsLeft,
  stageLabel,
  usualRecipe,
} from '../model';

const entity = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes: { v: '1', ...attributes } });

/** Contract v1, section 2.8. */
const STATE = entity('brewing', {
  machine: 'working',
  power_w: '1043',
  link: 'connected',
  brew_id: 'c1792991000',
  source: 'tablet',
  recipe_id: '1234567',
  recipe_name: '4 Pour Recipe',
  variant: 'usual',
  bean_id: 'b1',
  bean_name: 'Kenya Kiambu',
  pour: '3',
  pours_total: '4',
  started_at: '2026-10-20T05:40:20+00:00',
  first_bloom_at: '2026-10-20T05:40:58+00:00',
  eta: '2026-10-20T05:44:25+00:00',
  eta_basis: 'baseline',
  verdict: 'on_track',
  who: 'mikkel',
  who_method: 'bermuda',
  notify: 'mikkel',
});
const LIVE = entity('live', {
  brew_id: 'c1792991000',
  t0: '2026-10-20T05:40:58+00:00',
  step_s: '1',
  cup: '0,0,3,9,18',
  water: '0,32,67,101,135',
  pours: '0:0',
  plan_water: '0,35,70,105,140',
  plan_pours: '0-13:circular:93:45;28-51:circular:93:80;66-85:circular:93:65;97-116:centered:93:65',
  last_fresh_at: '2026-10-20T05:41:03+00:00',
});
const BEANS = entity('112', {
  bean_id: 'b1',
  bean_name: 'Kenya Kiambu',
  added_at: '2026-10-12T06:10:00+00:00',
  dose_g: '15',
  brews_left: '7',
  known_beans: [{ id: 'b1', name: 'Kenya Kiambu' }],
});

describe('series', () => {
  it('reads tenths and leaves gaps open', () => {
    expect(parseTenths('0,12,35,,,80')).toEqual([0, 1.2, 3.5, null, null, 8]);
    expect(parseTenths('')).toEqual([]);
    expect(parseTenths(undefined)).toEqual([]);
    expect(parseTenths('5,x,7')).toEqual([0.5, null, 0.7]);
    expect(parseTenths([0, 12, null, 30])).toEqual([0, 1.2, null, 3]);
  });

  it('reads the planned pours of the live entity', () => {
    expect(parsePlanPours('0-13:circular:93:45;97-116:centered:93:65')).toEqual([
      { start: 0, end: 13, pattern: 'circular', tempC: 93, ml: 45 },
      { start: 97, end: 116, pattern: 'centered', tempC: 93, ml: 65 },
    ]);
    expect(parsePlanPours('garbage;10-5:spiral:93:20')).toEqual([]);
  });

  it('lays a recipe out on its own time axis: volume over flow, then the pause', () => {
    const pours = parseRecipePours('45/93/3.5/circular/15;80/93/3.5/circular/15;65/93/3.5/circular/12;65/93/3.5/centered/5');
    expect(pours[0]).toEqual({ ml: 45, tempC: 93, flow: 3.5, pattern: 'circular', pauseS: 15 });
    expect(recipePlanPours(pours).map(pour => `${pour.start}-${pour.end}`)).toEqual(['0-13', '28-51', '66-85', '97-116']);
    const water = planWaterFromPours(recipePlanPours(pours));
    expect(water).toHaveLength(117);
    expect(water[116]).toBe(255);
  });

  it('infers the step of a plan series from where its total is first reached', () => {
    const pours = parsePlanPours('0-13:circular:93:45;28-51:circular:93:80');
    const perSecond = planWaterFromPours(pours, 1);
    const perTwo = planWaterFromPours(pours, 2);
    expect(inferPlanStep([...perSecond, 125, 125], pours)).toBe(1);
    expect(inferPlanStep([...perTwo, 125, 125, 125], pours)).toBe(2);
    expect(inferPlanStep([], pours)).toBe(1);
  });
});

describe('sensor.coffee_state', () => {
  it('reads the contract example', () => {
    const state = parseCoffeeState(STATE)!;
    expect(state.phase).toBe('brewing');
    expect(state.powerW).toBe(1043);
    expect(state.pour).toBe(3);
    expect(state.poursTotal).toBe(4);
    expect(state.etaMs).toBe(Date.parse('2026-10-20T05:44:25Z'));
    expect(state.notify).toBe('mikkel');
    expect(state.fault).toBeNull();
    expect(state.push).toBeNull();
  });

  it('is unknown while the entity is missing, unavailable or in an unknown state', () => {
    expect(parseCoffeeState(undefined)).toBeNull();
    expect(parseCoffeeState(entity('unavailable'))).toBeNull();
    expect(parseCoffeeState(entity('boiling'))).toBeNull();
  });

  it('reads "0" as zero and a missing attribute as unknown', () => {
    const state = parseCoffeeState(entity('grinding', { pour: '0', link: 'nonsense', who: 'none', notify: 'none' }))!;
    expect(state.pour).toBe(0);
    expect(state.link).toBe('not_connected');
    expect(state.who).toBeNull();
    expect(state.notify).toBeNull();
    expect(state.etaMs).toBeNull();
  });

  it('reads the cup, unknown when missing, and a start waiting for one', () => {
    expect(parseCoffeeState(entity('awaiting_cup', { cup: 'absent' }))).toMatchObject({ phase: 'awaiting_cup', cup: 'absent' });
    expect(parseCoffeeState(entity('idle'))?.cup).toBe('unknown');
    expect(parseCoffeeState(entity('idle', { cup: 'maybe' }))?.cup).toBe('unknown');
    expect(phaseWord({ phase: 'awaiting_cup', pour: 0, poursTotal: null })).toBe('Put cup on');
    expect(isEventful('awaiting_cup')).toBe(true);
    expect(coffeeCycle(entity('awaiting_cup'), 0).status).toBe('idle');
  });

  it('names the stage: the bloom, then pours', () => {
    expect(stageLabel(1, 4)).toBe('Bloom 1/4');
    expect(stageLabel(3, 4)).toBe('Pour 3/4');
    expect(stageLabel(0, 4)).toBeNull();
    expect(stageLabel(2, null)).toBe('Pour 2');
    expect(phaseWord({ phase: 'grinding', pour: 0, poursTotal: 4 })).toBe('Grinding');
    expect(phaseWord({ phase: 'brewing', pour: null, poursTotal: null })).toBe('Brewing');
    expect(phaseWord({ phase: 'brewing', pour: 1, poursTotal: 4 })).toBe('Bloom 1/4');
    expect(phaseWord({ phase: 'ready', pour: 4, poursTotal: 4 })).toBe('Ready');
    expect(phaseWord({ phase: 'idle', pour: null, poursTotal: null })).toBeNull();
  });

  it('counts down to the ETA and never below zero', () => {
    const eta = Date.parse('2026-10-20T05:44:25Z');
    expect(secondsLeft(eta, eta - 115_000)).toBe(115);
    expect(formatMinSec(115)).toBe('1:55');
    expect(secondsLeft(eta, eta + 5000)).toBe(0);
    expect(secondsLeft(null, eta)).toBeNull();
    expect(formatMinSec(-4)).toBe('-0:04');
  });

  it('is a Home run from first bloom to the ETA, and ready until picked up', () => {
    const bloom = Date.parse('2026-10-20T05:40:58Z');
    const eta = Date.parse('2026-10-20T05:44:25Z');
    const running = coffeeCycle(STATE, bloom + (eta - bloom) / 2);
    expect(running.status).toBe('running');
    expect(running.progressPct).toBeCloseTo(50);
    expect(running.etaMs).toBe(eta);
    expect(running.startMs).toBe(Date.parse('2026-10-20T05:40:20Z'));
    expect(coffeeCycle(entity('paused', { ...STATE.attributes }), bloom).etaMs).toBeNull();
    expect(coffeeCycle(entity('ready', { ...STATE.attributes }), eta).status).toBe('ready');
    expect(coffeeCycle(entity('idle'), eta).status).toBe('idle');
    expect(coffeeCycle(entity('starting'), eta).status).toBe('idle');
    expect(coffeeCycle(undefined, eta).status).toBe('idle');
  });
});

describe('sensor.coffee_live', () => {
  it('reads the contract example', () => {
    const live = parseCoffeeLive(LIVE)!;
    expect(live.status).toBe('live');
    expect(live.cup).toEqual([0, 0, 0.3, 0.9, 1.8]);
    expect(live.water[4]).toBe(13.5);
    expect(live.pours).toEqual([{ s: 0, index: 0 }]);
    expect(live.planPours).toHaveLength(4);
    expect(live.stepS).toBe(1);
    expect(live.t0Ms).toBe(Date.parse('2026-10-20T05:40:58Z'));
  });
});

describe('the other entities', () => {
  it('reads the beans, "unknown" until the first top-up', () => {
    const beans = parseCoffeeBeans(BEANS)!;
    expect(beans.remainingG).toBe(112);
    expect(beans.brewsLeft).toBe(7);
    expect(beans.low).toBe(false);
    expect(beans.knownBeans).toEqual([{ id: 'b1', name: 'Kenya Kiambu' }]);
    expect(parseCoffeeBeans(entity('unknown'))!.remainingG).toBeNull();
    expect(parseCoffeeBeans(entity('-12', { low: 'yes' }))).toMatchObject({ remainingG: 0, low: true });
  });

  it('reads the baseline band only as numbers', () => {
    const baseline = parseCoffeeBaseline(
      entity('ready', { n: '7', step_s: '2', cup_lo: '0,,20', cup_hi: '0,15,30', total_s_median: '203', brew_ids: 'c1,c2' })
    )!;
    expect(baseline.n).toBe(7);
    expect(baseline.cupLo).toEqual([0, null, 2]);
    expect(baseline.totalSMedian).toBe(203);
    expect(baseline.brewIds).toEqual(['c1', 'c2']);
    expect(parseCoffeeBaseline(entity('building', { n: '3' }))!.cupLo).toEqual([]);
  });

  it('reads the ledger with its deltas and the trial it carried', () => {
    const brews = parseCoffeeBrews(
      entity('2026-10-20T05:44:30+00:00', {
        brews: [
          {
            id: 'c1',
            at: '2026-10-20T05:44:30+00:00',
            outcome: 'complete',
            rating: 'sour',
            d_total_s: '+4',
            d_cup_g: '0',
            trial: 'grind_size:46>44',
            who: 'none',
          },
          { at: 'no id' },
        ],
        weeks: '2,3,,1',
        taste: 'sour:2,balanced:2,bitter:0',
        last_curve: '0,10,40',
      })
    )!;
    expect(brews.brews).toHaveLength(1);
    expect(brews.brews[0]).toMatchObject({
      rating: 'sour',
      dTotalS: 4,
      dCupG: 0,
      who: null,
      trial: { field: 'grind_size', from: '46', to: '44' },
    });
    expect(brews.weeks).toEqual([2, 3, 0, 1]);
    expect(brews.taste).toEqual({ sour: 2, balanced: 2, bitter: 0 });
    expect(brews.lastCurve).toEqual([0, 1, 4]);
  });

  it('reads recipes and finds the usual', () => {
    const recipes = parseCoffeeRecipes(
      entity('4 Pour Recipe', {
        usual_id: '1',
        recipes: [
          { id: '1', name: '4 Pour Recipe', dose_g: '15', ratio: '17', pours: '45/93/3.5/circular/15' },
          { id: '2', name: 'House blend', ratio: '1:15' },
        ],
      })
    );
    expect(usualRecipe(recipes)?.name).toBe('4 Pour Recipe');
    expect(recipes?.recipes[0].ratio).toBe('1:17');
    expect(recipes?.recipes[1].ratio).toBe('1:15');
    expect(formatRatio('16.5')).toBe('1:16.5');
    expect(formatRatio('x')).toBeNull();
  });

  it('reads the advice and its thread', () => {
    const advice = parseCoffeeAdvice(
      entity('suggested', {
        advice_id: 'a1',
        from: '46',
        to: '44',
        confidence: 'low',
        brew_ids: 'c1,c2,c3,c4',
        thread: [
          { role: 'advisor', at: '2026-10-20T05:50:00+00:00', text: 'Try 44.' },
          { role: 'person', who: 'kristine', text: 'It was bitter' },
          { role: 'robot', text: 'dropped' },
        ],
      })
    )!;
    expect(advice.status).toBe('suggested');
    expect(advice.brewIds).toHaveLength(4);
    expect(advice.thread.map(message => message.role)).toEqual(['advisor', 'person']);
    expect(advice.thread[1].who).toBe('kristine');
    expect(parseCoffeeAdvice(entity('no_agent'))!.status).toBe('no_agent');
  });
});
