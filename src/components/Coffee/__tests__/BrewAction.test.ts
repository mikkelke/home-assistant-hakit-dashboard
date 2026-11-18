// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COFFEE_PHASES, type CoffeePhase } from '../../../coffee/state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => [] as { op?: string; data?: string }[]);
const entities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const charts = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../ChartBox', () => ({
  ChartBox: (props: Record<string, unknown>) => {
    charts.push(props);
    return null;
  },
}));
vi.mock('@hakit/core', () => {
  const connection = {
    sendMessagePromise: (message: { service_data?: { op?: string; data?: string } }) => {
      if (message.service_data?.op) sent.push(message.service_data);
      return Promise.resolve(null);
    },
  };
  const state = () => ({ entities: entities.current, hassUrl: '', connection });
  return { useHass: Object.assign(<T>(selector: (snapshot: ReturnType<typeof state>) => T): T => selector(state()), { getState: state }) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: 'Kristine', isAdmin: false }) }));

const { default: CoffeeStage } = await import('../CoffeeStage');
const { CoffeeCard } = await import('../CoffeeCard');
const { setCupAdjust } = await import('../../../coffee/adjust');
const { parseCoffeeRecipes, usualRecipe } = await import('../../../coffee/model');

type Control = {
  hold: { label: string | null; disabled: boolean; pending: boolean; failed: boolean } | null;
  pickedUp: boolean;
  cupWait: boolean;
};

const NOTHING: Control = { hold: null, pickedUp: false, cupWait: false };
const holding = (label: string, flags: Partial<NonNullable<Control['hold']>> = {}): Control => ({
  hold: { label, disabled: false, pending: false, failed: false, ...flags },
  pickedUp: false,
  cupWait: false,
});

/** What each phase puts under the brew, whichever screen shows it. */
const CONTROL: Record<CoffeePhase, Control> = {
  asleep: holding('Hold 1 s to brew', { disabled: true }),
  idle: holding('Hold 1 s to brew'),
  awaiting_cup: { hold: null, pickedUp: false, cupWait: true },
  starting: holding('Starting…', { pending: true }),
  start_failed: holding("Didn't start · No water", { failed: true }),
  grinding: NOTHING,
  brewing: NOTHING,
  paused: NOTHING,
  ready: NOTHING,
  picked_up: holding('Hold 1 s to brew'),
  stopped: holding('Hold 1 s to brew'),
};

const recipes = {
  'sensor.coffee_recipes': {
    entity_id: 'sensor.coffee_recipes',
    state: '4 Pour Recipe',
    attributes: { v: '1', usual_id: '1', recipes: [{ id: '1', name: '4 Pour Recipe', dose_g: '15', ratio: '17', total_ml: '255' }] },
  },
};
const place = (phase: string, attributes: Record<string, string> = {}) => {
  entities.current = {
    'sensor.coffee_state': {
      entity_id: 'sensor.coffee_state',
      state: phase,
      attributes: { v: '1', machine: 'awake', link: 'connected', brew_id: 'c1', cup: 'present', tank_ml: '946', ...attributes },
    },
    ...recipes,
  };
};

let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  sent.length = 0;
  charts.length = 0;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const VIEWS = {
  card: () => {
    act(() => root.render(createElement(CoffeeCard, { onOpenStage: () => {} })));
    if (document.querySelector('.cc-tabs') == null) act(() => (document.querySelector('.appliance-header') as HTMLElement).click());
    sent.length = 0;
  },
  stage: () => act(() => root.render(createElement(CoffeeStage, { onClose: () => {} }))),
};

function control(): Control {
  const hold = document.querySelector('.hold-btn--brew');
  return {
    hold: hold && {
      label: hold.getAttribute('aria-label'),
      disabled: hold.classList.contains('is-disabled'),
      pending: hold.classList.contains('is-pending'),
      failed: hold.classList.contains('is-failed'),
    },
    pickedUp: [...document.querySelectorAll('button')].some(button => button.textContent === 'Picked up'),
    cupWait: document.querySelector('.coffee-cupwait') != null,
  };
}

