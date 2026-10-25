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

describe('the water tank in the Kitchen card', () => {
  const state = (attributes: Record<string, string> = {}, phase = 'idle') => ({
    entity_id: 'sensor.coffee_state',
    state: phase,
    attributes: { v: '1', machine: 'awake', link: 'connected', tank_ml: '946', ...attributes },
  });
  const entities = (attributes: Record<string, string> = {}) => ({
    'sensor.coffee_state': state(attributes),
    'sensor.coffee_recipes': {
      entity_id: 'sensor.coffee_recipes',
      state: '4 Pour Recipe',
      attributes: { v: '1', usual_id: '1', recipes: [{ id: '1', name: '4 Pour Recipe', total_ml: '255' }] },
    },
  });
  let sendMessagePromise: ReturnType<typeof vi.fn>;
  const sent = () =>
    sendMessagePromise.mock.calls
      .map(([message]) => message as { service?: string; service_data?: { op?: string; data?: string } })
      .filter(message => message.service === 'coffee_command')
      .map(message => message.service_data);
  const ops = () => sent().map(command => command?.op);
  const flush = () => act(async () => {});
  const buttons = () => [...document.querySelectorAll('.coffee-cupwait button')].map(button => button.textContent);
  const prompt = () => document.querySelector('.coffee-cupwait.is-water');
  const click = (element: Element | null) => act(() => (element as HTMLElement).click());
  const clickPrompt = async (label: string) => {
    click([...document.querySelectorAll('.coffee-cupwait button')].find(button => button.textContent === label) ?? null);
    await flush();
  };
  const hold = () => {
    act(() => {
      document.querySelector('.cc-hold')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  };
  const open = async (attributes: Record<string, string>) => {
    viewer.name = 'Kristine';
    store.setState({ entities: entities(attributes), connection: { sendMessagePromise } });
    show();
    tapHeader();
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sendMessagePromise = vi.fn((message: { domain?: string }) =>
      Promise.resolve(message.domain === 'shell_command' ? { response: { stdout: '{"absent":true}', stderr: '', returncode: 0 } } : null)
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds a start the tank cannot finish behind "Fill the water tank"', async () => {
    await open({ tank_left_ml: '150' });
    hold();
    expect(ops()).toEqual([]);
    expect(document.querySelector('.cc-hold')).toBeNull();
    expect(document.querySelector('.coffee-cupwait b')?.textContent).toBe('Fill the water tank');
    expect(document.querySelector('.coffee-cupwait small')?.textContent).toBe('About 150 ml left · this cup needs 315 ml');
    expect(buttons()).toEqual(['Start anyway', 'Filled']);
    expect(document.querySelector('.cc-water')).toBeNull();
  });

  it('registers the fill and then starts, with the data the Start button would have sent', async () => {
    await open({ tank_left_ml: '150' });
    hold();
    await clickPrompt('Filled');
    expect(ops()).toEqual(['water_filled', 'start']);
    expect(sent().map(command => JSON.parse(command?.data ?? 'null'))).toEqual([{}, { variant: 'usual' }]);
    expect(prompt()).toBeNull();
  });

  it('starts without the fill on "Start anyway"', async () => {
    await open({ tank_left_ml: '150' });
    hold();
    await clickPrompt('Start anyway');
    expect(ops()).toEqual(['start']);
    expect(prompt()).toBeNull();
  });

  it('sends one fill and one start however often Filled is tapped', async () => {
    await open({ tank_left_ml: '150' });
    hold();
    const filled = [...document.querySelectorAll('.coffee-cupwait button')].find(button => button.textContent === 'Filled');
    click(filled ?? null);
    click(filled ?? null);
    await flush();
    expect(ops()).toEqual(['water_filled', 'start']);
  });

  it('starts at once when the tank holds the cup', async () => {
    await open({ tank_left_ml: '315' });
    hold();
    expect(ops()).toEqual(['start']);
    expect(prompt()).toBeNull();
  });

  it('starts at once when the level is not known', async () => {
    await open({});
    hold();
    expect(ops()).toEqual(['start']);
    expect(prompt()).toBeNull();
  });

  it('lets the prompt go when the tank is filled from somewhere else', async () => {
    await open({ tank_left_ml: '150' });
    hold();
    expect(prompt()).not.toBeNull();
    act(() => store.setState({ entities: entities({ tank_left_ml: '946' }) }));
    expect(prompt()).toBeNull();
    expect(document.querySelector('.cc-hold')).not.toBeNull();
    expect(document.querySelector('.cc-water')).not.toBeNull();
  });

  it('shows the level in cups beside the beans, low once the usual no longer fits', async () => {
    const line = () => document.querySelector('.cc-water .cc-beans-tx b')?.textContent;
    await open({ tank_left_ml: '640' });
    expect(line()).toBe('Water · ≈ 2 cups');
    expect(document.querySelector('.cc-water.is-low')).toBeNull();
    act(() => store.setState({ entities: entities({ tank_left_ml: '150' }) }));
    expect(line()).toBe('Water · under a cup');
    expect(document.querySelector('.cc-water.is-low')).not.toBeNull();
  });

  it('starts the count with Filled when the level is not known', async () => {
    await open({});
    expect(document.querySelector('.cc-water .cc-beans-tx b')?.textContent).toBe('Water · unknown');
    expect(document.querySelector('.cc-water .cc-beans-tx small')?.textContent).toBe('tap when you fill the tank');
    click(document.querySelector('.cc-water button'));
    await flush();
    expect(ops()).toEqual(['water_filled']);
  });
});
