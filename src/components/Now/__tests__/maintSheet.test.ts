// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { parseHouseUpcoming, type HouseUpcomingRow } from '../../../home/houseUpcoming';

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
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon, className }: { icon: string; className?: string }) => createElement('i', { 'data-icon': icon, className }) };
});

vi.mock('../plantPhotos', () => ({ plantPhoto: (key: string) => (key === 'monstera' ? '/photos/monstera.webp' : undefined) }));

const { MaintSheet, DONE_EVENT, UNDO_EVENT } = await import('../MaintSheet');

const FILTERS = {
  id: 'maint:dishwasher:filters',
  kind: 'maint',
  at: '2026-12-27T08:00:00+00:00',
  icon: 'mdi:dishwasher',
  title: 'Dishwasher filters + spray arms',
  detail: 'rinse filter + arms, 30 runs left, ~27.12',
  area: 'kitchen',
  audience: 'admin',
  done: 'tap',
  info: ['Every 30 runs (~2 months)', 'Counting from 15.10'],
  steps: ['Switch the dishwasher off.', 'Rinse the filters under running water.', 'Refit in reverse.'],
  warn: 'Never run the dishwasher without the filters and the lower spray arm.',
};

const NOW = Date.parse('2026-10-15T10:30:00Z');
const parse = (raw: Record<string, unknown>): HouseUpcomingRow =>
  parseHouseUpcoming({ expires: '2026-10-15T10:45:00+00:00', rows: [raw] }, NOW)[0];
const without = (...keys: string[]) => Object.fromEntries(Object.entries(FILTERS).filter(([key]) => !keys.includes(key)));

let root: Root;
let send: Mock<(message: unknown) => Promise<unknown>>;
let onClose: Mock<() => void>;
let onOpenRoom: Mock<(areaId: string) => void>;

