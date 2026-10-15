// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fitView, planToScreen } from '../../../sensorMap/geometry';
import { device, makeDoc, makeFingerprint, makeFingerprintDoc, makeSuggestDoc, placement } from '../../../sensorMap/__tests__/docFixtures';
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
const editDoorSheet = () => press(marker('Test door contact'), 'Enter');
/** Selects the door contact and switches to Edit, typing a new x when one is given. */
function editDoor(x?: string) {
  editDoorSheet();
  act(() => byLabel('Edit').click());
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

describe('fingerprints on the plan', () => {
  it('draws each as a cross, hollow when weak, and lists the weak ones under a filter', async () => {
    const prints = makeFingerprintDoc();
    prints.items = [makeFingerprint('fp-a'), makeFingerprint('fp-b', { weak: true, pos: { x: 3, y: 3, h: 1 } }), makeFingerprint('fp-c')];
    const fake = fakeConnection({ ...docs(), sensor_map_fingerprints: prints });
    await open(fake);
    expect(queryAll('.sm-print')).toHaveLength(3);
    expect(queryAll('.sm-print.weak')).toHaveLength(1);
    expect(query('.sm-save')?.textContent).toContain('3 fingerprints');

    const filter = queryAll('.sm-chip').find(node => node.textContent === 'Weak only 1') as HTMLElement;
    act(() => filter.click());
    expect(queryAll('.sm-print')).toHaveLength(1);
    expect(query('.sm-print.weak')).not.toBeNull();
    act(() => filter.click());
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
    expect(queryAll('.sm-chip').some(node => node.textContent?.startsWith('Weak only'))).toBe(false);
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
    act(() => byLabel('Edit').click());
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
    const chip = queryAll('.sm-layers .sm-chip').find(node => node.textContent?.startsWith('Wi-Fi AP'));
    expect([chip?.textContent, chip?.classList.contains('t-wifi')]).toEqual(['Wi-Fi AP 1', true]);
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
    choose('Questions 1');
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
    ['Stop editing', () => act(() => byLabel('Stop editing').click())],
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
    act(() => byLabel('Edit').click());
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
