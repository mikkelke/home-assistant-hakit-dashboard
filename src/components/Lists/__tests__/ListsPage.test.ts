// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Raw = { uid: string; summary: string; status: 'needs_action' | 'completed' };
type Message = { type: string; [key: string]: unknown };

const hass = vi.hoisted(() => ({
  entities: {} as Record<string, unknown>,
  viewer: { isAdmin: true as boolean | null, name: 'Mikkel' as string | null, id: 'u-mikkel' as string | null },
  connection: null as unknown,
}));

vi.mock('@hakit/core', () => ({
  useHass: <T>(selector: (state: { connection: unknown }) => T): T => selector({ connection: hass.connection }),
}));
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});
vi.mock('../../../hooks/useTrackedEntities', () => ({
  useTrackedEntities: () => hass.entities,
  peekEntities: (entities: unknown) => entities,
}));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => hass.viewer }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => true, useMediaQuery: () => true }));

const { ListsPage } = await import('../ListsPage');

const entity = (entity_id: string, friendly_name: string) => ({ entity_id, state: '0', attributes: { friendly_name } });

const AUTH_USERS = [
  { id: 'u-mikkel', name: 'Mikkel', is_active: true, system_generated: false },
  { id: 'u-kristine', name: 'Kristine', is_active: true, system_generated: false },
  { id: 'u-claudia', name: 'Claudia', is_active: true, system_generated: false },
  { id: 'u-rooftop', name: 'Rooftop', is_active: true, system_generated: false },
  { id: 'u-appdaemon', name: 'AppDaemon', is_active: true, system_generated: false },
  { id: 'u-nodered', name: 'NodeRed', is_active: true, system_generated: false },
  { id: 'u-supervisor', name: 'Supervisor', is_active: true, system_generated: true },
  { id: 'u-former', name: 'Former', is_active: false, system_generated: false },
];

/** A Home Assistant that holds the lists, the visibility document and the users, and tells subscribers what changed. */
function homeAssistant() {
  const sent: Message[] = [];
  const items = new Map<string, Raw[]>();
  const itemSubscribers = new Map<string, (event: unknown) => void>();
  const docSubscribers = new Set<(event: { value: unknown }) => void>();
  const ha = {
    sent,
    doc: null as unknown,
    users: AUTH_USERS as unknown,
    /** Service calls and writes are answered, but their events wait until `release`. */
    hold: false,
    held: [] as Array<() => void>,
    /** Service calls and document writes are refused. */
    refuse: false,
    /** The document subscription never answers, or is refused. */
    docMode: 'answers' as 'answers' | 'silent' | 'refused',
    refuseItems: new Set<string>(),
    refuseUsers: false,
    unsubscribed: [] as string[],
    setItems(entityId: string, list: Raw[]) {
      items.set(entityId, list);
    },
    itemsOf: (entityId: string) => items.get(entityId) ?? [],
    emitItems(entityId: string) {
      itemSubscribers.get(entityId)?.({ items: items.get(entityId) ?? [] });
    },
    emitDoc() {
      docSubscribers.forEach(callback => callback({ value: ha.doc }));
    },
    release() {
      ha.held.splice(0).forEach(run => run());
    },
    calls: () => sent.filter(message => message.type === 'call_service'),
    writes: () => sent.filter(message => message.type === 'frontend/set_system_data'),
  };
  const later = (run: () => void) => (ha.hold ? ha.held.push(run) : run());
  const connection = {
    sendMessagePromise: vi.fn(async (message: Message) => {
      sent.push(message);
      if (message.type === 'config/auth/list') {
        if (ha.refuseUsers) throw new Error('unauthorized');
        return ha.users;
      }
      if (ha.refuse && (message.type === 'call_service' || message.type === 'frontend/set_system_data')) throw new Error('refused');
      if (message.type === 'frontend/set_system_data') {
        ha.doc = message.value;
        later(() => ha.emitDoc());
      }
      if (message.type === 'call_service') {
        const entityId = (message.target as { entity_id: string }).entity_id;
        const data = message.service_data as { item?: string; status?: Raw['status']; rename?: string };
        const list = items.get(entityId) ?? [];
        if (message.service === 'add_item') list.push({ uid: `new-${list.length + 1}`, summary: data.item ?? '', status: 'needs_action' });
        if (message.service === 'update_item') {
          const found = list.find(item => item.uid === data.item);
          if (!found) throw new Error('Item not found');
          found.status = data.status ?? found.status;
          found.summary = data.rename ?? found.summary;
        }
        if (message.service === 'remove_completed_items')
          items.set(
            entityId,
            list.filter(item => item.status !== 'completed')
          );
        else if (message.service === 'remove_item') {
          const gone = (message.service_data as { item: string[] }).item;
          if (!gone.every(uid => list.some(item => item.uid === uid))) throw new Error('Item not found');
          items.set(
            entityId,
            list.filter(item => !gone.includes(item.uid))
          );
        } else items.set(entityId, list);
        later(() => ha.emitItems(entityId));
      }
      return null;
    }),
    subscribeMessage: vi.fn(async (callback: (event: never) => void, message: Message) => {
      sent.push(message);
      const unsubscribe = async () => void ha.unsubscribed.push(`${message.type}:${String(message.entity_id ?? message.key)}`);
      if (message.type === 'todo/item/subscribe') {
        const entityId = message.entity_id as string;
        if (ha.refuseItems.has(entityId)) throw new Error('not_found');
        itemSubscribers.set(entityId, callback as (event: unknown) => void);
        ha.emitItems(entityId);
        return unsubscribe;
      }
      if (ha.docMode === 'refused') throw new Error('refused');
      docSubscribers.add(callback as (event: { value: unknown }) => void);
      if (ha.docMode === 'answers') callback({ value: ha.doc } as never);
      return unsubscribe;
    }),
  };
  return { ha, connection };
}

