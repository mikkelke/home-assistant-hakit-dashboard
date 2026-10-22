// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fitView, planToScreen } from '../../../sensorMap/geometry';
import {
  T0,
  device,
  makeDoc,
  makeFingerprint,
  makeFingerprintDoc,
  makeSuggestDoc,
  placement,
  rect,
  ulidAt,
} from '../../../sensorMap/__tests__/docFixtures';
import type { FingerprintDoc, FingerprintWifi, MapDoc, SuggestDoc, WifiSource, ZoneChange } from '../../../sensorMap/mapDoc';
import { noWifi } from '../../../sensorMap/mapDoc';
import { surveyPoints } from '../../../sensorMap/survey';
import { ventGlyph } from '../glyphs';

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
  sent: { type: string; key?: string; value?: unknown; domain?: string }[];
  /** The service calls other than Bermuda's. */
  commands: { domain: string; service: string; data: unknown }[];
  failWrites: boolean;
  failCommands: boolean;
}

function fakeConnection(data: Record<string, unknown>): Fake {
  const fake: Fake = { connection: {}, data: { ...data }, sent: [], commands: [], failWrites: false, failCommands: false };
  Object.assign(fake.connection, {
    sendMessagePromise: vi.fn(async (message: { type: string; key?: string; value?: unknown; domain?: string }) => {
      fake.sent.push(message);
      if (message.type === 'call_service') {
        const call = message as unknown as { domain: string; service: string; service_data?: unknown };
        if (call.domain === 'bermuda') return { response: {} };
        fake.commands.push({ domain: call.domain, service: call.service, data: call.service_data });
        if (fake.failCommands) throw new Error('no such service');
        return { context: { id: ulidAt(Date.now()) } };
      }
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

const canvas = { w: 800, h: 600 };

beforeEach(() => {
  vi.useFakeTimers();
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  Object.assign(canvas, { w: 800, h: 600 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: canvas.w,
    bottom: canvas.h,
    width: canvas.w,
    height: canvas.h,
    toJSON: () => ({}),
  }));
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
const draft = () => JSON.parse(window.localStorage.getItem('sensormap-draft-v1:map') ?? 'null');
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Types and leaves the field, as a person does before the page changes. */
function typeInto(input: HTMLInputElement, value: string) {
  type(input, value);
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

const press = (element: Element, key: string) =>
  act(() => void element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
const settle = (ms = 1500) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const marker = (name: string) => queryAll('.sm-mk').find(node => node.getAttribute('aria-label') === name) as Element;
const field = (label: string) =>
  queryAll('.sm-field')
    .find(node => node.querySelector('.sm-field-label')?.textContent === label)
    ?.querySelector('input') as HTMLInputElement;
const choose = (text: string) => act(() => (queryAll('.sm-chip').find(node => node.textContent === text) as HTMLElement).click());
/** Switches the mode control to View, Edit or Survey. */
const mode = (name: 'View' | 'Edit' | 'Survey') =>
  act(() => (queryAll('.sm-mode-btn').find(node => node.textContent === name) as HTMLElement).click());
const openLayers = () => act(() => (query('[aria-label^="Layers"]') as HTMLElement).click());
const layerRow = (label: string) =>
  queryAll('.sm-sheet .sm-lay-row').find(node => node.querySelector('.sm-lay-label')?.textContent === label) as HTMLElement;
/** Flips one row of the Layers sheet and puts the sheet away, so the plan answers taps again. */
function toggleLayer(label: string) {
  openLayers();
  act(() => layerRow(label).click());
  act(() => byLabel('Close').click());
}
const openQuestions = () => act(() => (query('[aria-label^="Questions"]') as HTMLElement).click());
const editDoorSheet = () => press(marker('Test door contact'), 'Enter');
/** Selects the door contact and switches to Edit, typing a new x when one is given. */
function editDoor(x?: string) {
  editDoorSheet();
  mode('Edit');
  if (x) typeInto(field('x'), x);
}

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

    openQuestions();
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

describe('fingerprints on the plan', () => {
  it('draws each as a cross, hollow when weak, and lists the weak ones under a filter', async () => {
    const prints = makeFingerprintDoc();
    prints.items = [makeFingerprint('fp-a'), makeFingerprint('fp-b', { weak: true, pos: { x: 3, y: 3, h: 1 } }), makeFingerprint('fp-c')];
    const fake = fakeConnection({ ...docs(), sensor_map_fingerprints: prints });
    await open(fake);
    expect(queryAll('.sm-print')).toHaveLength(3);
    expect(queryAll('.sm-print.weak')).toHaveLength(1);
    expect(query('.sm-save')?.textContent).toContain('3 fingerprints');

    openLayers();
    expect(layerRow('Fingerprints').querySelector('.sm-count')?.textContent).toBe('3');
    expect(layerRow('Weak only').querySelector('.sm-count')?.textContent).toBe('1');
    act(() => layerRow('Weak only').click());
    expect(queryAll('.sm-print')).toHaveLength(1);
    expect(query('.sm-print.weak')).not.toBeNull();
    act(() => layerRow('Weak only').click());
    expect(queryAll('.sm-print')).toHaveLength(3);
  });

  it('opens a fingerprint, a ghost and a marker from the keyboard alike', async () => {
    const prints = makeFingerprintDoc();
    prints.items = [makeFingerprint('fp-a')];
    await open(fakeConnection({ ...docs(), sensor_map_fingerprints: prints }));
    press(query('.sm-print') as Element, 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('Fingerprint');
    act(() => byLabel('Close').click());
    press(query('.sm-ghost [data-hit="ghost"]') as Element, ' ');
    expect(query('.sm-sheet')?.textContent).toContain('suggested placement');
  });

  it('offers no weak filter when every fingerprint is strong', async () => {
    const prints = makeFingerprintDoc();
    prints.items = [makeFingerprint('fp-a')];
    await open(fakeConnection({ ...docs(), sensor_map_fingerprints: prints }));
    openLayers();
    expect(layerRow('Weak only')).toBeUndefined();
    expect(query('.sm-save')?.textContent).toContain('1 fingerprint');
    expect(query('.sm-save')?.textContent).not.toContain('1 fingerprints');
  });
});

describe('editing and saving', () => {
  it('moves a marker to exactly the number typed, reports pending, then saved only after the acknowledgement', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor('3.5');
    expect(query('.sm-save')?.className).toContain('pending');
    expect(writes(fake)).toHaveLength(0);
    await settle(1000);
    expect(writes(fake)).toHaveLength(1);
    const written = writes(fake)[0].value as MapDoc;
    expect(writes(fake)[0].key).toBe('sensor_map');
    expect(written.devices.door_1.placement).toMatchObject({ pos: { x: 3.5, y: 3, h: 1 }, cert: 'room' });
    expect(query('.sm-save')?.className).toContain('saved');
  });

  it('writes on close before closing, and refuses to close while the write fails', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor('3.5');
    fake.failWrites = true;
    act(() => byLabel('Close the map').click());
    await flush();
    expect(writes(fake)).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(query('.sm-save')?.className).toContain('failed');

    fake.failWrites = false;
    act(() => (query('.sm-save .sm-link') as HTMLElement).click());
    await flush();
    expect(writes(fake)).toHaveLength(2);
    expect(query('.sm-save')?.className).toContain('saved');
    act(() => byLabel('Close the map').click());
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the unplaced devices in Edit and puts one on the plan with a tap on the tray and the plan', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    expect(query('.sm-tray')).toBeNull();
    mode('Edit');
    await flush();
    const tray = query('.sm-tray') as Element;
    expect(tray.textContent).toContain('Spare sensor');
    act(() => (tray.querySelector('button') as HTMLElement).click());
    expect(query('.sm-sheet')?.textContent).toContain('Tap the plan where it is');
  });
});

describe('device types', () => {
  it('lists a known type the stored document lacks, with its count, and stores it only with the next edit', async () => {
    const map = makeDoc();
    map.devices.ap_1 = device('Test access point', { type: 'wifi', placement: placement({ pos: { x: 6, y: 2, h: null } }) });
    const fake = fakeConnection({ ...docs(), sensor_map: map });
    await open(fake);
    openLayers();
    const row = layerRow('Wi-Fi AP');
    expect([row.querySelector('.sm-count')?.textContent, row.classList.contains('t-wifi')]).toEqual(['1', true]);
    act(() => byLabel('Close').click());
    expect(queryAll('.sm-mk.t-wifi')).toHaveLength(1);
    await settle();
    expect(writes(fake)).toHaveLength(0);

    editDoor('3.5');
    await settle(1000);
    expect((writes(fake)[0].value as MapDoc).types.map(type => type.key)).toContain('wifi');
  });
});

describe('leaving a field or the page', () => {
  it('Escape drops a typed coordinate: the marker stays, nothing is written', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor();
    act(() => field('x').focus());
    type(field('x'), '7.5');
    press(field('x'), 'Escape');
    expect(field('x').value).toBe('4');
    await settle();
    expect(writes(fake)).toHaveLength(0);
    expect(query('.sm-save')?.className).toContain('saved');
  });

  it('keeps a space typed in an answer, and keeps the answer as a draft when the page goes before the field is left', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    openQuestions();
    const answer = document.querySelector('#sm-q-Q1 input') as HTMLInputElement;
    type(answer, 'left ');
    expect(answer.value).toBe('left ');
    type(answer, 'left side');
    await act(async () => root.render(createElement('div')));
    await flush();
    expect(draft()?.doc.questions[0].answer).toBe('left side');
    expect(writes(fake)).toHaveLength(0);
  });
});

describe('dragging the selected marker', () => {
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const fire = (target: Element, name: string, x: number, y: number) =>
    act(
      () =>
        void target.dispatchEvent(
          new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y })
        )
    );
  /** Presses on `target` at `from`, drags 40 px to the right and stops just short of the release. */
  const drag = (target: string, from: { x: number; y: number }) => {
    fire(query(target) as Element, 'pointerdown', from.x, from.y);
    fire(query('.sm-svg') as Element, 'pointermove', from.x + 20, from.y);
    fire(query('.sm-svg') as Element, 'pointermove', from.x + 40, from.y);
    return () => fire(query('.sm-svg') as Element, 'pointerup', from.x + 40, from.y);
  };
  const door = () => screenOf(4, 3);
  const doorX = (fake: Fake) => (writes(fake)[0].value as MapDoc).devices.door_1.placement.pos?.x;

  it('moves by the distance dragged, and the write follows the release', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor();
    const release = drag('.sm-mk[data-id="door_1"] .sm-mk-bg', door());
    expect(writes(fake)).toHaveLength(0);
    release();
    await settle();
    expect(doorX(fake)).toBeCloseTo(4 + 40 / (canvas.w / 13), 1);
  });

  it.each([
    ['switching to View', () => mode('View')],
    ['Escape', () => press(query('.sm-main') as Element, 'Escape')],
    ['closing the sheet', () => act(() => byLabel('Close').click())],
  ])('moves nothing when %s comes before the release', async (_name, interrupt) => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor();
    const release = drag('.sm-mk[data-id="door_1"] .sm-mk-bg', door());
    interrupt();
    release();
    await settle();
    expect(writes(fake)).toHaveLength(0);
  });

  async function selectRadar(w: number, h: number) {
    Object.assign(canvas, { w, h });
    const fake = fakeConnection(docs());
    await open(fake);
    press(marker('Alpha radar'), 'Enter');
    mode('Edit');
    return fake;
  }

  it.each([
    [300, 200, false],
    [800, 600, true],
  ])('on a %i by %i canvas the facing handle is drawn: %s', async (w, h, drawn) => {
    await selectRadar(w, h);
    expect(query('.sm-handle') !== null).toBe(drawn);
  });

  it('moves a radar pressed where its facing handle also reaches, rather than turning it', async () => {
    const fake = await selectRadar(400, 280);
    const radar = screenOf(1, 3);
    const handle = screenOf(1 + 1.2 * Math.cos(Math.PI * 1.75), 3 + 1.2 * Math.sin(Math.PI * 1.75));
    const reach = 18 / Math.hypot(handle.x - radar.x, handle.y - radar.y);
    drag('.sm-handle .sm-handle-knob', { x: radar.x + (handle.x - radar.x) * reach, y: radar.y + (handle.y - radar.y) * reach })();
    await settle();
    const { pos, facing } = (writes(fake)[0].value as MapDoc).devices.radar_a.placement;
    expect(pos?.x).toBeGreaterThan(2);
    expect(facing).toEqual({ state: 'known', deg: 315 });
  });
});

describe('unsaved edits when the page goes', () => {
  async function leaveFailing() {
    const fake = fakeConnection(docs());
    await open(fake);
    fake.failWrites = true;
    editDoor('3.5');
    await settle();
    expect(query('.sm-save')?.className).toContain('failed');
    await act(async () => root.render(createElement('div')));
    await flush();
    fake.failWrites = false;
    return fake;
  }

  it('are kept as a draft on Back, and offered with Restore when the page opens again', async () => {
    const fake = await leaveFailing();
    expect(draft()).toMatchObject({ base: null, doc: { devices: { door_1: { placement: { pos: { x: 3.5 } } } } } });
    await open(fake);
    expect(query('.sm-workspace')).toBeNull();
    expect(query('.sm-status')?.textContent).toContain('Unsaved changes were kept');
    expect(query('.sm-status')?.textContent).not.toContain('Changed elsewhere');
    choose('Restore');
    await settle();
    expect(query('.sm-workspace')).not.toBeNull();
    expect((fake.data.sensor_map as MapDoc).devices.door_1.placement.pos?.x).toBe(3.5);
    expect(draft()).toBeNull();
  });

  it('are dropped with Discard, which writes nothing', async () => {
    const fake = await leaveFailing();
    const before = writes(fake).length;
    await open(fake);
    choose('Discard');
    await settle();
    expect(query('.sm-workspace')).not.toBeNull();
    expect(draft()).toBeNull();
    expect(writes(fake)).toHaveLength(before);
  });

  it('say when Home Assistant holds a document the draft was not made from, and Overwrite still replaces it', async () => {
    const fake = await leaveFailing();
    fake.data.sensor_map = { ...makeDoc(), write_id: 'elsewhere', writer: 'other', updated_at: '2030-02-02T10:00:00.000Z' };
    await open(fake);
    expect(query('.sm-status')?.textContent).toContain('Changed elsewhere: Home Assistant holds a newer map');
    choose('Overwrite');
    await settle();
    const stored = fake.data.sensor_map as MapDoc;
    expect([stored.devices.door_1.placement.pos?.x, stored.writer === 'other']).toEqual([3.5, false]);
  });

  it('are kept when the connection is replaced and the viewer lookup unmounts the page', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    fake.failWrites = true;
    editDoor('3.5');
    await settle();
    const next = fakeConnection(docs());
    lookups.set(next.connection, new Promise<User>(() => {}));
    act(() => store.setState({ connection: next.connection }));
    await flush();
    expect(query('.sm-workspace')).toBeNull();
    expect(draft()?.doc.devices.door_1.placement.pos.x).toBe(3.5);
  });
});