const holdBrew = () => {
  act(() => {
    document.querySelector('.hold-btn--brew')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  act(() => {
    vi.advanceTimersByTime(1000);
  });
};

describe.each(Object.entries(VIEWS))('the %s under a brew', (_, mount) => {
  it.each(COFFEE_PHASES)('puts the same control under %s as the other screen does', phase => {
    place(phase, phase === 'start_failed' ? { start_error: 'no_water' } : {});
    mount();
    expect(control()).toEqual(CONTROL[phase]);
  });

  it('offers Picked up, and no new cup, for a ready brew whose cup the scale cannot see', () => {
    place('ready', { cup: 'unknown' });
    mount();
    expect(control()).toEqual({ ...NOTHING, pickedUp: true });
    act(() => ([...document.querySelectorAll('button')].find(button => button.textContent === 'Picked up') as HTMLElement).click());
    expect(sent.map(command => [command.op, JSON.parse(command.data ?? '{}')])).toEqual([['picked_up', { brew_id: 'c1' }]]);
  });

  it.each(['idle', 'start_failed', 'picked_up', 'stopped'] as const)('starts the next cup with a hold from %s', phase => {
    place(phase, phase === 'start_failed' ? { start_error: 'no_water' } : {});
    mount();
    holdBrew();
    expect(sent.map(command => [command.op, JSON.parse(command.data ?? '{}')])).toEqual([['start', { variant: 'usual' }]]);
  });

  it.each(['asleep', 'ready', 'brewing', 'paused'] as const)('starts nothing from %s', phase => {
    place(phase);
    mount();
    holdBrew();
    expect(sent.map(command => command.op)).toEqual([]);
  });
});

const BAG_RECIPES = {
  'sensor.coffee_recipes': {
    entity_id: 'sensor.coffee_recipes',
    state: 'Daybreak',
    attributes: {
      v: '1',
      usual_id: '1',
      recipes: [
        {
          id: '1',
          name: 'Daybreak',
          dose_g: '15',
          ratio: '17',
          grind: '46',
          total_ml: '255',
          plan_s: '170',
          pours: '45/93/3.5/circular/15;80/93/3.5/circular/15;65/93/3.5/circular/12;65/93/3.5/centered/5',
        },
        {
          id: '2',
          name: 'Signature Brew',
          dose_g: '14',
          ratio: '14',
          grind: '44',
          total_ml: '200',
          plan_s: '200',
          pours: '40/94/3/spiral/20;40/94/3.5/circular/10;40/94/3.5/circular/10;40/94/3.5/circular/10;40/94/3.5/centered/0',
        },
      ],
    },
  },
};
const bag = (id: string, name: string, recipeId: string, brewsLeft: string, remaining = '300') => ({
  bean_id: id,
  bean_name: name,
  remaining,
  brews_left: brewsLeft,
  low: 'no',
  added_at: '2026-11-18T06:10:00+00:00',
  recipe_id: recipeId,
});
/** Daybreak is the house's bag and the usual's; Signature Brew is the newer bag. */
const TWO_BAGS = [bag('b2', 'Signature Brew', '2', '33', '500'), bag('b1', 'Daybreak', '1', '14', '214')];
const BASELINE = {
  'sensor.coffee_baseline': {
    entity_id: 'sensor.coffee_baseline',
    state: 'ready',
    attributes: { v: '1', n: '7', step_s: '2', total_s_median: '204', cup_lo: '0,100,200', cup_hi: '0,120,230' },
  },
};
const QUEUED_TRIAL = {
  'sensor.coffee_advice': {
    entity_id: 'sensor.coffee_advice',
    state: 'trial_queued',
    attributes: { v: '1', advice_id: 'a1', bean_id: 'b1', field: 'grind_size', from: '46', to: '42' },
  },
};
const placeBags = (phase: string, attributes: Record<string, string> = {}, bags: object[] = TWO_BAGS) => {
  place(phase, attributes);
  entities.current = {
    ...entities.current,
    ...BAG_RECIPES,
    ...BASELINE,
    'sensor.coffee_beans': {
      entity_id: 'sensor.coffee_beans',
      state: '214',
      attributes: { v: '1', bean_id: 'b1', bean_name: 'Daybreak', brews_left: '14', bags },
    },
  };
};

const cards = () => [...document.querySelectorAll('.coffee-bean')] as HTMLElement[];
const cardNamed = (name: string) => cards().find(card => card.querySelector('b')?.textContent === name) as HTMLElement;
const pickBeans = (name: string) => act(() => cardNamed(name).click());
const recipeLine = () => document.querySelector('.coffee-picker-recipe') as HTMLElement | null;
const starts = () => sent.filter(command => command.op === 'start').map(command => JSON.parse(command.data ?? '{}'));
const again = (mount: () => void) => {
  act(() => root.render(null));
  mount();
};

describe.each(Object.entries(VIEWS))('the %s with two open bags', (_, mount) => {
  afterEach(() => act(() => setCupAdjust(null, null)));

  it('asks which beans first, a card each with what is left, and keeps the hold shut until one is picked', () => {
    placeBags('idle');
    mount();
    expect(cards().map(card => [card.querySelector('b')?.textContent, card.querySelector('small')?.textContent])).toEqual([
      ['Daybreak', '≈14 cups left'],
      ['Signature Brew', '≈33 cups left'],
    ]);
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(recipeLine()?.textContent).toBe('');
    expect(control()).toEqual(holding('Pick beans first', { disabled: true }));
    holdBrew();
    expect(sent).toEqual([]);
  });

  it('gives each bag a colour of its own, shown on its card and on the recipe line once picked', () => {
    placeBags('idle');
    mount();
    const [daybreak, signature] = cards().map(card => card.style.getPropertyValue('--bean'));
    expect(daybreak).toMatch(/^#[0-9a-f]{6}$/);
    expect(signature).toMatch(/^#[0-9a-f]{6}$/);
    expect(daybreak).not.toBe(signature);
    pickBeans('Signature Brew');
    expect(recipeLine()?.textContent).toBe('Signature Brew');
    expect(recipeLine()?.style.getPropertyValue('--bean')).toBe(signature);
  });

  it('picking brews nothing, and the hold then starts the beans picked, once', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    expect(sent).toEqual([]);
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(control()).toEqual(holding('Hold 1 s to brew'));
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b2' }]);
  });

  it('starts the usual with its own beans named too', () => {
    placeBags('idle');
    mount();
    pickBeans('Daybreak');
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b1' }]);
  });

  it('keeps the pick, shut to change, while the start goes out', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    holdBrew();
    expect(starts()).toHaveLength(1);
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(cards().every(card => (card as HTMLButtonElement).disabled)).toBe(true);
    expect(recipeLine()?.textContent).toBe('Signature Brew');
    expect(control()).toEqual(holding('Starting…', { pending: true }));
  });

  it('asks again for the next cup once the brew has been under way', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    holdBrew();
    placeBags('brewing', { pour: '1' });
    mount();
    expect(document.querySelector('.coffee-picker')).toBeNull();
    placeBags('idle');
    mount();
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(control()).toEqual(holding('Pick beans first', { disabled: true }));
  });

  it('keeps the pick after a refused start, so the same hold tries again', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    holdBrew();
    sent.length = 0;
    placeBags('start_failed', { start_error: 'no_water' });
    mount();
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(control().hold?.disabled).toBe(false);
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b2' }]);
  });

  it('starts from every quiet phase with the beans picked', () => {
    for (const phase of ['idle', 'start_failed', 'picked_up', 'stopped']) {
      sent.length = 0;
      placeBags(phase, phase === 'start_failed' ? { start_error: 'no_water' } : {});
      again(mount);
      pickBeans('Signature Brew');
      holdBrew();
      expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b2' }]);
    }
  });

  it('shows no choice of beans where no start is offered', () => {
    for (const phase of ['ready', 'grinding', 'brewing', 'paused', 'awaiting_cup']) {
      placeBags(phase);
      mount();
      expect(document.querySelector('.coffee-picker'), phase).toBeNull();
    }
  });

  it('starts from a fresh pick when the page is opened again', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    again(mount);
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(control()).toEqual(holding('Pick beans first', { disabled: true }));
  });

  it('carries the cup held for the usual to the usual beans only', () => {
    placeBags('idle');
    const usual = usualRecipe(parseCoffeeRecipes(BAG_RECIPES['sensor.coffee_recipes']));
    act(() => setCupAdjust(usual, { grind_size: 42 }));
    mount();
    pickBeans('Daybreak');
    expect(control()).toEqual(holding('Hold 1 s · adjusted'));
    holdBrew();
    expect(starts()).toEqual([{ variant: 'tweak', grind_size: 42, bean_id: 'b1' }]);
    sent.length = 0;
    placeBags('idle');
    again(mount);
    pickBeans('Signature Brew');
    expect(control()).toEqual(holding('Hold 1 s to brew'));
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b2' }]);
  });

  it('holds a start back for the water the picked recipe needs, not the usual', () => {
    placeBags('idle', { tank_left_ml: '280' });
    mount();
    pickBeans('Daybreak');
    holdBrew();
    expect(sent).toEqual([]);
    expect(document.querySelector('.coffee-cupwait.is-water')).not.toBeNull();
    expect(cards()).toHaveLength(2);
    pickBeans('Signature Brew');
    expect(document.querySelector('.coffee-cupwait.is-water')).toBeNull();
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual', bean_id: 'b2' }]);
  });

  it('leaves the single hold as it was with one open bag, or one bag with a recipe', () => {
    placeBags('idle', {}, [bag('b1', 'Daybreak', '1', '14')]);
    mount();
    expect(document.querySelector('.coffee-picker')).toBeNull();
    expect(control()).toEqual(holding('Hold 1 s to brew'));
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual' }]);
    sent.length = 0;
    placeBags('idle', {}, [bag('b1', 'Daybreak', '1', '14'), bag('b3', 'Guji', '', '9')]);
    again(mount);
    expect(document.querySelector('.coffee-picker')).toBeNull();
    holdBrew();
    expect(starts()).toEqual([{ variant: 'usual' }]);
  });
});

