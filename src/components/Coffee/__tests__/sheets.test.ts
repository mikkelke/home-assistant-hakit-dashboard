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

const { parseCoffeeRecipes, usualRecipe } = await import('../../../coffee/model');
const { AdjustSheet, RecipesSheet } = await import('../sheets');

const entity = (state: string, attributes: Record<string, string | object[]>) => ({ state, attributes: { v: '1', ...attributes } });
const recipes = parseCoffeeRecipes(
  entity('4 Pour Recipe', {
    usual_id: '1',
    recipes: [
      {
        id: '1',
        name: '4 Pour Recipe',
        dose_g: '15',
        ratio: '17',
        grind: '46',
        total_ml: '255',
        pours: '45/93/3/circular/15;80/93/3.5/circular/15',
      },
      { id: '2', name: 'House blend', dose_g: '15', ratio: '15', grind: '50', total_ml: '225' },
    ],
  })
);
const USUAL = usualRecipe(recipes)!;

let root: Root;
let sent: { op?: string; data?: string }[];
beforeEach(() => {
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
});

const ops = () => sent.map(command => command.op);
const data = (index: number) => JSON.parse(sent[index].data ?? '{}');
const tap = (element: Element | null) => act(() => (element as HTMLElement).click());
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label) ?? null;

describe('the grind and temperature sheet', () => {
  const show = (onClose = vi.fn()) => {
    act(() => root.render(createElement(AdjustSheet, { recipe: USUAL, onClose })));
    return onClose;
  };

  it('saves only what changed into the recipe and closes', () => {
    const onClose = show();
    expect((button('Save') as HTMLButtonElement).disabled).toBe(true);
    tap(document.querySelector('[aria-label="Grind down"]'));
    tap(document.querySelector('[aria-label="Temp down"]'));
    tap(document.querySelector('[aria-label="Temp down"]'));
    tap(button('Save'));
    expect(ops()).toEqual(['adjust']);
    expect(data(0)).toEqual({ grind_size: 45, temperature: 91 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the temperature out when only the grind moved', () => {
    show();
    tap(document.querySelector('[aria-label="Grind up"]'));
    tap(button('Save'));
    expect(data(0)).toEqual({ grind_size: 47 });
  });
});

describe('the recipes sheet', () => {
  const show = (onClose = vi.fn()) => {
    act(() => root.render(createElement(RecipesSheet, { recipes: recipes!.recipes, usualId: '1', onClose })));
    return onClose;
  };

  it('selects the recipe tapped and closes', () => {
    const onClose = show();
    tap(document.querySelectorAll('.coffee-rrow')[1]);
    expect(ops()).toEqual(['select']);
    expect(data(0)).toEqual({ recipe_id: '2' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the selected recipe and sends nothing when it is tapped again', () => {
    const onClose = show();
    expect(document.querySelectorAll('.coffee-rrow.is-selected').length).toBe(1);
    tap(document.querySelector('.coffee-rrow.is-selected'));
    expect(ops()).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
