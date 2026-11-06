// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COFFEE_PHASES, type CoffeePhase } from '../../../coffee/state';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sent = vi.hoisted(() => [] as { op?: string; data?: string }[]);
const entities = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
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
