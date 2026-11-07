// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_RESET_MS } from '../../../hooks/useIdleReset';
import { ROUTE_ADOPTED_EVENT } from '../../../utils/navigation';

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

const world = vi.hoisted(() => ({ entities: {} as Record<string, unknown>, coffee: null as { phase: string } | null, sheetOpen: false }));
const closeSheet = vi.hoisted(() => vi.fn());

vi.mock('@hakit/core', async () => {
  const { useSyncExternalStore } = await import('react');
  const useHass = <T>(selector: (state: ReturnType<typeof store.getState>) => T): T =>
    useSyncExternalStore(store.subscribe, () => selector(store.getState()));
  return { useHass: Object.assign(useHass, store) };
});
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => world.entities }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useRoomDetailOverlay: () => true }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ name: null, isAdmin: false, id: null }) }));
vi.mock('../../../coffee/useCoffeeState', async importOriginal => ({
  ...(await importOriginal<object>()),
  useCoffeeState: () => world.coffee,
}));
vi.mock('../../Home/HomeHeader', () => ({
  HomeHeader: ({ onMenu }: { onMenu: () => void }) => createElement('button', { id: 'menu-toggle', onClick: onMenu }),
}));
vi.mock('../../Home/MotionConditions', () => ({ MotionConditions: () => null }));
vi.mock('../../Home/PulseRow', () => ({ PulseRow: () => null }));
vi.mock('../../HomePulse', () => ({ HomePulse: () => null }));
vi.mock('../../RoomGrid', () => ({ RoomGrid: () => null }));
vi.mock('../../FireSafety', () => ({ FireAlarmTakeover: () => null }));
vi.mock('../../QuickAccess/QuickAccess', async () => {
  const { createElement: h } = await import('react');
  const { useModalBackButton } = await import('../../../hooks/useModalBackButton');
  return {
    QuickAccess: () => {
      useModalBackButton({ isOpen: world.sheetOpen, onRequestClose: closeSheet, historyKey: 'quick-access-media' });
      return h('div', { id: 'quick-access' });
    },
  };
});
vi.mock('../../RoomDetail', () => ({ RoomDetail: () => createElement('div', { id: 'room-detail' }) }));
vi.mock('../../Now', () => ({ NowView: () => createElement('div', { id: 'now-view' }) }));
vi.mock('../../Energy', () => ({ EnergyPage: () => createElement('div', { id: 'energy-page' }) }));
vi.mock('../../SensorMap', () => ({ SensorMapPage: () => createElement('div', { id: 'sensor-map' }) }));
vi.mock('../../Heating/HeatingPage', () => ({ HeatingPage: () => createElement('div', { id: 'heating-page' }) }));
vi.mock('../../Lists/ListsPage', () => ({ ListsPage: (): ReactNode => createElement('div', { id: 'lists-page' }) }));
vi.mock('../../Coffee/CoffeeStage', () => ({ default: (): ReactNode => createElement('div', { id: 'coffee-stage' }) }));
vi.mock('../../Menu', () => ({
  Menu: ({ isOpen }: { isOpen: boolean }) => createElement('div', { id: 'menu', 'data-open': String(isOpen) }),
}));

const { Dashboard } = await import('../Dashboard');

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState(null, '', '/dashboard');
  world.entities = {};
  world.coffee = null;
  world.sheetOpen = false;
  closeSheet.mockClear();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const render = () => act(async () => root.render(createElement(Dashboard)));
const pastIdle = () => advance(IDLE_RESET_MS + 1_000);

async function mountAt(hash = '') {
  window.history.replaceState(null, '', `/dashboard${hash}`);
  await render();
  await advance(700);
}

const has = (selector: string) => document.querySelector(selector) !== null;
const touch = () => act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
const wakeSession = (state: string) => ({ 'sensor.wake_alarm_session': { entity_id: 'sensor.wake_alarm_session', state, attributes: {} } });

