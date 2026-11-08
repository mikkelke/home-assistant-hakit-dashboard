// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCookState, type CookState } from '../../../cook/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.hoisted(() => {
  (globalThis as { __APP_BUILD_VERSION__?: string }).__APP_BUILD_VERSION__ = 'test';
});
const world = vi.hoisted(() => ({
  cook: null as CookState | null,
  coffee: null as { phase: string; source?: string; brewId?: string } | null,
  viewer: { name: null as string | null, isAdmin: false, id: null },
}));
const store = vi.hoisted(() => ({
  areas: { kitchen: { area_id: 'kitchen', name: 'Kitchen' } },
  hassUrl: '',
  helpers: { callService: () => {} },
}));
vi.mock('@hakit/core', () => ({ useHass: (selector: (state: typeof store) => unknown) => selector(store) }));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => ({}) }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useRoomDetailOverlay: () => true }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => world.viewer }));
vi.mock('../../../cook/useCook', () => ({ useCookState: () => world.cook }));
vi.mock('../../../coffee/useCoffeeState', () => ({ useCoffeeState: () => world.coffee }));
vi.mock('../../Home/HomeHeader', () => ({ HomeHeader: () => null }));
vi.mock('../../Home/MotionConditions', () => ({ MotionConditions: () => null }));
vi.mock('../../Home/PulseRow', () => ({ PulseRow: () => null }));
vi.mock('../../HomePulse', () => ({ HomePulse: () => null }));
vi.mock('../../RoomGrid', () => ({ RoomGrid: () => null }));
vi.mock('../../FireSafety', () => ({ FireAlarmTakeover: () => null }));
vi.mock('../../QuickAccess/QuickAccess', () => ({ QuickAccess: () => createElement('div', { id: 'quick-access' }) }));
vi.mock('../../Menu', () => ({ Menu: () => null }));
vi.mock('../../Now', () => ({ NowView: () => createElement('div', { id: 'now-view' }) }));
vi.mock('../../Energy', () => ({ EnergyPage: () => createElement('div', { id: 'energy-page' }) }));
vi.mock('../../RoomDetail', () => ({
  RoomDetail: ({ area, onOpenCook }: { area: { area_id: string }; onOpenCook?: () => void }) =>
    createElement(
      'div',
      { id: 'room-detail', 'data-area': area.area_id },
      createElement('button', { id: 'open-cook', onClick: onOpenCook })
    ),
}));
const stage = vi.hoisted(() => ({ close: null as (() => void) | null }));
vi.mock('../../Cook/CookStage', () => ({
  default: ({ onClose }: { onClose: () => void }): ReactNode => {
    stage.close = onClose;
    return createElement('div', { id: 'cook-stage' });
  },
}));
vi.mock('../../Coffee/CoffeeStage', () => ({ default: () => createElement('div', { id: 'coffee-stage' }) }));
const { Dashboard } = await import('../Dashboard');
let root: Root;
const state = (bath: string, probe = 'off', next = '') =>
  parseCookState({
    state: bath === 'off' ? (probe === 'off' ? 'off' : 'probe') : probe === 'off' ? 'bath' : 'both',
    attributes: { v: '1', bath_phase: bath, probe_phase: probe, next_kind: next },
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const render = () => act(async () => root.render(createElement(Dashboard)));
const has = (selector: string) => document.querySelector(selector) != null;
async function mount(hash = '#cook') {
  window.history.replaceState(null, '', `/dashboard${hash}`);
  await render();
  await advance(700);
}
beforeEach(() => {
  vi.useFakeTimers();
  world.cook = state('off');
  world.coffee = null;
  world.viewer.name = null;
  stage.close = null;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('the cooking route', () => {
  it('opens a cold stage, hides the dock, and closes into Kitchen without pushing history', async () => {
    await mount();
    expect(has('#cook-stage')).toBe(true);
    expect(has('#quick-access')).toBe(false);
    const push = vi.spyOn(window.history, 'pushState');
    act(() => stage.close?.());
    await advance(700);
    expect(has('#cook-stage')).toBe(false);
    expect(document.querySelector('#room-detail')?.getAttribute('data-area')).toBe('kitchen');
    expect(window.location.hash).toBe('#room=kitchen');
    expect(push).not.toHaveBeenCalled();
  });
  it('pushes one stage entry over Kitchen and goes Back to its room entry', async () => {
    await mount('#room=kitchen');
    const push = vi.spyOn(window.history, 'pushState');
    act(() => document.querySelector<HTMLElement>('#open-cook')?.click());
    await advance(700);
    expect(has('#cook-stage')).toBe(true);
    expect(window.history.state).toMatchObject({ cook: true, cookOverKitchen: true });
    expect(push).toHaveBeenCalledTimes(1);
    const back = vi.spyOn(window.history, 'back');
    act(() => stage.close?.());
    expect(back).toHaveBeenCalledTimes(1);
  });
  it('swaps with coffee, Energy and the timeline when following their hashes', async () => {
    await mount();
    for (const [hash, marker] of [
      ['#coffee', '#coffee-stage'],
      ['#energy', '#energy-page'],
      ['#now', '#now-view'],
    ]) {
      window.history.replaceState(null, '', `/dashboard${hash}`);
      await advance(700);
      expect(has('#cook-stage')).toBe(false);
      expect(has(marker)).toBe(true);
      window.history.replaceState(null, '', '/dashboard#cook');
      await advance(700);
      expect(has('#cook-stage')).toBe(true);
    }
  });
  it('keeps either running lane open through idle and releases the stage once both end', async () => {
    world.cook = state('cooking');
    await mount();
    await advance(4 * 60_000);
    expect(has('#cook-stage')).toBe(true);
    world.cook = state('off', 'resting');
    await render();
    await advance(4 * 60_000);
    expect(has('#cook-stage')).toBe(true);
    world.cook = state('off');
    await render();
    await advance(4 * 60_000);
    expect(has('#cook-stage')).toBe(false);
    expect(window.location.hash).toBe('');
  });
});
describe('cooking takeovers', () => {
  it('opens at the actual pull moment and waits five minutes after the final lane ends', async () => {
    world.viewer.name = 'Rooftop';
    world.cook = state('cooking', 'tracking', 'pull');
    await mount('#energy');
    await advance(121_000);
    expect(has('#cook-stage')).toBe(false);
    world.cook = state('cooking', 'pull', 'pull');
    await render();
    await advance(700);
    expect(has('#cook-stage')).toBe(true);
    world.cook = state('cooking', 'off', 'bath_done');
    await render();
    await advance(10_000);
    expect(has('#cook-stage')).toBe(true);
    world.cook = state('off');
    await render();
    const back = vi.spyOn(window.history, 'back');
    await advance(299_000);
    expect(has('#cook-stage')).toBe(true);
    expect(back).not.toHaveBeenCalled();
    await advance(2_000);
    expect(back).toHaveBeenCalledTimes(1);
  });
  it('lets brewing coffee win over a cooking wake link, regardless of brew source', async () => {
    world.viewer.name = 'Rooftop';
    world.cook = state('done', 'off', 'bath_done');
    world.coffee = { phase: 'brewing', source: 'tablet' };
    await mount('#cook&takeover=cook-123');
    expect(has('#cook-stage')).toBe(false);
    expect(has('#coffee-stage')).toBe(true);
    expect(window.location.hash).toBe('#coffee');
  });
  it('leaves an attended cooking wake screen under user control when a later coffee brew starts', async () => {
    world.viewer.name = 'Rooftop';
    world.cook = state('cooking');
    await mount('#cook&takeover=cook-attended');
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    await advance(700);
    world.coffee = { phase: 'brewing', source: 'tablet' };
    await render();
    await advance(700);
    expect(has('#cook-stage')).toBe(true);
    expect(has('#coffee-stage')).toBe(false);
  });
  it('preempts an automatic cooking stage when any coffee brew begins', async () => {
    world.viewer.name = 'Rooftop';
    world.cook = state('cooking');
    await mount('#energy');
    await advance(121_000);
    world.cook = state('done', 'off', 'bath_done');
    await render();
    await advance(700);
    expect(has('#cook-stage')).toBe(true);
    world.coffee = { phase: 'brewing', source: 'tablet' };
    await render();
    await advance(700);
    expect(has('#coffee-stage')).toBe(true);
    expect(has('#cook-stage')).toBe(false);
  });
});