let root: Root;
let ha: ReturnType<typeof homeAssistant>['ha'];

beforeEach(() => {
  vi.useFakeTimers();
  const fake = homeAssistant();
  ha = fake.ha;
  hass.connection = fake.connection;
  hass.viewer = { isAdmin: true, name: 'Mikkel', id: 'u-mikkel' };
  hass.entities = {
    'todo.indkob': entity('todo.indkob', 'Indkøb'),
    'todo.husk_hjemme': entity('todo.husk_hjemme', 'Husk hjemme'),
    'todo.todo': entity('todo.todo', 'To-do'),
    'light.kitchen': entity('light.kitchen', 'Kitchen'),
  };
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(10)));

async function mount(onClose: () => void = () => {}) {
  await act(async () => root.render(createElement(ListsPage, { onClose })));
  await settle();
}

const text = (node: Element | null | undefined) => node?.textContent ?? '';
const names = () => [...document.querySelectorAll('.list-name')].map(text);
const card = (name: string) =>
  [...document.querySelectorAll('.list-card')].find(node => text(node.querySelector('.list-name')) === name) as HTMLElement;
const rows = (scope: Element) => [...scope.querySelectorAll('.list-item')].map(text);
const byText = (scope: ParentNode, selector: string, label: string) =>
  [...scope.querySelectorAll<HTMLElement>(selector)].find(node => text(node).trim() === label);
const click = (node: Element | undefined) => {
  expect(node).toBeDefined();
  act(() => (node as HTMLElement).click());
};

function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const rowOf = (list: string, label: string) => byText(card(list), '.list-item', label)?.closest('li') as HTMLElement;
const editor = (list: string) => card(list).querySelector<HTMLFormElement>('.list-edit');
const field = (list: string) => card(list).querySelector<HTMLInputElement>('.list-edit input') as HTMLInputElement;
const button = (scope: ParentNode, label: string) => scope.querySelector<HTMLElement>(`[aria-label="${label}"]`) ?? undefined;
const edit = (list: string, label: string) => click(button(rowOf(list, label), 'Edit'));
const submit = (form: Element | null) => act(() => void form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const press = (node: Element, key: string) => act(() => void node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));

