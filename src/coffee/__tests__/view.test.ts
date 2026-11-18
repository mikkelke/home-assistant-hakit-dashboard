import { describe, expect, it } from 'vitest';
import { parseCoffeeBeans, parseCoffeeRecipes } from '../model';
import { COFFEE_PHASES, isOnHome, type CoffeePhase } from '../state';
import {
  bagBrews,
  beanColors,
  brewView,
  canStart,
  maintenanceWord,
  pausedForWater,
  retagChoices,
  startFailure,
  waterCups,
  waterLine,
  waterShort,
  wantsConnect,
  type BrewView,
} from '../view';

const row = (id: string, detail: string | null, atMs: number | null, title = 'xBloom brewer rinse') => ({ id, title, detail, atMs });

describe('the Kitchen card footer', () => {
  it('names the next coffee maintenance by the brews left', () => {
    expect(
      maintenanceWord([
        row('maint:coffee:tank', 'empty, rinse, air-dry, 20 brews left, ~28.11', Date.parse('2026-11-28T08:00:00Z')),
        row('maint:coffee:rinse', 'dripper + shower screen, 10 brews left, ~08.11', Date.parse('2026-11-08T08:00:00Z')),
        row('maint:washer:drum', 'Bomuld 90, 2 runs left', Date.parse('2026-10-21T08:00:00Z')),
      ])
    ).toBe('Brew head in 10');
  });

  it('says due for an untimed row, and nothing without coffee rows', () => {
    expect(maintenanceWord([row('maint:coffee:tank', 'empty, rinse, air-dry, due', null)])).toBe('Tank due');
    expect(maintenanceWord([row('maint:washer:drum', 'Bomuld 90, 2 runs left', null)])).toBeNull();
  });
});

describe('opening the stage or the card', () => {
  it('connects to an awake machine without a link, and wakes a sleeping one', () => {
    expect(wantsConnect({ machine: 'awake', link: 'not_connected' })).toBe(true);
    expect(wantsConnect({ machine: 'working', link: 'connecting' })).toBe(true);
    expect(wantsConnect({ machine: 'awake', link: 'connected' })).toBe(false);
    expect(wantsConnect({ machine: 'asleep', link: 'not_connected' })).toBe(true);
    expect(wantsConnect({ machine: 'asleep', link: 'connected' })).toBe(true);
    expect(wantsConnect({ machine: 'off', link: 'not_connected' })).toBe(false);
    expect(wantsConnect({ machine: null, link: 'not_connected' })).toBe(false);
  });
});

describe('a refused start', () => {
  it('gives the machine its reason, and says when the xBloom app has it', () => {
    expect(startFailure({ phase: 'start_failed', startError: 'no_water', machine: 'awake' })?.label).toBe("Didn't start · No water");
    expect(startFailure({ phase: 'start_failed', startError: 'machine_busy', machine: 'awake' })?.label).toBe('Held by the xBloom app');
    expect(startFailure({ phase: 'start_failed', startError: 'machine_not_found', machine: 'asleep' })?.label).toBe(
      "Didn't start · Machine not found"
    );
    expect(startFailure({ phase: 'idle', startError: null, machine: 'awake' })).toBeNull();
  });
});

describe('the water tank', () => {
  const usual = { totalMl: 255 };

  it('is short when what is left cannot finish the cup and its 60 ml of bypass and margin', () => {
    expect(waterShort({ tankLeftMl: 150 }, usual)).toEqual({ leftMl: 150, needMl: 315 });
    expect(waterShort({ tankLeftMl: 314 }, usual)).toEqual({ leftMl: 314, needMl: 315 });
    expect(waterShort({ tankLeftMl: 315 }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 946 }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 0 }, { totalMl: 180 })).toEqual({ leftMl: 0, needMl: 240 });
  });

  it('judges each recipe by its own volume', () => {
    expect(waterShort({ tankLeftMl: 300 }, { totalMl: 225 })).toBeNull();
    expect(waterShort({ tankLeftMl: 300 }, { totalMl: 272 })).toEqual({ leftMl: 300, needMl: 332 });
  });

  it('is never short while the level or the recipe is unknown', () => {
    expect(waterShort({ tankLeftMl: null }, usual)).toBeNull();
    expect(waterShort({ tankLeftMl: 10 }, { totalMl: null })).toBeNull();
    expect(waterShort({ tankLeftMl: 10 }, null)).toBeNull();
    expect(waterShort(null, usual)).toBeNull();
  });

  it('counts the whole cups of the usual that are left', () => {
    expect(waterCups({ tankLeftMl: 946 }, usual)).toBe(3);
    expect(waterCups({ tankLeftMl: 640 }, usual)).toBe(2);
    expect(waterCups({ tankLeftMl: 315 }, usual)).toBe(1);
    expect(waterCups({ tankLeftMl: 314 }, usual)).toBe(0);
    expect(waterCups({ tankLeftMl: null }, usual)).toBeNull();
    expect(waterCups({ tankLeftMl: 640 }, null)).toBeNull();
  });

  it('says it on the idle line, low once the usual no longer fits', () => {
    expect(waterLine({ tankLeftMl: 640 }, usual)).toEqual({ text: '≈ 2 cups', low: false });
    expect(waterLine({ tankLeftMl: 340 }, usual)).toEqual({ text: '≈ 1 cup', low: false });
    expect(waterLine({ tankLeftMl: 150 }, usual)).toEqual({ text: 'under a cup', low: true });
    expect(waterLine({ tankLeftMl: 0 }, usual)).toEqual({ text: 'under a cup', low: true });
    expect(waterLine({ tankLeftMl: null }, usual)).toEqual({ text: 'unknown', low: false });
    expect(waterLine({ tankLeftMl: 640 }, null)).toEqual({ text: '≈ 640 ml', low: false });
  });
});

