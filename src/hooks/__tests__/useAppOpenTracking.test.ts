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

const trackAppOpen = vi.hoisted(() => vi.fn());
const loadedByUpdate = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../utils/trackUiTap', () => ({ trackAppOpen }));
vi.mock('../../utils/updateCheck', () => ({ loadedByUpdate }));

const { useAppOpenTracking } = await import('../useAppOpenTracking');

function Probe() {
  useAppOpenTracking();
  return null;
}

let root: Root;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  trackAppOpen.mockClear();
  loadedByUpdate.mockReset();
  loadedByUpdate.mockReturnValue(false);
  store.setState({ connection: null });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  setVisibility('visible');
  trackAppOpen.mockClear();
});

describe('useAppOpenTracking', () => {
  it('counts an open once the connection is up, not before', async () => {
    await act(async () => root.render(createElement(Probe)));
    expect(trackAppOpen).not.toHaveBeenCalled();
    await act(async () => store.setState({ connection: {} }));
    expect(trackAppOpen).toHaveBeenCalledTimes(1);
  });

  it('counts again each time the page becomes visible, but not when it is hidden', async () => {
    store.setState({ connection: {} });
    await act(async () => root.render(createElement(Probe)));
    expect(trackAppOpen).toHaveBeenCalledTimes(1);
    act(() => setVisibility('hidden'));
    expect(trackAppOpen).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    expect(trackAppOpen).toHaveBeenCalledTimes(2);
  });

  it('does not count the load an update reload brought up, but does count the next visit', async () => {
    loadedByUpdate.mockReturnValue(true);
    store.setState({ connection: {} });
    await act(async () => root.render(createElement(Probe)));
    expect(trackAppOpen).not.toHaveBeenCalled();
    act(() => setVisibility('visible'));
    expect(trackAppOpen).toHaveBeenCalledTimes(1);
  });

  it('stops listening once it is gone', async () => {
    store.setState({ connection: {} });
    await act(async () => root.render(createElement(Probe)));
    act(() => root.unmount());
    trackAppOpen.mockClear();
    act(() => setVisibility('visible'));
    expect(trackAppOpen).not.toHaveBeenCalled();
    root = createRoot(document.body.appendChild(document.createElement('div')));
  });
});
