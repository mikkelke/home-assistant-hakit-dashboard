// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  (globalThis as { __APP_BUILD_VERSION__?: string }).__APP_BUILD_VERSION__ = 'test';
});

const store = vi.hoisted(() => {
  type State = { areas: Record<string, { area_id: string; name: string }>; hassUrl: string; helpers: { callService: () => void } };
  const state: State = {
    areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
    hassUrl: '',
    helpers: { callService: () => {} },
  };
  const listeners = new Set<(state: State) => void>();
  return {
    getState: () => state,
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
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => ({}) }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => true }));
vi.mock('../../Home/HomeHeader', () => ({ HomeHeader: () => null }));
vi.mock('../../Home/MotionConditions', () => ({ MotionConditions: () => null }));
vi.mock('../../Home/PulseRow', () => ({ PulseRow: () => null }));
vi.mock('../../HomePulse', () => ({ HomePulse: () => null }));
vi.mock('../../RoomGrid', () => ({ RoomGrid: () => null }));
vi.mock('../../FireSafety', () => ({ FireAlarmTakeover: () => null }));
vi.mock('../../QuickAccess/QuickAccess', () => ({ QuickAccess: () => createElement('div', { id: 'quick-access' }) }));
vi.mock('../../RoomDetail', () => ({ RoomDetail: () => null }));
vi.mock('../../Now', () => ({ NowView: () => null }));
vi.mock('../../Energy', () => ({ EnergyPage: () => createElement('div', { id: 'energy-page' }) }));
vi.mock('../../Menu', () => ({
  Menu: ({ onOpenMap, onOpenEnergy }: { onOpenMap?: () => void; onOpenEnergy?: () => void }) =>
    createElement(
      'div',
      null,
      createElement('button', { id: 'open-map', onClick: onOpenMap }),
      createElement('button', { id: 'open-energy', onClick: onOpenEnergy })
    ),
}));

const page = vi.hoisted(() => ({ props: null as { onClose: () => void } | null }));
vi.mock('../../SensorMap', () => ({
  SensorMapPage: (props: { onClose: () => void }): ReactNode => {
    page.props = props;
    return createElement('div', { id: 'sensor-map' });
  },
}));

const { Dashboard } = await import('../Dashboard');

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/dashboard');
  page.props = null;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
};

async function mount() {
  await act(async () => root.render(createElement(Dashboard)));
  await settle();
}

const has = (selector: string) => document.querySelector(selector) !== null;

describe('the #map route', () => {
  it('opens the page for a cold #map link and hides the quick access bar while it is open', async () => {
    window.history.replaceState(null, '', '/dashboard#map');
    await mount();
    expect(has('#sensor-map')).toBe(true);
    expect(has('#quick-access')).toBe(false);
  });

  it('shows the grid, not the page, for a link without a hash', async () => {
    await mount();
    expect(has('#sensor-map')).toBe(false);
    expect(has('#quick-access')).toBe(true);
  });

  it('pushes exactly one history entry when opened from the menu', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await mount();
    act(() => (document.querySelector('#open-map') as HTMLElement).click());
    await settle();
    expect(has('#sensor-map')).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#map');
    expect(window.history.state).toMatchObject({ map: true });
  });

  it('closes by replacing the entry, clearing the hash, and the grid shows again', async () => {
    window.history.replaceState(null, '', '/dashboard#map');
    await mount();
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => page.props?.onClose());
    await settle();
    expect(has('#sensor-map')).toBe(false);
    expect(has('#quick-access')).toBe(true);
    expect(window.location.hash).toBe('');
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('follows Back: leaving the #map entry closes the page', async () => {
    await mount();
    act(() => (document.querySelector('#open-map') as HTMLElement).click());
    await settle();
    expect(has('#sensor-map')).toBe(true);
    window.history.replaceState(null, '', '/dashboard');
    await settle();
    expect(has('#sensor-map')).toBe(false);
  });

  it('swaps with Energy rather than stacking on it', async () => {
    window.history.replaceState(null, '', '/dashboard#map');
    await mount();
    expect(has('#sensor-map')).toBe(true);
    window.history.replaceState(null, '', '/dashboard#energy');
    await settle();
    expect(has('#sensor-map')).toBe(false);
    expect(has('#energy-page')).toBe(true);
    window.history.replaceState(null, '', '/dashboard#map');
    await settle();
    expect(has('#sensor-map')).toBe(true);
    expect(has('#energy-page')).toBe(false);
  });

  it('opens Energy and closes it the way it always did', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await mount();
    act(() => (document.querySelector('#open-energy') as HTMLElement).click());
    await settle();
    expect(has('#energy-page')).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#energy');
    expect(window.history.state).toMatchObject({ energy: true });
  });
});