describe('a page that is hidden', () => {
  it('keeps what Home Assistant has not acknowledged as a draft at once, since it may never come back', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    fake.failWrites = true;
    editDoor('3.5');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(draft()?.doc.devices.door_1.placement.pos.x).toBe(3.5);
  });
});

describe('a map changed elsewhere', () => {
  async function conflict() {
    const fake = fakeConnection(docs());
    await open(fake);
    const stored = fake.data.sensor_map as MapDoc;
    const theirs = { ...stored, write_id: 'theirs', writer: 'other-page' };
    theirs.devices = { ...stored.devices, door_1: { ...stored.devices.door_1, name: 'Renamed elsewhere' } };
    fake.data.sensor_map = theirs;
    editDoor('3.5');
    await settle();
    return fake;
  }

  it('is not written over: the page keeps the edit as a draft and offers it against the other document, and Reload drops it', async () => {
    const fake = await conflict();
    expect(query('.sm-workspace')).toBeNull();
    expect(query('.sm-status')?.textContent).toContain('Changed elsewhere');
    expect(writes(fake)).toHaveLength(0);
    choose('Reload');
    await settle();
    press(marker('Renamed elsewhere'), 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('Renamed elsewhere');
    expect(draft()).toBeNull();
    expect(writes(fake)).toHaveLength(0);
  });

  it('is replaced by Overwrite, as a write of this page', async () => {
    const fake = await conflict();
    choose('Overwrite');
    await settle();
    const stored = fake.data.sensor_map as MapDoc;
    expect([stored.devices.door_1.placement.pos?.x, stored.devices.door_1.name, stored.writer === 'other-page']).toEqual([
      3.5,
      'Test door contact',
      false,
    ]);
  });
});

const BSSID_A = '02:00:5e:10:00:0a';
const BSSID_B = '02:00:5e:10:00:0b';
const WIFI_SOURCE: WifiSource = {
  name: 'Test phone',
  notify: 'notify.mobile_app_test_phone',
  signal: 'sensor.test_phone_wi_fi_signal_strength',
  bssid: 'sensor.test_phone_wi_fi_bssid',
  frequency: 'sensor.test_phone_wi_fi_frequency',
};

/** The map with a Wi-Fi source, one access point on the plan and a BSSID table that lists it. */
function wifiMap(): MapDoc {
  const map = makeDoc();
  map.devices.ap_1 = device('Test access point', { type: 'wifi', placement: placement({ pos: { x: 6, y: 2, h: null } }) });
  map.wifi = { source: WIFI_SOURCE, aps: { [BSSID_A]: 'ap_1' } };
  return map;
}

const entity = (state: string, at: number) => ({ state, last_updated: new Date(at).toISOString(), attributes: {} });
/** The phone's three Wi-Fi sensors as the Companion app left them some time ago. */
const seedWifi = (signal = '-70') =>
  act(() =>
    store.setState({
      entities: {
        [WIFI_SOURCE.signal]: entity(signal, Date.now() - 600_000),
        [WIFI_SOURCE.bssid]: entity(BSSID_A, Date.now() - 3_600_000),
        [WIFI_SOURCE.frequency]: entity('5180', Date.now() - 3_600_000),
      },
    })
  );
const reportSignal = (value: string) =>
  act(() => store.setState({ entities: { ...store.getState().entities, [WIFI_SOURCE.signal]: entity(value, Date.now()) } }));

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const chip = (text: string) => queryAll('.sm-chip').find(node => node.textContent === text) as HTMLElement;
/** Throws a suggestion away: the control asks first, and its confirming tap wakes up a moment later. */
const discard = async () => {
  act(() => chip('Discard suggestion').click());
  await advance(700);
  act(() => chip('Yes, discard').click());
};
const point = (n = 0) => surveyPoints(makeDoc().plan)[n];
const target = (id: string) => query(`.sm-sv[data-id="${id}"]`) as Element;
const savedPrints = (fake: Fake) =>
  writes(fake)
    .filter(message => message.key === 'sensor_map_fingerprints')
    .at(-1)?.value as FingerprintDoc;
const startFrom = (id: string) => {
  press(target(id), 'Enter');
  act(() => chip('Save and start').click());
};

describe('the survey', () => {
  it('is off until asked for, as is the coverage layer', async () => {
    await open(fakeConnection(docs()));
    expect(queryAll('.sm-mode-btn').map(node => `${node.textContent}:${node.getAttribute('aria-pressed')}`)).toEqual([
      'View:true',
      'Edit:false',
      'Survey:false',
    ]);
    openLayers();
    expect(layerRow('Coverage').getAttribute('aria-checked')).toBe('false');
    act(() => byLabel('Close').click());
    expect(queryAll('.sm-sv')).toHaveLength(0);
    expect(queryAll('.sm-cov-dot')).toHaveLength(0);
    expect(query('.sm-subbar')).toBeNull();
  });

  it('draws the points as numbered hollow targets and counts how many are done', async () => {
    await open(fakeConnection(docs()));
    mode('Survey');
    const points = surveyPoints(makeDoc().plan);
    expect(queryAll('.sm-sv')).toHaveLength(points.length);
    expect(queryAll('.sm-sv .sm-sv-n').map(node => node.textContent)).toEqual(points.map(p => String(p.n)));
    expect(queryAll('.sm-sv.todo')).toHaveLength(points.length);
    expect(query('.sm-subbar [role="status"]')?.textContent).toBe(`0 of ${points.length}`);
    expect(query('.sm-subbar-note')?.textContent).toContain('Keep the screen on for 10 s');
  });

  it('opens the capture sheet at a point when it is tapped, and Next point goes to the next one to do', async () => {
    await open(fakeConnection(docs()));
    mode('Survey');
    const first = point(0);
    press(target(first.id), 'Enter');
    const sheet = query('.sm-sheet') as Element;
    expect(sheet.textContent).toContain(`Point ${first.n}: ${first.label}`);
    expect(sheet.textContent).toContain('Keep the screen on for 10 s');
    expect([field('x').value, field('y').value]).toEqual([String(first.at[0]), String(first.at[1])]);
    expect(target(first.id).classList.contains('sel')).toBe(true);
    act(() => byLabel('Close').click());
    expect(query('.sm-sheet')).toBeNull();
    act(() => chip('Next point').click());
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${point(1).n}: ${point(1).label}`);
  });

  it('skips a point, remembers that in this browser only, and restores it', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Survey');
    const first = point(0);
    press(target(first.id), 'Enter');
    act(() => chip('Skip this point').click());
    expect(query('.sm-sheet')).toBeNull();
    expect(target(first.id).classList.contains('skipped')).toBe(true);
    expect(queryAll('.sm-subbar .sm-count').map(node => node.textContent)).toContain('1 skipped');
    await settle(500);
    expect(JSON.parse(window.localStorage.getItem('sensormap-ui-v1') ?? 'null').skipped).toEqual([first.id]);
    expect(writes(fake)).toHaveLength(0);
    press(target(first.id), 'Enter');
    act(() => chip('Restore this point').click());
    expect(target(first.id).classList.contains('todo')).toBe(true);
    expect(query('.sm-sheet')?.textContent).toContain('Skip this point');
  });

  it('keeps a point as that point when the spot is moved before the capture', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    press(target(first.id), 'Enter');
    typeInto(field('x'), '9.5');
    expect(field('x').value).toBe('9.5');
    act(() => chip('Save and start').click());
    await advance(1000);
    reportSignal('-61');
    await advance(13_000);
    await advance(1100);
    expect(savedPrints(fake).items[0]).toMatchObject({ survey_id: first.id, pos: { x: 9.5, y: first.at[1] } });
    expect(target(first.id).getAttribute('transform')).toContain('9.5');
    expect(target(first.id).classList.contains('done')).toBe(true);
  });

  it('captures a point: sends the update command, keeps the reading that follows and turns the target solid', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(0);
    expect(fake.commands).toEqual([{ domain: 'notify', service: 'mobile_app_test_phone', data: { message: 'command_update_sensors' } }]);
    expect(query('.sm-fab-wrap')?.textContent).toContain('keep the screen on');
    expect(query('.sm-sheet')).toBeNull();
    await advance(1200);
    reportSignal('-61');
    await advance(13_000);
    await advance(1100);
    const [item] = savedPrints(fake).items;
    expect(item).toMatchObject({
      survey_id: first.id,
      pos: { x: first.at[0], y: first.at[1], h: 1 },
      bermuda_address: 'test-beacon-address',
      wifi: { dbm: -61, bssid: BSSID_A, freq_mhz: 5180, band: '5', miss: {} },
    });
    expect(fake.commands).toHaveLength(1);
    expect(target(first.id).classList.contains('done')).toBe(true);
    expect(target(first.id).classList.contains('nowifi')).toBe(false);
    expect(query('.sm-subbar [role="status"]')?.textContent).toBe(`1 of ${surveyPoints(makeDoc().plan).length}`);
    expect(query('.sm-subbar-note')?.textContent).toBe(`Point ${first.n} saved: -61 dBm, 5 GHz, Test access point.`);
    expect(query('.sm-fab-wrap')?.textContent).toContain('I am here');
    expect(query('.sm-sheet')).toBeNull();
  });

  it('captures Wi-Fi alone when no phone is tracked by Bluetooth, and draws no Bluetooth cross for it', async () => {
    const map = wifiMap();
    map.phones = [];
    const fake = fakeConnection({ ...docs(), sensor_map: map });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(1200);
    reportSignal('-58');
    await advance(14_000);
    const [item] = savedPrints(fake).items;
    expect(item).toMatchObject({ phone: 'Test phone', bermuda_address: '', scanners: {}, polls: 0, wifi: { dbm: -58 } });
    expect(fake.sent.some(message => message.domain === 'bermuda')).toBe(false);
    expect(queryAll('.sm-print')).toHaveLength(0);
    expect(target(first.id).classList.contains('done')).toBe(true);
  });

  it('goes on waiting for Wi-Fi after the window, says so, and saves the moment a reading lands', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(9000);
    expect(query('.sm-fab-wrap')?.textContent).toContain('keep the screen on');
    expect(query('.sm-fab-wrap')?.textContent).not.toContain('Waiting for Wi-Fi');
    await advance(1600);
    expect(query('.sm-fab-wrap')?.textContent).toContain('Waiting for Wi-Fi… 10 s');
    expect(queryAll('.sm-fab').map(node => node.textContent)).toEqual(['Save without Wi-Fi', 'Cancel']);
    await advance(14_000);
    expect(query('.sm-fab-wrap')?.textContent).toContain('Waiting for Wi-Fi… 24 s');
    expect(savedPrints(fake)).toBeUndefined();
    reportSignal('-61');
    await advance(2500);
    const [item] = savedPrints(fake).items;
    expect(item.wifi).toMatchObject({ dbm: -61, bssid: BSSID_A, miss: {} });
    expect(fake.commands).toHaveLength(3);
    expect(query('.sm-fab-wrap')?.textContent).toContain('I am here');
    expect(query('.sm-subbar-note')?.textContent).toBe(`Point ${first.n} saved: -61 dBm, 5 GHz, Test access point.`);
  });

  it('saves without Wi-Fi at once when asked to, with the capture as far as it got', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(15_000);
    act(() => (queryAll('.sm-fab').find(node => node.textContent === 'Save without Wi-Fi') as HTMLElement).click());
    await advance(2600);
    const [item] = savedPrints(fake).items;
    expect(item).toMatchObject({
      survey_id: first.id,
      bermuda_address: 'test-beacon-address',
      wifi: { dbm: null, miss: { dbm: 'stale' } },
    });
    expect(target(first.id).classList.contains('nowifi')).toBe(true);
    expect(query('.sm-subbar-note')?.textContent).toContain(
      `Point ${first.n} saved without Wi-Fi: the phone sent no new reading while the capture waited`
    );
    expect(query('.sm-fab-wrap')?.textContent).toContain('I am here');
  });

  it('saves without Wi-Fi after sixty seconds with no reading, having asked the phone again every ten', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(59_000);
    expect(query('.sm-fab-wrap')?.textContent).toContain('Waiting for Wi-Fi… 59 s');
    expect(savedPrints(fake)).toBeUndefined();
    await advance(3600);
    expect(savedPrints(fake).items[0].wifi).toMatchObject({ dbm: null, miss: { dbm: 'stale' } });
    expect(fake.commands).toHaveLength(6);
    expect(target(first.id).classList.contains('nowifi')).toBe(true);
  });

  it('is cancelled with the Cancel button while it waits for Wi-Fi, which keeps nothing', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    startFrom(point(0).id);
    await advance(20_000);
    act(() => (queryAll('.sm-fab').find(node => node.textContent === 'Cancel') as HTMLElement).click());
    await advance(60_000);
    expect(savedPrints(fake)).toBeUndefined();
    expect(query('.sm-fab-wrap')?.textContent).toContain('I am here');
  });

  it('saves a capture without Wi-Fi when the sensors are off, says why, and marks the point to take again', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    mode('Survey');
    expect(query('.sm-subbar')?.textContent).toContain('Wi-Fi sensors are off in the app');
    const first = point(0);
    startFrom(first.id);
    await advance(14_000);
    const [item] = savedPrints(fake).items;
    expect(item.wifi).toMatchObject({ dbm: null, miss: { dbm: 'no_entity' } });
    expect(fake.commands).toHaveLength(1);
    expect(target(first.id).classList.contains('done')).toBe(true);
    expect(target(first.id).classList.contains('nowifi')).toBe(true);
    expect(query('.sm-subbar-note')?.textContent).toContain(
      `Point ${first.n} saved without Wi-Fi: the Wi-Fi sensors are not enabled in the Companion app`
    );
    expect(queryAll('.sm-subbar .sm-chip').map(node => node.textContent)).toContain('1 without Wi-Fi');
    press(target(first.id), 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('no Wi-Fi');
    act(() => chip('Capture this point again').click());
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${first.n}: ${first.label}`);
  });

  it('says so when the update command fails, and still saves the capture', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    fake.failCommands = true;
    await open(fake);
    seedWifi();
    mode('Survey');
    startFrom(point(0).id);
    await advance(62_000);
    expect(savedPrints(fake).items[0].wifi.miss.dbm).toBe('command_failed');
    expect(query('.sm-subbar-note')?.textContent).toContain('the update command failed and no reading came (no such service)');
  });

  it('is cancelled when the page is hidden, and tells the person to keep the screen on', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    startFrom(first.id);
    await advance(3000);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    await advance(14_000);
    expect(query('.sm-point.warn')?.textContent).toContain('Keep the screen on for 10 s');
    expect(savedPrints(fake)).toBeUndefined();
    expect(target(first.id).classList.contains('todo')).toBe(true);
    expect(query('.sm-fab-wrap')?.textContent).toContain('I am here');
  });

  it('is cancelled with the Cancel button, which keeps nothing', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    startFrom(point(0).id);
    await advance(2000);
    act(() => (chip('Cancel') ?? (queryAll('.sm-fab').find(node => node.textContent === 'Cancel') as HTMLElement)).click());
    await advance(14_000);
    expect(savedPrints(fake)).toBeUndefined();
  });

  it('cannot start with neither a tracked phone nor a Wi-Fi source', async () => {
    const map = makeDoc();
    map.phones = [];
    await open(fakeConnection({ ...docs(), sensor_map: map }));
    mode('Survey');
    press(target(point(0).id), 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('nothing to capture');
    expect((chip('Save and start') as HTMLButtonElement).disabled).toBe(true);
    expect(
      (queryAll('.sm-fab').find(node => node.textContent?.includes('I am here')) as HTMLButtonElement | undefined)?.disabled ?? true
    ).toBe(true);
  });

  it('shows a point that was captured before as solid, and opens its fingerprint instead of the capture sheet', async () => {
    const first = point(0);
    const prints = makeFingerprintDoc();
    prints.items = [makeFingerprint('fp-1', { survey_id: first.id, pos: { x: first.at[0], y: first.at[1], h: 1 }, wifi: noWifi('stale') })];
    await open(fakeConnection({ ...docs(), sensor_map_fingerprints: prints }));
    mode('Survey');
    expect(target(first.id).classList.contains('done')).toBe(true);
    press(target(first.id), 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('Fingerprint');
    expect(query('.sm-sheet')?.textContent).toContain(`Survey point ${first.id}`);
  });
});

