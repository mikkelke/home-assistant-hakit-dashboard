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

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useHass: <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState())),
  };
});
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});
vi.mock('../../../hooks', () => ({
  useViewer: () => ({ name: null, id: null, isAdmin: false }),
  useModalBackButton: () => ({ requestClose: vi.fn() }),
  useSwipeToClose: () => ({}),
}));
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => ({}) }));
vi.mock('../../../hooks/useApartmentLock', () => ({
  useApartmentLock: () => ({
    present: true,
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
vi.mock('../../Intercom', () => ({ IntercomCard: () => null }));
vi.mock('../../MediaPlayer', () => ({ PHONE_PLAYER_NAME: 'Phone', PhonePlayer: () => null, SonosPlayer: () => null, TVCard: () => null }));

const { QuickAccess } = await import('../../QuickAccess/QuickAccess');
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
const showDoors = async () => {
  await act(async () => root.render(createElement(QuickAccess, { hassUrl: null, callService: vi.fn(), onOpenNow: vi.fn() })));
  await act(async () => document.querySelector<HTMLButtonElement>('[title="Access"]')!.click());
};

beforeEach(() => {
  send.mockReset();
  events.clear();
  connection.connected = true;
  store.setConnection(connection);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setConnection(null);
});

describe('Quick Access guest codes entry', () => {
  it.each(['admin', 'guests'])('shows the action beside the apartment lock for %s', async role => {
    send.mockResolvedValue({ role });
    await showDoors();
    expect(document.querySelector('.qa-door.is-lock')).not.toBeNull();
    expect(guestEntry()).not.toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'yale_access/me' });
  });

  it.each(['forbidden', 'unknown_command', 'upstream_unavailable'])('hides the action when me fails with %s', async code => {
    send.mockRejectedValue({ code, message: 'Synthetic role failure' });
    await showDoors();
    expect(guestEntry()).toBeNull();
  });

  it('hides the action while the role is unresolved and after a disconnect', async () => {
    let resolve!: (reply: unknown) => void;
    send.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    await showDoors();
    expect(guestEntry()).toBeNull();
    await act(async () => resolve({ role: 'admin' }));
    expect(guestEntry()).not.toBeNull();
    connection.connected = false;
    await act(async () => events.get('disconnected')?.forEach(listener => listener()));
    expect(guestEntry()).toBeNull();
  });
});