describe('which lists the page shows', () => {
  it('is every todo list in Home Assistant, by name, for an administrator, who also gets the visibility control', async () => {
    await mount();
    expect(names()).toEqual(['Husk hjemme', 'Indkøb', 'To-do']);
    expect(document.querySelector('[aria-label="List visibility"]')).not.toBeNull();
    expect(document.querySelector('.lists-page-header')?.textContent).toContain('Lists');
  });

  it('is only the lists that name the viewer for anyone else, with no visibility control', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine', 'u-claudia'], 'todo.todo': ['u-claudia'] } };
    await mount();
    expect(names()).toEqual(['Indkøb']);
    expect(document.querySelector('[aria-label="List visibility"]')).toBeNull();
  });

  it('is nothing, and no empty state, while the viewer is unresolved', async () => {
    hass.viewer = { isAdmin: null, name: null, id: null };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    await mount();
    expect(names()).toEqual([]);
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('');
    expect(document.querySelector('[aria-label="List visibility"]')).toBeNull();
  });

  it('is nothing until the document arrives, then the lists it names', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.docMode = 'silent';
    await mount();
    expect(names()).toEqual([]);
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('');
    ha.doc = { visible: { 'todo.husk_hjemme': ['u-kristine'] } };
    ha.docMode = 'answers';
    await act(async () => ha.emitDoc());
    expect(names()).toEqual(['Husk hjemme']);
  });

  it('is a short empty state when nothing is shared with the viewer', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.doc = null;
    await mount();
    expect(names()).toEqual([]);
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('No lists shared with you');
  });

  it('is nothing for a viewer whose lookup failed, which leaves them without an id', async () => {
    hass.viewer = { isAdmin: false, name: null, id: null };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    await mount();
    expect(names()).toEqual([]);
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('No lists shared with you');
  });

  it('says so when the document cannot be read, rather than that nothing is shared', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.docMode = 'refused';
    await mount();
    expect(names()).toEqual([]);
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('Could not load the lists');
  });

  it('is still every list for an administrator when the document cannot be read', async () => {
    ha.docMode = 'refused';
    await mount();
    expect(names()).toEqual(['Husk hjemme', 'Indkøb', 'To-do']);
  });

  it('is a short empty state for an administrator when Home Assistant has no todo list', async () => {
    hass.entities = { 'light.kitchen': entity('light.kitchen', 'Kitchen') };
    await mount();
    expect(document.querySelector('.lists-page-content')?.textContent).toBe('No to-do lists in Home Assistant');
    expect(document.querySelector('[aria-label="List visibility"]')).toBeNull();
  });

  it('follows the viewer: lists appear when the lookup resolves as an administrator', async () => {
    hass.viewer = { isAdmin: null, name: null, id: null };
    await mount();
    expect(names()).toEqual([]);
    hass.viewer = { isAdmin: true, name: 'Mikkel', id: 'u-mikkel' };
    await act(async () => root.render(createElement(ListsPage, { onClose: () => {} })));
    await settle();
    expect(names()).toEqual(['Husk hjemme', 'Indkøb', 'To-do']);
  });

  it('follows a change of who sees what while it is open, and stops following a list that goes', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'], 'todo.husk_hjemme': ['u-kristine'] } };
    await mount();
    expect(names()).toEqual(['Husk hjemme', 'Indkøb']);
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'], 'todo.todo': ['u-kristine'] } };
    await act(async () => ha.emitDoc());
    await settle();
    expect(names()).toEqual(['Indkøb', 'To-do']);
    expect(ha.unsubscribed).toEqual(['todo/item/subscribe:todo.husk_hjemme']);
  });

  it('stops following everything when the page closes', async () => {
    await mount();
    expect(ha.unsubscribed).toEqual([]);
    act(() => root.unmount());
    expect([...ha.unsubscribed].sort()).toEqual([
      'frontend/subscribe_system_data:todo_lists',
      'todo/item/subscribe:todo.husk_hjemme',
      'todo/item/subscribe:todo.indkob',
      'todo/item/subscribe:todo.todo',
    ]);
  });

  it('closes from the button', async () => {
    const onClose = vi.fn();
    await mount(onClose);
    click(document.querySelector('[aria-label="Close lists"]') ?? undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('one list', () => {
  beforeEach(() => {
    ha.setItems('todo.indkob', [
      { uid: 'a', summary: 'Mælk', status: 'needs_action' },
      { uid: 'b', summary: 'Smør', status: 'needs_action' },
      { uid: 'c', summary: 'Kaffe', status: 'completed' },
      { uid: 'd', summary: 'Brød', status: 'completed' },
    ]);
  });

  it('shows the open items and their count, and the done items behind a Done (n) row', async () => {
    await mount();
    const indkob = card('Indkøb');
    expect(rows(indkob)).toEqual(['Mælk', 'Smør']);
    expect(text(indkob.querySelector('.list-count'))).toBe('2');
    expect(text(indkob.querySelector('.list-done-toggle'))).toBe('Done (2)');
    expect(indkob.querySelector('.list-done-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(text(card('Husk hjemme').querySelector('.list-done'))).toBe('');
  });

  it('subscribes to each list it shows, and to nothing it does not', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    await mount();
    const subscribed = ha.sent.filter(message => message.type === 'todo/item/subscribe');
    expect(subscribed).toEqual([{ type: 'todo/item/subscribe', entity_id: 'todo.indkob' }]);
  });

  it('checks an open item off with todo.update_item, and shows it done before Home Assistant has said so', async () => {
    await mount();
    ha.hold = true;
    click(byText(card('Indkøb'), '.list-item', 'Mælk'));
    await settle();
    expect(ha.calls()).toEqual([
      {
        type: 'call_service',
        domain: 'todo',
        service: 'update_item',
        service_data: { item: 'a', status: 'completed' },
        target: { entity_id: 'todo.indkob' },
      },
    ]);
    expect(rows(card('Indkøb'))).toEqual(['Smør']);
    expect(text(card('Indkøb').querySelector('.list-done-toggle'))).toBe('Done (3)');
    ha.hold = false;
    ha.release();
    await settle();
    expect(rows(card('Indkøb'))).toEqual(['Smør']);
    expect(text(card('Indkøb').querySelector('.list-done-toggle'))).toBe('Done (3)');
  });

  it('keeps a quick second check-off in place when the answer to the first arrives alone', async () => {
    await mount();
    ha.hold = true;
    click(byText(card('Indkøb'), '.list-item', 'Mælk'));
    click(byText(card('Indkøb'), '.list-item', 'Smør'));
    await settle();
    expect(rows(card('Indkøb'))).toEqual([]);
    const smør = ha.itemsOf('todo.indkob')[1];
    smør.status = 'needs_action';
    ha.emitItems('todo.indkob');
    await settle();
    expect(rows(card('Indkøb'))).toEqual([]);
    smør.status = 'completed';
    ha.emitItems('todo.indkob');
    await settle();
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(rows(card('Indkøb'))).toEqual([]);
    expect(text(card('Indkøb').querySelector('.list-done-toggle'))).toBe('Done (4)');
  });

  it('puts an item back when Home Assistant refuses the check-off, and says it was not saved', async () => {
    await mount();
    ha.refuse = true;
    click(byText(card('Indkøb'), '.list-item', 'Mælk'));
    await settle();
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
    expect(text(card('Indkøb').querySelector('.list-note.is-error'))).toBe('Not saved. Try again.');
    ha.refuse = false;
    click(byText(card('Indkøb'), '.list-item', 'Mælk'));
    await settle();
    expect(card('Indkøb').querySelector('.list-note.is-error')).toBeNull();
    expect(rows(card('Indkøb'))).toEqual(['Smør']);
  });

  it('lets a check-off go after a while if Home Assistant never confirms it', async () => {
    await mount();
    ha.hold = true;
    click(byText(card('Indkøb'), '.list-item', 'Mælk'));
    await settle();
    expect(rows(card('Indkøb'))).toEqual(['Smør']);
    await act(async () => void (await vi.advanceTimersByTimeAsync(5000)));
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
  });

  it('shows the done items when the row is opened, and takes one back with todo.update_item', async () => {
    await mount();
    click(card('Indkøb').querySelector('.list-done-toggle') ?? undefined);
    expect(card('Indkøb').querySelector('.list-done-toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør', 'Kaffe', 'Brød']);
    const kaffe = byText(card('Indkøb'), '.list-item', 'Kaffe');
    expect(kaffe?.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    click(kaffe);
    await settle();
    expect(ha.calls().at(-1)).toMatchObject({ service: 'update_item', service_data: { item: 'c', status: 'needs_action' } });
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør', 'Kaffe', 'Brød']);
    expect(byText(card('Indkøb'), '.list-item', 'Kaffe')?.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('false');
    expect(text(card('Indkøb').querySelector('.list-count'))).toBe('3');
  });

  it('closes the done items again when the last one is taken back', async () => {
    ha.setItems('todo.indkob', [{ uid: 'c', summary: 'Kaffe', status: 'completed' }]);
    await mount();
    click(card('Indkøb').querySelector('.list-done-toggle') ?? undefined);
    click(byText(card('Indkøb'), '.list-item', 'Kaffe'));
    await settle();
    expect(card('Indkøb').querySelector('.list-done')).toBeNull();
    click(byText(card('Indkøb'), '.list-item', 'Kaffe'));
    await settle();
    expect(card('Indkøb').querySelector('.list-done-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(card('Indkøb').querySelectorAll('.list-items')).toHaveLength(0);
  });

  it('clears the done items with todo.remove_completed_items, and the Done row goes', async () => {
    await mount();
    click(card('Indkøb').querySelector('.list-clear') ?? undefined);
    await settle();
    expect(ha.calls()).toEqual([
      { type: 'call_service', domain: 'todo', service: 'remove_completed_items', service_data: {}, target: { entity_id: 'todo.indkob' } },
    ]);
    expect(card('Indkøb').querySelector('.list-done')).toBeNull();
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
  });

  it('adds the typed item with todo.add_item, empties the field and shows the item', async () => {
    await mount();
    const input = card('Indkøb').querySelector('input') as HTMLInputElement;
    const add = card('Indkøb').querySelector('.list-add-btn') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    type(input, '  Æg  ');
    expect(add.disabled).toBe(false);
    act(() =>
      card('Indkøb')
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await settle();
    expect(ha.calls()).toEqual([
      { type: 'call_service', domain: 'todo', service: 'add_item', service_data: { item: 'Æg' }, target: { entity_id: 'todo.indkob' } },
    ]);
    expect((card('Indkøb').querySelector('input') as HTMLInputElement).value).toBe('');
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør', 'Æg']);
  });

  it('adds nothing for a blank field', async () => {
    await mount();
    type(card('Indkøb').querySelector('input') as HTMLInputElement, '   ');
    act(() =>
      card('Indkøb')
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await settle();
    expect(ha.calls()).toEqual([]);
  });

  it('gives the text back when Home Assistant does not take the item', async () => {
    await mount();
    ha.refuse = true;
    type(card('Indkøb').querySelector('input') as HTMLInputElement, 'Æg');
    act(() =>
      card('Indkøb')
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await settle();
    expect((card('Indkøb').querySelector('input') as HTMLInputElement).value).toBe('Æg');
    expect(text(card('Indkøb').querySelector('.list-note.is-error'))).toBe('Not saved. Try again.');
  });

  it('says so when a list cannot be loaded, and loads it on retry', async () => {
    ha.refuseItems.add('todo.indkob');
    await mount();
    expect(text(card('Indkøb').querySelector('.list-note.is-error'))).toBe('Could not load this list');
    expect(card('Indkøb').querySelector('input')).toBeNull();
    expect(text(card('Husk hjemme').querySelector('.list-note'))).toBe('');
    ha.refuseItems.clear();
    click(card('Indkøb').querySelector('.list-note-btn') ?? undefined);
    await settle();
    expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
  });

  it('leaves the text free to select with a mouse, and checks off from the circle', async () => {
    await mount();
    const melk = byText(card('Indkøb'), '.list-item', 'Mælk') as HTMLElement;
    const span = melk.querySelector('span') as HTMLElement;
    expect(span.closest('button')).toBeNull();
    act(() => void span.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'mouse' })));
    await settle();
    expect(ha.calls()).toEqual([]);
    const circle = melk.querySelector('[role="checkbox"]') as HTMLElement;
    expect(circle.getAttribute('aria-label')).toBe('Mælk');
    act(() => void circle.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'mouse' })));
    await settle();
    expect(ha.calls()).toEqual([expect.objectContaining({ service: 'update_item', service_data: { item: 'a', status: 'completed' } })]);
  });

  it('checks off from a finger on the text', async () => {
    await mount();
    const span = byText(card('Indkøb'), '.list-item', 'Mælk')?.querySelector('span') as HTMLElement;
    act(() => void span.dispatchEvent(new PointerEvent('click', { bubbles: true, pointerType: 'touch' })));
    await settle();
    expect(ha.calls()).toEqual([expect.objectContaining({ service: 'update_item', service_data: { item: 'a', status: 'completed' } })]);
  });

  describe('editing an item', () => {
    const renameCall = (uid: string, summary: string) => ({
      type: 'call_service',
      domain: 'todo',
      service: 'update_item',
      service_data: { item: uid, rename: summary },
      target: { entity_id: 'todo.indkob' },
    });

    const iconOf = (node: Element | undefined) => node?.querySelector('[data-icon]')?.getAttribute('data-icon');

    it('puts a pencil beside every row, open or done, and a tap on the row itself still checks it off', async () => {
      await mount();
      const indkob = card('Indkøb');
      expect(indkob.querySelectorAll('[aria-label="Edit"]')).toHaveLength(2);
      click(indkob.querySelector('.list-done-toggle') ?? undefined);
      expect(indkob.querySelectorAll('[aria-label="Edit"]')).toHaveLength(4);
      expect(iconOf(button(rowOf('Indkøb', 'Mælk'), 'Edit'))).toBe('mdi:pencil-outline');
      expect(indkob.querySelector('button button')).toBeNull();
      click(byText(indkob, '.list-item', 'Mælk'));
      await settle();
      expect(rows(indkob)).toEqual(['Smør', 'Mælk', 'Kaffe', 'Brød']);
      expect(editor('Indkøb')).toBeNull();
    });

    it('turns the row into a field holding its text, focused with the cursor at the end, when the pencil is tapped', async () => {
      await mount();
      edit('Indkøb', 'Mælk');
      const input = field('Indkøb');
      expect(input.value).toBe('Mælk');
      expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
      expect(rows(card('Indkøb'))).toEqual(['Smør']);
      expect(iconOf(button(editor('Indkøb') as HTMLElement, 'Delete'))).toBe('mdi:trash-can-outline');
      expect(iconOf(button(editor('Indkøb') as HTMLElement, 'Save'))).toBe('mdi:check');
      expect(ha.calls()).toEqual([]);
    });

    it('renames with todo.update_item on Enter, and shows the new text before Home Assistant has answered', async () => {
      await mount();
      ha.hold = true;
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), '  Mælk 1 l ');
      submit(editor('Indkøb'));
      await settle();
      expect(ha.calls()).toEqual([renameCall('a', 'Mælk 1 l')]);
      expect(editor('Indkøb')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Mælk 1 l', 'Smør']);
      ha.hold = false;
      ha.release();
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Mælk 1 l', 'Smør']);
      expect(ha.itemsOf('todo.indkob')[0].summary).toBe('Mælk 1 l');
    });

    it('renames from the Save button too', async () => {
      await mount();
      edit('Indkøb', 'Smør');
      type(field('Indkøb'), 'Smør 250 g');
      click(button(editor('Indkøb') as HTMLElement, 'Save'));
      await settle();
      expect(ha.calls()).toEqual([renameCall('b', 'Smør 250 g')]);
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør 250 g']);
    });

    it('renames when the focus leaves the row, and not while it only moves to a button of the row', async () => {
      await mount();
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Mælk 1 l');
      act(() => button(editor('Indkøb') as HTMLElement, 'Delete')?.focus());
      await settle();
      expect(ha.calls()).toEqual([]);
      expect(editor('Indkøb')).not.toBeNull();
      act(() => button(editor('Indkøb') as HTMLElement, 'Delete')?.blur());
      await settle();
      expect(ha.calls()).toEqual([renameCall('a', 'Mælk 1 l')]);
      expect(editor('Indkøb')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Mælk 1 l', 'Smør']);
    });

    it('keeps the focus in the field when Delete or Save is pressed, so the edit does not end before the tap lands', async () => {
      await mount();
      edit('Indkøb', 'Mælk');
      for (const label of ['Copy', 'Delete', 'Save']) {
        const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        act(() => void button(editor('Indkøb') as HTMLElement, label)?.dispatchEvent(down));
        expect(down.defaultPrevented).toBe(true);
      }
    });

    it('copies the text in the field, says so for a moment, and stays in the edit', async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      try {
        await mount();
        edit('Indkøb', 'Mælk');
        type(field('Indkøb'), 'Mælk 1 l');
        click(button(editor('Indkøb') as HTMLElement, 'Copy'));
        await settle();
        expect(writeText).toHaveBeenCalledWith('Mælk 1 l');
        expect(iconOf(button(editor('Indkøb') as HTMLElement, 'Copied'))).toBe('mdi:clipboard-check-outline');
        expect(ha.calls()).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('copies the selected field where the Clipboard API is missing, as on plain http', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
      let selected = '';
      const execCommand = vi.fn(() => {
        const input = document.activeElement as HTMLInputElement;
        selected = input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
        return true;
      });
      Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
      try {
        await mount();
        edit('Indkøb', 'Mælk');
        click(button(editor('Indkøb') as HTMLElement, 'Copy'));
        await settle();
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(selected).toBe('Mælk');
        expect(button(editor('Indkøb') as HTMLElement, 'Copied')).toBeTruthy();
      } finally {
        vi.unstubAllGlobals();
        delete (document as { execCommand?: unknown }).execCommand;
      }
    });

    it('sends nothing on Escape, and the row keeps its text', async () => {
      await mount();
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Something else');
      press(field('Indkøb'), 'Escape');
      await settle();
      expect(ha.calls()).toEqual([]);
      expect(editor('Indkøb')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
      expect(card('Indkøb').querySelector('.list-note.is-error')).toBeNull();
      edit('Indkøb', 'Mælk');
      expect(field('Indkøb').value).toBe('Mælk');
    });

    it('sends nothing for a blank text or the text the item already has', async () => {
      await mount();
      for (const typed of ['   ', 'Mælk', ' Mælk ']) {
        edit('Indkøb', 'Mælk');
        type(field('Indkøb'), typed);
        submit(editor('Indkøb'));
        await settle();
        expect(editor('Indkøb')).toBeNull();
        expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
      }
      expect(ha.calls()).toEqual([]);
      expect(card('Indkøb').querySelector('.list-note.is-error')).toBeNull();
    });

    it('deletes with todo.remove_item, and the row is gone before Home Assistant has answered', async () => {
      await mount();
      ha.hold = true;
      edit('Indkøb', 'Mælk');
      click(button(editor('Indkøb') as HTMLElement, 'Delete'));
      await settle();
      expect(ha.calls()).toEqual([
        {
          type: 'call_service',
          domain: 'todo',
          service: 'remove_item',
          service_data: { item: ['a'] },
          target: { entity_id: 'todo.indkob' },
        },
      ]);
      expect(editor('Indkøb')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Smør']);
      expect(text(card('Indkøb').querySelector('.list-count'))).toBe('1');
      ha.hold = false;
      ha.release();
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Smør']);
      expect(ha.itemsOf('todo.indkob').map(item => item.uid)).toEqual(['b', 'c', 'd']);
    });

    it('puts the old text back and says it was not saved when Home Assistant refuses a rename', async () => {
      await mount();
      ha.refuse = true;
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Mælk 1 l');
      submit(editor('Indkøb'));
      await settle();
      expect(ha.calls()).toEqual([renameCall('a', 'Mælk 1 l')]);
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
      expect(text(card('Indkøb').querySelector('.list-note.is-error'))).toBe('Not saved. Try again.');
      ha.refuse = false;
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Mælk 1 l');
      submit(editor('Indkøb'));
      await settle();
      expect(card('Indkøb').querySelector('.list-note.is-error')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Mælk 1 l', 'Smør']);
    });

    it('brings the row back and says it was not saved when Home Assistant refuses a deletion', async () => {
      await mount();
      ha.refuse = true;
      edit('Indkøb', 'Mælk');
      click(button(editor('Indkøb') as HTMLElement, 'Delete'));
      await settle();
      expect(ha.calls()).toHaveLength(1);
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
      expect(text(card('Indkøb').querySelector('.list-count'))).toBe('2');
      expect(text(card('Indkøb').querySelector('.list-note.is-error'))).toBe('Not saved. Try again.');
      ha.refuse = false;
      edit('Indkøb', 'Mælk');
      click(button(editor('Indkøb') as HTMLElement, 'Delete'));
      await settle();
      expect(card('Indkøb').querySelector('.list-note.is-error')).toBeNull();
      expect(rows(card('Indkøb'))).toEqual(['Smør']);
    });

    it('edits one row of a list at a time', async () => {
      await mount();
      edit('Indkøb', 'Mælk');
      edit('Indkøb', 'Smør');
      expect(card('Indkøb').querySelectorAll('.list-edit')).toHaveLength(1);
      expect(field('Indkøb').value).toBe('Smør');
      expect(rows(card('Indkøb'))).toEqual(['Mælk']);
    });

    it('edits a done row too, and it stays done', async () => {
      await mount();
      click(card('Indkøb').querySelector('.list-done-toggle') ?? undefined);
      edit('Indkøb', 'Kaffe');
      type(field('Indkøb'), 'Kaffe, 1 kg');
      submit(editor('Indkøb'));
      await settle();
      expect(ha.calls()).toEqual([renameCall('c', 'Kaffe, 1 kg')]);
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør', 'Kaffe, 1 kg', 'Brød']);
      expect(byText(card('Indkøb'), '.list-item', 'Kaffe, 1 kg')?.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe(
        'true'
      );
      expect(text(card('Indkøb').querySelector('.list-count'))).toBe('2');
    });

    it('closes the done items when the last of them is deleted', async () => {
      ha.setItems('todo.indkob', [
        { uid: 'a', summary: 'Mælk', status: 'needs_action' },
        { uid: 'c', summary: 'Kaffe', status: 'completed' },
      ]);
      await mount();
      click(card('Indkøb').querySelector('.list-done-toggle') ?? undefined);
      edit('Indkøb', 'Kaffe');
      click(button(editor('Indkøb') as HTMLElement, 'Delete'));
      await settle();
      expect(card('Indkøb').querySelector('.list-done')).toBeNull();
      click(byText(card('Indkøb'), '.list-item', 'Mælk'));
      await settle();
      expect(card('Indkøb').querySelector('.list-done-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(rows(card('Indkøb'))).toEqual([]);
    });

    it('shows the last of two quick renames of one item', async () => {
      await mount();
      ha.hold = true;
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Letmælk');
      submit(editor('Indkøb'));
      edit('Indkøb', 'Letmælk');
      type(field('Indkøb'), 'Sødmælk');
      submit(editor('Indkøb'));
      await settle();
      expect(ha.calls()).toEqual([renameCall('a', 'Letmælk'), renameCall('a', 'Sødmælk')]);
      expect(rows(card('Indkøb'))).toEqual(['Sødmælk', 'Smør']);
      ha.hold = false;
      ha.release();
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Sødmælk', 'Smør']);
    });

    it('believes Home Assistant once it has moved on from the old name, also when it goes back to it', async () => {
      await mount();
      ha.hold = true;
      edit('Indkøb', 'Mælk');
      type(field('Indkøb'), 'Mælk 1 l');
      submit(editor('Indkøb'));
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Mælk 1 l', 'Smør']);
      ha.itemsOf('todo.indkob')[0].summary = 'Letmælk';
      ha.emitItems('todo.indkob');
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Letmælk', 'Smør']);
      ha.itemsOf('todo.indkob')[0].summary = 'Mælk';
      ha.emitItems('todo.indkob');
      await settle();
      expect(rows(card('Indkøb'))).toEqual(['Mælk', 'Smør']);
    });
  });
});

describe('the visibility sheet', () => {
  const openSheet = async () => {
    click(document.querySelector('[aria-label="List visibility"]') ?? undefined);
    await settle();
  };
  const chip = (list: string, user: string) => {
    const row = [...document.querySelectorAll('.lists-vis-row')].find(
      node => text(node.querySelector('.lists-vis-name')) === list
    ) as HTMLElement;
    return byText(row, '.lists-vis-chip', user) as HTMLButtonElement;
  };

  it('opens on document.body, with one row per list and one switch per person or device', async () => {
    await mount();
    await openSheet();
    const sheet = document.querySelector('.lists-sheet') as HTMLElement;
    expect(sheet.parentElement).toBe(document.body);
    expect(ha.sent.filter(message => message.type === 'config/auth/list')).toHaveLength(1);
    expect([...sheet.querySelectorAll('.lists-vis-name')].map(text)).toEqual(['Husk hjemme', 'Indkøb', 'To-do']);
    const row = sheet.querySelector('.lists-vis-row') as HTMLElement;
    expect([...row.querySelectorAll('.lists-vis-chip')].map(text)).toEqual(['Claudia', 'Kristine', 'Tablet']);
    expect(row.querySelector('.lists-vis-chip')?.getAttribute('role')).toBe('switch');
  });

  it('shows who sees a list as it is stored', async () => {
    ha.doc = { visible: { 'todo.indkob': ['u-kristine', 'u-rooftop'] } };
    await mount();
    await openSheet();
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('true');
    expect(chip('Indkøb', 'Tablet').getAttribute('aria-checked')).toBe('true');
    expect(chip('Indkøb', 'Claudia').getAttribute('aria-checked')).toBe('false');
    expect(chip('To-do', 'Kristine').getAttribute('aria-checked')).toBe('false');
  });

  it('writes the whole document when a switch is flipped, and the switch follows', async () => {
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    await mount();
    await openSheet();
    click(chip('To-do', 'Claudia'));
    await settle();
    expect(ha.writes()).toEqual([
      {
        type: 'frontend/set_system_data',
        key: 'todo_lists',
        value: { visible: { 'todo.indkob': ['u-kristine'], 'todo.todo': ['u-claudia'] } },
      },
    ]);
    expect(chip('To-do', 'Claudia').getAttribute('aria-checked')).toBe('true');
    click(chip('Indkøb', 'Kristine'));
    await settle();
    expect(ha.writes().at(-1)).toMatchObject({ value: { visible: { 'todo.todo': ['u-claudia'] } } });
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('false');
  });

  it('shows a flip at once and keeps two quick flips, which Home Assistant answers one after the other', async () => {
    await mount();
    await openSheet();
    ha.hold = true;
    click(chip('Indkøb', 'Kristine'));
    click(chip('Indkøb', 'Claudia'));
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('true');
    expect(chip('Indkøb', 'Claudia').getAttribute('aria-checked')).toBe('true');
    await settle();
    expect(ha.writes().at(-1)).toMatchObject({ value: { visible: { 'todo.indkob': ['u-kristine', 'u-claudia'] } } });
    ha.hold = false;
    ha.release();
    await settle();
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('true');
    expect(chip('Indkøb', 'Claudia').getAttribute('aria-checked')).toBe('true');
  });

  it('does not let the echo of an earlier write undo a flip made since', async () => {
    await mount();
    await openSheet();
    ha.hold = true;
    click(chip('Indkøb', 'Kristine'));
    click(chip('Indkøb', 'Claudia'));
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    act(() => ha.emitDoc());
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('true');
    expect(chip('Indkøb', 'Claudia').getAttribute('aria-checked')).toBe('true');
    ha.doc = { visible: { 'todo.indkob': ['u-kristine', 'u-claudia'] } };
    act(() => ha.emitDoc());
    await settle();
    expect(chip('Indkøb', 'Claudia').getAttribute('aria-checked')).toBe('true');
  });

  it('puts a switch back and says so when Home Assistant refuses the write', async () => {
    await mount();
    await openSheet();
    ha.refuse = true;
    click(chip('Indkøb', 'Kristine'));
    await settle();
    expect(chip('Indkøb', 'Kristine').getAttribute('aria-checked')).toBe('false');
    expect(text(document.querySelector('.lists-vis-note.is-error'))).toBe('Not saved. Try again.');
  });

  it('is not there for anyone but an administrator, and does not ask for the users', async () => {
    hass.viewer = { isAdmin: false, name: 'Kristine', id: 'u-kristine' };
    ha.doc = { visible: { 'todo.indkob': ['u-kristine'] } };
    await mount();
    expect(document.querySelector('.lists-sheet')).toBeNull();
    expect(ha.sent.some(message => message.type === 'config/auth/list')).toBe(false);
  });

  it('says so when Home Assistant refuses to list its users', async () => {
    ha.refuseUsers = true;
    await mount();
    await openSheet();
    expect(document.querySelectorAll('.lists-vis-row')).toHaveLength(0);
    expect(text(document.querySelector('.lists-vis-note.is-error'))).toBe('Could not load who the lists can be shown to');
  });

  it('says there is no one to show the lists to when the only users are the administrator and the service accounts', async () => {
    ha.users = AUTH_USERS.filter(user => ['u-mikkel', 'u-appdaemon', 'u-nodered', 'u-supervisor'].includes(user.id));
    await mount();
    await openSheet();
    expect(document.querySelectorAll('.lists-vis-row')).toHaveLength(0);
    expect(text(document.querySelector('.lists-vis-note'))).toBe('No one else to show the lists to');
  });
});
