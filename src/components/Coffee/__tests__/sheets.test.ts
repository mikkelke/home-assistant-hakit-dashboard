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

const { parseCoffeeBeans, parseCoffeeRecipes, usualRecipe } = await import('../../../coffee/model');
const { AdjustSheet, BeansSheet, RecipesSheet } = await import('../sheets');
const { setCupAdjust, useCupAdjust } = await import('../../../coffee/adjust');

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
const data = (index: number) => JSON.parse(sent[index].data ?? '{}');
const tap = (element: Element | null) => act(() => (element as HTMLElement).click());

describe('the adjust-cup sheet', () => {
  const show = (onClose = vi.fn()) => {
    act(() => root.render(createElement(AdjustSheet, { recipe: USUAL, onClose })));
    return onClose;
  };
  const apply = () => tap([...document.querySelectorAll('button')].find(b => b.textContent === 'Apply') ?? null);
  function Held() {
    return createElement('output', null, JSON.stringify(useCupAdjust(USUAL)));
  }
  const held = () => {
    act(() => root.render(createElement(Held)));
    return JSON.parse(document.querySelector('output')?.textContent ?? '"missing"');
  };
  afterEach(() => setCupAdjust(null, null));

  it('holds only what changed for the next cup, sends nothing and closes', () => {
    const onClose = show();
    tap(document.querySelector('[aria-label="Dose up"]'));
    tap(document.querySelector('[aria-label="Ratio down"]'));
    tap(document.querySelector('[aria-label="Grind down"]'));
    tap(document.querySelector('[aria-label="Temp down"]'));
    expect(document.body.textContent).toContain('1:16.5');
    expect(document.body.textContent).toContain('256 ml water');
    apply();
    expect(sent).toEqual([]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(held()).toEqual({ dose: 15.5, ratio: 16.5, grind_size: 45, temperature: 92 });
  });

  it('opens on what is held, and Reset lets it go', () => {
    setCupAdjust(USUAL, { grind_size: 42 });
    show();
    expect(document.body.textContent).toContain('42');
    tap([...document.querySelectorAll('button')].find(b => b.textContent === 'Reset') ?? null);
    expect(held()).toBeNull();
  });

  it('holds nothing when nothing changed', () => {
    show();
    apply();
    expect(held()).toBeNull();
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

describe('the beans sheet', () => {
  const bag = (id: string, name: string, remaining: string, addedAt: string) => ({
    bean_id: id,
    bean_name: name,
    remaining,
    brews_left: '20',
    low: 'no',
    added_at: addedAt,
    recipe_id: '',
  });
  const known = [
    { id: 'b1', name: 'Daybreak' },
    { id: 'b2', name: 'Signature Brew' },
    { id: 'b3', name: 'Guji' },
  ];
  const twoBags = parseCoffeeBeans(
    entity('714', {
      bean_id: 'b1',
      bean_name: 'Daybreak',
      known_beans: known,
      bags: [bag('b2', 'Signature Brew', '500', '2026-11-18T06:10:00+00:00'), bag('b1', 'Daybreak', '213.6', '2026-11-06T06:10:00+00:00')],
    })
  );
  const show = (beans: typeof twoBags = twoBags, onClose = vi.fn()) => {
    act(() => root.render(createElement(BeansSheet, { beans, onClose })));
    return onClose;
  };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith(text)) ?? null;
  const rows = () => [...document.querySelectorAll('.coffee-bag')];
  const radio = (text: string) => [...document.querySelectorAll('[role=radio]')].find(r => r.textContent === text) ?? null;
  const beanChoices = () => [...document.querySelectorAll('[aria-label="Which beans"] [role=radio]')].map(r => r.textContent);

  it('shows each open bag with its grams and the day it was added', () => {
    show();
    expect(rows().map(row => row.querySelector('b')?.textContent)).toEqual(['Signature Brew', 'Daybreak']);
    expect(rows().map(row => row.querySelector('small')?.textContent)).toEqual(['≈500 g · added 18.11', '≈214 g · added 06.11']);
  });

  it('no longer says that other beans switch the container', () => {
    show();
    expect(document.body.textContent).not.toMatch(/switch|container/i);
  });

  it('empties the bag whose button is tapped, and closes', () => {
    const onClose = show();
    tap(document.querySelector('[aria-label="Empty Signature Brew"]'));
    expect(ops()).toEqual(['beans_empty']);
    expect(data(0)).toEqual({ bean_id: 'b2' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('adds to the bag of the beans picked, naming them on the button when several bags are open', () => {
    show();
    tap(radio('Signature Brew'));
    tap(radio('500 g'));
    expect(button('Added 500 g')?.textContent).toBe('Added 500 g · Signature Brew');
    tap(button('Added 500 g'));
    expect(ops()).toEqual(['beans_add']);
    expect(data(0)).toEqual({ grams: 500, bean_id: 'b2' });
  });

  it('opens a bag for new beans by name, which is what it starts on', () => {
    show();
    const input = document.querySelector('.coffee-input') as HTMLInputElement;
    expect((button('Added 250 g') as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, ' Guatemala ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    tap(button('Added 250 g'));
    expect(data(0)).toEqual({ grams: 250, new_name: 'Guatemala' });
  });

  it('keeps the bag of beans the feed no longer lists as known pickable', () => {
    const trimmed = parseCoffeeBeans(
      entity('714', {
        bean_id: 'b1',
        bean_name: 'Daybreak',
        known_beans: [],
        bags: [bag('b2', 'Signature Brew', '500', '2026-11-18T06:10:00+00:00'), bag('b1', 'Daybreak', '214', '2026-11-06T06:10:00+00:00')],
      })
    );
    show(trimmed);
    expect(beanChoices().slice(1)).toEqual(['Signature Brew', 'Daybreak']);
  });

  it('lists a lone bag without naming beans on the button, and no bag at all when none is open', () => {
    show(parseCoffeeBeans(entity('112', { bean_id: 'b1', bean_name: 'Daybreak', known_beans: known })));
    expect(rows()).toHaveLength(1);
    expect(document.body.textContent).toContain('Open bag');
    tap(radio('Daybreak'));
    expect(button('Added 250 g')?.textContent).toBe('Added 250 g');
    show(null);
    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Open bag');
  });
});
