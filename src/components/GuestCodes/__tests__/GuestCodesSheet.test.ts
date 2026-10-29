// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  await tap(button('Create guest'));
  await enter('Name', 'Test guest');
};
const create = async () => {
  await newGuest();
  await tap(button('Create guest'));
};
const sent = (type: string) => send.mock.calls.filter(([message]) => message.type === type).map(([message]) => message);
const text = () => document.body.textContent ?? '';

beforeEach(() => {
  pin = String(Math.floor(Math.random() * 900_000) + 100_000);
  users = [];
  copy.mockReset().mockResolvedValue(undefined);
  share.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  send.mockReset().mockImplementation(async message => {
    switch (message.type) {
      case 'yale_access/users':
        return { users };
      case 'yale_access/create':
        return { user: row(), pin };
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
  it.each([
    ['admin', 'Lock users'],
    ['guests', 'My guests'],
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
    for (const value of ['Always', 'Recurring', 'active', 'scheduled', 'pending', 'failed', 'used 12.10', 'never used', 'Test creator']) {
      expect(text().toLowerCase()).toContain(value.toLowerCase());
    }
    expect(text()).toContain('01.10 12:00–02.10 12:00');
  });

  it('omits creator metadata from a guests-role list', async () => {
    users = [row({ created_by: 'Test creator' })];
    await open();
    expect(text()).not.toContain('Test creator');
  });
});

describe('one-time guest PIN', () => {
  it('shows progress without a second create request, then shows the PIN and only copies or shares on a tap', async () => {
    const pending = deferred();
    send.mockImplementation(async message => (message.type === 'yale_access/create' ? pending.promise : { users }));
    await open();
    await create();
    expect(text()).toContain('Creating');
    expect(text()).toContain('3 minutes');
    expect(sent('yale_access/create')).toHaveLength(1);
    expect(copy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ user: row(), pin }));
    expect(text()).toContain(pin);
    expect(text()).toContain('Always');
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
    await tap(button('End access'));
    await tap(button('End access'));
    expect(sent('yale_access/end')).toHaveLength(1);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
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
    expect(document.activeElement).toBe(button('Close'));
    await act(async () =>
      button('Close')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    );
    expect(document.activeElement).toBe(last);
  });

  it('skips fields disabled by the period fieldset when trapping focus during creation', async () => {
    const pending = deferred();
    send.mockImplementation(async command => (command.type === 'yale_access/create' ? pending.promise : { users }));
    await open();
    await newGuest();
    await tap(
      [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
        element => element.closest('label')?.textContent === 'From–to'
      )
    );
    await tap(button('Create guest'));
    const disabledField = input('To')!;
    const focusDisabled = vi.spyOn(disabledField, 'focus');
    const close = button('Close')!;
    close.focus();
    await act(async () =>
      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    );
    expect(focusDisabled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(close);
  });
});

describe('guest row actions', () => {
  it('sends a changed period as Copenhagen instants and refreshes the list', async () => {
    users = [row()];
    await open();
    await tap(button('Change period'));
    const timed = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find(
      element => element.closest('label')?.textContent === 'From–to'
    );
    await tap(timed);
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
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects an inverted period before sending a command', async () => {
    users = [row({ kind: 'temporary', from: '2026-07-15T10:00:00Z', to: '2026-07-16T10:00:00Z' })];
    await open();
    await tap(button('Change period'));
    await enter('To', '2026-07-14T12:00');
    await tap(button('Save period'));
    expect(sent('yale_access/set_validity')).toEqual([]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('after');
  });

  it('keeps recurring schedules read-only while allowing access to be ended', async () => {
    users = [row({ kind: 'recurring' })];
    await open();
    expect(button('Change period')?.disabled).toBe(true);
    expect(button('End access')?.disabled).toBe(false);
  });

  it('confirms ending access by name and warns admins that the lock code is removed', async () => {
    users = [row()];
    await open('admin');
    await tap(button('End access'));
    expect(sent('yale_access/end')).toEqual([]);
    expect(text()).toContain('End access for Test guest?');
    expect(text()).toContain('This removes their code from the lock.');
    await tap(button('End access'));
    expect(sent('yale_access/end')).toEqual([{ type: 'yale_access/end', user_id: 'synthetic-guest' }]);
    expect(window.history.back).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it('surfaces backend mutation errors verbatim and does not send while offline', async () => {
    users = [row()];
    await open();
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
