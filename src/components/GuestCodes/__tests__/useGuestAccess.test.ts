// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  return {
    useHass: <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
      useSyncExternalStore(store.subscribe, () => selector(store.getState())),
  };
});

const { useGuestAccess } = await import('../useGuestAccess');

const send = vi.fn<(message: { type: string }) => Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const connection = {
  connected: true,
  sendMessagePromise: send,
  addEventListener: (event: string, listener: () => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
  },
  removeEventListener: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
};

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => (resolve = done));
  return { promise, resolve };
}

function Probe() {
  const role = useGuestAccess();
  return role ? createElement('button', { 'data-role': role }, 'Guest codes') : null;
}

let root: Root;
const show = () => act(async () => root.render(createElement(Probe)));
const button = () => document.querySelector<HTMLButtonElement>('button');
const emit = (event: string) => act(async () => listeners.get(event)?.forEach(listener => listener()));

beforeEach(() => {
  send.mockReset();
  listeners.clear();
  connection.connected = true;
  store.setConnection(connection);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setConnection(null);
});

describe('guest role gating', () => {
  it.each(['admin', 'guests'])('shows the entry only after a successful %s response', async role => {
    const reply = deferred();
    send.mockReturnValue(reply.promise);
    await show();
    expect(button()).toBeNull();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'yale_access/me' });
    await act(async () => reply.resolve({ role }));
    expect(button()?.dataset.role).toBe(role);
  });

  it.each([{ role: 'unknown' }, {}, null])('fails closed for an invalid response %j', async reply => {
    send.mockResolvedValue(reply);
    await show();
    expect(button()).toBeNull();
  });

  it.each(['forbidden', 'upstream_unavailable', 'unknown_command'])('fails closed for %s', async code => {
    send.mockRejectedValue({ code, message: 'Synthetic backend failure' });
    await show();
    expect(button()).toBeNull();
  });

  it('removes prior access during reconnect and keeps it hidden if the check fails', async () => {
    send.mockResolvedValueOnce({ role: 'admin' }).mockRejectedValueOnce({ code: 'forbidden' });
    await show();
    expect(button()).not.toBeNull();
    connection.connected = false;
    await emit('disconnected');
    expect(button()).toBeNull();
    connection.connected = true;
    await emit('ready');
    expect(button()).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('ignores an old response after a newer reconnect check', async () => {
    const first = deferred();
    const second = deferred();
    send.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await show();
    await emit('ready');
    await act(async () => second.resolve({ role: 'guests' }));
    expect(button()?.dataset.role).toBe('guests');
    await act(async () => first.resolve({ role: 'admin' }));
    expect(button()?.dataset.role).toBe('guests');
  });

  it('does not reuse authorization when the connection changes', async () => {
    send.mockResolvedValueOnce({ role: 'admin' });
    await show();
    expect(button()).not.toBeNull();
    const pending = deferred();
    send.mockReturnValueOnce(pending.promise);
    await act(async () => store.setConnection({ ...connection }));
    expect(button()).toBeNull();
    await act(async () => pending.resolve({ role: 'guests' }));
    expect(button()?.dataset.role).toBe('guests');
  });

  it('does not ask an absent or disconnected connection for a role', async () => {
    store.setConnection(null);
    await show();
    connection.connected = false;
    await act(async () => store.setConnection(connection));
    expect(button()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
