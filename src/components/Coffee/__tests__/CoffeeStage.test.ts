// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { setCupAdjust } = await import('../../../coffee/adjust');

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

describe('the stage after a brew', () => {
  it('goes back to the brew screen on New cup and counts a waiting cup as picked up', () => {
    entities.current = coffeeState('ready', { brew_id: 'c1', ready_at: new Date().toISOString() });
    show();
    expect(button('Hold 1 s to brew')).toBeNull();
    act(() => (button('New cup') as HTMLElement).click());
    expect(sent.map(command => command.op)).toEqual(['picked_up']);
    expect(document.querySelector('.cs-side.is-idle')).not.toBeNull();
  });

  it('goes back without a pickup once the cup is already taken', () => {
    entities.current = coffeeState('picked_up', { brew_id: 'c1' });
    show();
    act(() => (button('New cup') as HTMLElement).click());
    expect(sent).toEqual([]);
    expect(document.querySelector('.cs-side.is-idle')).not.toBeNull();
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
  const commands = () => sent.map(command => [command.op, JSON.parse(command.data ?? '{}')]);

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
  afterEach(() => setCupAdjust(null, null));

  it('shows the applied values and the brew button starts that cup with them, once', () => {
    entities.current = { ...coffeeState('idle', { tank_ml: '760', tank_left_ml: '700' }), ...recipes };
    show();
    act(() => setCupAdjust({ id: '82726' }, { dose: 15, grind_size: 42, temperature: 90 }));
    expect(document.body.textContent).toContain('adjusted for this cup');
    expect(document.body.textContent).toContain('255 ml');
    expect(document.body.textContent).toContain('90°');
    act(() => {
      document.querySelector('.hold-btn')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(sent.map(command => [command.op, JSON.parse(command.data ?? '{}')])).toEqual([
      ['start', { variant: 'tweak', dose: 15, grind_size: 42, temperature: 90 }],
    ]);
    expect(document.body.textContent).not.toContain('adjusted for this cup');
  });
});
