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
vi.mock('../../RoomDetail', () => ({
  RoomDetail: ({ area, onOpenCoffee }: { area: { area_id: string }; onOpenCoffee?: () => void }) =>
    createElement(
      'div',
      { id: 'room-detail', 'data-area': area.area_id },
      createElement('button', { id: 'open-coffee', onClick: onOpenCoffee })
    ),
}));
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

const stage = vi.hoisted(() => ({ props: null as { onClose: () => void } | null }));
vi.mock('../../Coffee/CoffeeStage', () => ({
  default: (props: { onClose: () => void }): ReactNode => {
    stage.props = props;
    return createElement('div', { id: 'coffee-stage' });
  },
}));
vi.mock('../../SensorMap', () => ({ SensorMapPage: () => createElement('div', { id: 'sensor-map' }) }));

const { Dashboard } = await import('../Dashboard');

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/dashboard');
  stage.props = null;
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

describe('the #coffee route', () => {
  it('opens the stage for a cold #coffee link and hides the quick access bar while it is open', async () => {
    window.history.replaceState(null, '', '/dashboard#coffee');
    await mount();
    expect(has('#coffee-stage')).toBe(true);
    expect(has('#quick-access')).toBe(false);
  });

  it('opens it for the tablet wake link too', async () => {
    window.history.replaceState(null, '', '/dashboard#coffee&takeover=c1792991000');
    await mount();
    expect(has('#coffee-stage')).toBe(true);
  });

  it('opens over the Kitchen as one entry, and its back button returns there', async () => {
    window.history.replaceState(null, '', '/dashboard#room=kitchen');
    await mount();
    expect(document.querySelector('#room-detail')?.getAttribute('data-area')).toBe('kitchen');
    const push = vi.spyOn(window.history, 'pushState');
    act(() => (document.querySelector('#open-coffee') as HTMLElement).click());
    await settle();
    expect(has('#coffee-stage')).toBe(true);
    expect(has('#room-detail')).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#coffee');
    expect(window.history.state).toMatchObject({ coffee: true, coffeeOverKitchen: true });
    const back = vi.spyOn(window.history, 'back');
    act(() => stage.props?.onClose());
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('closes a cold link onto the Kitchen by replacing the entry', async () => {
    window.history.replaceState(null, '', '/dashboard#coffee');
    await mount();
    const push = vi.spyOn(window.history, 'pushState');
    act(() => stage.props?.onClose());
    await settle();
    expect(has('#coffee-stage')).toBe(false);
    expect(window.location.hash).toBe('#room=kitchen');
    expect(document.querySelector('#room-detail')?.getAttribute('data-area')).toBe('kitchen');
    expect(push).not.toHaveBeenCalled();
  });

  it('follows Back: leaving the #coffee entry closes the stage', async () => {
    window.history.replaceState(null, '', '/dashboard#room=kitchen');
    await mount();
    act(() => (document.querySelector('#open-coffee') as HTMLElement).click());
    await settle();
    expect(has('#coffee-stage')).toBe(true);
    window.history.replaceState(null, '', '/dashboard#room=kitchen');
    await settle();
    expect(has('#coffee-stage')).toBe(false);
    expect(has('#room-detail')).toBe(true);
  });

  it('swaps with the map and Energy rather than stacking on them', async () => {
    window.history.replaceState(null, '', '/dashboard#coffee');
    await mount();
    window.history.replaceState(null, '', '/dashboard#energy');
    await settle();
    expect(has('#coffee-stage')).toBe(false);
    expect(has('#energy-page')).toBe(true);
    window.history.replaceState(null, '', '/dashboard#coffee');
    await settle();
    expect(has('#coffee-stage')).toBe(true);
    expect(has('#energy-page')).toBe(false);
    window.history.replaceState(null, '', '/dashboard#map');
    await settle();
    expect(has('#coffee-stage')).toBe(false);
    expect(has('#sensor-map')).toBe(true);
  });
});
