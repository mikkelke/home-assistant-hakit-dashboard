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
vi.mock('../../Now', () => ({ NowView: () => createElement('div', { id: 'now-view' }) }));
vi.mock('../../Energy', () => ({ EnergyPage: () => createElement('div', { id: 'energy-page' }) }));
vi.mock('../../SensorMap', () => ({ SensorMapPage: () => createElement('div', { id: 'sensor-map' }) }));
vi.mock('../../Heating/HeatingPage', () => ({ HeatingPage: () => createElement('div', { id: 'heating-page' }) }));
vi.mock('../../Menu', () => ({
  Menu: ({ onOpenLists, onOpenEnergy }: { onOpenLists?: () => void; onOpenEnergy?: () => void }) =>
    createElement(
      'div',
      null,
      createElement('button', { id: 'open-lists', onClick: onOpenLists }),
      createElement('button', { id: 'open-energy', onClick: onOpenEnergy })
    ),
}));

const lists = vi.hoisted(() => ({ props: null as { onClose: () => void } | null }));
vi.mock('../../Lists/ListsPage', () => ({
  ListsPage: (props: { onClose: () => void }): ReactNode => {
    lists.props = props;
    return createElement('div', { id: 'lists-page' });
  },
}));

const { Dashboard } = await import('../Dashboard');

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/dashboard-rooftop/home');
  lists.props = null;
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

describe('the #lists route', () => {
  it('opens the page for a cold #lists link, as a push would, and hides the quick access bar', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#lists');
    await mount();
    expect(has('#lists-page')).toBe(true);
    expect(has('#quick-access')).toBe(false);
  });

  it('shows the grid, not the page, for a link without a hash', async () => {
    await mount();
    expect(has('#lists-page')).toBe(false);
    expect(has('#quick-access')).toBe(true);
  });

  it('pushes exactly one history entry when opened from the menu', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await mount();
    act(() => (document.querySelector('#open-lists') as HTMLElement).click());
    await settle();
    expect(has('#lists-page')).toBe(true);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#lists');
    expect(window.history.state).toMatchObject({ lists: true });
  });

  it('closes by replacing the entry, clearing the hash, and the grid shows again', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#lists');
    await mount();
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    act(() => lists.props?.onClose());
    await settle();
    expect(has('#lists-page')).toBe(false);
    expect(has('#quick-access')).toBe(true);
    expect(window.location.hash).toBe('');
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('follows Back: leaving the #lists entry closes the page', async () => {
    await mount();
    act(() => (document.querySelector('#open-lists') as HTMLElement).click());
    await settle();
    expect(has('#lists-page')).toBe(true);
    window.history.replaceState(null, '', '/dashboard-rooftop/home');
    await settle();
    expect(has('#lists-page')).toBe(false);
  });

  it('swaps with the other pages rather than stacking on them', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#lists');
    await mount();
    for (const [hash, id] of [
      ['#energy', '#energy-page'],
      ['#heating', '#heating-page'],
      ['#map', '#sensor-map'],
    ] as const) {
      window.history.replaceState(null, '', `/dashboard-rooftop/home${hash}`);
      await settle();
      expect(has('#lists-page')).toBe(false);
      expect(has(id)).toBe(true);
      window.history.replaceState(null, '', '/dashboard-rooftop/home#lists');
      await settle();
      expect(has('#lists-page')).toBe(true);
      expect(has(id)).toBe(false);
    }
  });

  it('gives way to the timeline when a #now link arrives', async () => {
    window.history.replaceState(null, '', '/dashboard-rooftop/home#lists');
    await mount();
    window.history.replaceState(null, '', '/dashboard-rooftop/home#now=washer-1791881730');
    await settle();
    expect(has('#lists-page')).toBe(false);
    expect(has('#now-view')).toBe(true);
  });

  it('does not touch how Energy opens', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await mount();
    act(() => (document.querySelector('#open-energy') as HTMLElement).click());
    await settle();
    expect(has('#energy-page')).toBe(true);
    expect(has('#lists-page')).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#energy');
  });
});
