// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  (globalThis as { __APP_BUILD_VERSION__?: string }).__APP_BUILD_VERSION__ = 'test';
});

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { entities: Record<string, unknown>; hassUrl: string; connection: object };
  let state: State = { entities: {}, hassUrl: '', connection: {} };
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
vi.mock('../../FireSafety', () => ({ SmokeAlarmSheet: () => null }));

type User = { is_admin: boolean; name: string };
/** The pending HA user lookup; a new `connection` object makes the next menu look it up again. */
const lookup = vi.hoisted(() => ({ current: Promise.resolve({ is_admin: true, name: 'Mikkel' }) as Promise<User> }));
vi.mock('home-assistant-js-websocket', () => ({ getUser: () => lookup.current }));

const { Menu } = await import('../Menu');

let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

async function openMenu(user: Promise<User>) {
  lookup.current = user;
  store.setState({ connection: {} });
  await act(async () => {
    root.render(createElement(Menu, { isOpen: true, onClose: () => {}, entities: {} }));
  });
}

const entries = () => [...document.querySelectorAll('.menu-item')].map(item => item.textContent);

describe('the battery overview entry', () => {
  it('is in the menu for an admin', async () => {
    await openMenu(Promise.resolve({ is_admin: true, name: 'Mikkel' }));
    expect(entries()).toContain('Batteries');
  });

  it('is not in the menu for a housemate', async () => {
    await openMenu(Promise.resolve({ is_admin: false, name: 'Kristine' }));
    expect(entries()).not.toContain('Batteries');
    expect(entries()).toContain('Energy');
    expect(document.querySelectorAll('.menu-divider')).toHaveLength(1);
  });

  it('stays out while the viewer is still loading and appears once an admin resolves', async () => {
    let resolve: (user: User) => void = () => {};
    await openMenu(new Promise<User>(done => (resolve = done)));
    expect(entries()).not.toContain('Batteries');
    await act(async () => resolve({ is_admin: true, name: 'Mikkel' }));
    expect(entries()).toContain('Batteries');
  });
});

describe('the sensor map entry', () => {
  it('is in the menu for an admin, after the batteries', async () => {
    await openMenu(Promise.resolve({ is_admin: true, name: 'Mikkel' }));
    expect(entries()).toContain('Map');
    expect(entries().indexOf('Map')).toBeGreaterThan(entries().indexOf('Batteries'));
  });

  it('is not in the menu for a housemate, or while the viewer is still loading', async () => {
    await openMenu(Promise.resolve({ is_admin: false, name: 'Kristine' }));
    expect(entries()).not.toContain('Map');
    let resolve: (user: User) => void = () => {};
    await openMenu(new Promise<User>(done => (resolve = done)));
    expect(entries()).not.toContain('Map');
    await act(async () => resolve({ is_admin: true, name: 'Mikkel' }));
    expect(entries()).toContain('Map');
  });

  it('closes the menu and opens the map when tapped', async () => {
    const onClose = vi.fn();
    const onOpenMap = vi.fn();
    lookup.current = Promise.resolve({ is_admin: true, name: 'Mikkel' });
    store.setState({ connection: {} });
    await act(async () => {
      root.render(createElement(Menu, { isOpen: true, onClose, entities: {}, onOpenMap }));
    });
    const item = [...document.querySelectorAll('.menu-item')].find(node => node.textContent === 'Map') as HTMLElement;
    act(() => item.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenMap).toHaveBeenCalledTimes(1);
  });
});
