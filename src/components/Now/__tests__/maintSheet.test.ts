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

  it('shows what it says and its info lines, with no guide, no Done button and no way into the room', async () => {
    await open(parse(PLANT));
    expect(text()).toContain('soil 15%, water at 15%');
    expect([...document.body.querySelectorAll('.maint-info li')].map(li => li.textContent)).toEqual(PLANT.info);
    expect(buttons()).toEqual([]);
    expect(document.body.querySelector('.maint-guide')).toBeNull();
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

  it('is not on an appliance row that has a Done button, as before', async () => {
    await open(parse({ ...FILTERS, id: 'maint:coffee:tank' }));
    expect(button('Done')).toBeDefined();
    expect(button('Open room')).toBeUndefined();
  });
});