describe('a suggested Wi-Fi setup', () => {
  async function openWithSetup() {
    const suggest = makeSuggestDoc();
    suggest.items.push({
      id: 's-wifi',
      kind: 'wifi',
      source: WIFI_SOURCE,
      aps: { [BSSID_A.toUpperCase()]: 'door_1', [BSSID_B]: 'nobody' },
      reason: 'Derived from the controller',
    });
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggest });
    await open(fake);
    mode('Survey');
    return fake;
  }

  it('is offered in the survey bar, listing each BSSID with its access point, and writes nothing until accepted', async () => {
    const fake = await openWithSetup();
    act(() => chip('Wi-Fi setup suggested').click());
    const sheet = query('.sm-sheet') as Element;
    expect(sheet.textContent).toContain('Derived from the controller');
    expect(sheet.textContent).toContain('notify.mobile_app_test_phone');
    expect(queryAll('.sm-sheet tbody tr').map(row => row.textContent)).toEqual([
      `${BSSID_A}Test door contact`,
      `${BSSID_B}not on the map yet`,
    ]);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('becomes part of the map when accepted, with the BSSIDs in lower case, and is logged', async () => {
    const fake = await openWithSetup();
    act(() => chip('Wi-Fi setup suggested').click());
    act(() => chip('Accept').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(writes(fake).at(-1)?.key).toBe('sensor_map');
    expect(written.wifi).toEqual({ source: WIFI_SOURCE, aps: { [BSSID_A]: 'door_1', [BSSID_B]: 'nobody' } });
    expect(written.suggest_log.map(entry => entry.id)).toContain('s-wifi');
    expect(queryAll('.sm-subbar .sm-chip').map(node => node.textContent)).not.toContain('Wi-Fi setup suggested');
    expect(query('.sm-subbar')?.textContent).toContain('Wi-Fi sensors are off in the app');
  });

  it('is only logged when discarded', async () => {
    const fake = await openWithSetup();
    act(() => chip('Wi-Fi setup suggested').click());
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.wifi).toEqual({ source: null, aps: {} });
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-wifi', rejected_at: expect.any(String) })]);
  });
});

describe('a suggested phone', () => {
  const ADDRESS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90_1_2';
  const phoneItem = (extra: Record<string, unknown> = {}) => ({
    id: 's-phone',
    kind: 'phone' as const,
    phone: { name: 'Test owner', bermuda_address: ADDRESS, person: 'person.test_owner' },
    reason: 'Bermuda tracks the phone now',
    ...extra,
  });
  const noPhones = () => {
    const map = makeDoc();
    map.phones = [];
    return map;
  };
  async function openWithPhone(options: { phones?: boolean; wifi?: boolean } = {}) {
    const suggest = makeSuggestDoc();
    suggest.items.push(phoneItem());
    if (options.wifi)
      suggest.items.push({
        id: 's-wifi',
        kind: 'wifi',
        source: WIFI_SOURCE,
        aps: { [BSSID_A]: 'door_1' },
        reason: 'Derived from the controller',
      });
    const fake = fakeConnection({ ...docs(), sensor_map: options.phones === false ? noPhones() : makeDoc(), sensor_map_suggest: suggest });
    await open(fake);
    return fake;
  }
  const phonesWritten = (fake: Fake) => (writes(fake).at(-1)?.value as MapDoc).phones;

  it('is offered by a chip in the survey bar, and in the phone chips of the Phones layer', async () => {
    await openWithPhone();
    mode('Survey');
    expect(queryAll('.sm-subbar .sm-chip').map(node => node.textContent)).toContain('Phone suggested');
    mode('View');
    expect(query('.sm-subbar')).toBeNull();
    toggleLayer('Phones');
    expect(queryAll('.sm-phones .sm-chip').map(node => node.textContent)).toContain('Phone suggested');
  });

  it('shows the phone with the address Bluetooth tracks it by, and writes nothing until accepted', async () => {
    const fake = await openWithPhone({ phones: false });
    mode('Survey');
    act(() => chip('Phone suggested').click());
    const sheet = query('.sm-sheet') as Element;
    expect(sheet.textContent).toContain('Bermuda tracks the phone now');
    expect(sheet.textContent).toContain(
      `Phone Test owner: Bluetooth tracks it as ${ADDRESS}, person person.test_owner. It is added to the tracked phones.`
    );
    expect(sheet.textContent).toContain('Now: 0 tracked phones');
    expect(queryAll('.sm-sheet .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('becomes a tracked phone of the map when accepted, written by the page, and the sheet closes', async () => {
    const fake = await openWithPhone({ phones: false });
    mode('Survey');
    act(() => chip('Phone suggested').click());
    act(() => chip('Accept').click());
    await settle(1100);
    expect(writes(fake).at(-1)?.key).toBe('sensor_map');
    expect(phonesWritten(fake)).toEqual([{ name: 'Test owner', bermuda_address: ADDRESS, person: 'person.test_owner' }]);
    expect((writes(fake).at(-1)?.value as MapDoc).suggest_log.map(entry => entry.id)).toContain('s-phone');
    expect(query('.sm-sheet')).toBeNull();
    expect(queryAll('.sm-subbar .sm-chip').map(node => node.textContent)).not.toContain('Phone suggested');
  });

  it('replaces the tracked phone that has the same address, whatever the case, instead of listing it twice', async () => {
    const suggest = makeSuggestDoc();
    suggest.items.push(phoneItem({ phone: { name: 'Renamed', bermuda_address: ADDRESS, person: null } }));
    const map = makeDoc();
    map.phones = [{ name: 'Old', bermuda_address: ADDRESS.toUpperCase(), person: 'person.test_owner' }];
    const fake = fakeConnection({ ...docs(), sensor_map: map, sensor_map_suggest: suggest });
    await open(fake);
    mode('Survey');
    act(() => chip('Phone suggested').click());
    expect(query('.sm-sheet')?.textContent).toContain('It replaces the phone already listed with that address.');
    act(() => chip('Accept').click());
    await settle(1100);
    expect(phonesWritten(fake)).toEqual([{ name: 'Renamed', bermuda_address: ADDRESS, person: null }]);
  });

  it('is only logged when discarded', async () => {
    const fake = await openWithPhone({ phones: false });
    mode('Survey');
    act(() => chip('Phone suggested').click());
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.phones).toEqual([]);
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-phone', rejected_at: expect.any(String) })]);
    expect(query('.sm-sheet')).toBeNull();
  });

  it('shares the setup sheet with a Wi-Fi setup, and the sheet stays until the last one is decided', async () => {
    const fake = await openWithPhone({ phones: false, wifi: true });
    mode('Survey');
    expect(queryAll('.sm-subbar .sm-chip').map(node => node.textContent)).toContain('Setup suggested');
    act(() => chip('Setup suggested').click());
    expect(queryAll('.sm-sheet .sm-suggest')).toHaveLength(2);
    act(() => (queryAll('.sm-sheet .sm-chip.on')[0] as HTMLElement).click());
    await settle(1100);
    expect(queryAll('.sm-sheet .sm-suggest')).toHaveLength(1);
    act(() => (queryAll('.sm-sheet .sm-chip.on')[0] as HTMLElement).click());
    await settle(1100);
    expect(query('.sm-sheet')).toBeNull();
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.phones).toHaveLength(1);
    expect(written.wifi.source).toEqual(WIFI_SOURCE);
    expect(written.suggest_log.map(entry => entry.id).sort()).toEqual(['s-phone', 's-wifi']);
  });

  it('is listed ahead of a Wi-Fi setup however the suggestions are ordered, since the BSSID table is long', async () => {
    const suggest = makeSuggestDoc();
    suggest.items.push(
      {
        id: 's-wifi',
        kind: 'wifi',
        source: WIFI_SOURCE,
        aps: { [BSSID_A]: 'door_1', [BSSID_B]: 'nobody' },
        reason: 'Derived from the controller',
      },
      phoneItem()
    );
    await open(fakeConnection({ ...docs(), sensor_map: noPhones(), sensor_map_suggest: suggest }));
    mode('Survey');
    act(() => chip('Setup suggested').click());
    expect(queryAll('.sm-sheet .sm-suggest > p:first-child').map(node => node.textContent)).toEqual([
      'Bermuda tracks the phone now',
      'Derived from the controller',
    ]);
  });

  it('makes the next capture ask Bermuda for the phone by the address that was accepted', async () => {
    const fake = await openWithPhone({ phones: false });
    mode('Survey');
    act(() => chip('Phone suggested').click());
    act(() => chip('Accept').click());
    await settle(1100);
    press(target(point(0).id), 'Enter');
    expect((chip('Save and start') as HTMLButtonElement).disabled).toBe(false);
    act(() => chip('Save and start').click());
    await advance(3000);
    const asked = fake.sent.filter(message => message.domain === 'bermuda') as unknown as { service_data: { addresses: string } }[];
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every(message => message.service_data.addresses === ADDRESS)).toBe(true);
  });
});

