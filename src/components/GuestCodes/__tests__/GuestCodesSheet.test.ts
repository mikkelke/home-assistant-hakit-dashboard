// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GuestRole, GuestUser } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  let connection: object | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ connection }),
    setConnection(value: object | null) {
      connection = value;
      listeners.forEach(listener => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return {
    useHass: Object.assign(useHass, { getState: store.getState }),
  };
});
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});

const { GuestCodesSheet } = await import('../GuestCodesSheet');
const { useSwipeToClose } = await import('../../../hooks/useSwipeToClose');

type Message = { type: string; [key: string]: unknown };
const row = (patch: Partial<GuestUser> = {}): GuestUser => ({
  user_id: 'synthetic-guest',
  name: 'Test guest',
  slot: null,
  kind: 'always',
  from: null,
  to: null,
  status: 'active',
  last_use: null,
  created_by: null,
  ...patch,
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let root: Root;
let users: GuestUser[];
let pin: string;
let pinLength: number | undefined;
let own: GuestUser | null;
const send = vi.fn<(message: Message) => Promise<unknown>>();
const onClose = vi.fn();
const copy = vi.fn();
const share = vi.fn();

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const button = (label: string) =>
  buttons()
    .filter(element => element.textContent?.trim() === label || element.getAttribute('aria-label') === label)
    .at(-1);
const tap = async (element: Element | null | undefined) => {
  expect(element).toBeTruthy();
  await act(async () => (element as HTMLElement).click());
};
const input = (label: string) =>
  document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ??
  [...document.querySelectorAll('label')]
    .find(element => element.textContent?.trim().startsWith(label))
    ?.querySelector<HTMLInputElement>('input');
const enter = async (label: string, value: string) => {
  const field = input(label);
  expect(field).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field!.dispatchEvent(new Event('input', { bubbles: true }));
    field!.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const open = (role: GuestRole = 'guests') => act(async () => root.render(createElement(GuestCodesSheet, { role, onClose })));
const newGuest = async () => {
  await tap(button('New guest'));
  await enter('Name', 'Test guest');
};
const create = async () => {
  await newGuest();
  await tap(button('Create guest'));
};
const sent = (type: string) => send.mock.calls.filter(([message]) => message.type === type).map(([message]) => message);
const text = () => document.body.textContent ?? '';
const openDetail = () => tap(document.querySelector('.gc-row button'));
const topDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;

beforeEach(() => {
  pin = String(Math.floor(Math.random() * 900_000) + 100_000);
  users = [];
  pinLength = undefined;
  own = null;
  copy.mockReset().mockResolvedValue(undefined);
  share.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  send.mockReset().mockImplementation(async message => {
    switch (message.type) {
      case 'yale_access/me':
        return { role: 'admin', pin_length: pinLength, own };
      case 'yale_access/pin':
        return { pin };
      case 'yale_access/set_pin':
        return { user: message.user_id === own?.user_id ? own : row() };
      case 'yale_access/users':
        return { users };
      case 'yale_access/create':
        return { user: row(), pin: message.pin ?? pin };
      case 'yale_access/set_validity':
        return { user: row({ kind: 'temporary', from: message.from as string, to: message.to as string }) };
      case 'yale_access/end':
        return { ok: true };
      default:
        throw new Error('Unexpected synthetic command');
    }
  });
  store.setConnection({ connected: true, sendMessagePromise: send });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  onClose.mockReset().mockImplementation(() => root.render(null));
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new Event('modalBackButton', { cancelable: true }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setConnection(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('guest list', () => {
  it('reserves the header and gives the body the remaining height for scrolling', async () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/index.css', 'utf8') + readFileSync('src/components/GuestCodes/GuestCodes.css', 'utf8');
    document.head.appendChild(style);
    try {
      await open('admin');
      expect(getComputedStyle(button('Close')!).position).toBe('relative');
      const header = getComputedStyle(document.querySelector('.gc-head')!);
      const body = getComputedStyle(document.querySelector('.gc-body')!);
      expect(header.flexShrink).toBe('0');
      expect(body.flexGrow).toBe('1');
      expect(body.flexShrink).toBe('1');
      expect(body.minHeight).toBe('0');
      expect(body.overflowY).toBe('auto');
      expect(body.touchAction).toBe('pan-y');
    } finally {
      style.remove();
    }
  });

  it('keeps New guest before a long owner list and opens the editor', async () => {
    users = Array.from({ length: 40 }, (_, index) => row({ user_id: `synthetic-${index}`, name: `Guest ${index}` }));
    await open('admin');
    const body = document.querySelector('.gc-body')!;
    expect(body.firstElementChild?.className).toBe('gc-toolbar');
    expect(body.firstElementChild?.contains(button('New guest')!)).toBe(true);
    expect(document.querySelectorAll('.gc-row')).toHaveLength(40);
    expect(document.querySelector('[role="dialog"]')?.closest('[inert]')).toBeNull();
    await tap(button('New guest'));
    expect(input('Name')).toBeTruthy();
  });

  it('allows a vertical touch on the list without cancelling scrolling or closing', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    users = [row()];
    await open('admin');
    const target = document.querySelector('.gc-row-name')!;
    const touch = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const points = [{ clientX, clientY }];
      Object.defineProperties(event, { touches: { value: points }, changedTouches: { value: points } });
      return event;
    };
    const move = touch('touchmove', 105, 200);
    await act(async () => {
      target.dispatchEvent(touch('touchstart', 100, 500));
      target.dispatchEvent(move);
      target.dispatchEvent(touch('touchend', 105, 200));
    });
    expect(move.defaultPrevented).toBe(false);
    expect(window.history.back).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await tap(button('New guest'));
    expect(input('Name')).toBeTruthy();
  });

  it('closes with a swipe that the modal it was opened from does not see', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(max-width: 768px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const modalClose = vi.fn();
    function Modal() {
      const { handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeToClose(modalClose);
      return createElement(
        'div',
        { onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleTouchEnd },
        createElement(GuestCodesSheet, { role: 'admin', onClose })
      );
    }
    await act(async () => root.render(createElement(Modal)));
    const touch = (type: string, clientX: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const points = [{ clientX, clientY: 300 }];
      Object.defineProperties(event, { touches: { value: points }, changedTouches: { value: points } });
      return event;
    };
    const target = document.querySelector('.gc-head h2')!;
    await act(async () => {
      target.dispatchEvent(touch('touchstart', 300));
      target.dispatchEvent(touch('touchmove', 100));
      target.dispatchEvent(touch('touchend', 100));
    });
    expect(window.history.back).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modalClose).not.toHaveBeenCalled();
  });

  it.each([
    ['admin', 'Door codes'],
    ['guests', 'Door codes'],
  ] as const)('titles the %s list %s', async (role, title) => {
    await open(role);
    expect(text()).toContain(title);
    expect(sent('yale_access/users')).toEqual([{ type: 'yale_access/users' }]);
  });

  it('separates expired guests into a collapsed group and shows validity, status, last use and creator', async () => {
    users = [
      row({ created_by: 'Test creator', last_use: '2026-10-12T10:00:00Z' }),
      row({
        user_id: 'synthetic-expired',
        name: 'Expired guest',
        kind: 'temporary',
        from: '2026-10-01T10:00:00Z',
        to: '2026-10-02T10:00:00Z',
        status: 'expired',
      }),
      row({ user_id: 'synthetic-recurring', name: 'Recurring guest', kind: 'recurring', status: 'scheduled' }),
      row({ user_id: 'synthetic-pending', name: 'Pending guest', status: 'pending' }),
      row({ user_id: 'synthetic-failed', name: 'Failed guest', status: 'failed' }),
    ];
    await open('admin');
    const expired = document.querySelector('details')!;
    expect(expired.open).toBe(false);
    expect(expired.textContent).toContain('Expired guest');
    expect([...document.querySelectorAll('.gc-row')].filter(element => !element.closest('details'))).toHaveLength(4);
    for (const value of ['Always', 'Recurring', 'scheduled', 'pending', 'failed', 'never used']) {
      expect(text().toLowerCase()).toContain(value.toLowerCase());
    }
    expect(document.querySelector('.gc-status--active')).toBeNull();
    expect(text()).not.toContain('Test creator');
    await openDetail();
    expect(topDialog().textContent).toContain('Created by');
    expect(topDialog().textContent).toContain('Test creator');
  });

  it('omits creator metadata from a guests-role list', async () => {
    users = [row({ created_by: 'Test creator' })];
    await open();
    expect(text()).not.toContain('Test creator');
  });
});

describe('my code', () => {
  it.each(['admin', 'guests'] as const)('hides the card when %s has no own user', async role => {
    await open(role);
    expect(document.querySelector('[aria-label="My code"]')).toBeNull();
    expect(button('Show code')).toBeUndefined();
    expect(button('Change code')).toBeUndefined();
  });

  it.each(['admin', 'guests'] as const)('reveals and copies the %s own code above the toolbar without guest actions', async role => {
    own = row({ user_id: 'synthetic-own', name: 'Test resident' });
    users = [own, row()];
    pinLength = 4;
    pin = '0123';
    await open(role);
    const card = document.querySelector('[aria-label="My code"]')!;
    expect(document.querySelector('.gc-body')!.firstElementChild).toBe(card);
    expect(card.nextElementSibling?.className).toBe('gc-toolbar');
    expect(card.querySelector('[aria-label="Code hidden"]')?.textContent).toBe('••••');
    expect(sent('yale_access/me')).toEqual([{ type: 'yale_access/me' }]);
    expect(sent('yale_access/pin')).toEqual([]);
    expect(document.querySelectorAll('.gc-row')).toHaveLength(1);
    expect(button('View Test resident')).toBeUndefined();
    expect(button('End access')).toBeUndefined();
    expect(button('Change period')).toBeUndefined();
    await tap(button('Show code'));
    expect(sent('yale_access/pin')).toEqual([{ type: 'yale_access/pin', user_id: 'synthetic-own' }]);
    expect(card.textContent).toContain(pin);
    expect(button('Share')).toBeUndefined();
    expect(copy).not.toHaveBeenCalled();
    await tap(button('Copy'));
    expect(copy).toHaveBeenCalledExactlyOnceWith(pin);
    await tap(button('Close'));
    await open(role);
    expect(text()).not.toContain(pin);
    expect(button('Copy')).toBeUndefined();
  });

  it.each(['admin', 'guests'] as const)('changes the %s own code and refreshes own settings', async role => {
    own = row({ user_id: 'synthetic-own', name: 'Test resident', protected: true });
    pinLength = 4;
    await open(role);
    await tap(button('Show code'));
    await tap(button('Change code'));
    expect(text()).not.toContain(pin);
    expect(topDialog().getAttribute('aria-label')).toBe('Change code');
    expect(input('Code')!.pattern).toBe('[0-9]{4}');
    expect(button('Change period')).toBeUndefined();
    expect(button('End access')).toBeUndefined();
    await enter('Code', '0012');
    own = { ...own, name: 'Updated resident' };
    await tap(button('Save code'));
    expect(sent('yale_access/set_pin')).toEqual([{ type: 'yale_access/set_pin', user_id: 'synthetic-own', pin: '0012' }]);
    expect(sent('yale_access/me')).toHaveLength(2);
    expect(topDialog().getAttribute('aria-label')).toBe('My code');
    expect(topDialog().textContent).toContain('0012');
    expect(button('Share')).toBeUndefined();
    await tap(button('Done'));
    expect(text()).not.toContain('0012');
    expect(text()).not.toContain(pin);
    await tap(button('Change code'));
    expect(topDialog().textContent).toContain('Updated resident');
  });

  it('discards a late own reveal after closing and reopening the sheet', async () => {
    own = row({ user_id: 'synthetic-own' });
    await open();
    const pending = deferred();
    send.mockReturnValueOnce(pending.promise);
    await tap(button('Show code'));
    await tap(button('Close'));
    await open();
    await act(async () => pending.resolve({ pin }));
    expect(text()).not.toContain(pin);
    expect(button('Copy')).toBeUndefined();
    expect(button('Show code')?.disabled).toBe(false);
  });

  it('shows an own reveal error and allows retrying', async () => {
    own = row({ user_id: 'synthetic-own' });
    await open();
    send.mockRejectedValueOnce({ message: 'Could not load your code. Try again.' });
    await tap(button('Show code'));
    expect(document.querySelector('[aria-label="My code"] [role="alert"]')?.textContent).toBe('Could not load your code. Try again.');
    await tap(button('Show code'));
    expect(text()).toContain(pin);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('discards a late own reveal when changing the code and permits a fresh reveal', async () => {
    own = row({ user_id: 'synthetic-own' });
    await open();
    const pending = deferred();
    send.mockReturnValueOnce(pending.promise);
    await tap(button('Show code'));
    await tap(button('Change code'));
    await act(async () => pending.resolve({ pin }));
    expect(text()).not.toContain(pin);
    await tap(button('Close'));
    expect(text()).not.toContain(pin);
    await tap(button('Show code'));
    expect(sent('yale_access/pin')).toHaveLength(2);
    expect(text()).toContain(pin);
  });

  it('removes guest detail actions when delayed settings identify the selected user as own', async () => {
    own = row({ user_id: 'synthetic-own' });
    users = [own];
    const pending = deferred();
    const original = send.getMockImplementation()!;
    send.mockImplementation(message => (message.type === 'yale_access/me' ? pending.promise : original(message)));
    await open('admin');
    await openDetail();
    await act(async () => pending.resolve({ pin_length: 6, own }));
    expect(button('End access')).toBeUndefined();
    expect(button('Change period')).toBeUndefined();
    expect(document.querySelectorAll('.gc-row')).toHaveLength(0);
  });
});

describe('one-time guest PIN', () => {
  it('hides Always for the guests role and creates with from/to', async () => {
    await open('guests');
    await newGuest();
    expect(text()).not.toContain('Always');
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(input('From')).toBeTruthy();
    expect(input('To')).toBeTruthy();
    await enter('From', '2026-07-15T12:00');
    await enter('To', '2026-07-16T12:00');
    await tap(button('Create guest'));
    expect(sent('yale_access/create')).toEqual([
      {
        type: 'yale_access/create',
        name: 'Test guest',
        from: '2026-07-15T10:00:00.000Z',
        to: '2026-07-16T10:00:00.000Z',
      },
    ]);
  });

  it('shows progress without a second create request, then shows the PIN and only copies or shares on a tap', async () => {
    const pending = deferred();
    send.mockImplementation(async message => (message.type === 'yale_access/create' ? pending.promise : { users }));
    await open();
    await create();
    expect(text()).toContain('Creating');
    expect(text()).not.toContain('3 minutes');
    expect(sent('yale_access/create')).toHaveLength(1);
    expect(copy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ user: row(), pin }));
    expect(text()).toContain(pin);
    expect(text()).not.toContain('Always');
    await tap(button('Copy'));
    expect(copy).toHaveBeenCalledOnce();
    expect(copy.mock.calls[0][0]).toContain(pin);
    await tap(button('Share'));
    expect(share).toHaveBeenCalledOnce();
    expect(JSON.stringify(share.mock.calls[0])).toContain(pin);
  });

  it('clears the PIN on Done, starts a fresh form, and never writes it to browser storage', async () => {
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    const localWrite = vi.fn();
    const sessionWrite = vi.fn();
    vi.stubGlobal('localStorage', { setItem: localWrite, getItem: () => null });
    vi.stubGlobal('sessionStorage', { setItem: sessionWrite, getItem: () => null });
    await open();
    await create();
    expect(text()).toContain(pin);
    await tap(button('Done'));
    expect(text()).not.toContain(pin);
    await newGuest();
    expect(text()).not.toContain(pin);
    expect(input('Name')?.value).toBe('Test guest');
    expect(JSON.stringify(persist.mock.calls)).not.toContain(pin);
    expect(persist).not.toHaveBeenCalled();
    expect(localWrite).not.toHaveBeenCalled();
    expect(sessionWrite).not.toHaveBeenCalled();
  });

  it('discards the PIN when the sheet is closed and reopened', async () => {
    await open();
    await create();
    expect(text()).toContain(pin);
    await tap(button('Close'));
    expect(document.body.textContent).not.toContain(pin);
    await open();
    expect(text()).not.toContain(pin);
    expect(button('Copy')).toBeUndefined();
  });

  it('does not show a late create response after the view has closed', async () => {
    const pending = deferred();
    send.mockImplementation(async message => (message.type === 'yale_access/create' ? pending.promise : { users }));
    await open();
    await create();
    await tap(button('Close'));
    await open();
    await act(async () => pending.resolve({ user: row(), pin }));
    expect(text()).not.toContain(pin);
    expect(button('Copy')).toBeUndefined();
  });

  it('shows a pending backend message verbatim without retrying creation', async () => {
    const message = 'The change is pending. Check the user list; do not create the guest again';
    send.mockImplementation(async command => {
      if (command.type === 'yale_access/create') throw { code: 'pending', message };
      return { users };
    });
    await open();
    await create();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(sent('yale_access/create')).toHaveLength(1);
    expect(button('Copy')).toBeUndefined();
  });

  it.each(['malformed', 'pending'])('does not display a PIN from a %s success response', async outcome => {
    send.mockImplementation(async command =>
      command.type === 'yale_access/create' ? { pin, ...(outcome === 'pending' ? { user: row({ status: 'pending' }) } : {}) } : { users }
    );
    await open();
    await create();
    expect(text()).not.toContain(pin);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(button('Copy')).toBeUndefined();
  });

  it('creates and ends access with StrictMode effect replay enabled', async () => {
    users = [row()];
    await act(async () => root.render(createElement(StrictMode, null, createElement(GuestCodesSheet, { role: 'admin', onClose }))));
    await create();
    expect(text()).toContain(pin);
    expect(sent('yale_access/create')).toHaveLength(1);
    await tap(button('Done'));
    await openDetail();
    await tap(button('End access'));
    await tap(button('End access'));
    expect(sent('yale_access/end')).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('.gc-row')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])('keeps keyboard focus inside the editor after create %s', async outcome => {
    const pending = deferred();
    send.mockImplementation(async command => (command.type === 'yale_access/create' ? pending.promise : { users }));
    await open();
    await newGuest();
    const submit = button('Create guest')!;
    submit.focus();
    await tap(submit);
    await act(async () => {
      if (outcome === 'success') pending.resolve({ user: row(), pin });
      else pending.reject({ code: 'pending', message: 'Synthetic pending message' });
    });
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    const last = button('Done')!;
    last.focus();
    await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    const first = dialog.querySelector('button')!;
    expect(document.activeElement).toBe(first);
    await act(async () =>
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    );
    expect(document.activeElement).toBe(last);
  });

  it('skips fields disabled by the period fieldset when trapping focus during creation', async () => {
    const pending = deferred();
    send.mockImplementation(async command => (command.type === 'yale_access/create' ? pending.promise : { users }));
    await open('admin');
    await newGuest();
    await tap(button('From–to'));
    await tap(button('Create guest'));
    const disabledField = input('To')!;
    const focusDisabled = vi.spyOn(disabledField, 'focus');
    const first = topDialog().querySelector<HTMLButtonElement>('button')!;
    first.focus();
    await act(async () =>
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    );
    expect(focusDisabled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button('Close'));
  });
});

describe('guest row actions', () => {
  it.each(['admin', 'guests'] as const)('opens protected users without mutation actions for %s', async role => {
    users = [row({ protected: true })];
    await open(role);
    const listRow = document.querySelector('.gc-row')!;
    expect(listRow.querySelectorAll('button')).toHaveLength(1);
    await openDetail();
    expect(topDialog().textContent).toContain('Protected');
    expect(button('Change code')).toBeUndefined();
    expect(button('Change period')).toBeUndefined();
    expect(button('End access')).toBeUndefined();
  });

  it('sends a changed period as Copenhagen instants and refreshes the list', async () => {
    users = [row()];
    await open('admin');
    await openDetail();
    await tap(button('Change period'));
    await tap(button('From–to'));
    await enter('From', '2026-07-15T12:00');
    await enter('To', '2026-07-16T12:00');
    await tap(button('Save period'));
    expect(sent('yale_access/set_validity')).toEqual([
      {
        type: 'yale_access/set_validity',
        user_id: 'synthetic-guest',
        from: '2026-07-15T10:00:00.000Z',
        to: '2026-07-16T10:00:00.000Z',
      },
    ]);
    expect(sent('yale_access/users').length).toBeGreaterThan(1);
    expect(window.history.back).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects an inverted period before sending a command', async () => {
    users = [row({ kind: 'temporary', from: '2026-07-15T10:00:00Z', to: '2026-07-16T10:00:00Z' })];
    await open();
    await openDetail();
    await tap(button('Change period'));
    await enter('To', '2026-07-14T12:00');
    await tap(button('Save period'));
    expect(sent('yale_access/set_validity')).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('after');
  });

  it('keeps recurring schedules read-only while allowing access to be ended', async () => {
    users = [row({ kind: 'recurring' })];
    await open();
    await openDetail();
    expect(button('Change period')?.disabled).toBe(true);
    expect(button('End access')?.disabled).toBe(false);
  });

  it('confirms ending access by name and warns admins that the lock code is removed', async () => {
    users = [row()];
    await open('admin');
    await openDetail();
    await tap(button('End access'));
    expect(sent('yale_access/end')).toEqual([]);
    expect(text()).toContain('End access for Test guest?');
    expect(text()).toContain('This removes their code from the lock.');
    await tap(button('End access'));
    expect(sent('yale_access/end')).toEqual([{ type: 'yale_access/end', user_id: 'synthetic-guest' }]);
    expect(window.history.back).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('surfaces backend mutation errors verbatim and does not send while offline', async () => {
    users = [row()];
    await open();
    await openDetail();
    await tap(button('End access'));
    const message = 'Synthetic backend refusal: access could not be ended';
    send.mockRejectedValueOnce({ code: 'request_failed', message });
    await tap(button('End access'));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(message);
    await act(async () => store.setConnection({ connected: false, sendMessagePromise: send }));
    await tap(button('End access'));
    expect(sent('yale_access/end')).toHaveLength(1);
  });

  it('uses Escape and browser back to close the top view before the list', async () => {
    await open();
    await newGuest();
    const editor = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(input('Name')).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event('modalBackButton', { cancelable: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('guest details and chosen codes', () => {
  it('opens a compact row with a hidden code and fetches only after Show code', async () => {
    users = [row({ created_by: 'Test creator' })];
    await open('admin');
    const listRow = document.querySelector('.gc-row')!;
    expect(listRow.querySelectorAll('button')).toHaveLength(1);
    expect(listRow.textContent).toContain('Always · never used');
    expect(button('Change period')).toBeUndefined();
    await openDetail();
    expect(topDialog().textContent).toContain('••••••');
    expect(sent('yale_access/pin')).toEqual([]);
    expect(text()).not.toContain(pin);
    await tap(button('Show code'));
    expect(sent('yale_access/pin')).toEqual([{ type: 'yale_access/pin', user_id: 'synthetic-guest' }]);
    expect(topDialog().textContent).toContain(pin);
    await tap(button('Copy'));
    expect(copy).toHaveBeenCalledExactlyOnceWith(pin);
    await tap(button('Share'));
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Door code', text: `Door code: ${pin}\nValid Always` });
    await tap(button('Close'));
    expect(text()).not.toContain(pin);
    await openDetail();
    expect(topDialog().textContent).toContain('••••••');
    expect(text()).not.toContain(pin);
  });

  it('discards a late PIN fetch after closing the detail', async () => {
    users = [row()];
    const pending = deferred();
    const original = send.getMockImplementation()!;
    send.mockImplementation(message => (message.type === 'yale_access/pin' ? pending.promise : original(message)));
    await open('admin');
    await openDetail();
    await tap(button('Show code'));
    await tap(button('Close'));
    await openDetail();
    await act(async () => pending.resolve({ pin }));
    expect(text()).not.toContain(pin);
  });

  it('discards a late reveal while changing a code and permits a fresh reveal afterward', async () => {
    users = [row()];
    const pending = deferred();
    await open('admin');
    await openDetail();
    send.mockReturnValueOnce(pending.promise);
    await tap(button('Show code'));
    await tap(button('Change code'));
    await enter('Code', '001234');
    await tap(button('Save code'));
    await act(async () => pending.resolve({ pin }));
    expect(text()).not.toContain(pin);
    await tap(button('Done'));
    expect(text()).not.toContain(pin);
    await tap(button('Show code'));
    expect(sent('yale_access/pin')).toHaveLength(2);
    expect(topDialog().textContent).toContain(pin);
  });

  it('shows PIN errors and lets the user retry', async () => {
    users = [row()];
    await open('admin');
    await openDetail();
    send.mockRejectedValueOnce({ message: 'Could not load the code. Try again.' });
    await tap(button('Show code'));
    expect(topDialog().textContent).toContain('Could not load the code. Try again.');
    await tap(button('Show code'));
    expect(topDialog().textContent).toContain(pin);
  });

  it('changes a code preserving leading zeroes, then copies and shares the new code', async () => {
    users = [row()];
    await open('admin');
    await openDetail();
    await tap(button('Show code'));
    await tap(button('Change code'));
    expect(text()).not.toContain(pin);
    await enter('Code', '001234');
    await tap(button('Save code'));
    expect(sent('yale_access/set_pin')).toEqual([{ type: 'yale_access/set_pin', user_id: 'synthetic-guest', pin: '001234' }]);
    expect(topDialog().textContent).toContain('001234');
    await tap(button('Copy'));
    expect(copy).toHaveBeenCalledExactlyOnceWith('001234');
    await tap(button('Share'));
    expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Door code', text: 'Door code: 001234\nValid Always' });
    await tap(button('Done'));
    expect(text()).not.toContain('001234');
    expect(text()).not.toContain(pin);
    expect(topDialog().textContent).toContain('••••••');
  });

  it.each(['', '001234'])('includes the optional create PIN only when filled: %j', async code => {
    await open('admin');
    await newGuest();
    if (code) await enter('Code', code);
    await tap(button('Create guest'));
    const request = sent('yale_access/create')[0];
    expect(request).toEqual({ type: 'yale_access/create', name: 'Test guest', ...(code ? { pin: code } : {}) });
    expect(Object.hasOwn(request, 'pin')).toBe(Boolean(code));
  });

  it.each(['create', 'change'] as const)('validates %s codes against pin_length rather than six', async mode => {
    pinLength = 4;
    users = [row()];
    await open('admin');
    if (mode === 'create') await newGuest();
    else {
      await openDetail();
      await tap(button('Change code'));
    }
    const code = input('Code')!;
    expect(code.inputMode).toBe('numeric');
    expect(code.autocomplete).toBe('off');
    expect(code.pattern).toBe('[0-9]{4}');
    expect(code.required).toBe(mode === 'change');
    for (const invalid of ['123', '123456', '12a4', '１２３４']) {
      await enter('Code', invalid);
      expect(code.checkValidity()).toBe(false);
      await act(async () => code.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(sent(mode === 'create' ? 'yale_access/create' : 'yale_access/set_pin')).toEqual([]);
    }
    await enter('Code', '0123');
    await tap(button(mode === 'create' ? 'Create guest' : 'Save code'));
    expect(sent(mode === 'create' ? 'yale_access/create' : 'yale_access/set_pin')[0].pin).toBe('0123');
    expect(topDialog().textContent).toContain('0123');
  });

  it('uses six digits when pin_length is missing and Random fills a valid code', async () => {
    users = [row()];
    await open('admin');
    await openDetail();
    await tap(button('Change code'));
    expect(input('Code')!.pattern).toBe('[0-9]{6}');
    await tap(button('Random'));
    expect(input('Code')!.value).toMatch(/^[0-9]{6}$/);
    await tap(button('Save code'));
    expect(sent('yale_access/set_pin')).toHaveLength(1);
  });

  it('keeps Always out of every guests-role screen', async () => {
    users = [row()];
    await open('guests');
    expect(text()).not.toContain('Always');
    await openDetail();
    expect(text()).not.toContain('Always');
    await tap(button('Change period'));
    expect(text()).not.toContain('Always');
    expect(button('Always')).toBeUndefined();
    expect(input('From')).toBeTruthy();
    await tap(button('Close'));
    await tap(button('Change code'));
    expect(text()).not.toContain('Always');
    await enter('Code', '123456');
    await tap(button('Save code'));
    expect(text()).not.toContain('Always');
  });
});
