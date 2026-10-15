// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = vi.hoisted(() => {
  type State = { connection: object | null };
  let state: State = { connection: null };
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

type User = { is_admin: boolean; name: string };
const lookups = vi.hoisted(() => new Map<object, Promise<User>>());
const getUser = vi.hoisted(() => vi.fn());
vi.mock('home-assistant-js-websocket', () => ({ getUser }));

const { useViewer } = await import('../useViewer');

let root: Root;
const seen: Array<boolean | null> = [];

function Probe() {
  seen.push(useViewer().isAdmin);
  return null;
}

beforeEach(() => {
  seen.length = 0;
  lookups.clear();
  getUser.mockReset();
  getUser.mockImplementation((connection: object) => lookups.get(connection));
  store.setState({ connection: null });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const connect = (user: Promise<User>) => {
  const connection = {};
  lookups.set(connection, user);
  act(() => store.setState({ connection }));
  return connection;
};

describe('the viewer of a connection', () => {
  it('is unresolved until the lookup answers, then the answer', async () => {
    let resolve: (user: User) => void = () => {};
    connect(new Promise<User>(done => (resolve = done)));
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBeNull();
    await act(async () => resolve({ is_admin: true, name: 'Admin' }));
    expect(seen.at(-1)).toBe(true);
  });

  it('is false when the lookup fails, which is the restricted view', async () => {
    connect(Promise.reject(new Error('refused')));
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(false);
  });

  it('looks a connection up once, however many components ask', async () => {
    connect(Promise.resolve({ is_admin: true, name: 'Admin' }));
    await act(async () => root.render([createElement(Probe, { key: 'a' }), createElement(Probe, { key: 'b' })]));
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('reads as unresolved on a replacement connection until that connection answers, never as the old viewer', async () => {
    connect(Promise.resolve({ is_admin: true, name: 'Admin' }));
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(true);

    let resolve: (user: User) => void = () => {};
    seen.length = 0;
    connect(new Promise<User>(done => (resolve = done)));
    await act(async () => {});
    expect(seen).not.toContain(true);
    expect(seen.at(-1)).toBeNull();

    await act(async () => resolve({ is_admin: false, name: 'Housemate' }));
    expect(seen.at(-1)).toBe(false);
  });

  it('knows a connection it has already looked up straight away', async () => {
    const first = connect(Promise.resolve({ is_admin: true, name: 'Admin' }));
    await act(async () => root.render(createElement(Probe)));
    connect(Promise.resolve({ is_admin: false, name: 'Other' }));
    await act(async () => {});
    seen.length = 0;
    act(() => store.setState({ connection: first }));
    expect(seen[0]).toBe(true);
  });

  it('has no viewer without a connection', async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBeNull();
  });
});