describe('the coverage layer', () => {
  const wifi = (dbm: number, bssid: string | null, band: '2.4' | '5' = '5'): FingerprintWifi => ({
    dbm,
    readings: [{ dbm, at: '2030-01-01T10:00:00.000Z' }],
    bssid,
    freq_mhz: band === '5' ? 5180 : 2437,
    band,
    at: '2030-01-01T10:00:00.000Z',
    miss: {},
  });
  const print = (id: string, x: number, y: number, found: FingerprintWifi) => makeFingerprint(id, { pos: { x, y, h: 1 }, wifi: found });
  const prints = () => {
    const doc = makeFingerprintDoc();
    doc.items = [
      print('c1', 1, 1, wifi(-50, BSSID_A)),
      print('c2', 2, 2, wifi(-60, BSSID_A)),
      print('c3', 3, 3, wifi(-80, BSSID_B, '2.4')),
      print('c4', 6, 2, wifi(-70, BSSID_A)),
      print('c5', 7, 2, noWifi('stale')),
    ];
    return doc;
  };
  const counts = () => queryAll('.sm-cov-count').map(node => [...node.querySelectorAll('tspan')].map(line => line.textContent).join(' · '));
  const choice = (label: string) =>
    queryAll('.sm-subbar [aria-label="Access point"] .sm-chip').find(node => node.textContent?.startsWith(label)) as HTMLElement;

  async function openCoverage() {
    await open(fakeConnection({ ...docs(), sensor_map: wifiMap(), sensor_map_fingerprints: prints() }));
    toggleLayer('Coverage');
  }

  it('draws a dot for each capture that has a reading, coloured by its dBm', async () => {
    await open(fakeConnection({ ...docs(), sensor_map: wifiMap(), sensor_map_fingerprints: prints() }));
    expect(queryAll('.sm-cov-dot')).toHaveLength(0);
    toggleLayer('Coverage');
    expect(queryAll('.sm-cov-dot')).toHaveLength(4);
    expect(['strong', 'good', 'fair', 'weak'].map(bucket => queryAll(`.sm-cov-dot.b-${bucket}`).length)).toEqual([1, 1, 1, 1]);
    expect(queryAll('.sm-subbar .sm-chip.static').map(node => node.textContent)).toEqual(['≥ -55', '≥ -65', '≥ -72', '< -72']);
    expect(query('.sm-cov-dot title')?.textContent).toBe('-50 dBm, 5 GHz, Test access point');
  });

  it('fills each room with the median of its own points and shows how many that is', async () => {
    await openCoverage();
    expect(counts()).toEqual(['-60 dBm · 3 points', '-70 dBm · 1 point']);
    expect(queryAll('.sm-cov-fill').map(node => node.getAttribute('class'))).toEqual(['sm-cov-fill b-good', 'sm-cov-fill b-fair']);
  });

  it('filters by access point, for the dots and for the medians, and falls back to all when nothing is left to filter', async () => {
    await openCoverage();
    expect(queryAll('.sm-subbar [aria-label="Access point"] .sm-chip').map(node => node.textContent)).toEqual([
      'All APs 4',
      'Test access point 3',
      'Unlisted 10:00:0b 1',
    ]);
    act(() => choice('Test access point').click());
    expect(queryAll('.sm-cov-dot')).toHaveLength(3);
    expect(counts()).toEqual(['-55 dBm · 2 points', '-70 dBm · 1 point']);
    expect(choice('Test access point').getAttribute('aria-pressed')).toBe('true');
    act(() => choice('Unlisted').click());
    expect(queryAll('.sm-cov-dot')).toHaveLength(1);
    expect(counts()).toEqual(['-80 dBm · 1 point']);
    act(() => choice('All APs').click());
    expect(queryAll('.sm-cov-dot')).toHaveLength(4);
  });

  it('opens the fingerprint of a dot, and leaves the Bluetooth layer as it was', async () => {
    await openCoverage();
    expect(queryAll('.sm-print')).toHaveLength(5);
    press(query('.sm-cov-dot') as Element, 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('-50 dBm, 5 GHz, Test access point');
    expect(query('.sm-sheet')?.textContent).toContain(`BSSID ${BSSID_A}`);
  });

  it('says when no capture has a reading yet', async () => {
    await open(fakeConnection(docs()));
    toggleLayer('Coverage');
    expect(query('.sm-subbar')?.textContent).toContain('No capture holds a Wi-Fi reading yet');
    expect(queryAll('.sm-cov-fill')).toHaveLength(0);
  });
});

describe('fingerprints of the first schema version', () => {
  it('are read, drawn as before, and say their Wi-Fi was not captured', async () => {
    const { wifi: _wifi, survey_id: _survey, ...old } = makeFingerprint('fp-old');
    void _wifi;
    void _survey;
    const stored = { ...makeFingerprintDoc(), schema_version: 1, items: [old] };
    const fake = fakeConnection({ ...docs(), sensor_map_fingerprints: stored });
    await open(fake);
    expect(queryAll('.sm-print')).toHaveLength(1);
    press(query('.sm-print') as Element, 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('no Wi-Fi, Wi-Fi was not captured for this fingerprint');
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });
});

describe('a suggested rename', () => {
  async function openWithRename() {
    const suggest = makeSuggestDoc();
    suggest.items = [{ id: 's-rename', kind: 'rename', device_key: 'door_1', name: 'Front door contact', reason: 'It is the front door' }];
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggest });
    await open(fake);
    press(marker('Test door contact'), 'Enter');
    return fake;
  }

  it('shows on the device with the name it proposes, and renames it, with a log entry, only when accepted', async () => {
    const fake = await openWithRename();
    expect(query('.sm-sheet')?.textContent).toContain('Suggested name "Front door contact": It is the front door');
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    act(() => chip('Accept').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.devices.door_1.name).toBe('Front door contact');
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-rename', accepted_at: expect.any(String) })]);
    expect(marker('Front door contact')).toBeDefined();
    expect(query('.sm-sheet')?.textContent).not.toContain('Suggested name');
  });

  it('leaves the name when discarded, and logs it', async () => {
    const fake = await openWithRename();
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.devices.door_1.name).toBe('Test door contact');
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-rename', rejected_at: expect.any(String) })]);
  });
});

describe('furniture', () => {
  const ISLAND = { id: 'island', name: 'Test island', box: [5, 5, 7, 6] as [number, number, number, number] };
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const withIsland = (): MapDoc => {
    const map = makeDoc();
    map.plan.furniture = [ISLAND];
    return map;
  };
  const suggestingIsland = (): SuggestDoc => {
    const suggest = makeSuggestDoc();
    suggest.items = [{ id: 's-island', kind: 'furniture', furniture: ISLAND, reason: 'It stands there' }];
    return suggest;
  };
  const openSuggesting = async () => {
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggestingIsland() });
    await open(fake);
    return fake;
  };
  const outline = () => query('.sm-ghost-box [data-hit="ghost"]') as Element;
  const viewBox = () => query('.sm-svg')?.getAttribute('viewBox');

  it('is drawn from the plan with its name, above the rooms and under the walls', async () => {
    await open(fakeConnection({ ...docs(), sensor_map: withIsland() }));
    const box = query('.sm-furniture .sm-furniture-box') as Element;
    expect(queryAll('.sm-furniture .sm-furniture-box')).toHaveLength(1);
    expect(['x', 'y', 'width', 'height'].map(name => Number(box.getAttribute(name)))).toEqual([5, makeDoc().plan.bounds.y1 - 6, 2, 1]);
    expect(query('.sm-furniture text')?.textContent).toBe('Test island');
    const layers = [...(query('.sm-svg')?.children ?? [])].map(node => node.getAttribute('class'));
    expect(layers.indexOf('sm-zones')).toBeLessThan(layers.indexOf('sm-furniture'));
    expect(layers.indexOf('sm-furniture')).toBeLessThan(layers.indexOf('sm-structure'));
  });

  it('is not there on a plan that has none', async () => {
    await open(fakeConnection(docs()));
    expect(query('.sm-furniture')).toBeNull();
  });

  it('is suggested as a dashed outline with its name, counted by the pill, and not yet part of the plan', async () => {
    await openSuggesting();
    expect(queryAll('.sm-ghost-box')).toHaveLength(1);
    expect(query('.sm-ghost-box text')?.textContent).toBe('Test island');
    expect(outline().getAttribute('aria-label')).toBe('Suggested furniture Test island');
    expect(query('.sm-pill')?.textContent).toBe('1 suggestion');
    expect(query('.sm-furniture')).toBeNull();
  });

  it('opens a sheet with the reason, without the hint to drag, and writes nothing until it is decided', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test island');
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested furniture');
    expect(query('.sm-sheet')?.textContent).toContain('It stands there');
    expect(query('.sm-sheet')?.textContent).not.toContain('Drag the marker');
    expect(queryAll('.sm-sheet .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('joins the plan when accepted, as a write of the page that is logged, and the outline goes', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    act(() => chip('Accept').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(writes(fake).at(-1)?.key).toBe('sensor_map');
    expect(written.plan.furniture).toEqual([ISLAND]);
    expect(written.layout_version).toBe(makeDoc().layout_version);
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-island', accepted_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(queryAll('.sm-furniture .sm-furniture-box')).toHaveLength(1);
    expect(query('.sm-pill')).toBeNull();
  });

  it('leaves the plan alone when discarded, and logs it', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.plan.furniture).toBeUndefined();
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-island', rejected_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(query('.sm-furniture')).toBeNull();
  });

  it('is a card in the suggestions sheet that can be shown on the map, which selects the outline', async () => {
    await openSuggesting();
    act(() => (query('.sm-pill') as HTMLElement).click());
    const card = query('.sm-sheet .sm-suggest-card') as HTMLElement;
    expect(card.querySelector('.sm-tag')?.textContent).toBe('Furniture');
    expect(card.textContent).toContain('Test island');
    expect(card.textContent).toContain('It stands there');
    expect([...card.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    act(() => ([...card.querySelectorAll('button')].find(node => node.textContent === 'Show on map') as HTMLElement).click());
    await settle(100);
    expect(query('.sm-ghost.sel')).not.toBeNull();
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested furniture');
  });

  it('is not dragged in Edit: a drag on the outline pans the plan and accepts nothing', async () => {
    const fake = await openSuggesting();
    mode('Edit');
    const from = screenOf(6, 5.5);
    const fire = (target: Element, name: string, at: { x: number; y: number }) =>
      act(
        () =>
          void target.dispatchEvent(
            new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at.x, clientY: at.y })
          )
      );
    const before = viewBox();
    fire(query('.sm-ghost-edge') as Element, 'pointerdown', from);
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + 20, y: from.y });
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + 40, y: from.y });
    fire(query('.sm-svg') as Element, 'pointerup', { x: from.x + 40, y: from.y });
    await settle();
    expect(viewBox()).not.toBe(before);
    expect(writes(fake)).toHaveLength(0);
    expect(queryAll('.sm-ghost-box')).toHaveLength(1);
  });
});