beforeEach(() => {
  send = vi.fn(() => Promise.resolve(null));
  store.setState({ connection: { sendMessagePromise: send } });
  onClose = vi.fn<() => void>();
  onOpenRoom = vi.fn<(areaId: string) => void>();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

async function open(row: HouseUpcomingRow, isAdmin = true) {
  await act(async () => {
    root.render(createElement(MaintSheet, { row, isAdmin, onClose, onOpenRoom }));
  });
}

const text = () => document.body.querySelector('.maint-body')?.textContent ?? '';
const buttons = () => [...document.body.querySelectorAll<HTMLButtonElement>('.maint-body button')];
const button = (label: string) => buttons().find(b => b.textContent?.includes(label));
async function press(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  await act(async () => {
    target?.click();
  });
}
const sent = () => send.mock.calls.map(([message]) => message);

describe('the sheet of a maintenance row', () => {
  it('shows what the row says, with the guide behind the info button', async () => {
    await open(parse(FILTERS));
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Dishwasher filters + spray arms');
    expect(text()).toContain('rinse filter + arms, 30 runs left, ~27.12');
    expect(text()).toContain('Every 30 runs (~2 months)');
    expect(text()).toContain('Counting from 15.10');
    expect(document.body.querySelector('.maint-guide')).toBeNull();
    expect(text()).not.toContain('Switch the dishwasher off.');
    expect(document.body.querySelector('.appliance-glyph [data-icon="mdi:dishwasher"]')).not.toBeNull();
  });

  it('opens and closes the guide: the safety note first, then the steps in order', async () => {
    await open(parse(FILTERS));
    const how = button('How to');
    expect(how?.getAttribute('aria-expanded')).toBe('false');
    await press('How to');
    expect(button('How to')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('.maint-warn')?.textContent).toBe(
      'Never run the dishwasher without the filters and the lower spray arm.'
    );
    expect([...document.body.querySelectorAll('.maint-steps li')].map(li => li.textContent)).toEqual(FILTERS.steps);
    expect(document.body.querySelector('ol.maint-steps')).not.toBeNull();
    expect(button('How to')?.getAttribute('aria-controls')).toBe(document.body.querySelector('.maint-guide')?.id);
    await press('How to');
    expect(document.body.querySelector('.maint-guide')).toBeNull();
  });

  it('has no info button for a row without steps and no note without one', async () => {
    await open(parse(without('steps', 'warn')));
    expect(button('How to')).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    await open(parse(without('warn')));
    await press('How to');
    expect(document.body.querySelector('.maint-warn')).toBeNull();
    expect(document.body.querySelectorAll('.maint-steps li')).toHaveLength(3);
  });
});

describe('the Done button', () => {
  it('asks before it fires, and Cancel fires nothing', async () => {
    await open(parse(FILTERS));
    expect(button('Yes, done')).toBeUndefined();
    await press('Done');
    expect(text()).toContain('Mark it done? The count starts over.');
    expect(sent()).toEqual([]);
    await press('Cancel');
    expect(sent()).toEqual([]);
    expect(button('Done')).toBeDefined();
    expect(button('Yes, done')).toBeUndefined();
  });

  it('fires house_upcoming_done with the row id once it is confirmed, and says it is done', async () => {
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    expect(sent()).toEqual([{ type: 'fire_event', event_type: DONE_EVENT, event_data: { row: 'maint:dishwasher:filters' } }]);
    expect(DONE_EVENT).toBe('house_upcoming_done');
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('Marked done');
    expect(button('Undo')).toBeDefined();
    expect(button('Yes, done')).toBeUndefined();
  });

  it('takes it back with Undo, which fires house_upcoming_undo and brings the Done button back', async () => {
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    await press('Undo');
    expect(sent()[1]).toEqual({ type: 'fire_event', event_type: UNDO_EVENT, event_data: { row: 'maint:dishwasher:filters' } });
    expect(UNDO_EVENT).toBe('house_upcoming_undo');
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    expect(button('Done')).toBeDefined();
    expect(button('Undo')).toBeUndefined();
  });

  it('is disabled while the event is on its way', async () => {
    let arrive: (value: unknown) => void = () => {};
    send.mockImplementationOnce(() => new Promise(resolve => (arrive = resolve)));
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    const busy = button('Marking done');
    expect(busy?.disabled).toBe(true);
    expect(sent()).toHaveLength(1);
    await act(async () => arrive(null));
    expect(text()).toContain('Marked done');
  });

  it('says so when Home Assistant does not take it, and lets it be tried again', async () => {
    send.mockRejectedValueOnce({ code: 'unauthorized', message: 'Unauthorized' });
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Home Assistant did not take that');
    expect(document.body.querySelector('[role="status"]')).toBeNull();
    expect(button('Done')).toBeDefined();
    await press('Done');
    await press('Yes, done');
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('Marked done');
    expect(sent()).toHaveLength(2);
  });

  it('stays done when the undo is refused', async () => {
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    send.mockRejectedValueOnce(new Error('offline'));
    await press('Undo');
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(text()).toContain('Marked done');
    expect(button('Undo')).toBeDefined();
  });

  it('says so without a connection to Home Assistant and fires nothing', async () => {
    store.setState({ connection: null });
    await open(parse(FILTERS));
    await press('Done');
    await press('Yes, done');
    expect(sent()).toEqual([]);
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('is for admins only', async () => {
    await open(parse(FILTERS), false);
    expect(button('Done')).toBeUndefined();
    expect(text()).toContain('rinse filter + arms');
    expect(sent()).toEqual([]);
  });

  it('is only on a row that has one, which has no Open room button and keeps its place after a Done', async () => {
    await open(parse(without('done')));
    expect(button('Done')).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    await open(parse(FILTERS));
    expect(button('Open room')).toBeUndefined();
    await press('Done');
    await press('Yes, done');
    await act(async () => {
      root.render(
        createElement(MaintSheet, {
          row: parse({
            ...FILTERS,
            detail: 'rinse filter + arms, 30 runs left, ~14.12',
            info: ['Every 30 runs (~2 months)', 'Done 15.10, no runs since'],
          }),
          isAdmin: true,
          onClose,
          onOpenRoom,
        })
      );
    });
    expect(text()).toContain('Done 15.10, no runs since');
    expect(text()).toContain('Marked done');
  });
});

describe('a row with a guide but no Done button', () => {
  const HYGIENE = {
    ...without('done', 'info'),
    id: 'maint:dishwasher:hygiene',
    title: 'Dishwasher hygiene run',
    detail: 'Intensive 75, due, last unknown',
  };

  it('shows the guide and opens its room', async () => {
    await open(parse(HYGIENE));
    expect(button('Done')).toBeUndefined();
    await press('How to');
    expect(document.body.querySelectorAll('.maint-steps li')).toHaveLength(3);
    await press('Open room');
    expect(onOpenRoom).toHaveBeenCalledExactlyOnceWith('kitchen');
    expect(sent()).toEqual([]);
  });

  it('has no Open room button without a room', async () => {
    await open(parse(Object.fromEntries(Object.entries(HYGIENE).filter(([key]) => key !== 'area'))));
    expect(button('Open room')).toBeUndefined();
  });
});

describe('a row with info lines only', () => {
  const PLANT = {
    id: 'maint:plant:test',
    kind: 'maint',
    icon: 'mdi:watering-can-outline',
    title: 'Water the test plant: 3 L',
    detail: 'soil 15%, water at 15%',
    area: 'dining_room',
    audience: 'admin',
    info: ['The big plant with banana leaves', 'On the floor by the window'],
  };

  it('shows what it says and its info lines, with no guide and no Done button, and offers the room that lists it as due', async () => {
    await open(parse(PLANT));
    expect(text()).toContain('soil 15%, water at 15%');
    expect([...document.body.querySelectorAll('.maint-info li')].map(li => li.textContent)).toEqual(PLANT.info);
    expect(buttons().map(b => b.textContent)).toEqual(['Open room']);
    expect(document.body.querySelector('.maint-guide')).toBeNull();
    await press('Open room');
    expect(onOpenRoom).toHaveBeenCalledExactlyOnceWith('dining_room');
  });

  it('offers no room while it is not due yet, since the room has nothing about it', async () => {
    await open(parse({ ...PLANT, at: '2026-12-27T08:00:00+00:00' }));
    expect(text()).toContain('soil 15%, water at 15%');
    expect(buttons()).toEqual([]);
  });
});

describe('the Open room button', () => {
  const GUIDE = { ...without('done', 'info'), area: 'kitchen' };
  const rowWith = (id: string) => parse({ ...GUIDE, id });

  it.each(['maint:washer:drum', 'maint:dryer:plinth', 'maint:dishwasher:hygiene', 'maint:coffee:rinse', 'maint:rober2:filter'])(
    'is on %s, whose room panel has a card for the appliance',
    async id => {
      await open(rowWith(id));
      await press('Open room');
      expect(onOpenRoom).toHaveBeenCalledExactlyOnceWith('kitchen');
    }
  );

  it.each(['maint:plant:test', 'maint:once:test', 'maint:battery:sensor.test_battery', 'maint:more'])(
    'is not on %s, whose room panel has nothing about it, though the row names a room and has a guide',
    async id => {
      const row = rowWith(id);
      expect(row.areaId).toBe('kitchen');
      expect(row.steps.length).toBeGreaterThan(0);
      await open(row);
      expect(button('How to')).toBeDefined();
      expect(button('Open room')).toBeUndefined();
    }
  );

  it('is on a row that is due whatever it is, since the room panel lists it under To do', async () => {
    await open(parse({ ...without('done', 'info', 'at'), id: 'maint:plant:test' }));
    await press('Open room');
    expect(onOpenRoom).toHaveBeenCalledExactlyOnceWith('kitchen');
  });

  it('is not offered to a sheet that is opened without a way into the room', async () => {
    await act(async () => {
      root.render(createElement(MaintSheet, { row: rowWith('maint:washer:drum'), isAdmin: true, onClose }));
    });
    expect(button('How to')).toBeDefined();
    expect(button('Open room')).toBeUndefined();
  });

  it('is not on an appliance row that has a Done button, as before', async () => {
    await open(parse({ ...FILTERS, id: 'maint:coffee:tank' }));
    expect(button('Done')).toBeDefined();
    expect(button('Open room')).toBeUndefined();
  });
});

describe('an overview row', () => {
  const PLANTS = {
    id: 'maint:plants',
    kind: 'maint',
    icon: 'mdi:sprout',
    title: 'Plants: next 27.10',
    detail: 'Next care of each plant',
    audience: 'admin',
    at: '2026-10-27T07:00:00+00:00',
    items: ['Fig: next 27.10, watered 20.10', 'Palm: next 29.10, watered 19.10', 'Aloe: next 2.11, watered 14.10'],
  };

  it('lists its lines in order under what it says, with no guide, no Done button and no room', async () => {
    await open(parse(PLANTS));
    expect([...document.body.querySelectorAll('.maint-items li')].map(li => li.textContent)).toEqual(PLANTS.items);
    expect([...(document.body.querySelector('.maint-body')?.children ?? [])].map(node => node.className)).toEqual([
      'maint-detail',
      'maint-items',
    ]);
    expect(buttons()).toEqual([]);
  });

  it('has the Done button of an administrator only when it says done is a tap', async () => {
    await open(parse({ ...PLANTS, done: 'tap' }));
    expect(buttons().map(b => b.textContent)).toEqual(['Done']);
    expect(document.body.querySelectorAll('.maint-items li')).toHaveLength(3);
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    await open(parse({ ...PLANTS, done: 'tap' }), false);
    expect(buttons()).toEqual([]);
  });
});

describe('a plants row', () => {
  const MONSTERA = {
    id: 'maint:plant:monstera',
    name: 'Monstera',
    amount: '1 L',
    detail: 'due since 30.10',
    where: 'Kitchen floor by the Rober2 dock',
    aka: 'Big leaves with holes',
    photo: 'monstera',
    done: 'tap',
  };
  const LILY = {
    id: 'maint:plant:peace_lily_kitchen',
    name: 'Peace lily kitchen',
    amount: '0.4 L',
    detail: 'due since 27.10',
    where: 'Coffee cart next to the xBloom',
    aka: 'Small peace lily, droops when thirsty',
    photo: 'peace_lily',
    done: 'tap',
  };
  const IVY = {
    id: 'maint:plant:ivy',
    name: 'Ivy',
    amount: '0.3 L + 1/4 tsp fertiliser',
    detail: 'soil 20%, water at 20%',
    where: 'Top of the wine fridge',
    aka: 'Small trailing ivy',
    photo: 'ivy',
  };
  const PLANTS = {
    id: 'maint:plants',
    kind: 'maint',
    icon: 'mdi:watering-can-outline',
    title: 'Water 3 plants',
    detail: 'Monstera, Peace lily kitchen, Ivy',
    audience: 'admin',
    items: ['Fig: next 27.10, watered 20.10'],
    plants: [MONSTERA, LILY, IVY],
  };
  const rowOf = (...plants: Record<string, string>[]) => parse({ ...PLANTS, plants });

  const cards = () => [...document.body.querySelectorAll<HTMLElement>('.maint-plant')];
  const names = () => cards().map(item => item.querySelector('.maint-plant-name')?.textContent);
  const card = (name: string) => cards().find(item => item.querySelector('.maint-plant-name')?.textContent === name);
  const dimmed = () => cards().map(item => item.classList.contains('is-done'));
  const check = (name: string) => card(name)?.querySelector<HTMLButtonElement>('button');
  const label = (name: string) => check(name)?.getAttribute('aria-label');
  async function tap(name: string) {
    const target = check(name);
    expect(target, name).toBeDefined();
    await act(async () => {
      target?.click();
    });
  }

  it('lists a card for each plant in order, in place of the lines and the detail of the row', async () => {
    await open(parse(PLANTS));
    expect(document.body.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Water 3 plants');
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
    expect([...document.body.querySelectorAll('.maint-plant-amount')].map(chip => chip.textContent)).toEqual([
      '1 L',
      '0.4 L',
      '0.3 L + 1/4 tsp fertiliser',
    ]);
    expect([...document.body.querySelectorAll('.maint-plant-where')].map(line => line.textContent)).toEqual([
      'Kitchen floor by the Rober2 dock',
      'Coffee cart next to the xBloom',
      'Top of the wine fridge',
    ]);
    expect(document.body.querySelectorAll('.maint-plant-where [data-icon="mdi:map-marker-outline"]')).toHaveLength(3);
    expect([...document.body.querySelectorAll('.maint-plant-aka')].map(line => line.textContent)).toEqual([
      'Big leaves with holes',
      'Small peace lily, droops when thirsty',
      'Small trailing ivy',
    ]);
    expect(text()).not.toContain('Fig: next 27.10');
    expect([...(document.body.querySelector('.maint-body')?.children ?? [])].map(node => node.className)).toEqual(['maint-plants']);
  });

  it('leaves out the amount, the place and the look of a plant that has none', async () => {
    await open(parse({ ...PLANTS, plants: [{ id: 'maint:plant:fig', name: 'Fig', done: 'tap' }] }));
    expect(card('Fig')?.querySelector('.maint-plant-amount')).toBeNull();
    expect(card('Fig')?.querySelector('.maint-plant-where')).toBeNull();
    expect(card('Fig')?.querySelector('.maint-plant-aka')).toBeNull();
    expect(label('Fig')).toBe('Mark done: Fig');
  });

  it('shows the photo of a plant whose key has an image, and a sprout on a plain tile for any other', async () => {
    await open(rowOf(MONSTERA, LILY, IVY, { id: 'maint:plant:fig', name: 'Fig' }));
    expect(card('Monstera')?.querySelector('img')?.getAttribute('src')).toBe('/photos/monstera.webp');
    expect(card('Monstera')?.querySelector('.is-blank')).toBeNull();
    for (const name of ['Peace lily kitchen', 'Ivy', 'Fig']) {
      expect(card(name)?.querySelector('img'), name).toBeNull();
      expect(card(name)?.querySelector('.maint-plant-photo.is-blank [data-icon="mdi:sprout"]'), name).not.toBeNull();
    }
  });

  it('has a check button for an admin on each plant that can be marked done, and the detail of the others in its place', async () => {
    await open(parse(PLANTS));
    expect(buttons().map(b => b.getAttribute('aria-label'))).toEqual(['Mark done: Monstera', 'Mark done: Peace lily kitchen']);
    expect(buttons().every(b => !b.disabled && b.querySelector('[data-icon="mdi:check"]') != null)).toBe(true);
    expect(check('Ivy')).toBeNull();
    expect(card('Ivy')?.textContent).toContain('soil 20%, water at 20%');
    expect(card('Monstera')?.textContent).not.toContain('due since 30.10');
    expect(button('Done')).toBeUndefined();
  });

  it('has no button for anyone but an admin, and shows the detail of every plant', async () => {
    await open(parse(PLANTS), false);
    expect(buttons()).toEqual([]);
    expect(card('Monstera')?.textContent).toContain('due since 30.10');
    expect(card('Ivy')?.textContent).toContain('soil 20%, water at 20%');
    expect(sent()).toEqual([]);
  });

  it('fires house_upcoming_done with the id of the plant at one tap, with no question, and dims the card to an Undo button', async () => {
    await open(parse(PLANTS));
    await tap('Monstera');
    expect(sent()).toEqual([{ type: 'fire_event', event_type: DONE_EVENT, event_data: { row: 'maint:plant:monstera' } }]);
    expect(text()).not.toContain('Mark it done?');
    expect(dimmed()).toEqual([true, false, false]);
    expect(label('Monstera')).toBe('Undo: Monstera');
    expect(check('Monstera')?.querySelector('[data-icon="mdi:undo"]')).not.toBeNull();
    expect(check('Monstera')?.disabled).toBe(false);
    expect(label('Peace lily kitchen')).toBe('Mark done: Peace lily kitchen');
  });

  it('shows a spinner on the card whose event is on its way, and the cards do not hold each other up', async () => {
    const arrivals: ((value: unknown) => void)[] = [];
    send.mockImplementation(() => new Promise(resolve => arrivals.push(resolve)));
    await open(parse(PLANTS));
    await tap('Monstera');
    expect(check('Monstera')?.disabled).toBe(true);
    expect(check('Monstera')?.getAttribute('aria-busy')).toBe('true');
    expect(check('Monstera')?.querySelector('.appliance-spin[data-icon="mdi:loading"]')).not.toBeNull();
    expect(dimmed()).toEqual([false, false, false]);
    expect(check('Peace lily kitchen')?.disabled).toBe(false);
    await tap('Peace lily kitchen');
    expect(sent()).toHaveLength(2);
    await act(async () => arrivals[1](null));
    expect(dimmed()).toEqual([false, true, false]);
    expect(check('Monstera')?.disabled).toBe(true);
    await act(async () => arrivals[0](null));
    expect(dimmed()).toEqual([true, true, false]);
    expect(check('Monstera')?.disabled).toBe(false);
    expect(check('Monstera')?.getAttribute('aria-busy')).toBeNull();
  });

  it('takes a Done back with Undo, which fires house_upcoming_undo for the plant and brings the check button back', async () => {
    send.mockImplementation(() => Promise.resolve(null));
    await open(parse(PLANTS));
    await tap('Monstera');
    await tap('Monstera');
    expect(sent()[1]).toEqual({ type: 'fire_event', event_type: UNDO_EVENT, event_data: { row: 'maint:plant:monstera' } });
    expect(dimmed()).toEqual([false, false, false]);
    expect(label('Monstera')).toBe('Mark done: Monstera');
  });

  it('shows the Undo as busy while it is on its way, with the card still dimmed', async () => {
    await open(parse(PLANTS));
    await tap('Monstera');
    let arrive: (value: unknown) => void = () => {};
    send.mockImplementationOnce(() => new Promise(resolve => (arrive = resolve)));
    await tap('Monstera');
    expect(check('Monstera')?.disabled).toBe(true);
    expect(check('Monstera')?.querySelector('.appliance-spin')).not.toBeNull();
    expect(dimmed()).toEqual([true, false, false]);
    await act(async () => arrive(null));
    expect(dimmed()).toEqual([false, false, false]);
  });

  it('says so on the card when Home Assistant does not take a Done, and lets it be tried again', async () => {
    send.mockRejectedValueOnce({ code: 'unauthorized', message: 'Unauthorized' });
    await open(parse(PLANTS));
    await tap('Monstera');
    expect(card('Monstera')?.querySelector('[role="alert"]')?.textContent).toContain('Home Assistant did not take that');
    expect(document.body.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(dimmed()).toEqual([false, false, false]);
    expect(label('Monstera')).toBe('Mark done: Monstera');
    expect(check('Monstera')?.disabled).toBe(false);
    await tap('Monstera');
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(dimmed()).toEqual([true, false, false]);
    expect(sent()).toHaveLength(2);
  });

  it('stays marked when the Undo is refused', async () => {
    await open(parse(PLANTS));
    await tap('Monstera');
    send.mockRejectedValueOnce(new Error('offline'));
    await tap('Monstera');
    expect(card('Monstera')?.querySelector('[role="alert"]')).not.toBeNull();
    expect(dimmed()).toEqual([true, false, false]);
    expect(label('Monstera')).toBe('Undo: Monstera');
  });

  it('says so without a connection to Home Assistant and fires nothing', async () => {
    store.setState({ connection: null });
    await open(parse(PLANTS));
    await tap('Monstera');
    expect(sent()).toEqual([]);
    expect(card('Monstera')?.querySelector('[role="alert"]')).not.toBeNull();
    expect(dimmed()).toEqual([false, false, false]);
  });

  it('keeps a plant the publisher has dropped after its Done, dimmed with its Undo and in its place, until the sheet closes', async () => {
    await open(rowOf(MONSTERA, LILY, IVY));
    await tap('Peace lily kitchen');
    await open(rowOf(MONSTERA, IVY));
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
    expect(dimmed()).toEqual([false, true, false]);
    expect(label('Peace lily kitchen')).toBe('Undo: Peace lily kitchen');
    await tap('Peace lily kitchen');
    expect(sent()[1]).toEqual({ type: 'fire_event', event_type: UNDO_EVENT, event_data: { row: 'maint:plant:peace_lily_kitchen' } });
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
    expect(dimmed()).toEqual([false, false, false]);
    expect(label('Peace lily kitchen')).toBe('Mark done: Peace lily kitchen');
    await open(rowOf(MONSTERA, LILY, IVY));
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
  });

  it('keeps the card of a plant the publisher drops while its Done is still on its way', async () => {
    let arrive: (value: unknown) => void = () => {};
    send.mockImplementationOnce(() => new Promise(resolve => (arrive = resolve)));
    await open(rowOf(MONSTERA, LILY, IVY));
    await tap('Monstera');
    await open(rowOf(LILY, IVY));
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
    expect(check('Monstera')?.disabled).toBe(true);
    await act(async () => arrive(null));
    expect(dimmed()).toEqual([true, false, false]);
    expect(label('Monstera')).toBe('Undo: Monstera');
  });

  it('puts several dropped plants back where they stood, lets an unmarked one go and keeps the cards when none is left', async () => {
    const ivy = { ...IVY, done: 'tap' };
    await open(rowOf(MONSTERA, LILY, ivy));
    await tap('Monstera');
    await tap('Ivy');
    await open(rowOf(LILY));
    expect(names()).toEqual(['Monstera', 'Peace lily kitchen', 'Ivy']);
    expect(dimmed()).toEqual([true, false, true]);
    await open(rowOf());
    expect(names()).toEqual(['Monstera', 'Ivy']);
    expect(dimmed()).toEqual([true, true]);
    expect(document.body.querySelector('.maint-items')).toBeNull();
  });

  it('shows the lines of the row again once no plant is listed and none was marked', async () => {
    await open(rowOf());
    expect(cards()).toEqual([]);
    expect(document.body.querySelector('.maint-plants')).toBeNull();
    expect([...document.body.querySelectorAll('.maint-items li')].map(li => li.textContent)).toEqual(['Fig: next 27.10, watered 20.10']);
  });
});
