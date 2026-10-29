// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  let connection: object | null = null;
  const listeners = new Set<() => void>();
  return {
    getState: () => ({ connection, entities: {} as Record<string, undefined> }),
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
const lock = vi.hoisted(() => ({ present: true }));

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, { getState: store.getState }) };
});
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});
vi.mock('../../../hooks', async () => {
  const { useState } = await import('react');
  return {
    useViewer: () => ({ name: null, id: null, isAdmin: false }),
    useModalBackButton: ({ onRequestClose }: { onRequestClose: () => void }) => ({ requestClose: onRequestClose }),
    useSwipeToClose: () => ({}),
    useLocalStorageBoolean: (_key: string, initial: boolean) => useState(initial),
    useTouchScrollSlopGuard: () => ({ consumeBlockClick: () => false }),
  };
});
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => ({}) }));
vi.mock('../../../hooks/useApartmentLock', () => ({
  useApartmentLock: () => ({
    present: lock.present,
    state: 'locked',
    disabled: false,
    pending: false,
    error: null,
    actionLabel: 'Unlock the apartment',
    icon: 'mdi:lock',
    send: vi.fn(),
  }),
}));
vi.mock('../../../utils/trackUiTap', () => ({ trackUiTap: vi.fn() }));
vi.mock('../../../utils/idle', () => ({ onIdle: () => () => {} }));
vi.mock('../../Request', () => ({
  RequestSheet: () => null,
  RequestTile: () => null,
  useRequestAccess: () => ({ allowed: false, drtv: false }),
}));
vi.mock('../../Intercom/doorbellArchive', () => ({ fetchDoorbellIndex: () => Promise.resolve([]), formatRingTime: () => '' }));
vi.mock('../../MediaPlayer', () => ({ PHONE_PLAYER_NAME: 'Phone', PhonePlayer: () => null, SonosPlayer: () => null, TVCard: () => null }));

const { QuickAccess } = await import('../../QuickAccess/QuickAccess');
const { IntercomCard } = await import('../../Intercom/IntercomCard');
const send = vi.fn<(message: { type: string }) => Promise<unknown>>();
const events = new Map<string, Set<() => void>>();
const connection = {
  connected: true,
  sendMessagePromise: send,
  addEventListener: (event: string, listener: () => void) => {
    if (!events.has(event)) events.set(event, new Set());
    events.get(event)!.add(listener);
  },
  removeEventListener: (event: string, listener: () => void) => events.get(event)?.delete(listener),
};

let root: Root;
const guestEntry = () => document.querySelector<HTMLButtonElement>('[aria-label="Guest codes"]');
const showCard = async (showHeader = false) => {
  await act(async () => root.render(createElement(IntercomCard, { entities: {}, callService: vi.fn(), showHeader })));
  if (showHeader) await act(async () => document.querySelector<HTMLElement>('.access-top')!.click());
};

beforeEach(() => {
  send.mockReset();
  events.clear();
  lock.present = true;
  connection.connected = true;
  store.setConnection(connection);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setConnection(null);
});

describe('Access card guest codes entry', () => {
  it.each([
    ['admin', true],
    ['guests', true],
    ['admin', false],
    ['guests', false],
  ] as const)('opens the lazy %s sheet from the card with showHeader=%s', async (role, showHeader) => {
    send.mockImplementation(async message => (message.type === 'yale_access/me' ? { role } : { users: [] }));
    await showCard(showHeader);
    expect(guestEntry()).not.toBeNull();
    expect(guestEntry()!.closest('.access-row')?.previousElementSibling?.textContent).toContain('Apartment');
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'yale_access/me' });
    expect(document.querySelector('.gc-sheet')).toBeNull();
    await act(async () => guestEntry()!.click());
    await vi.waitFor(() => expect(document.querySelector('.gc-sheet')).not.toBeNull());
    const sheet = document.querySelector('.gc-sheet')!;
    expect(sheet.getAttribute('aria-label')).toBe(role === 'admin' ? 'Lock users' : 'My guests');
    expect(sheet.closest('.rq-overlay')?.parentElement).toBe(document.body);
    await act(async () => sheet.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    expect(document.querySelector('.gc-sheet')).toBeNull();
    expect(guestEntry()).not.toBeNull();
  });

  it.each(['forbidden', 'unknown_command', 'upstream_unavailable'])('hides the action when me fails with %s', async code => {
    send.mockRejectedValue({ code, message: 'Synthetic role failure' });
    await showCard();
    expect(guestEntry()).toBeNull();
  });

  it('hides the action while the role is unresolved and after a disconnect', async () => {
    let resolve!: (reply: unknown) => void;
    send.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    await showCard();
    expect(guestEntry()).toBeNull();
    await act(async () => resolve({ role: 'admin' }));
    expect(guestEntry()).not.toBeNull();
    connection.connected = false;
    await act(async () => events.get('disconnected')?.forEach(listener => listener()));
    expect(guestEntry()).toBeNull();
  });

  it('hides the action when the apartment lock is absent', async () => {
    lock.present = false;
    send.mockResolvedValue({ role: 'admin' });
    await showCard();
    expect(guestEntry()).toBeNull();
  });

  it('does not bubble sheet touches into an ancestor modal swipe handler', async () => {
    send.mockImplementation(async message => (message.type === 'yale_access/me' ? { role: 'admin' } : { users: [] }));
    const ancestorTouch = vi.fn();
    await act(async () =>
      root.render(
        createElement(
          'div',
          { onTouchStart: ancestorTouch, onTouchMove: ancestorTouch, onTouchEnd: ancestorTouch },
          createElement(IntercomCard, { entities: {}, callService: vi.fn() })
        )
      )
    );
    await act(async () => guestEntry()!.click());
    await vi.waitFor(() => expect(document.querySelector('.gc-sheet')).not.toBeNull());
    await act(async () => {
      for (const type of ['touchstart', 'touchmove', 'touchend']) {
        document.querySelector('.gc-body')!.dispatchEvent(new Event(type, { bubbles: true }));
      }
    });
    expect(ancestorTouch).not.toHaveBeenCalled();
  });

  it('keeps the doors popup free of guest codes and opens them from the access panel', async () => {
    send.mockImplementation(async message => (message.type === 'yale_access/me' ? { role: 'admin' } : { users: [] }));
    await act(async () => root.render(createElement(QuickAccess, { hassUrl: null, callService: vi.fn(), onOpenNow: vi.fn() })));
    await act(async () => document.querySelector<HTMLButtonElement>('[title="Access"]')!.click());
    expect(document.querySelector('.qa-door.is-lock')).not.toBeNull();
    expect(guestEntry()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Open the access panel"]')!.click());
    expect(document.querySelector('.qa-doors')).toBeNull();
    expect(document.querySelector('.qa-modal.intercom')).not.toBeNull();
    expect(guestEntry()).not.toBeNull();
    await act(async () => guestEntry()!.click());
    await vi.waitFor(() => expect(document.querySelector('.gc-sheet')).not.toBeNull());
    expect(document.querySelector('.qa-modal.intercom')).not.toBeNull();
  });
});
