// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recipe } from '../../../coffee/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => [] as { op?: string; data?: string }[]);
const entities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('@hakit/core', () => {
  const connection = {
    sendMessagePromise: (message: { service_data: { op?: string; data?: string } }) => {
      sent.push(message.service_data);
      return Promise.resolve(null);
    },
  };
  const state = () => ({ entities: entities.current, hassUrl: '', connection });
  return { useHass: Object.assign(<T>(selector: (snapshot: ReturnType<typeof state>) => T): T => selector(state()), { getState: state }) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));

const { default: CoffeeStage } = await import('../CoffeeStage');
const { setCupAdjust, useCupAdjust } = await import('../../../coffee/adjust');
const { parseCoffeeRecipes, usualRecipe } = await import('../../../coffee/model');

const coffeeState = (state: string, attributes: Record<string, string>) => ({
  'sensor.coffee_state': {
    entity_id: 'sensor.coffee_state',
    state,
    attributes: { v: '1', machine: 'awake', link: 'connected', ...attributes },
  },
});

let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  sent.length = 0;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label) ?? null;
const show = () => act(() => root.render(createElement(CoffeeStage, { onClose: () => {} })));
const commands = () => sent.map(command => [command.op, JSON.parse(command.data ?? '{}')]);
const hold = () => {
  act(() => {
    document.querySelector('.hold-btn')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
};

describe('the stage after a brew', () => {
  const finished = (phase: string, attributes: Record<string, string> = {}) => {
    entities.current = coffeeState(phase, { brew_id: 'c1', ready_at: new Date().toISOString(), ...attributes });
    show();
  };
  const follows = (first: Element | null, second: Element | null) =>
    first != null && second != null && (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('offers no new cup while the brew is ready and its cup stands on the scale', () => {
    finished('ready', { cup: 'present' });
    expect(document.querySelector('.cs-side.is-ready')).not.toBeNull();
    expect(document.querySelector('.hold-btn')).toBeNull();
    expect(button('Picked up')).toBeNull();
  });

  it('counts a cup the scale cannot see as picked up on a tap, and starts nothing', () => {
    finished('ready', { cup: 'unknown' });
    expect(document.querySelector('.hold-btn')).toBeNull();
    act(() => (button('Picked up') as HTMLElement).click());
    expect(commands()).toEqual([['picked_up', { brew_id: 'c1' }]]);
  });

  it.each([
    ['picked_up', 'is-ready'],
    ['stopped', 'is-stopped'],
  ])('starts the next cup straight from %s, with the result still on show', (phase, side) => {
    finished(phase, { cup: 'absent' });
    expect(button('Picked up')).toBeNull();
    expect(button('New cup')).toBeNull();
    expect(document.querySelector(`.cs-side.${side}`)).not.toBeNull();
    hold();
    expect(commands()).toEqual([['start', { variant: 'usual' }]]);
    expect(document.querySelector(`.cs-side.${side}`)).not.toBeNull();
  });

  it('puts the hold under the taste row, outside what scrolls, with the links to change the cup beside it', () => {
    finished('picked_up', { cup: 'absent' });
    const taste = document.querySelector('.cs-taste');
    const start = document.querySelector('.hold-btn.cs-go');
    expect(follows(taste, start)).toBe(true);
    expect(document.querySelector('.cs-scroll')?.contains(taste)).toBe(true);
    expect(document.querySelector('.cs-scroll')?.contains(start)).toBe(false);
    expect(button('Adjust cup')).not.toBeNull();
    expect(button('Recipes')).not.toBeNull();
  });
});

describe('saving a tweaked cup', () => {
  const brewing = () => {
    entities.current = {
      ...coffeeState('brewing', { brew_id: 'c2', variant: 'tweak', recipe_name: '3 Pour Recipe', pour: '1' }),
      'sensor.coffee_recipes': {
        entity_id: 'sensor.coffee_recipes',
        state: '3 Pour Recipe',
        attributes: { v: '1', usual_id: '82726', recipes: [{ id: '82726', name: '3 Pour Recipe', dose_g: '16', ratio: '17' }] },
      },
    };
    show();
    act(() => (button('Save this cup…') as HTMLElement).click());
  };

  it('overwrites the recipe only after a confirm, while it brews', () => {
    brewing();
    act(() => (button('Overwrite 3 Pour Recipe') as HTMLElement).click());
    expect(sent).toEqual([]);
    act(() => (button('Yes, overwrite 3 Pour Recipe') as HTMLElement).click());
    expect(commands()).toEqual([['save_brew', { brew_id: 'c2' }]]);
    expect((button('Saved') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves as a new recipe under a name not already taken', () => {
    brewing();
    const input = document.querySelector('.coffee-input') as HTMLInputElement;
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    type('3 Pour Recipe');
    expect((button('Save as new') as HTMLButtonElement).disabled).toBe(true);
    type(' Fine 42 ');
    act(() => (button('Save as new') as HTMLElement).click());
    expect(commands()).toEqual([['save_brew', { brew_id: 'c2', new_name: 'Fine 42' }]]);
  });

  it('offers no save for a cup brewed as the recipe is', () => {
    entities.current = coffeeState('ready', { brew_id: 'c3', variant: 'usual', recipe_name: '3 Pour Recipe' });
    show();
    expect(button('Save this cup…')).toBeNull();
  });
});

describe('an adjusted cup', () => {
  const recipes = {
    'sensor.coffee_recipes': {
      entity_id: 'sensor.coffee_recipes',
      state: '3 Pour Recipe',
      attributes: {
        v: '1',
        usual_id: '82726',
        recipes: [
          { id: '82726', name: '3 Pour Recipe', dose_g: '16', ratio: '17', grind: '45', total_ml: '272', pours: '117/93/3/circular/25' },
        ],
      },
    },
  };
  const phase = (state: string, brewId: string, attributes: Record<string, string> = {}) => {
    entities.current = { ...coffeeState(state, { brew_id: brewId, tank_ml: '760', tank_left_ml: '700', ...attributes }), ...recipes };
    show();
  };
  const tile = () => document.querySelector('.cs-usual')?.textContent ?? '';
  const label = () => document.querySelector('.hold-btn')?.getAttribute('aria-label');
  const held = () => {
    const recipe = usualRecipe(parseCoffeeRecipes(entities.current['sensor.coffee_recipes'] as never));
    act(() => root.render(createElement('div', null, createElement(CoffeeStage, { onClose: () => {} }), createElement(Held, { recipe }))));
    return JSON.parse(document.querySelector('output')?.textContent ?? '"missing"');
  };
  function Held({ recipe }: { recipe: Recipe | null }) {
    return createElement('output', null, JSON.stringify(useCupAdjust(recipe)));
  }
  afterEach(() => act(() => setCupAdjust(null, null)));

  it('shows the applied values and the brew button starts that cup with them, once', () => {
    phase('idle', 'c1');
    act(() => setCupAdjust({ id: '82726' }, { dose: 15, grind_size: 42, temperature: 90 }));
    expect(document.body.textContent).toContain('adjusted for this cup');
    expect(document.body.textContent).toContain('255 ml');
    expect(document.body.textContent).toContain('90°');
    hold();
    expect(commands()).toEqual([['start', { variant: 'tweak', dose: 15, grind_size: 42, temperature: 90 }]]);
  });

  it('keeps the values through the whole brew and lets go when it is ready', () => {
    phase('idle', 'c1');
    act(() => setCupAdjust({ id: '82726' }, { dose: 5.5 }));
    expect(tile()).toContain('5.5 g');
    hold();
    expect(commands()).toEqual([['start', { variant: 'tweak', dose: 5.5 }]]);

    phase('idle', 'c1');
    expect(tile()).toContain('5.5 g');
    phase('starting', 'c2', { variant: 'tweak' });
    expect(tile()).toContain('5.5 g');
    expect(label()).toBe('Starting…');
    phase('awaiting_cup', 'c2', { variant: 'tweak' });
    expect(held()).toEqual({ dose: 5.5 });
    phase('brewing', 'c2', { variant: 'tweak', pour: '1' });
    expect(held()).toEqual({ dose: 5.5 });
    phase('paused', 'c2', { variant: 'tweak', pour: '2' });
    expect(held()).toEqual({ dose: 5.5 });
    phase('ready', 'c2', { variant: 'tweak', cup: 'present' });
    expect(held()).toBeNull();
    phase('picked_up', 'c2', { variant: 'tweak', cup: 'absent' });
    expect(held()).toBeNull();
    expect(label()).toBe('Hold 1 s to brew');
  });

  it('lets go when the brew is stopped', () => {
    phase('idle', 'c1');
    act(() => setCupAdjust({ id: '82726' }, { dose: 5.5 }));
    hold();
    phase('brewing', 'c2', { variant: 'tweak', pour: '1' });
    expect(held()).toEqual({ dose: 5.5 });
    phase('stopped', 'c2', { variant: 'tweak', cup: 'present' });
    expect(held()).toBeNull();
  });

  it('keeps the values for another try when the machine refuses the start', () => {
    phase('idle', 'c1');
    act(() => setCupAdjust({ id: '82726' }, { dose: 5.5 }));
    hold();
    phase('starting', 'c2', { variant: 'tweak' });
    phase('start_failed', 'c2', { variant: 'tweak', start_error: 'machine_busy' });
    expect(held()).toEqual({ dose: 5.5 });
    expect(tile()).toContain('5.5 g');
    expect(label()).toBe('Held by the xBloom app');
    phase('idle', 'c2');
    sent.length = 0;
    hold();
    expect(commands()).toEqual([['start', { variant: 'tweak', dose: 5.5 }]]);
    phase('grinding', 'c3', { variant: 'tweak' });
    phase('ready', 'c3', { variant: 'tweak', cup: 'present' });
    expect(held()).toBeNull();
  });

  it('keeps the values when the wait for the cup is dropped', () => {
    phase('idle', 'c1');
    act(() => setCupAdjust({ id: '82726' }, { dose: 5.5 }));
    hold();
    phase('awaiting_cup', 'c2', { variant: 'tweak' });
    phase('idle', 'c1');
    expect(held()).toEqual({ dose: 5.5 });
    expect(label()).toBe('Hold 1 s · adjusted');
  });
});
