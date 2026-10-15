// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { makeDoc, makeFingerprintDoc, makeSuggestDoc } from '../../../sensorMap/__tests__/docFixtures';
import type { MapDoc } from '../../../sensorMap/mapDoc';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { connection: object | null; entities: Record<string, unknown>; devices: Record<string, unknown>; hassUrl: string };
  let state: State = { connection: null, entities: {}, devices: {}, hassUrl: '' };
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

type User = { is_admin: boolean; name: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
vi.mock('home-assistant-js-websocket', () => ({ getUser: (connection: object) => lookups.get(connection) }));

const { SensorMapPage } = await import('../SensorMapPage');

interface Fake {
  connection: object;
  data: Record<string, unknown>;
  sent: { type: string; key?: string; value?: unknown }[];
  failWrites: boolean;
}

function fakeConnection(data: Record<string, unknown>): Fake {
  const fake: Fake = { connection: {}, data: { ...data }, sent: [], failWrites: false };
  Object.assign(fake.connection, {
    sendMessagePromise: vi.fn(async (message: { type: string; key?: string; value?: unknown }) => {
      fake.sent.push(message);
      if (message.type === 'frontend/get_system_data') return { value: fake.data[message.key ?? ''] ?? null };
      if (message.type === 'frontend/set_system_data') {
        if (fake.failWrites) throw new Error('connection lost');
        fake.data[message.key ?? ''] = message.value;
        return null;
      }
      if (message.type === 'config_entries/get') return [];
      throw new Error(`unexpected message ${message.type}`);
    }),
    subscribeMessage: vi.fn(async (callback: (event: unknown) => void, message: { type: string; key?: string }) => {
      if (message.type === 'frontend/subscribe_system_data') callback({ value: fake.data[message.key ?? ''] ?? null });
      return async () => {};
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return fake;
}

const docs = (): Record<string, unknown> => ({
  sensor_map: makeDoc(),
  sensor_map_fingerprints: makeFingerprintDoc(),
  sensor_map_suggest: makeSuggestDoc(),
});

let root: Root;
let onClose: Mock<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  lookups.clear();
  onClose = vi.fn<() => void>();
  store.setState({ connection: null, entities: {}, devices: {} });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

async function open(fake: Fake, user: Promise<User> = Promise.resolve({ is_admin: true, name: 'Admin' })) {
  lookups.set(fake.connection, user);
  act(() => store.setState({ connection: fake.connection }));
  await act(async () => root.render(createElement(SensorMapPage, { onClose })));
  await flush();
}

const query = (selector: string) => document.querySelector(selector);
const queryAll = (selector: string) => [...document.querySelectorAll(selector)];
const writes = (fake: Fake) => fake.sent.filter(message => message.type === 'frontend/set_system_data');
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement;

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

const press = (element: Element, key: string) =>
  act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

describe('who may open the map', () => {
  it('shows a loading surface while the viewer is looked up, and asks Home Assistant for nothing', async () => {
    const fake = fakeConnection(docs());
    await open(fake, new Promise<User>(() => {}));
    expect(query('.sensor-map')?.getAttribute('data-gate')).toBe('loading');
    expect(query('.sm-workspace')).toBeNull();
    expect(fake.sent).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes itself for a housemate and never loads a document', async () => {
    const fake = fakeConnection(docs());
    await open(fake, Promise.resolve({ is_admin: false, name: 'Housemate' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(query('.sm-workspace')).toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it('shows the map to an administrator', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    expect(query('.sm-workspace')).not.toBeNull();
    expect(query('.sm-title')?.textContent).toBe('Sensor map');
    expect(onClose).not.toHaveBeenCalled();
    expect(queryAll('.sm-mk')).toHaveLength(6);
    expect(query('.sm-save')?.textContent).toContain('saved');
  });

  it('waits for a slow authorization and then shows the map', async () => {
    const fake = fakeConnection(docs());
    let resolve: (user: User) => void = () => {};
    await open(fake, new Promise<User>(done => (resolve = done)));
    expect(query('.sm-workspace')).toBeNull();
    await act(async () => resolve({ is_admin: true, name: 'Admin' }));
    await flush();
    expect(query('.sm-workspace')).not.toBeNull();
    expect(fake.sent.some(message => message.type === 'frontend/get_system_data')).toBe(true);
  });

  it('goes back to the loading surface on a replacement connection and loads from that one', async () => {
    const first = fakeConnection(docs());
    await open(first);
    expect(query('.sm-workspace')).not.toBeNull();

    const second = fakeConnection(docs());
    let resolve: (user: User) => void = () => {};
    lookups.set(second.connection, new Promise<User>(done => (resolve = done)));
    act(() => store.setState({ connection: second.connection }));
    await flush();
    expect(query('.sm-workspace')).toBeNull();
    expect(query('.sensor-map')?.getAttribute('data-gate')).toBe('loading');
    expect(second.sent).toEqual([]);

    await act(async () => resolve({ is_admin: true, name: 'Admin' }));
    await flush();
    expect(query('.sm-workspace')).not.toBeNull();
    expect(second.sent.some(message => message.type === 'frontend/get_system_data')).toBe(true);
  });
});

describe('when there is nothing to show', () => {
  it('says so when Home Assistant holds no map document, and offers another try', async () => {
    const fake = fakeConnection({});
    await open(fake);
    expect(query('.sm-status')?.textContent).toContain('no map document');
    expect(byLabel('Close the map')).not.toBeNull();
    const retry = queryAll('.sm-chip').find(node => node.textContent === 'Try again') as HTMLElement;
    fake.data.sensor_map = makeDoc();
    act(() => retry.click());
    await flush();
    expect(query('.sm-workspace')).not.toBeNull();
  });

  it('shows what is wrong with a document it cannot use', async () => {
    const fake = fakeConnection({ sensor_map: { schema_version: 9 } });
    await open(fake);
    expect(query('.sm-status')?.getAttribute('role')).toBe('alert');
    expect(query('.sm-status')?.textContent).toContain('schema_version');
  });
});

describe('sheets and history', () => {
  it('opens a device sheet and the questions without adding a history entry or locking the page', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back');
    const fake = fakeConnection(docs());
    await open(fake);

    const marker = queryAll('.sm-mk').find(node => node.getAttribute('aria-label') === 'Alpha radar') as Element;
    press(marker, 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('Alpha radar');

    const questions = queryAll('.sm-chip').find(node => node.textContent?.startsWith('Questions')) as HTMLElement;
    act(() => questions.click());
    expect(query('.sm-sheet')?.textContent).toContain('Which side is alpha?');

    act(() => byLabel('Close').click());
    expect(query('.sm-sheet')?.textContent).toContain('Alpha radar');
    act(() => byLabel('Close').click());
    expect(query('.sm-sheet')).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('shows a suggestion on the device it concerns, with Accept and Reject', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    expect(queryAll('.sm-ghost')).toHaveLength(1);
    const marker = queryAll('.sm-mk').find(node => node.getAttribute('aria-label') === 'Test door contact') as Element;
    press(marker, 'Enter');
    const sheet = query('.sm-sheet') as Element;
    expect(sheet.textContent).toContain('Suggested: Measured answer');
    const accept = [...sheet.querySelectorAll('button')].find(node => node.textContent === 'Accept') as HTMLElement;
    act(() => accept.click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.devices.door_1.placement.pos).toEqual({ x: 4, y: 2.5, h: 1.9 });
    expect(written.suggest_log.map(entry => entry.id)).toEqual(['s-1']);
  });
});

describe('editing and saving', () => {
  async function editDoor(fake: Fake, x: string) {
    const marker = queryAll('.sm-mk').find(node => node.getAttribute('aria-label') === 'Test door contact') as Element;
    press(marker, 'Enter');
    act(() => byLabel('Edit').click());
    const field = queryAll('.sm-field')
      .find(node => node.querySelector('.sm-field-label')?.textContent === 'x')
      ?.querySelector('input') as HTMLInputElement;
    typeInto(field, x);
    return fake;
  }

  it('moves a marker to exactly the number typed, reports pending, then saving, then saved only after the acknowledgement', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    await editDoor(fake, '3.5');
    expect(query('.sm-save')?.className).toContain('pending');
    expect(writes(fake)).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes(fake)).toHaveLength(1);
    const written = writes(fake)[0].value as MapDoc;
    expect(writes(fake)[0].key).toBe('sensor_map');
    expect(written.devices.door_1.placement.pos).toEqual({ x: 3.5, y: 3, h: 1 });
    expect(written.devices.door_1.placement.cert).toBe('room');
    expect(query('.sm-save')?.className).toContain('saved');
  });

  it('writes on close before closing, and refuses to close while the write fails', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    await editDoor(fake, '3.5');
    fake.failWrites = true;
    act(() => byLabel('Close the map').click());
    await flush();
    expect(writes(fake)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(query('.sm-save')?.className).toContain('failed');

    fake.failWrites = false;
    const retry = query('.sm-save .sm-link') as HTMLElement;
    act(() => retry.click());
    await flush();
    expect(writes(fake)).toHaveLength(2);
    expect(query('.sm-save')?.className).toContain('saved');
    act(() => byLabel('Close the map').click());
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the edit through a failed write and lands it once on retry', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    fake.failWrites = true;
    await editDoor(fake, '2.5');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(query('.sm-save')?.className).toContain('failed');
    fake.failWrites = false;
    act(() => (query('.sm-save .sm-link') as HTMLElement).click());
    await flush();
    const stored = fake.data.sensor_map as MapDoc;
    expect(stored.devices.door_1.placement.pos?.x).toBe(2.5);
    expect(stored.devices.door_1.history).toHaveLength(1);
  });

  it('shows the unplaced devices in Edit and puts one on the plan with a tap on the tray and the plan', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    expect(query('.sm-tray')).toBeNull();
    act(() => byLabel('Edit').click());
    await flush();
    const tray = query('.sm-tray') as Element;
    expect(tray.textContent).toContain('Spare sensor');
    act(() => (tray.querySelector('button') as HTMLElement).click());
    expect(query('.sm-sheet')?.textContent).toContain('Tap the plan where it is');
  });

  it('answers a question and saves the answer', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    const questions = queryAll('.sm-chip').find(node => node.textContent?.startsWith('Questions')) as HTMLElement;
    act(() => questions.click());
    const input = document.querySelector('#sm-q-Q1 input') as HTMLInputElement;
    typeInto(input, 'The left side');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const stored = fake.data.sensor_map as MapDoc;
    expect(stored.questions[0]).toMatchObject({ id: 'Q1', answer: 'The left side' });
  });
});
