// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const connection = vi.hoisted(() => ({ current: null as { sendMessagePromise: (message: unknown) => Promise<unknown> } | null }));
vi.mock('@hakit/core', () => {
  const store = () => ({ entities: {}, hassUrl: '', connection: connection.current });
  return { useHass: Object.assign(<T>(selector: (snapshot: ReturnType<typeof store>) => T): T => selector(store()), { getState: store }) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));

const { parseCoffeeRecipes, parseCoffeeState, usualRecipe } = await import('../../../coffee/model');
const { RecipeDetail, TweakSheet } = await import('../sheets');

const entity = (state: string, attributes: Record<string, string | object[]>) => ({ state, attributes: { v: '1', ...attributes } });
const stateWith = (tankLeftMl: string) =>
  parseCoffeeState(entity('idle', { machine: 'awake', link: 'connected', tank_ml: '946', tank_left_ml: tankLeftMl }))!;
const recipes = parseCoffeeRecipes(
  entity('4 Pour Recipe', {
    usual_id: '1',
    recipes: [
      { id: '1', name: '4 Pour Recipe', dose_g: '15', ratio: '17', grind: '46', total_ml: '255' },
      { id: '2', name: 'House blend', dose_g: '15', ratio: '15', grind: '50', total_ml: '225' },
    ],
  })
);
const USUAL = usualRecipe(recipes)!;
const HOUSE_BLEND = recipes!.recipes[1];

let root: Root;
let sent: { op?: string; data?: string }[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  sent = [];
  connection.current = {
    sendMessagePromise: message => {
      sent.push((message as { service_data: { op?: string; data?: string } }).service_data);
      return Promise.resolve(null);
    },
  };
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const ops = () => sent.map(command => command.op);
const hold = () => {
  act(() => {
    document.querySelector('.hold-btn')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
};
const tap = (element: Element | null) => act(() => (element as HTMLElement).click());
const prompt = () => document.querySelector('.coffee-cupwait.is-water');
const promptButton = (label: string) =>
  [...document.querySelectorAll('.coffee-cupwait button')].find(button => button.textContent === label) ?? null;
const flush = () => act(async () => {});

describe('the tweak sheet with too little water', () => {
  const show = (tankLeftMl: string, onClose = vi.fn()) => {
    act(() => root.render(createElement(TweakSheet, { recipe: USUAL, state: stateWith(tankLeftMl), onClose })));
    return onClose;
  };

  it('judges the cup by the dose and ratio it shows, and starts at once when the tank holds it', () => {
    const onClose = show('330');
    hold();
    expect(ops()).toEqual(['start']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('holds a start the tank cannot finish, and a bigger cup is short where the usual was not', () => {
    show('330');
    for (let step = 0; step < 3; step++) tap(document.querySelector('[aria-label="Ratio up"]'));
    hold();
    expect(ops()).toEqual([]);
    expect(document.querySelector('.coffee-cupwait small')?.textContent).toBe('About 330 ml left · this cup needs 338 ml');
  });

  it('starts the tweak the sheet shows when Filled is tapped, not the one it held', async () => {
    const onClose = show('150');
    hold();
    expect(prompt()).not.toBeNull();
    tap(document.querySelector('[aria-label="Grind up"]'));
    tap(promptButton('Filled'));
    await flush();
    expect(ops()).toEqual(['water_filled', 'start']);
    expect(JSON.parse(sent[1].data ?? '{}')).toEqual({ variant: 'tweak', grind_size: 47 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts without the fill on Start anyway and closes', async () => {
    const onClose = show('150');
    hold();
    tap(promptButton('Start anyway'));
    await flush();
    expect(ops()).toEqual(['start']);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open while the prompt waits', () => {
    const onClose = show('150');
    hold();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.hold-btn')).toBeNull();
  });
});

describe('a recipe with too little water', () => {
  const show = (recipe: typeof USUAL, isUsual: boolean, tankLeftMl: string, onDone = vi.fn()) => {
    act(() => root.render(createElement(RecipeDetail, { recipe, isUsual, state: stateWith(tankLeftMl), onDone })));
    return onDone;
  };

  it('judges another recipe by its own volume', async () => {
    show(HOUSE_BLEND, false, '290');
    hold();
    expect(ops()).toEqual(['start']);
    expect(JSON.parse(sent[0].data ?? '{}')).toEqual({ variant: 'other', recipe_id: '2' });
  });

  it('holds it back, then starts the same recipe after Filled', async () => {
    const onDone = show(HOUSE_BLEND, false, '200');
    hold();
    expect(ops()).toEqual([]);
    expect(document.querySelector('.coffee-cupwait small')?.textContent).toBe('About 200 ml left · this cup needs 285 ml');
    tap(promptButton('Filled'));
    await flush();
    expect(ops()).toEqual(['water_filled', 'start']);
    expect(JSON.parse(sent[1].data ?? '{}')).toEqual({ variant: 'other', recipe_id: '2' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('starts the usual with variant usual', async () => {
    show(USUAL, true, '100');
    hold();
    tap(promptButton('Start anyway'));
    await flush();
    expect(JSON.parse(sent[0].data ?? '{}')).toEqual({ variant: 'usual' });
  });
});