describe('vents', () => {
  const FAMILY = {
    id: 'family',
    name: 'Test supply',
    kind: 'supply' as const,
    pos: { x: 6, y: 5, h: 2.5 },
    valve: 'Test valve 160',
    flow_m3h: 185,
  };
  const HOOD = { id: 'hood', name: 'Test hood', kind: 'exhaust' as const, pos: { x: 2, y: 5 } };
  const ISLAND = { id: 'island', name: 'Test island', box: [5, 5, 7, 6] as [number, number, number, number] };
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const withVents = (): MapDoc => {
    const map = makeDoc();
    map.plan.furniture = [ISLAND];
    map.plan.vents = [FAMILY, HOOD];
    return map;
  };
  const suggestingVent = (): SuggestDoc => {
    const suggest = makeSuggestDoc();
    suggest.items = [{ id: 's-family', kind: 'vent', vent: FAMILY, reason: 'It blows there' }];
    return suggest;
  };
  const openSuggesting = async () => {
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggestingVent() });
    await open(fake);
    return fake;
  };
  const ring = () => query('.sm-ghost-vent [data-hit="ghost"]') as Element;
  const viewBox = () => query('.sm-svg')?.getAttribute('viewBox');
  const fire = (on: Element, name: string, at: { x: number; y: number }) =>
    act(
      () =>
        void on.dispatchEvent(
          new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at.x, clientY: at.y })
        )
    );
  const tap = (on: Element, at: { x: number; y: number }) => {
    fire(on, 'pointerdown', at);
    fire(query('.sm-svg') as Element, 'pointerup', at);
  };
  const vent = (id: string) => query(`.sm-vent[data-id="${id}"]`) as Element;
  const rows = () =>
    queryAll('.sm-sheet .sm-entity-row').map(row => [row.querySelector('dt')?.textContent, row.querySelector('dd')?.textContent]);

  it('is drawn from the plan as a ring, a supply and an exhaust apart in class and glyph, over the walls and under the sensors', async () => {
    await open(fakeConnection({ ...docs(), sensor_map: withVents() }));
    expect(queryAll('.sm-vents .sm-vent')).toHaveLength(2);
    expect(vent('family').getAttribute('class')).toContain('kind-supply');
    expect(vent('hood').getAttribute('class')).toContain('kind-exhaust');
    expect(vent('family').getAttribute('transform')).toBe(`translate(6 ${makeDoc().plan.bounds.y1 - 5})`);
    expect(vent('family').getAttribute('aria-label')).toBe('Vent Test supply, supply');
    const glyph = (id: string) => vent(id).querySelector('.sm-vent-glyph')?.getAttribute('d');
    expect(glyph('family')).toBeTruthy();
    expect(glyph('family')).not.toBe(glyph('hood'));
    const layers = [...(query('.sm-svg')?.children ?? [])].map(node => node.getAttribute('class'));
    expect(layers.indexOf('sm-furniture')).toBeLessThan(layers.indexOf('sm-vents'));
    expect(layers.indexOf('sm-structure')).toBeLessThan(layers.indexOf('sm-vents'));
    expect(layers.indexOf('sm-vents')).toBeLessThan(layers.indexOf('sm-markers'));
  });

  it('is not there on a plan that has none', async () => {
    await open(fakeConnection(docs()));
    expect(query('.sm-vents')).toBeNull();
  });

  it('shows its name, kind, valve, flow and place in a sheet when it is touched, and marks it selected until the sheet is closed', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: withVents() });
    await open(fake);
    tap(query('.sm-vent[data-id="family"] .sm-mk-hit circle') as Element, screenOf(6, 5));
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test supply');
    expect(rows()).toEqual([
      ['kind', 'supply'],
      ['valve', 'Test valve 160'],
      ['flow', '185 m³/h'],
      ['height', '2.5 m'],
    ]);
    expect(query('.sm-sheet')?.textContent).toContain('At x 6.00, y 5.00.');
    expect(vent('family').classList.contains('sel')).toBe(true);
    expect(vent('hood').classList.contains('sel')).toBe(false);
    act(() => byLabel('Close').click());
    expect(query('.sm-sheet')).toBeNull();
    expect(vent('family').classList.contains('sel')).toBe(false);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('leaves out the valve, the flow and the height that the plan does not give', async () => {
    await open(fakeConnection({ ...docs(), sensor_map: withVents() }));
    press(vent('hood'), 'Enter');
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test hood');
    expect(rows()).toEqual([['kind', 'exhaust']]);
  });

  it('gives a touch near a sensor to the sensor, which lies over it', async () => {
    const map = withVents();
    map.plan.vents = [{ ...FAMILY, pos: { x: 6.1, y: 1 } }];
    await open(fakeConnection({ ...docs(), sensor_map: map }));
    tap(query('.sm-vent[data-id="family"] .sm-mk-hit circle') as Element, screenOf(6.1, 1));
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Beta radar');
  });

  it('is suggested as a dashed ring in the colour of its kind, counted by the pill, and not yet part of the plan', async () => {
    await openSuggesting();
    expect(queryAll('.sm-ghost-vent')).toHaveLength(1);
    expect(query('.sm-ghost-vent')?.getAttribute('class')).toContain('kind-supply');
    expect(query('.sm-ghost-vent .sm-vent-glyph')?.getAttribute('d')).toBe(ventGlyph('supply'));
    expect(ring().getAttribute('aria-label')).toBe('Suggested vent Test supply');
    expect(ring().getAttribute('transform')).toBe(`translate(6 ${makeDoc().plan.bounds.y1 - 5})`);
    expect(query('.sm-pill')?.textContent).toBe('1 suggestion');
    expect(query('.sm-vents')).toBeNull();
  });

  it('opens a sheet with the reason, the facts and the hint to drag, and writes nothing until it is decided', async () => {
    const fake = await openSuggesting();
    press(ring(), 'Enter');
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test supply');
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested vent');
    expect(query('.sm-sheet')?.textContent).toContain('It blows there');
    expect(rows()).toEqual([
      ['kind', 'supply'],
      ['valve', 'Test valve 160'],
      ['flow', '185 m³/h'],
      ['height', '2.5 m'],
    ]);
    expect(query('.sm-sheet')?.textContent).toContain('At x 6.00, y 5.00.');
    expect(query('.sm-sheet')?.textContent).toContain('switch on Edit and drag the marker');
    expect(queryAll('.sm-sheet .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('joins the plan when accepted, as a write of the page that is logged, and the dashed ring gives way to the vent', async () => {
    const fake = await openSuggesting();
    press(ring(), 'Enter');
    act(() => chip('Accept').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(writes(fake).at(-1)?.key).toBe('sensor_map');
    expect(written.plan.vents).toEqual([FAMILY]);
    expect(written.layout_version).toBe(makeDoc().layout_version);
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-family', accepted_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(queryAll('.sm-vents .sm-vent')).toHaveLength(1);
    expect(query('.sm-pill')).toBeNull();
  });

  it('leaves the plan alone when discarded, and logs it', async () => {
    const fake = await openSuggesting();
    press(ring(), 'Enter');
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.plan.vents).toBeUndefined();
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-family', rejected_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(query('.sm-vents')).toBeNull();
  });

  it('is a card in the suggestions sheet that can be shown on the map, which selects the ring', async () => {
    await openSuggesting();
    act(() => (query('.sm-pill') as HTMLElement).click());
    const card = query('.sm-sheet .sm-suggest-card') as HTMLElement;
    expect(card.querySelector('.sm-tag')?.textContent).toBe('Vent');
    expect(card.textContent).toContain('Test supply');
    expect(card.textContent).toContain('It blows there');
    expect([...card.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    act(() => ([...card.querySelectorAll('button')].find(node => node.textContent === 'Show on map') as HTMLElement).click());
    await settle(100);
    expect(query('.sm-ghost.sel')).not.toBeNull();
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested vent');
  });

  it('gives a touch near a sensor to the sensor in View even when the vent is the one selected', async () => {
    const map = withVents();
    map.plan.vents = [{ ...FAMILY, pos: { x: 6.1, y: 1 } }];
    await open(fakeConnection({ ...docs(), sensor_map: map }));
    press(vent('family'), 'Enter');
    tap(query('.sm-vent[data-id="family"] .sm-mk-hit circle') as Element, screenOf(6.1, 1));
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Beta radar');
  });

  describe('dragging a vent', () => {
    const family = () => screenOf(6, 5);
    /** Presses on the vent at `from`, moves `dx` px to the right in two steps and stops just short of the release. */
    const drag = (from: { x: number; y: number }, dx = 40, target = '.sm-vent[data-id="family"] .sm-mk-hit circle') => {
      fire(query(target) as Element, 'pointerdown', from);
      fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx / 2, y: from.y });
      fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx, y: from.y });
      return () => fire(query('.sm-svg') as Element, 'pointerup', { x: from.x + dx, y: from.y });
    };
    const selectFamily = async (map = withVents()) => {
      const fake = fakeConnection({ ...docs(), sensor_map: map });
      await open(fake);
      press(vent('family'), 'Enter');
      mode('Edit');
      return fake;
    };
    const ventsOf = (fake: Fake) => (writes(fake).at(-1)?.value as MapDoc).plan.vents;
    const snapBox = () => query('.sm-sheet .sm-check input') as HTMLInputElement;
    /** A plan on which the supply vent has a wall within reach to its left. */
    const nearWall = () => {
      const map = withVents();
      map.plan.vents = [{ ...FAMILY, pos: { x: 4.5, y: 2, h: 2.5 } }, HOOD];
      return map;
    };

    it('moves by the distance dragged, and the write follows the release, keeping the rest of the vent and the layout version', async () => {
      const fake = await selectFamily();
      const before = vent('family').getAttribute('transform');
      const release = drag(family());
      expect(vent('family').getAttribute('transform')).not.toBe(before);
      expect(writes(fake)).toHaveLength(0);
      release();
      await settle();
      expect(writes(fake)).toHaveLength(1);
      expect(writes(fake)[0].key).toBe('sensor_map');
      const written = writes(fake)[0].value as MapDoc;
      expect(written.plan.vents?.[0]).toMatchObject({
        id: 'family',
        name: 'Test supply',
        kind: 'supply',
        valve: 'Test valve 160',
        flow_m3h: 185,
      });
      expect(written.plan.vents?.[0].pos.x).toBeCloseTo(6 + 40 / (canvas.w / 13), 1);
      expect(written.plan.vents?.[0].pos).toMatchObject({ y: 5, h: 2.5 });
      expect(written.plan.vents?.[1]).toEqual(HOOD);
      expect(written.layout_version).toBe(makeDoc().layout_version);
      expect(written.suggest_log).toEqual([]);
      expect(vent('family').getAttribute('transform')).not.toBe(before);
    });

    it('is dragged from where it sits once selected in Edit, even with a sensor over it, and the sensor stays', async () => {
      const map = withVents();
      map.plan.vents = [{ ...FAMILY, pos: { x: 7.2, y: 3, h: 2.5 } }, HOOD];
      const fake = await selectFamily(map);
      drag(screenOf(7.2, 3))();
      await settle();
      const written = writes(fake).at(-1)?.value as MapDoc;
      expect(written.plan.vents?.[0].pos.x).toBeCloseTo(7.2 + 40 / (canvas.w / 13), 1);
      expect(written.devices.scan_b.placement.pos).toEqual({ x: 7, y: 3, h: 1 });
    });

    it('gets the sheet out of the way while it is dragged, and brings it back at the release', async () => {
      await selectFamily();
      const release = drag(family());
      expect(query('.sm-sheet.collapsed')).not.toBeNull();
      release();
      await settle();
      expect(query('.sm-sheet.collapsed')).toBeNull();
      expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test supply');
    });

    it('does not write when it is dropped where it was', async () => {
      const fake = await selectFamily();
      const from = family();
      fire(query('.sm-vent[data-id="family"] .sm-mk-hit circle') as Element, 'pointerdown', from);
      fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + 30, y: from.y });
      fire(query('.sm-svg') as Element, 'pointermove', from);
      fire(query('.sm-svg') as Element, 'pointerup', from);
      await settle();
      expect(writes(fake)).toHaveLength(0);
    });

    it('snaps to the face of a wall within reach, as a sensor does', async () => {
      const fake = await selectFamily(nearWall());
      drag(screenOf(4.5, 2), -40)();
      await settle();
      expect(ventsOf(fake)?.[0].pos).toEqual({ x: 3.95, y: 2, h: 2.5 });
    });

    it('goes where it is dropped when Snap to walls is off, which only Edit offers', async () => {
      const fake = fakeConnection({ ...docs(), sensor_map: nearWall() });
      await open(fake);
      press(vent('family'), 'Enter');
      expect(snapBox()).toBeNull();
      mode('Edit');
      expect(snapBox().checked).toBe(true);
      act(() => snapBox().click());
      expect(snapBox().checked).toBe(false);
      drag(screenOf(4.5, 2), -40)();
      await settle();
      expect(ventsOf(fake)?.[0].pos.x).toBeCloseTo(4.5 - 40 / (canvas.w / 13), 1);
      expect(ventsOf(fake)?.[0].pos.x).not.toBe(3.95);
    });

    it.each([
      ['switching to View', () => mode('View')],
      ['Escape', () => press(query('.sm-main') as Element, 'Escape')],
      ['closing the sheet', () => act(() => byLabel('Close').click())],
    ])('moves nothing when %s comes before the release, and the vent is back where it was at once', async (_name, interrupt) => {
      const fake = await selectFamily();
      const before = vent('family').getAttribute('transform');
      const release = drag(family());
      interrupt();
      expect(vent('family').getAttribute('transform')).toBe(before);
      release();
      await settle();
      expect(writes(fake)).toHaveLength(0);
    });

    it('is only dragged once it is selected: a press on another vent pans the plan', async () => {
      const fake = await selectFamily();
      const before = viewBox();
      drag(screenOf(2, 5), 40, '.sm-vent[data-id="hood"] .sm-mk-hit circle')();
      await settle();
      expect(viewBox()).not.toBe(before);
      expect(writes(fake)).toHaveLength(0);
    });

    it('is only dragged in Edit: in View the drag pans the plan and writes nothing', async () => {
      const fake = fakeConnection({ ...docs(), sensor_map: withVents() });
      await open(fake);
      press(vent('family'), 'Enter');
      const before = viewBox();
      drag(family())();
      await settle();
      expect(viewBox()).not.toBe(before);
      expect(writes(fake)).toHaveLength(0);
    });

    it('is not written over a map that was changed elsewhere: the page keeps the edit as a draft and says so', async () => {
      const fake = await selectFamily();
      fake.data.sensor_map = { ...(fake.data.sensor_map as MapDoc), write_id: 'theirs', writer: 'other-page' };
      drag(family())();
      await settle();
      expect(query('.sm-workspace')).toBeNull();
      expect(query('.sm-status')?.textContent).toContain('Changed elsewhere');
      expect(writes(fake)).toHaveLength(0);
      expect(draft()?.doc.plan.vents[0].pos.x).toBeCloseTo(6 + 40 / (canvas.w / 13), 1);
    });
  });

  describe('dragging a suggested vent', () => {
    /** Presses on the suggested ring, moves it `dx` px to the right in two steps, and lifts when asked to. */
    const dragRing = (dx: number, from = screenOf(6, 5), release = true) => {
      fire(query('.sm-ghost-vent .sm-mk-hit circle') as Element, 'pointerdown', from);
      fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx / 2, y: from.y });
      fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx, y: from.y });
      if (release) fire(query('.sm-svg') as Element, 'pointerup', { x: from.x + dx, y: from.y });
    };
    const openEditing = async (suggest = suggestingVent()) => {
      const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggest });
      await open(fake);
      mode('Edit');
      return fake;
    };

    it('accepts the vent where it is dropped in Edit, as one write that keeps its facts and the layout version', async () => {
      const fake = await openEditing();
      dragRing(40);
      await settle();
      expect(writes(fake)).toHaveLength(1);
      expect(writes(fake)[0].key).toBe('sensor_map');
      const written = writes(fake)[0].value as MapDoc;
      expect(written.plan.vents).toHaveLength(1);
      expect(written.plan.vents?.[0]).toMatchObject({
        id: 'family',
        name: 'Test supply',
        kind: 'supply',
        valve: 'Test valve 160',
        flow_m3h: 185,
      });
      expect(written.plan.vents?.[0].pos.x).toBeCloseTo(6 + 40 / (canvas.w / 13), 1);
      expect(written.plan.vents?.[0].pos).toMatchObject({ y: 5, h: 2.5 });
      expect(written.layout_version).toBe(makeDoc().layout_version);
      expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-family', accepted_at: expect.any(String) })]);
      expect(queryAll('.sm-ghost')).toHaveLength(0);
      expect(queryAll('.sm-vents .sm-vent')).toHaveLength(1);
    });

    it('shows the ring following the pointer while it is dragged, and writes nothing before the drop', async () => {
      const fake = await openEditing();
      const before = query('.sm-ghost-vent [data-hit="ghost"]')?.getAttribute('transform');
      dragRing(40, screenOf(6, 5), false);
      expect(query('.sm-ghost-vent [data-hit="ghost"]')?.getAttribute('transform')).not.toBe(before);
      await settle(1500);
      expect(writes(fake)).toHaveLength(0);
      fire(query('.sm-svg') as Element, 'pointerup', { x: screenOf(6, 5).x + 40, y: screenOf(6, 5).y });
      await settle();
      expect(writes(fake)).toHaveLength(1);
    });

    it('selects the vent it became, whose sheet shows the place it was dropped at', async () => {
      await openEditing();
      dragRing(40);
      await settle();
      expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Test supply');
      expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('vent');
      expect(query('.sm-sheet')?.textContent).toMatch(/At x 6\.6\d, y 5\.00\./);
      expect(vent('family').classList.contains('sel')).toBe(true);
    });

    it('snaps to the face of a wall within reach where it is dropped', async () => {
      const suggest = suggestingVent();
      suggest.items = [{ id: 's-family', kind: 'vent', vent: { ...FAMILY, pos: { x: 4.5, y: 2, h: 2.5 } }, reason: 'It blows there' }];
      const fake = await openEditing(suggest);
      dragRing(-40, screenOf(4.5, 2));
      await settle();
      expect((writes(fake)[0].value as MapDoc).plan.vents?.[0].pos).toEqual({ x: 3.95, y: 2, h: 2.5 });
    });

    it('keeps a suggested vent without a height without one', async () => {
      const suggest = suggestingVent();
      suggest.items = [{ id: 's-hood', kind: 'vent', vent: { ...HOOD, pos: { x: 6, y: 5 } }, reason: 'It sucks there' }];
      const fake = await openEditing(suggest);
      dragRing(40);
      await settle();
      expect(Object.keys((writes(fake)[0].value as MapDoc).plan.vents?.[0].pos ?? {})).toEqual(['x', 'y']);
    });

    it('is only possible in Edit: without it the drag pans the plan and accepts nothing', async () => {
      const fake = await openSuggesting();
      const before = viewBox();
      dragRing(40);
      await settle();
      expect(viewBox()).not.toBe(before);
      expect(writes(fake)).toHaveLength(0);
      expect(queryAll('.sm-ghost-vent')).toHaveLength(1);
    });

    it('still opens the suggestion when tapped in Edit, and a press that does not move accepts nothing', async () => {
      const fake = await openEditing();
      const at = screenOf(6, 5);
      fire(query('.sm-ghost-vent .sm-mk-hit circle') as Element, 'pointerdown', at);
      fire(query('.sm-svg') as Element, 'pointerup', at);
      expect(query('.sm-sheet')?.textContent).toContain('suggested vent');
      expect(query('.sm-sheet')?.textContent).toContain('Drag the marker to where it belongs');
      await settle(1500);
      expect(writes(fake)).toHaveLength(0);
    });

    it('can be reached from a sheet that is open, which gets out of the way for the drag', async () => {
      const fake = await openEditing();
      press(ring(), 'Enter');
      expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested vent');
      dragRing(40);
      await settle();
      expect(writes(fake)).toHaveLength(1);
      expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('vent');
    });
  });
});

