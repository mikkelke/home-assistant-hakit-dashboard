import { describe, expect, it, vi } from 'vitest';
import { COFFEE_DEMO_SCENARIOS } from '../demoStore';
import { COFFEE_ENTITY_IDS } from '../entities';
import {
  parseCoffeeAdvice,
  parseCoffeeBaseline,
  parseCoffeeBeans,
  parseCoffeeBrews,
  parseCoffeeLive,
  parseCoffeeRecipes,
  parseCoffeeState,
  stageLabel,
  usualRecipe,
} from '../model';
import { waterShort } from '../view';

vi.mock('@hakit/core', () => ({ useHass: { getState: () => ({ connection: null }) } }));

const { coffeeDemo } = await import('../demo');

const ANCHOR = Date.parse('2026-10-20T05:42:26Z');

/** Contract v1, 2.1: a string, a list of strings, or a list of flat dicts of strings. */
function leavesAreStrings(value: unknown): boolean {
  if (typeof value === 'string') return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    item =>
      typeof item === 'string' || (typeof item === 'object' && item !== null && Object.values(item).every(leaf => typeof leaf === 'string'))
  );
}

/** Contract v1, 2.1.7. */
const CAPS_KB: Record<string, number> = {
  'sensor.coffee_state': 2,
  'sensor.coffee_live': 6,
  'sensor.coffee_baseline': 5,
  'sensor.coffee_brews': 14,
  'sensor.coffee_recipes': 4,
  'sensor.coffee_advice': 4,
  'sensor.coffee_beans': 2,
};

describe('coffee demo', () => {
  for (const scenario of COFFEE_DEMO_SCENARIOS) {
    it(`${scenario}: all seven entities, encoded as the coffee app publishes them`, () => {
      const { entities } = coffeeDemo(scenario, ANCHOR, ANCHOR + 2000);
      expect(Object.keys(entities).sort()).toEqual([...COFFEE_ENTITY_IDS].sort());
      for (const [id, entity] of Object.entries(entities)) {
        expect(entity?.attributes.v, id).toBe('1');
        for (const [key, value] of Object.entries(entity?.attributes ?? {})) expect(leavesAreStrings(value), `${id}.${key}`).toBe(true);
        expect(JSON.stringify(entity?.attributes).length, id).toBeLessThan(CAPS_KB[id] * 1024);
      }
      expect(parseCoffeeState(entities['sensor.coffee_state'])).not.toBeNull();
      expect(parseCoffeeState(entities['sensor.coffee_state'])?.tankMl).toBe(946);
      expect(parseCoffeeLive(entities['sensor.coffee_live'])).not.toBeNull();
      expect(parseCoffeeBaseline(entities['sensor.coffee_baseline'])).not.toBeNull();
      expect(parseCoffeeBeans(entities['sensor.coffee_beans'])?.remainingG).toBeGreaterThan(0);
      expect(parseCoffeeBrews(entities['sensor.coffee_brews'])?.brews).toHaveLength(22);
      expect(parseCoffeeRecipes(entities['sensor.coffee_recipes'])?.recipes).toHaveLength(4);
      expect(parseCoffeeAdvice(entities['sensor.coffee_advice'])).not.toBeNull();
    });
  }

  it('live plays the brew second by second, Pour 3/4 at 1:28, and ends ready', () => {
    const start = coffeeDemo('live', ANCHOR, ANCHOR);
    const state = parseCoffeeState(start.entities['sensor.coffee_state'])!;
    const live = parseCoffeeLive(start.entities['sensor.coffee_live'])!;
    expect(state.phase).toBe('brewing');
    expect(stageLabel(state.pour, state.poursTotal)).toBe('Pour 3/4');
    expect(live.cup).toHaveLength(89);
    expect(parseCoffeeLive(coffeeDemo('live', ANCHOR, ANCHOR + 10_000).entities['sensor.coffee_live'])!.cup).toHaveLength(99);
    const later = parseCoffeeState(coffeeDemo('live', ANCHOR, ANCHOR + 130_000).entities['sensor.coffee_state'])!;
    expect(later.phase).toBe('ready');
    expect(later.cupG).toBeGreaterThan(200);
  });

  it('carries a plausible tank in every scenario, a low one in water_low and none known in water_unknown', () => {
    for (const scenario of COFFEE_DEMO_SCENARIOS) {
      const tank = parseCoffeeState(coffeeDemo(scenario, ANCHOR, ANCHOR + 2000).entities['sensor.coffee_state'])!;
      if (scenario === 'water_unknown') {
        expect(tank.tankLeftMl, scenario).toBeNull();
        expect(tank.tankFilledAtMs, scenario).toBeNull();
      } else {
        expect(tank.tankLeftMl, scenario).toBeGreaterThanOrEqual(0);
        expect(tank.tankLeftMl, scenario).toBeLessThanOrEqual(946);
        expect(tank.tankFilledAtMs, scenario).toBeLessThan(ANCHOR);
      }
    }
    const low = parseCoffeeState(coffeeDemo('water_low', ANCHOR, ANCHOR).entities['sensor.coffee_state'])!;
    expect(low.phase).toBe('idle');
    expect(low.tankLeftMl).toBe(150);
    expect(
      waterShort(low, usualRecipe(parseCoffeeRecipes(coffeeDemo('water_low', ANCHOR, ANCHOR).entities['sensor.coffee_recipes'])))
    ).toEqual({
      leftMl: 150,
      needMl: 315,
    });
    const quiet = parseCoffeeState(coffeeDemo('idle', ANCHOR, ANCHOR).entities['sensor.coffee_state'])!;
    expect(waterShort(quiet, { totalMl: 255 })).toBeNull();
  });

  it('lost link leaves the seconds after the last fresh one empty', () => {
    const live = parseCoffeeLive(coffeeDemo('lost_link', ANCHOR, ANCHOR).entities['sensor.coffee_live'])!;
    expect(live.status).toBe('stale');
    expect(live.cup[60]).not.toBeNull();
    expect(live.cup.slice(61)).toEqual(new Array(live.cup.length - 61).fill(null));
  });

  it('the usual band is ready with seven brews; building has none', () => {
    const ready = parseCoffeeBaseline(coffeeDemo('idle', ANCHOR, ANCHOR).entities['sensor.coffee_baseline'])!;
    expect(ready.n).toBe(7);
    expect(ready.cupLo.length).toBeGreaterThan(90);
    expect(ready.planStepS).toBe(1);
    expect(parseCoffeeBaseline(coffeeDemo('building', ANCHOR, ANCHOR).entities['sensor.coffee_baseline'])!.status).toBe('building');
  });

  it('carries recent curves for the history', () => {
    const { recent } = coffeeDemo('idle', ANCHOR, ANCHOR);
    expect(Object.keys(recent!.curves).length).toBe(21);
    expect(recent!.bands.bl1.n).toBe(7);
  });
});