describe('a brew waiting for water', () => {
  it('is a pause on the no-water fault, and nothing else', () => {
    expect(pausedForWater({ phase: 'paused', fault: 'no_water' })).toBe(true);
    expect(pausedForWater({ phase: 'paused', fault: null })).toBe(false);
    expect(pausedForWater({ phase: 'paused', fault: 'no_beans' })).toBe(false);
    expect(pausedForWater({ phase: 'brewing', fault: 'no_water' })).toBe(false);
    expect(pausedForWater({ phase: 'idle', fault: 'no_water' })).toBe(false);
  });
});

describe('the screen a brew is on', () => {
  const VIEWS: Record<CoffeePhase, [BrewView, BrewView]> = {
    asleep: ['idle', 'idle'],
    idle: ['idle', 'idle'],
    awaiting_cup: ['idle', 'idle'],
    starting: ['idle', 'idle'],
    start_failed: ['idle', 'idle'],
    grinding: ['live', 'stale'],
    brewing: ['live', 'stale'],
    paused: ['paused', 'stale'],
    ready: ['ready', 'ready'],
    picked_up: ['ready', 'ready'],
    stopped: ['stopped', 'stopped'],
  };

  it('is named for every phase, with a lost link only touching a brew under way', () => {
    expect(Object.keys(VIEWS).sort()).toEqual([...COFFEE_PHASES].sort());
    for (const phase of COFFEE_PHASES) {
      expect([brewView({ phase }, false), brewView({ phase }, true)]).toEqual(VIEWS[phase]);
    }
  });

  it('keeps the finished brew on show through the pickup, and starts the next cup from it', () => {
    expect(brewView({ phase: 'picked_up' }, false)).toBe(brewView({ phase: 'ready' }, false));
    const awake = { machine: 'awake' as const };
    expect(canStart({ ...awake, phase: 'ready' })).toBe(false);
    for (const phase of ['picked_up', 'stopped', 'idle', 'start_failed'] as const) expect(canStart({ ...awake, phase })).toBe(true);
    for (const phase of ['awaiting_cup', 'starting', 'grinding', 'brewing', 'paused', 'asleep'] as const) {
      expect(canStart({ ...awake, phase })).toBe(false);
    }
  });
});

describe('the coffee chip on Home', () => {
  it('shows a brew under way and a finished one until it lapses back to idle', () => {
    const shown = COFFEE_PHASES.filter(phase => isOnHome(phase));
    expect(shown).toEqual(['grinding', 'brewing', 'paused', 'ready', 'picked_up']);
    expect(isOnHome(null)).toBe(false);
  });
});

const bagAttrs = (id: string, name: string, recipeId: string) => ({
  bean_id: id,
  bean_name: name,
  remaining: '300',
  brews_left: '20',
  low: 'no',
  added_at: '2026-11-18T06:10:00+00:00',
  recipe_id: recipeId,
});
const openBags = (...bags: ReturnType<typeof bagAttrs>[]) => parseCoffeeBeans({ state: '300', attributes: { v: '1', bags } })!;
const library = parseCoffeeRecipes({
  state: 'Daybreak',
  attributes: {
    v: '1',
    usual_id: 'r1',
    recipes: [
      { id: 'r1', name: 'Daybreak', total_ml: '255' },
      { id: 'r2', name: 'Signature Brew', total_ml: '200' },
    ],
  },
})!;