describe('a suggested zone change', () => {
  const CHANGE: ZoneChange = {
    zones: [{ zone_id: 'delta', poly: rect(0, 4, 8, 8) }],
    remove_zone_lines: [4],
    annotations: { a1: ['Delta', 'x 0 to 8'] },
    device_zones: { door_1: 'beta' },
  };
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const suggesting = (change: ZoneChange = CHANGE): SuggestDoc => {
    const suggest = makeSuggestDoc();
    suggest.items = [{ id: 's-zones', kind: 'zone_change', change, reason: 'It runs on there' }];
    return suggest;
  };
  const openSuggesting = async (change?: ZoneChange) => {
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggesting(change) });
    await open(fake);
    return fake;
  };
  const outline = () => query('.sm-ghost-zones [data-hit="ghost"]') as Element;
  const zonePath = (id: string) => query(`.sm-zone[data-id="${id}"] .sm-zone-fill`)?.getAttribute('d');
  const OLD_DELTA = 'M0 5L4 5L4 1L0 1Z';
  const NEW_DELTA = 'M0 5L8 5L8 1L0 1Z';
  const LINES = [
    'Delta: new outline',
    'Zone line at x 4 dropped',
    'Label "Delta" becomes "Delta x 0 to 8"',
    'Test door contact goes to Beta',
  ];

  it('is suggested as the dashed outline of the zone it redraws, counted by the pill, and not yet part of the plan', async () => {
    await openSuggesting();
    expect(queryAll('.sm-ghost-zones')).toHaveLength(1);
    expect(queryAll('.sm-ghost-zones .sm-ghost-rect').map(node => node.getAttribute('d'))).toEqual([NEW_DELTA]);
    expect(outline().getAttribute('aria-label')).toBe('Suggested zone change Delta');
    expect(query('.sm-pill')?.textContent).toBe('1 suggestion');
    expect(zonePath('delta')).toBe(OLD_DELTA);
    expect(queryAll('.sm-zoneline')).toHaveLength(1);
  });

  it('opens a sheet with the reason and what it does, and writes nothing until it is decided', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Delta');
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested zone change');
    expect(query('.sm-sheet')?.textContent).toContain('It runs on there');
    expect(queryAll('.sm-sheet .sm-list li').map(node => node.textContent)).toEqual(LINES);
    expect(query('.sm-sheet')?.textContent).not.toContain('At x');
    expect(query('.sm-sheet')?.textContent).not.toContain('Drag the marker');
    expect(queryAll('.sm-sheet .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('is applied when accepted, as one write of the page that is logged, and the outline takes the place of the zone', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    act(() => chip('Accept').click());
    await settle(1100);
    expect(writes(fake)).toHaveLength(1);
    const written = writes(fake)[0].value as MapDoc;
    expect(writes(fake)[0].key).toBe('sensor_map');
    expect(written.plan.zones.find(zone => zone.zone_id === 'delta')?.poly).toEqual(rect(0, 4, 8, 8));
    expect(written.plan.zone_lines).toEqual([]);
    expect(written.plan.annotations[0].lines).toEqual(['Delta', 'x 0 to 8']);
    expect(written.devices.door_1.zone_id).toBe('beta');
    expect(written.layout_version).toBe(makeDoc().layout_version);
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-zones', accepted_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(zonePath('delta')).toBe(NEW_DELTA);
    expect(queryAll('.sm-zoneline')).toHaveLength(0);
    expect(queryAll('.sm-labels .sm-room').some(node => node.textContent?.includes('x 0 to 8'))).toBe(true);
    expect(query('.sm-pill')).toBeNull();
  });

  it('leaves the plan alone when discarded, and logs it', async () => {
    const fake = await openSuggesting();
    press(outline(), 'Enter');
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.plan.zones).toEqual(makeDoc().plan.zones);
    expect(written.plan.zone_lines).toEqual(makeDoc().plan.zone_lines);
    expect(written.devices.door_1.zone_id).toBe('alpha');
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-zones', rejected_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(zonePath('delta')).toBe(OLD_DELTA);
  });

  it('is a card in the suggestions sheet that can be shown on the map, which selects the outline', async () => {
    await openSuggesting();
    act(() => (query('.sm-pill') as HTMLElement).click());
    const card = query('.sm-sheet .sm-suggest-card') as HTMLElement;
    expect(card.querySelector('.sm-tag')?.textContent).toBe('Zones');
    expect(card.textContent).toContain('Delta');
    expect(card.textContent).toContain('It runs on there');
    expect(card.textContent).toContain(`${LINES.join('; ')}.`);
    expect([...card.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    act(() => ([...card.querySelectorAll('button')].find(node => node.textContent === 'Show on map') as HTMLElement).click());
    await settle(100);
    expect(query('.sm-ghost.sel')).not.toBeNull();
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested zone change');
  });

  it('is not dragged in Edit: a drag on the outline pans the plan and accepts nothing', async () => {
    const fake = await openSuggesting();
    mode('Edit');
    const from = screenOf(4, 6);
    const fire = (target: Element, name: string, at: { x: number; y: number }) =>
      act(
        () =>
          void target.dispatchEvent(
            new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at.x, clientY: at.y })
          )
      );
    const before = query('.sm-svg')?.getAttribute('viewBox');
    fire(query('.sm-ghost-zones .sm-ghost-edge') as Element, 'pointerdown', from);
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + 20, y: from.y });
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + 40, y: from.y });
    fire(query('.sm-svg') as Element, 'pointerup', { x: from.x + 40, y: from.y });
    await settle();
    expect(query('.sm-svg')?.getAttribute('viewBox')).not.toBe(before);
    expect(writes(fake)).toHaveLength(0);
    expect(queryAll('.sm-ghost-zones')).toHaveLength(1);
  });

  it('has no outline to draw when it only moves devices: a card without Show on map, accepted from the list', async () => {
    const fake = await openSuggesting({ device_zones: { door_1: 'beta' } });
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(query('.sm-pill')?.textContent).toBe('1 suggestion');
    act(() => (query('.sm-pill') as HTMLElement).click());
    const card = query('.sm-sheet .sm-suggest-card') as HTMLElement;
    expect(card.querySelector('.sm-tag')?.textContent).toBe('Zones');
    expect(card.textContent).toContain('Zone change');
    expect([...card.querySelectorAll('button')].map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    act(() => chip('Accept').click());
    await settle(1100);
    expect((writes(fake).at(-1)?.value as MapDoc).devices.door_1.zone_id).toBe('beta');
  });

  it('is refused as a whole when a part cannot be applied: Accept writes nothing and the suggestion stays', async () => {
    const fake = await openSuggesting({ ...CHANGE, device_zones: { door_1: 'nowhere' } });
    press(outline(), 'Enter');
    act(() => chip('Accept').click());
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    expect(zonePath('delta')).toBe(OLD_DELTA);
    expect(queryAll('.sm-ghost-zones')).toHaveLength(1);
    expect(query('.sm-pill')?.textContent).toBe('1 suggestion');
  });
});

