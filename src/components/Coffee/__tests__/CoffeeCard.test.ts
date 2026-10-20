// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object | null };
  let state: State = { entities: {}, hassUrl: '', connection: null };
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
    setState(patch: Partial<State>) {
      state = { ...state, ...patch };
      listeners.forEach(listener => listener(state));
    },
    subscribe(listener: (state: State) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, store) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));
const viewer = vi.hoisted(() => ({ name: 'Kristine' as string | null, isAdmin: false as boolean | null }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => viewer }));

const { CoffeeCard } = await import('../CoffeeCard');

const IDLE = {
  'sensor.coffee_state': {
    entity_id: 'sensor.coffee_state',
    state: 'idle',
    attributes: { v: '1', machine: 'asleep', link: 'not_connected' },
  },
};

let root: Root;
beforeEach(() => {
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  store.setState({ entities: IDLE, connection: null });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

function show(onOpenStage = vi.fn()) {
  act(() => root.render(createElement(CoffeeCard, { onOpenStage })));
  return onOpenStage;
}
const tapHeader = () => act(() => (document.querySelector('.appliance-header') as HTMLElement).click());

describe('the Kitchen Coffee entry', () => {
  it('expands the card on a phone', () => {
    viewer.name = 'Kristine';
    const open = show();
    expect(document.querySelector('.cc-tabs')).toBeNull();
    expect(document.querySelector('.appliance-word')?.textContent).toBe('Asleep');
    tapHeader();
    expect(document.querySelector('.cc-tabs')).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the stage on the wine-fridge tablet', () => {
    viewer.name = 'Rooftop';
    const open = show();
    tapHeader();
    expect(open).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.cc-tabs')).toBeNull();
  });

  it('opens on its own while a brew runs, with the stage as its word', () => {
    viewer.name = 'Kristine';
    store.setState({
      entities: {
        'sensor.coffee_state': {
          entity_id: 'sensor.coffee_state',
          state: 'brewing',
          attributes: { v: '1', machine: 'working', link: 'connected', brew_id: 'c1', pour: '3', pours_total: '4' },
        },
      },
    });
    show();
    expect(document.querySelector('.cc-tabs')).not.toBeNull();
    expect(document.querySelector('.appliance-word')?.textContent).toBe('Pour 3/4');
  });

  it('connects when it opens, which wakes a sleeping machine too', () => {
    viewer.name = 'Kristine';
    const sendMessagePromise = vi.fn((message: unknown) => Promise.resolve(message));
    store.setState({ connection: { sendMessagePromise } });
    const commands = () =>
      sendMessagePromise.mock.calls
        .map(([message]) => message as { service?: string; service_data?: { op?: string } })
        .filter(message => message.service === 'coffee_command')
        .map(message => message.service_data?.op);
    show();
    expect(commands()).toEqual([]);
    tapHeader();
    expect(commands()).toEqual(['connect']);
  });

  it('waits for the cup with a Cancel, and offers "Cup is already on" only while the scale cannot tell', () => {
    viewer.name = 'Kristine';
    const waiting = (cup: string, machine = 'awake') =>
      store.setState({
        entities: {
          'sensor.coffee_state': {
            entity_id: 'sensor.coffee_state',
            state: 'awaiting_cup',
            attributes: { v: '1', machine, link: 'connected', brew_id: 'c2', cup },
          },
        },
      });
    const buttons = () => [...document.querySelectorAll('.coffee-cupwait button')].map(button => button.textContent);
    const hint = () => document.querySelector('.coffee-cupwait small')?.textContent;
    waiting('unknown');
    show();
    expect(document.querySelector('.appliance-word')?.textContent).toBe('Put cup on');
    expect(document.querySelector('.coffee-cupwait b')?.textContent).toBe('Put your cup on');
    expect(hint()).toBe('The brew starts by itself');
    expect(document.querySelector('.cc-hold')).toBeNull();
    expect(buttons()).toEqual(['Cancel', 'Cup is already on']);
    act(() => waiting('absent'));
    expect(buttons()).toEqual(['Cancel']);
    act(() => waiting('unknown', 'asleep'));
    expect(hint()).toBe('Waking the machine…');
  });

  it('shows nothing while the coffee app is not reporting', () => {
    store.setState({ entities: {} });
    show();
    expect(document.querySelector('.coffee-card')).toBeNull();
  });
});