describe('the colours of the beans', () => {
  it('are the same whatever order the bags are listed in, and different for every open bag', () => {
    expect(beanColors(['b2', 'b1'])).toEqual(beanColors(['b1', 'b2']));
    expect(beanColors(['b1', 'b1'])).toEqual(beanColors(['b1']));
    for (const ids of [
      ['b1', 'b2'],
      ['b1', 'b2', 'b3'],
      ['a', 'b', 'c', 'd', 'e'],
    ]) {
      expect(new Set(Object.values(beanColors(ids))).size).toBe(ids.length);
    }
  });

  it('stay what they were: a bean is not recoloured by a release', () => {
    expect(beanColors(['b1'])).toEqual({ b1: '#a5b4fc' });
    expect(beanColors(['b1', 'b2'])).toEqual({ b1: '#a5b4fc', b2: '#fca5a5' });
  });

  it('colour more bags than there are colours, rather than fail', () => {
    const ids = Array.from({ length: 9 }, (_, index) => `bean-${index}`);
    expect(Object.keys(beanColors(ids))).toHaveLength(9);
  });
});

describe('the beans to pick before a brew', () => {
  it('asks only once two open bags have a recipe of their name', () => {
    const one = openBags(bagAttrs('b1', 'Daybreak', 'r1'));
    const noRecipe = openBags(bagAttrs('b1', 'Daybreak', 'r1'), bagAttrs('b2', 'Signature Brew', ''));
    expect(bagBrews(one, library)).toEqual([]);
    expect(bagBrews(noRecipe, library)).toEqual([]);
    expect(bagBrews(null, library)).toEqual([]);
  });

  it('lists them by name with their recipe, the usual marked, and the colours the correction uses', () => {
    const beans = openBags(bagAttrs('b2', 'Signature Brew', 'r2'), bagAttrs('b1', 'Daybreak', 'r1'), bagAttrs('b3', 'Guji', ''));
    const picks = bagBrews(beans, library);
    expect(picks.map(item => [item.bag.beanName, item.recipe?.name, item.usual])).toEqual([
      ['Daybreak', 'Daybreak', true],
      ['Signature Brew', 'Signature Brew', false],
    ]);
    const colors = beanColors(['b1', 'b2', 'b3']);
    expect(picks.map(item => item.color)).toEqual([colors.b1, colors.b2]);
  });

  it('keeps a bag whose recipe the library does not have, without one', () => {
    const beans = openBags(bagAttrs('b1', 'Daybreak', 'r1'), bagAttrs('b2', 'Signature Brew', 'r9'));
    expect(bagBrews(beans, library).map(item => item.recipe?.name ?? null)).toEqual(['Daybreak', null]);
    expect(bagBrews(beans, null).map(item => item.usual)).toEqual([false, false]);
  });
});

describe('correcting the beans of a brew', () => {
  const nowMs = Date.parse('2026-11-18T12:00:00Z');
  const hoursAgo = (hours: number) => nowMs - hours * 3_600_000;
  const two = openBags(bagAttrs('b1', 'Daybreak', 'r1'), bagAttrs('b2', 'Signature Brew', 'r2'));

  it('offers the other open bags for a brew under a day old', () => {
    expect(retagChoices(two, { atMs: hoursAgo(3), beanName: 'Daybreak' }, nowMs).map(choice => choice.bag.beanId)).toEqual(['b2']);
    expect(retagChoices(two, { atMs: hoursAgo(23.9), beanName: 'daybreak ' }, nowMs).map(choice => choice.bag.beanId)).toEqual(['b2']);
  });

  it('offers every bag for a brew without beans, or with beans no bag is open for', () => {
    expect(retagChoices(two, { atMs: hoursAgo(1), beanName: null }, nowMs)).toHaveLength(2);
    expect(retagChoices(two, { atMs: hoursAgo(1), beanName: 'Guji' }, nowMs)).toHaveLength(2);
  });

  it('offers nothing with one open bag, for an old brew, or for one without a time', () => {
    const one = openBags(bagAttrs('b1', 'Daybreak', 'r1'));
    expect(retagChoices(one, { atMs: hoursAgo(1), beanName: 'Daybreak' }, nowMs)).toEqual([]);
    expect(retagChoices(two, { atMs: hoursAgo(24), beanName: 'Daybreak' }, nowMs)).toEqual([]);
    expect(retagChoices(two, { atMs: null, beanName: 'Daybreak' }, nowMs)).toEqual([]);
    expect(retagChoices(null, { atMs: hoursAgo(1), beanName: 'Daybreak' }, nowMs)).toEqual([]);
  });

  it('colours the choices like the picker does', () => {
    const picks = bagBrews(two, library);
    const choices = retagChoices(two, { atMs: hoursAgo(1), beanName: 'Daybreak' }, nowMs);
    expect(choices[0].color).toBe(picks.find(item => item.bag.beanId === 'b2')?.color);
  });
});