describe('tapping the plan during a survey', () => {
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const fire = (target: Element, name: string, at: { x: number; y: number }) =>
    act(
      () =>
        void target.dispatchEvent(
          new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at.x, clientY: at.y })
        )
    );
  const tap = (on: Element, at: { x: number; y: number }) => {
    fire(on, 'pointerdown', at);
    fire(query('.sm-svg') as Element, 'pointerup', at);
  };

  it('opens the point that was touched, whatever is drawn beneath it', async () => {
    await open(fakeConnection(docs()));
    mode('Survey');
    const first = point(0);
    tap(query(`.sm-sv[data-id="${first.id}"] .sm-mk-hit circle`) as Element, screenOf(first.at[0], first.at[1]));
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${first.n}: ${first.label}`);
  });

  it('opens the nearer of two points whose touch areas overlap, not the one drawn on top', async () => {
    const points = surveyPoints(makeDoc().plan);
    let pair: [(typeof points)[number], (typeof points)[number]] = [points[0], points[1]];
    for (const a of points) {
      for (const b of points) {
        const near = (p: [typeof a, typeof b]) => Math.hypot(p[0].at[0] - p[1].at[0], p[0].at[1] - p[1].at[1]);
        if (a !== b && near([a, b]) < near(pair)) pair = [a, b];
      }
    }
    const [under, over] = pair;
    const metres = Math.hypot(under.at[0] - over.at[0], under.at[1] - over.at[1]);
    // Scale the plan so that the two centres are 12 px apart: well inside the 22 px reach of both.
    Object.assign(canvas, { w: (12 / metres) * 13, h: 600 });
    await open(fakeConnection(docs()));
    mode('Survey');
    const drawnLater = points.indexOf(over) > points.indexOf(under) ? over : under;
    const drawnEarlier = drawnLater === over ? under : over;
    tap(query(`.sm-sv[data-id="${drawnLater.id}"] .sm-mk-hit circle`) as Element, screenOf(drawnEarlier.at[0], drawnEarlier.at[1]));
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${drawnEarlier.n}: ${drawnEarlier.label}`);
  });

  it('switches to another point when one is touched while a sheet is open', async () => {
    await open(fakeConnection(docs()));
    mode('Survey');
    const [first, second] = [point(0), point(1)];
    press(target(first.id), 'Enter');
    tap(query(`.sm-sv[data-id="${second.id}"] .sm-mk-hit circle`) as Element, screenOf(second.at[0], second.at[1]));
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${second.n}: ${second.label}`);
    expect(target(first.id).classList.contains('sel')).toBe(false);
    expect(target(second.id).classList.contains('sel')).toBe(true);
  });

  it('moves the spot of the open point to where the plan is tapped, and the capture is still for that point', async () => {
    const fake = fakeConnection({ ...docs(), sensor_map: wifiMap() });
    await open(fake);
    seedWifi();
    mode('Survey');
    const first = point(0);
    press(target(first.id), 'Enter');
    const spot = screenOf(7.5, 6);
    tap(query('.sm-svg') as Element, spot);
    expect(Number(field('x').value)).toBeCloseTo(7.5, 1);
    expect(Number(field('y').value)).toBeCloseTo(6, 1);
    expect(query('.sm-sheet')?.textContent).toContain(`Point ${first.n}`);
    act(() => chip('Save and start').click());
    await advance(1000);
    reportSignal('-63');
    await advance(14_000);
    const [item] = savedPrints(fake).items;
    expect(item.survey_id).toBe(first.id);
    expect(item.pos.x).toBeCloseTo(7.5, 1);
    expect(target(first.id).classList.contains('done')).toBe(true);
  });
});

describe('throwing a suggestion away', () => {
  const ghostSheet = async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    press(query('.sm-ghost [data-hit="ghost"]') as Element, 'Enter');
    return fake;
  };

  it('is a button named Discard suggestion beside Accept, and nothing says Reject any more', async () => {
    await ghostSheet();
    expect(queryAll('.sm-sheet .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    expect(query('.sm-sheet')?.textContent).not.toContain('Reject');
  });

  it('asks first, and the confirming tap does nothing until a moment after it appears', async () => {
    const fake = await ghostSheet();
    act(() => chip('Discard suggestion').click());
    expect(query('.sm-sheet')?.textContent).toContain('Discard this suggestion?');
    const yes = chip('Yes, discard') as HTMLButtonElement;
    expect(yes.disabled).toBe(true);
    act(() => yes.click());
    await settle(300);
    expect((chip('Yes, discard') as HTMLButtonElement).disabled).toBe(true);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    expect((chip('Yes, discard') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is called off by Keep it, which writes nothing and brings the first button back', async () => {
    const fake = await ghostSheet();
    act(() => chip('Discard suggestion').click());
    await advance(700);
    act(() => chip('Keep it').click());
    expect(chip('Discard suggestion')).toBeDefined();
    expect(chip('Yes, discard')).toBeUndefined();
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    expect(queryAll('.sm-ghost')).toHaveLength(1);
  });

  it('logs the suggestion as rejected once confirmed, and the marker goes', async () => {
    const fake = await ghostSheet();
    await discard();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-1', rejected_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    expect(written.devices.door_1.placement.pos).toEqual({ x: 4, y: 3, h: 1 });
  });

  it('is the same on a device sheet and on a proposed answer', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    press(marker('Test door contact'), 'Enter');
    expect(queryAll('.sm-sheet .sm-suggest .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    act(() => byLabel('Close').click());
    openQuestions();
    expect(queryAll('.sm-qa .sm-suggest .sm-chip').map(node => node.textContent)).toEqual(['Accept', 'Discard suggestion']);
    await discard();
    await settle(1100);
    expect((writes(fake).at(-1)?.value as MapDoc).suggest_log).toEqual([
      expect.objectContaining({ id: 's-2', rejected_at: expect.any(String) }),
    ]);
  });
});

describe('dragging a suggested marker', () => {
  const screenOf = (x: number, y: number) => planToScreen(fitView(canvas, makeDoc().plan.fit), canvas, x, y);
  const fire = (target: Element, name: string, at: { x: number; y: number }) =>
    act(
      () =>
        void target.dispatchEvent(
          new PointerEvent(name, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: at.x, clientY: at.y })
        )
    );
  /** Presses on the suggested marker, moves it `dx` px to the right in two steps, and lifts. */
  const dragGhost = (dx: number, from = screenOf(4, 2.5), release = true) => {
    fire(query('.sm-ghost .sm-mk-hit circle') as Element, 'pointerdown', from);
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx / 2, y: from.y });
    fire(query('.sm-svg') as Element, 'pointermove', { x: from.x + dx, y: from.y });
    if (release) fire(query('.sm-svg') as Element, 'pointerup', { x: from.x + dx, y: from.y });
  };
  const viewBox = () => query('.sm-svg')?.getAttribute('viewBox');
  const undo = () => act(() => (queryAll('.sm-sheet .sm-chip').find(node => node.textContent?.includes('Undo')) as HTMLElement).click());

  it('accepts a suggested placement where it is dropped in Edit, at room certainty, as one write', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    dragGhost(40);
    await settle();
    expect(writes(fake)).toHaveLength(1);
    const written = writes(fake)[0].value as MapDoc;
    expect(written.devices.door_1.placement).toMatchObject({ cert: 'room', confirmed_at: null });
    expect(written.devices.door_1.placement.pos?.x).toBeCloseTo(4 + 40 / (canvas.w / 13), 1);
    expect(written.devices.door_1.placement.pos).toMatchObject({ y: 2.5, h: 1.9 });
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-1', accepted_at: expect.any(String) })]);
    expect(queryAll('.sm-ghost')).toHaveLength(0);
  });

  it('shows the marker following the pointer while it is dragged, and writes nothing before the drop', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    const before = query('.sm-ghost [data-hit="ghost"]')?.getAttribute('transform');
    dragGhost(40, screenOf(4, 2.5), false);
    expect(query('.sm-ghost [data-hit="ghost"]')?.getAttribute('transform')).not.toBe(before);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    fire(query('.sm-svg') as Element, 'pointerup', { x: screenOf(4, 2.5).x + 40, y: screenOf(4, 2.5).y });
    await settle();
    expect(writes(fake)).toHaveLength(1);
  });

  it('selects the device it became, so Undo is there at once, and Undo puts it back as it was', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    dragGhost(40);
    await settle();
    expect(query('.sm-sheet')?.textContent).toContain('Test door contact');
    undo();
    await settle();
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.devices.door_1.placement).toEqual(makeDoc().devices.door_1.placement);
    expect(written.devices.door_1.history).toEqual([]);
  });

  it('adds a suggested new device where it is dropped, and Undo returns it to the tray', async () => {
    const suggest = makeSuggestDoc();
    const { history: _history, ...rest } = device('New thing', {
      type: 'contact',
      ha: { device_ids: ['dev-new'], bindings: {}, scanner_source: null },
      placement: placement({ pos: { x: 4, y: 2.5, h: 1.2 }, cert: 'guess' }),
    });
    void _history;
    suggest.items = [{ id: 's-new', kind: 'new_device', device: rest, reason: 'new in the registry' }];
    const fake = fakeConnection({ ...docs(), sensor_map_suggest: suggest });
    await open(fake);
    mode('Edit');
    dragGhost(40);
    await settle();
    const written = writes(fake)[0].value as MapDoc;
    expect(written.devices['dev-new'].placement).toMatchObject({ cert: 'room', confirmed_at: null, pos: { y: 2.5, h: 1.2 } });
    expect(written.devices['dev-new'].placement.pos?.x).toBeCloseTo(4 + 40 / (canvas.w / 13), 1);
    expect(query('.sm-sheet')?.textContent).toContain('New thing');
    undo();
    await settle();
    expect((writes(fake).at(-1)?.value as MapDoc).devices['dev-new'].placement.pos).toBeNull();
  });

  it('is only possible in Edit: without it the drag pans the plan and accepts nothing', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    const before = viewBox();
    dragGhost(40);
    await settle();
    expect(viewBox()).not.toBe(before);
    expect(writes(fake)).toHaveLength(0);
    expect(queryAll('.sm-ghost')).toHaveLength(1);
  });

  it('still opens the suggestion when tapped in Edit, and a press that does not move accepts nothing', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    const at = screenOf(4, 2.5);
    fire(query('.sm-ghost .sm-mk-hit circle') as Element, 'pointerdown', at);
    fire(query('.sm-svg') as Element, 'pointerup', at);
    expect(query('.sm-sheet')?.textContent).toContain('suggested placement');
    expect(query('.sm-sheet')?.textContent).toContain('Drag the marker to where it belongs');
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('can be reached from a sheet that is open, which gets out of the way for the drag', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    press(query('.sm-ghost [data-hit="ghost"]') as Element, 'Enter');
    expect(query('.sm-sheet')?.textContent).toContain('suggested placement');
    dragGhost(40);
    await settle();
    expect(writes(fake)).toHaveLength(1);
    expect(query('.sm-sheet')?.textContent).not.toContain('suggested placement');
  });
});

describe('the text of a sheet', () => {
  it('is not inside a button, so it can be selected, and a tap on the title still folds the sheet', async () => {
    await open(fakeConnection(docs()));
    press(marker('Test door contact'), 'Enter');
    const title = query('.sm-sheet-title') as Element;
    expect(title.textContent).toContain('Test door contact');
    expect(title.closest('button')).toBeNull();
    expect(query('.sm-sheet.collapsed')).toBeNull();
    act(() => (query('.sm-sheet-handle') as HTMLElement).click());
    expect(query('.sm-sheet.collapsed')).not.toBeNull();
    act(() => (query('.sm-sheet-handle') as HTMLElement).click());
    expect(query('.sm-sheet.collapsed')).toBeNull();
  });

  it('is not folded away by the click that ends a selection of it', async () => {
    await open(fakeConnection(docs()));
    press(marker('Test door contact'), 'Enter');
    const selecting = vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'Test door' } as unknown as Selection);
    act(() => (query('.sm-sheet-handle') as HTMLElement).click());
    expect(query('.sm-sheet.collapsed')).toBeNull();
    selecting.mockRestore();
  });

  it('is folded and unfolded by the chevron too, which says which state it is in', async () => {
    await open(fakeConnection(docs()));
    press(marker('Test door contact'), 'Enter');
    expect(byLabel('Collapse').getAttribute('aria-expanded')).toBe('true');
    act(() => byLabel('Collapse').click());
    expect(byLabel('Expand').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the top bar', () => {
  it('is one header row of back, title, save state and Layers, with the modes under it and no chip row to scroll', async () => {
    await open(fakeConnection(docs()));
    const row = query('.sm-header-row') as Element;
    expect([...row.children].map(node => node.getAttribute('aria-label') ?? node.className.split(' ')[0])).toEqual([
      'Close the map',
      'sm-title',
      'sm-save',
      'sm-pill',
      'Layers',
    ]);
    expect(query('.sm-header .sm-mode-row .sm-mode')).not.toBeNull();
    expect(query('.sm-layers')).toBeNull();
    expect(queryAll('.sm-header [aria-pressed]').map(node => node.textContent)).toEqual(['View', 'Edit', 'Survey']);
    expect(byLabel('Edit')).toBeNull();
    expect(byLabel('Stop editing')).toBeNull();
  });

  it('opens Questions from an icon with the number still open, and a Layers badge only once a type is hidden', async () => {
    await open(fakeConnection(docs()));
    const questions = query('[aria-label^="Questions"]') as HTMLElement;
    expect([questions.getAttribute('aria-label'), questions.querySelector('.sm-badge')?.textContent]).toEqual(['Questions, 1 open', '1']);
    expect(query('[aria-label^="Layers"] .sm-badge')).toBeNull();
    act(() => questions.click());
    expect(query('.sm-sheet')?.textContent).toContain('Which side is alpha?');
  });
});

describe('the modes', () => {
  const pressed = () => queryAll('.sm-mode-btn').map(node => `${node.textContent}:${node.getAttribute('aria-pressed')}`);
  const editing = () => query('.sm-main')?.getAttribute('data-edit');

  it('start in View, and Edit and Survey are exclusive: each turns the other off', async () => {
    await open(fakeConnection(docs()));
    expect([pressed(), editing(), query('.sm-subbar')]).toEqual([['View:true', 'Edit:false', 'Survey:false'], 'false', null]);
    mode('Edit');
    expect([pressed(), editing()]).toEqual([['View:false', 'Edit:true', 'Survey:false'], 'true']);
    mode('Survey');
    expect([pressed(), editing()]).toEqual([['View:false', 'Edit:false', 'Survey:true'], 'false']);
    expect(query('.sm-subbar')).not.toBeNull();
    mode('Edit');
    expect([pressed(), editing(), query('.sm-subbar')]).toEqual([['View:false', 'Edit:true', 'Survey:false'], 'true', null]);
    mode('View');
    expect([pressed(), editing()]).toEqual([['View:true', 'Edit:false', 'Survey:false'], 'false']);
  });

  it('change nothing when the mode that is on is tapped again', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Edit');
    mode('Edit');
    expect([pressed(), editing()]).toEqual([['View:false', 'Edit:true', 'Survey:false'], 'true']);
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('write what is pending when Edit is left, as the pencil did', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    editDoor('3.5');
    expect(writes(fake)).toHaveLength(0);
    mode('View');
    await flush();
    expect(writes(fake)).toHaveLength(1);
    expect((writes(fake)[0].value as MapDoc).devices.door_1.placement.pos?.x).toBe(3.5);
  });

  it('keep Survey for the next visit, as the survey layer was kept', async () => {
    const fake = fakeConnection(docs());
    await open(fake);
    mode('Survey');
    await settle(500);
    await act(async () => root.render(createElement('div')));
    await flush();
    await open(fake);
    expect([pressed(), editing()]).toEqual([['View:false', 'Edit:false', 'Survey:true'], 'false']);
    expect(query('.sm-subbar')).not.toBeNull();
  });
});

describe('the Layers sheet', () => {
  const rows = () => queryAll('.sm-sheet .sm-lay-row').map(node => node.querySelector('.sm-lay-label')?.textContent);
  const badge = () => query('[aria-label^="Layers"] .sm-badge')?.textContent ?? null;
  const markers = () => queryAll('.sm-mk').length;

  it('lists every device type with its icon and count, then the display layers as switches', async () => {
    await open(fakeConnection(docs()));
    openLayers();
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Layers');
    expect(queryAll('.sm-sheet [role="checkbox"] .sm-lay-label').map(node => node.textContent)).toEqual([
      'BLE scanner',
      'Presence radar',
      'Contact',
      'Plug',
      'Bed sensor',
      'Thermostat / temperature',
      'Speaker',
      'Wi-Fi AP',
      'Other',
    ]);
    expect(layerRow('BLE scanner').querySelector('.sm-count')?.textContent).toBe('3');
    expect(layerRow('BLE scanner').querySelector('svg path')).not.toBeNull();
    expect(queryAll('.sm-sheet [role="switch"] .sm-lay-label').map(node => node.textContent)).toEqual([
      'Names',
      'Grid',
      'Footprints',
      'Phones',
      'Fingerprints',
      'Coverage',
      'Suggestions',
      'Light theme',
    ]);
    expect(layerRow('Suggestions').querySelector('.sm-count')?.textContent).toBe('2');
    expect(rows()).not.toContain('Survey');
  });

  it('is opened and closed by the Layers button', async () => {
    await open(fakeConnection(docs()));
    expect(byLabel('Layers').getAttribute('aria-expanded')).toBe('false');
    openLayers();
    expect(byLabel('Layers').getAttribute('aria-expanded')).toBe('true');
    openLayers();
    expect(query('.sm-sheet')).toBeNull();
  });

  it('hides a type with its row and badges the button with how many types are hidden', async () => {
    await open(fakeConnection(docs()));
    const before = markers();
    openLayers();
    expect(layerRow('Contact').getAttribute('aria-checked')).toBe('true');
    act(() => layerRow('Contact').click());
    expect(layerRow('Contact').getAttribute('aria-checked')).toBe('false');
    expect(markers()).toBe(before - 1);
    expect([badge(), byLabel('Layers, 1 hidden') !== null, query('.sm-sheet .sm-sheet-sub')?.textContent]).toEqual(['1', true, '1 hidden']);
    act(() => layerRow('Contact').click());
    expect([markers(), badge()]).toEqual([before, null]);
  });

  it('hides every type with None and shows every type again with All', async () => {
    await open(fakeConnection(docs()));
    const before = markers();
    openLayers();
    choose('None');
    expect([markers(), badge()]).toEqual([0, '9']);
    expect(queryAll('.sm-sheet [role="checkbox"]').every(node => node.getAttribute('aria-checked') === 'false')).toBe(true);
    choose('All');
    expect([markers(), badge()]).toEqual([before, null]);
  });

  it('keeps a device that has a role which is still shown, as the chips did', async () => {
    await open(fakeConnection(docs()));
    const before = markers();
    openLayers();
    act(() => layerRow('BLE scanner').click());
    expect(markers()).toBe(before - 2);
    expect(query('.sm-mk[data-id="scan_b"]')).not.toBeNull();
    act(() => layerRow('Plug').click());
    expect(markers()).toBe(before - 3);
  });

  it('is remembered in this browser, with the display layers', async () => {
    await open(fakeConnection(docs()));
    openLayers();
    act(() => layerRow('Contact').click());
    act(() => layerRow('Names').click());
    await settle(500);
    expect(JSON.parse(window.localStorage.getItem('sensormap-ui-v1') ?? 'null').layers).toMatchObject({
      hiddenTypes: ['contact'],
      names: true,
    });
  });

  it('turns each display layer on and off', async () => {
    await open(fakeConnection(docs()));
    openLayers();
    const checked = (label: string) => layerRow(label).getAttribute('aria-checked');
    expect([checked('Suggestions'), queryAll('.sm-ghost').length]).toEqual(['true', 1]);
    act(() => layerRow('Suggestions').click());
    expect([checked('Suggestions'), queryAll('.sm-ghost').length]).toEqual(['false', 0]);
    expect([checked('Grid'), query('.sm-grid') !== null]).toEqual(['true', true]);
    act(() => layerRow('Grid').click());
    expect([checked('Grid'), query('.sm-grid') !== null]).toEqual(['false', false]);
    expect([checked('Light theme'), query('.sm-workspace')?.getAttribute('data-theme')]).toEqual(['false', 'dark']);
    act(() => layerRow('Light theme').click());
    expect([checked('Light theme'), query('.sm-workspace')?.getAttribute('data-theme')]).toEqual(['true', 'light']);
    expect([checked('Coverage'), query('.sm-subbar')]).toEqual(['false', null]);
    act(() => layerRow('Coverage').click());
    expect([checked('Coverage'), query('.sm-subbar') !== null]).toEqual(['true', true]);
  });
});

/** A suggestion document with one suggestion of each kind, in no particular order. */
function suggestionsOfEveryKind(): SuggestDoc {
  const suggest = makeSuggestDoc();
  const [placementItem, answerItem] = suggest.items;
  const { history: _history, ...fresh } = device('New thing', {
    type: 'contact',
    ha: { device_ids: ['dev-new'], bindings: {}, scanner_source: null },
    placement: placement({ pos: { x: 9, y: 2.5, h: 1.2 }, cert: 'guess' }),
  });
  void _history;
  suggest.items = [
    answerItem,
    { id: 's-wifi', kind: 'wifi', source: WIFI_SOURCE, aps: { [BSSID_A]: 'door_1' }, reason: 'Derived from the controller' },
    { id: 's-rename', kind: 'rename', device_key: 'door_1', name: 'Front door contact', reason: 'It is the front door' },
    placementItem,
    {
      id: 's-phone',
      kind: 'phone',
      phone: { name: 'Test owner', bermuda_address: 'a1b2c3d4e5f60718293a4b5c6d7e8f90_1_2', person: 'person.test_owner' },
      reason: 'Bermuda tracks the phone now',
    },
    { id: 's-new', kind: 'new_device', device: fresh, reason: 'New in the registry' },
  ];
  return suggest;
}

describe('the suggestions pill', () => {
  const pill = () => query('.sm-pill') as HTMLElement | null;

  it('is not there while nothing waits', async () => {
    const suggest = makeSuggestDoc();
    suggest.items = [];
    await open(fakeConnection({ ...docs(), sensor_map_suggest: suggest }));
    expect(pill()).toBeNull();
  });

  it('says how many suggestions wait, in the header row right after the save state', async () => {
    await open(fakeConnection(docs()));
    expect(pill()?.textContent).toBe('2 suggestions');
    expect(pill()?.parentElement?.classList.contains('sm-header-row')).toBe(true);
    expect(pill()?.previousElementSibling?.classList.contains('sm-save')).toBe(true);
  });

  it('counts only what no one has decided, and says suggestion for one', async () => {
    const map = makeDoc();
    map.suggest_log = [{ id: 's-1', accepted_at: T0 }];
    await open(fakeConnection({ ...docs(), sensor_map: map }));
    expect(pill()?.textContent).toBe('1 suggestion');
  });

  it('is gone once the log has decided every suggestion', async () => {
    const map = makeDoc();
    map.suggest_log = [
      { id: 's-1', rejected_at: T0 },
      { id: 's-2', accepted_at: T0 },
    ];
    await open(fakeConnection({ ...docs(), sensor_map: map }));
    expect(pill()).toBeNull();
  });

  it('counts a suggestion of every kind', async () => {
    await open(fakeConnection({ ...docs(), sensor_map_suggest: suggestionsOfEveryKind() }));
    expect(pill()?.textContent).toBe('6 suggestions');
  });

  it('is shown whichever mode the map is in', async () => {
    await open(fakeConnection(docs()));
    mode('Edit');
    expect(pill()?.textContent).toBe('2 suggestions');
    mode('Survey');
    expect(pill()?.textContent).toBe('2 suggestions');
  });
});

describe('the suggestions sheet', () => {
  const pill = () => query('.sm-pill') as HTMLElement;
  const card = (tag: string) =>
    queryAll('.sm-sheet .sm-suggest-card').find(node => node.querySelector('.sm-tag')?.textContent === tag) as HTMLElement;
  const cardButton = (tag: string, text: string) =>
    [...card(tag).querySelectorAll('button')].find(node => node.textContent === text) as HTMLElement;
  const tags = () => queryAll('.sm-sheet .sm-suggest-card .sm-tag').map(node => node.textContent);
  const viewBox = () => query('.sm-svg')?.getAttribute('viewBox');
  const everyKind = { ...docs(), sensor_map_suggest: suggestionsOfEveryKind() };

  async function openAll() {
    const fake = fakeConnection(everyKind);
    await open(fake);
    act(() => pill().click());
    return fake;
  }

  it('lists every suggestion that waits in one sheet: setup, new devices, placements, renames, then answers', async () => {
    await openAll();
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Suggestions');
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('6 waiting');
    expect(tags()).toEqual(['Phone', 'Wi-Fi', 'New device', 'Placement', 'Rename', 'Answer']);
  });

  it('gives each its reason and says what it is about', async () => {
    await openAll();
    expect(card('Phone').textContent).toContain('Bermuda tracks the phone now');
    expect(card('Phone').textContent).toContain('Phone Test owner: Bluetooth tracks it as a1b2c3d4e5f60718293a4b5c6d7e8f90_1_2');
    expect(card('Wi-Fi').textContent).toContain('Derived from the controller');
    expect(card('Wi-Fi').textContent).toContain(`${BSSID_A}Test door contact`);
    expect(card('New device').textContent).toContain('New thing');
    expect(card('New device').textContent).toContain('New in the registry');
    expect(card('New device').textContent).toContain('At x 9.00, y 2.50.');
    expect(card('Placement').textContent).toContain('Test door contact');
    expect(card('Placement').textContent).toContain('Measured answer');
    expect(card('Placement').textContent).toContain('At x 4.00, y 2.50.');
    expect(card('Rename').textContent).toContain('Test door contact to Front door contact');
    expect(card('Rename').textContent).toContain('It is the front door');
    expect(card('Answer').textContent).toContain('Q1: Which side is alpha?');
    expect(card('Answer').textContent).toContain('Proposed: The left side');
    expect(card('Answer').textContent).toContain('Owner said so');
  });

  it('puts Accept and Discard on every one, and Show on map only on those that have a place on the plan', async () => {
    await openAll();
    const buttons = (tag: string) => [...card(tag).querySelectorAll('button')].map(node => node.textContent);
    expect(buttons('Phone')).toEqual(['Accept', 'Discard suggestion']);
    expect(buttons('Wi-Fi')).toEqual(['Accept', 'Discard suggestion']);
    expect(buttons('New device')).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    expect(buttons('Placement')).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    expect(buttons('Rename')).toEqual(['Accept', 'Show on map', 'Discard suggestion']);
    expect(buttons('Answer')).toEqual(['Accept', 'Discard suggestion']);
  });

  it('says a suggestion was made against an older layout', async () => {
    const suggest = suggestionsOfEveryKind();
    suggest.based_on_layout_version = 1;
    await open(fakeConnection({ ...docs(), sensor_map_suggest: suggest }));
    act(() => pill().click());
    expect(card('Placement').textContent).toContain('Made against an older layout.');
    expect(card('Answer').textContent).not.toContain('older layout');
  });

  it('writes nothing until a suggestion is decided', async () => {
    const fake = await openAll();
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
  });

  it('is closed by the pill again, and by Close', async () => {
    await openAll();
    act(() => pill().click());
    expect(query('.sm-sheet')).toBeNull();
    act(() => pill().click());
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    act(() => byLabel('Close').click());
    expect(query('.sm-sheet')).toBeNull();
  });

  it('accepts one the way the device sheet does: written to the map, logged, and one fewer on the pill', async () => {
    const fake = await openAll();
    act(() => cardButton('Rename', 'Accept').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(writes(fake).at(-1)?.key).toBe('sensor_map');
    expect(written.devices.door_1.name).toBe('Front door contact');
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-rename', accepted_at: expect.any(String) })]);
    expect(pill().textContent).toBe('5 suggestions');
    expect(tags()).toEqual(['Phone', 'Wi-Fi', 'New device', 'Placement', 'Answer']);
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('5 waiting');
  });

  it('asks before it discards, the confirming tap waking up a moment later, then logs the rejection and takes it off the pill', async () => {
    const fake = await openAll();
    act(() => cardButton('Answer', 'Discard suggestion').click());
    expect(card('Answer').textContent).toContain('Discard this suggestion?');
    expect((chip('Yes, discard') as HTMLButtonElement).disabled).toBe(true);
    await advance(700);
    expect((chip('Yes, discard') as HTMLButtonElement).disabled).toBe(false);
    expect(writes(fake)).toHaveLength(0);
    act(() => chip('Yes, discard').click());
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.suggest_log).toEqual([expect.objectContaining({ id: 's-2', rejected_at: expect.any(String) })]);
    expect(written.questions[0].answer).toBeNull();
    expect(pill().textContent).toBe('5 suggestions');
    expect(tags()).not.toContain('Answer');
  });

  it('leaves a suggestion where it is when the discard is called off with Keep it', async () => {
    const fake = await openAll();
    act(() => cardButton('Answer', 'Discard suggestion').click());
    await advance(700);
    act(() => chip('Keep it').click());
    await settle(1500);
    expect(writes(fake)).toHaveLength(0);
    expect(pill().textContent).toBe('6 suggestions');
  });

  it('takes every kind through the same accept, and puts the sheet away after the last one', async () => {
    const fake = await openAll();
    for (const tag of ['Phone', 'Wi-Fi', 'New device', 'Placement', 'Rename']) {
      act(() => cardButton(tag, 'Accept').click());
      expect(query('.sm-sheet')).not.toBeNull();
    }
    expect(pill().textContent).toBe('1 suggestion');
    act(() => cardButton('Answer', 'Accept').click());
    expect(query('.sm-sheet')).toBeNull();
    expect(query('.sm-pill')).toBeNull();
    await settle(1100);
    const written = writes(fake).at(-1)?.value as MapDoc;
    expect(written.phones.map(phone => phone.name)).toContain('Test owner');
    expect(written.wifi.aps).toEqual({ [BSSID_A]: 'door_1' });
    expect(written.devices['dev-new'].name).toBe('New thing');
    expect(written.devices.door_1.placement.pos).toMatchObject({ x: 4, y: 2.5 });
    expect(written.devices.door_1.name).toBe('Front door contact');
    expect(written.questions[0].answer).toBe('The left side');
    expect(written.suggest_log.map(entry => entry.id).sort()).toEqual(['s-1', 's-2', 's-new', 's-phone', 's-rename', 's-wifi']);
  });

  it('puts the sheet away once the last suggestion is discarded', async () => {
    const suggest = makeSuggestDoc();
    suggest.items = [suggest.items[1]];
    await open(fakeConnection({ ...docs(), sensor_map_suggest: suggest }));
    act(() => pill().click());
    await discard();
    expect(query('.sm-sheet')).toBeNull();
    expect(query('.sm-pill')).toBeNull();
  });

  it('shows a suggested placement on the map: centres on its marker, selects it and opens its sheet', async () => {
    await openAll();
    const before = viewBox();
    act(() => cardButton('Placement', 'Show on map').click());
    await settle(100);
    expect(viewBox()).not.toBe(before);
    expect(query('.sm-ghost.sel')).not.toBeNull();
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested placement');
    expect(query('.sm-sheet')?.textContent).toContain('Measured answer');
    expect(pill().textContent).toBe('6 suggestions');
  });

  it('shows a suggested new device on the map the same way', async () => {
    await openAll();
    act(() => cardButton('New device', 'Show on map').click());
    await settle(100);
    expect(query('.sm-ghost.sel')).not.toBeNull();
    expect(query('.sm-sheet .sm-sheet-sub')?.textContent).toBe('suggested new device');
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('New thing');
  });

  it('switches the Suggestions layer back on when it was off, so the marker is there to select', async () => {
    await open(fakeConnection(everyKind));
    toggleLayer('Suggestions');
    expect(queryAll('.sm-ghost')).toHaveLength(0);
    act(() => pill().click());
    act(() => cardButton('Placement', 'Show on map').click());
    await settle(100);
    expect(queryAll('.sm-ghost')).toHaveLength(2);
    expect(query('.sm-ghost.sel')).not.toBeNull();
  });

  it('shows a rename on the map by selecting the device it renames', async () => {
    await openAll();
    act(() => cardButton('Rename', 'Show on map').click());
    await settle(100);
    expect(query('.sm-mk.sel[data-id="door_1"]')).not.toBeNull();
    expect(query('.sm-sheet')?.textContent).toContain('Suggested name "Front door contact": It is the front door');
  });

  it('can be taken back to from the pill after Show on map', async () => {
    await openAll();
    act(() => cardButton('Placement', 'Show on map').click());
    act(() => pill().click());
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Suggestions');
    expect(tags()).toHaveLength(6);
  });

  it('is on the Survey bar as well: the setup chip still opens its own sheet with the same suggestions', async () => {
    await open(fakeConnection(everyKind));
    mode('Survey');
    act(() => chip('Setup suggested').click());
    expect(query('.sm-sheet .sm-sheet-title')?.textContent).toBe('Survey setup');
    expect(queryAll('.sm-sheet .sm-suggest')).toHaveLength(2);
    expect(pill()?.textContent).toBe('6 suggestions');
  });
});