describe('the idle reset', () => {
  it.each([
    ['a room', '#room=kitchen', '#room-detail'],
    ['Energy', '#energy', '#energy-page'],
    ['Heating', '#heating', '#heating-page'],
    ['Lists', '#lists', '#lists-page'],
    ['the timeline', '#now', '#now-view'],
    ['the coffee stage', '#coffee', '#coffee-stage'],
  ])('closes %s after three idle minutes and replaces its entry with the bare Home URL', async (_name, hash, selector) => {
    await mountAt(hash);
    expect(has(selector)).toBe(true);
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    await pastIdle();
    expect(has(selector)).toBe(false);
    expect(has('#quick-access')).toBe(true);
    expect(window.location.hash).toBe('');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('closes the menu', async () => {
    await mountAt();
    act(() => (document.querySelector('#menu-toggle') as HTMLElement).click());
    expect(document.querySelector('#menu')?.getAttribute('data-open')).toBe('true');
    await pastIdle();
    expect(document.querySelector('#menu')?.getAttribute('data-open')).toBe('false');
  });

  it('closes an open sheet in place, without going back', async () => {
    world.sheetOpen = true;
    await mountAt();
    const back = vi.spyOn(window.history, 'back');
    const adopted = vi.fn();
    window.addEventListener(ROUTE_ADOPTED_EVENT, adopted);
    await pastIdle();
    window.removeEventListener(ROUTE_ADOPTED_EVENT, adopted);
    expect(adopted).toHaveBeenCalledTimes(1);
    expect(closeSheet).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('leaves history alone on Home', async () => {
    await mountAt();
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    await advance(10 * IDLE_RESET_MS);
    expect(has('#quick-access')).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('waits three minutes after the last touch', async () => {
    await mountAt('#lists');
    await advance(2 * 60_000);
    touch();
    await advance(2 * 60_000);
    expect(has('#lists-page')).toBe(true);
    await advance(60_000 + 1_000);
    expect(has('#lists-page')).toBe(false);
  });

  it('leaves the sensor map alone, with its drafts', async () => {
    await mountAt('#map');
    await advance(10 * IDLE_RESET_MS);
    expect(has('#sensor-map')).toBe(true);
    expect(window.location.hash).toBe('#map');
  });

  it('leaves the coffee stage alone while a brew is running or waiting, and closes it once the machine rests', async () => {
    world.coffee = { phase: 'brewing' };
    await mountAt('#coffee');
    await advance(10 * IDLE_RESET_MS);
    expect(has('#coffee-stage')).toBe(true);
    world.coffee = { phase: 'awaiting_cup' };
    await render();
    await advance(IDLE_RESET_MS);
    expect(has('#coffee-stage')).toBe(true);
    world.coffee = { phase: 'idle' };
    await render();
    await pastIdle();
    expect(has('#coffee-stage')).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('does not let a brew keep the Kitchen open', async () => {
    world.coffee = { phase: 'brewing' };
    await mountAt('#room=kitchen');
    await pastIdle();
    expect(has('#room-detail')).toBe(false);
  });

  it('leaves everything alone while a wake alarm session rings or snoozes', async () => {
    world.entities = wakeSession('ringing');
    await mountAt('#lists');
    await advance(10 * IDLE_RESET_MS);
    expect(has('#lists-page')).toBe(true);
    world.entities = wakeSession('snoozing');
    await render();
    await advance(IDLE_RESET_MS);
    expect(has('#lists-page')).toBe(true);
    world.entities = wakeSession('dismissed');
    await render();
    await pastIdle();
    expect(has('#lists-page')).toBe(false);
  });

  it('leaves everything alone while a text field has focus', async () => {
    const field = document.body.appendChild(document.createElement('input'));
    await mountAt('#lists');
    field.focus();
    await advance(10 * IDLE_RESET_MS);
    expect(has('#lists-page')).toBe(true);
    field.blur();
    await pastIdle();
    expect(has('#lists-page')).toBe(false);
  });
});

describe('a dashboard that comes back to the foreground', () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
  };
  afterEach(() => setVisibility('visible'));

  it('is back on Home as soon as it shows, when it was untouched for more than three minutes', async () => {
    await mountAt('#lists');
    setVisibility('hidden');
    vi.setSystemTime(Date.now() + IDLE_RESET_MS + 1);
    expect(has('#lists-page')).toBe(true);
    setVisibility('visible');
    await advance(0);
    expect(has('#lists-page')).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('keeps the page when it was away for less', async () => {
    await mountAt('#lists');
    setVisibility('hidden');
    vi.setSystemTime(Date.now() + IDLE_RESET_MS - 5_000);
    setVisibility('visible');
    await advance(0);
    expect(has('#lists-page')).toBe(true);
  });

  it('lets a link that arrived meanwhile win, and counts from its arrival', async () => {
    await mountAt();
    setVisibility('hidden');
    window.history.replaceState(null, '', '/dashboard#lists');
    vi.setSystemTime(Date.now() + IDLE_RESET_MS + 1);
    setVisibility('visible');
    expect(has('#lists-page')).toBe(false);
    await advance(600);
    expect(has('#lists-page')).toBe(true);
    expect(window.location.hash).toBe('#lists');
    await advance(IDLE_RESET_MS - 1_000);
    expect(has('#lists-page')).toBe(true);
    await advance(2_000);
    expect(has('#lists-page')).toBe(false);
    expect(window.location.hash).toBe('');
  });
});