type IdleChart = { planPours: unknown[]; bandLo: unknown; bandHi: unknown; label: string };
const idleChart = (): IdleChart => {
  const drawn = charts.filter(chart => chart.mode === 'idle');
  return drawn[drawn.length - 1] as unknown as IdleChart;
};
const texts = (selector: string) => [...document.querySelectorAll(selector)].map(element => element.textContent);
const legend = () => texts('.cs-top .coffee-leg');
const button = (label: string) => [...document.querySelectorAll('button')].find(item => item.textContent === label) ?? null;

/** Where each screen writes what it is about to brew. */
const SHOWN = {
  card: {
    selected: '.cc-usual-line span:last-child',
    chipRow: '.cc-chips',
    chips: '.cc-chips .coffee-chip',
    beans: 'button.cc-beans b',
    brews: 'button.cc-beans .coffee-chip',
    water: '.cc-water b',
  },
  stage: {
    selected: '.cs-usual h3',
    chipRow: '.cs-chips',
    chips: '.cs-chips .coffee-chip',
    beans: '.cs-beans-line',
    brews: '.cs-beans .coffee-chip',
    water: '.coffee-waterchip',
  },
} as const;

describe.each(Object.entries(VIEWS))('the %s describing the beans picked', (name, mount) => {
  const at = SHOWN[name as keyof typeof SHOWN];
  const selected = () => document.querySelector(at.selected)?.textContent;
  const adjustCup = () =>
    (name === 'card' ? document.querySelector('.cc-ibtn[aria-label="Adjust cup"]') : button('Adjust cup')) as HTMLButtonElement;
  afterEach(() => act(() => setCupAdjust(null, null)));

  it('names no recipe before the beans are picked, and plans and bands nothing', () => {
    placeBags('idle');
    mount();
    expect(selected()).toBe('Pick beans first');
    expect(texts(at.chips)).toEqual([]);
    expect(idleChart()).toMatchObject({ planPours: [], bandLo: null, bandHi: null });
    expect(legend()).toEqual([]);
  });

  it('keeps the room of the chips until the beans are picked, so the picker stays where it is', () => {
    placeBags('idle');
    mount();
    expect(document.querySelector(at.chipRow)?.className).toMatch(/-chips-ask/);
    pickBeans('Signature Brew');
    expect(document.querySelector(at.chipRow)?.className).not.toMatch(/-chips-ask/);
  });

  it('follows the recipe of the other beans once picked, with the plan on the chart and no band', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    expect(selected()).toBe(name === 'card' ? '5 pours · ≈3:20' : '5 pours · Signature');
    expect(texts(at.chips)).toEqual(
      name === 'card' ? ['14 g', '1:14', '200 ml', 'Grind 44'] : ['14 g', '1:14', '200 ml', '94°', 'Grind 44', '≈ 3:20']
    );
    expect(idleChart().planPours).toHaveLength(5);
    expect(idleChart()).toMatchObject({ bandLo: null, bandHi: null });
    expect(idleChart().label).toContain('Signature Brew');
    if (name === 'stage') expect(legend()).toEqual(['Plan']);
  });

  it('keeps the usual, with its band, for the usual beans', () => {
    placeBags('idle');
    mount();
    pickBeans('Daybreak');
    expect(selected()).toBe(name === 'card' ? '4 pours · ≈3:24 · n=7' : '4 pours · Daybreak');
    expect(texts(at.chips)).toEqual(
      name === 'card' ? ['15 g', '1:17', '255 ml', 'Grind 46'] : ['15 g', '1:17', '255 ml', '93°', 'Grind 46', '≈ 3:24']
    );
    expect(idleChart().planPours).toHaveLength(4);
    expect(idleChart().bandLo).not.toBeNull();
    if (name === 'stage') expect(legend()).toEqual(['Your usual · n=7', 'Plan']);
  });

  it('counts the tank in cups of the recipe picked', () => {
    placeBags('idle', { tank_left_ml: '600' });
    mount();
    expect(document.querySelector(at.water)?.textContent).toContain('≈ 600 ml');
    pickBeans('Daybreak');
    expect(document.querySelector(at.water)?.textContent).toContain('≈ 1 cup');
    pickBeans('Signature Brew');
    expect(document.querySelector(at.water)?.textContent).toContain('≈ 2 cups');
  });

  it('shows the grams of the bag picked on the beans tile', () => {
    placeBags('idle');
    mount();
    expect(document.querySelector(at.beans)?.textContent).toContain('≈214 g');
    pickBeans('Signature Brew');
    expect(document.querySelector(at.beans)?.textContent).toContain('≈500 g');
    expect(document.querySelector(at.beans)?.textContent).toContain('Signature Brew');
    expect(document.querySelector(at.brews)?.textContent).toBe('≈ 33 brews');
    pickBeans('Daybreak');
    expect(document.querySelector(at.beans)?.textContent).toContain('≈214 g');
    expect(document.querySelector(at.brews)?.textContent).toBe('≈ 14 brews');
  });

  it('opens Adjust cup only for the usual beans', () => {
    placeBags('idle');
    mount();
    expect(adjustCup().disabled).toBe(true);
    pickBeans('Signature Brew');
    expect(adjustCup().disabled).toBe(true);
    pickBeans('Daybreak');
    expect(adjustCup().disabled).toBe(false);
  });

  it('applies the held cup and the queued trial to the usual beans only', () => {
    placeBags('idle');
    entities.current = { ...entities.current, ...QUEUED_TRIAL };
    mount();
    pickBeans('Daybreak');
    expect(texts(at.chips)).toContain('Grind 42');
    expect(control()).toEqual(holding('Hold 1 s · trial'));
    if (name === 'stage') expect(button('Usual, grind 46')).not.toBeNull();
    pickBeans('Signature Brew');
    expect(texts(at.chips)).toContain('Grind 44');
    expect(texts(at.chips)).not.toContain('Grind 42');
    expect(control()).toEqual(holding('Hold 1 s to brew'));
    if (name === 'stage') expect(button('Usual, grind 46')).toBeNull();

    const usual = usualRecipe(parseCoffeeRecipes(BAG_RECIPES['sensor.coffee_recipes']));
    act(() => setCupAdjust(usual, { grind_size: 40 }));
    expect(document.querySelector(name === 'card' ? '.cc-usual-line .coffee-lab' : '.cs-usual .coffee-lab')?.textContent).toBe('Selected');
    pickBeans('Daybreak');
    expect(document.querySelector(name === 'card' ? '.cc-usual-line .coffee-lab' : '.cs-usual .coffee-lab')?.textContent).toMatch(
      /^Selected · adjusted/
    );
  });

  it('keeps what the pick shows while the cup is awaited, and forgets it once the brew is under way', () => {
    placeBags('idle');
    mount();
    pickBeans('Signature Brew');
    placeBags('awaiting_cup');
    mount();
    expect(selected()).toContain('5 pours');
    placeBags('brewing', { pour: '1' });
    mount();
    placeBags('idle');
    mount();
    expect(selected()).toBe('Pick beans first');
    expect(texts(at.chips)).toEqual([]);
  });

  it('leaves the single bag as it was: its usual, band, grams and Adjust cup', () => {
    placeBags('idle', {}, [bag('b1', 'Daybreak', '1', '14', '214')]);
    mount();
    expect(selected()).toBe(name === 'card' ? '4 pours · ≈3:24 · n=7' : '4 pours · Daybreak');
    expect(idleChart().planPours).toHaveLength(4);
    expect(idleChart().bandLo).not.toBeNull();
    expect(idleChart().label).not.toContain('Signature');
    expect(document.querySelector(at.beans)?.textContent).toContain('≈214 g');
    expect(adjustCup().disabled).toBe(false);
  });
});

describe('the card with two open bags', () => {
  const tab = (label: string) => [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent === label) as HTMLElement;

  it('forgets the pick when the card is closed, or the brew tab left, and asks again', () => {
    placeBags('idle');
    VIEWS.card();
    pickBeans('Signature Brew');
    act(() => tab('History').click());
    act(() => tab('Brew').click());
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    pickBeans('Signature Brew');
    act(() => (document.querySelector('.appliance-header') as HTMLElement).click());
    act(() => (document.querySelector('.appliance-header') as HTMLElement).click());
    expect(cards().map(card => card.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    expect(control()).toEqual(holding('Pick beans first', { disabled: true }));
  });

  it('keeps Adjust cup open on the other tabs', () => {
    placeBags('idle');
    VIEWS.card();
    const adjust = () => document.querySelector('.cc-ibtn[aria-label="Adjust cup"]') as HTMLButtonElement;
    expect(adjust().disabled).toBe(true);
    act(() => tab('Recipes').click());
    expect(adjust().disabled).toBe(false);
  });
});
