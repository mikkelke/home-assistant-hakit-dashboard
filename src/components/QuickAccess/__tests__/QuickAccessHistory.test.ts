// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in for the @hakit/core store: `useHass(selector)` plus getState, setState and subscribe. */
const store = vi.hoisted(() => {
  type State = { connection: object | null; entities: Record<string, unknown> };
  let state: State = { connection: null, entities: {} };
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
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }), loadIcons: () => {} };
});
vi.mock('home-assistant-js-websocket', () => ({ getUser: () => Promise.resolve({ is_admin: false, name: 'Mikkel' }) }));
vi.mock('../../../utils/trackUiTap', () => ({ trackUiTap: vi.fn() }));
vi.mock('../../../utils/idle', () => ({ onIdle: () => () => {} }));
vi.mock('../../Intercom', () => ({ IntercomCard: () => null }));
vi.mock('../../Request', () => ({
  RequestSheet: () => null,
  RequestTile: () => null,
  useRequestAccess: () => ({ allowed: false, drtv: false }),
}));
vi.mock('../../MediaPlayer', () => ({
  PHONE_PLAYER_NAME: 'My phone',
  TVCard: () => null,
  SonosPlayer: () => null,
  PhonePlayer: () => null,
}));
// A card with the sheet a real one portals to the body (its history and forecast pop-ups).
vi.mock('../../Weather/QuickWeatherCard', async () => {
  const { createElement: h, useState } = await import('react');
  const { createPortal } = await import('react-dom');
  return {
    QuickWeatherCard: () => {
      const [open, setOpen] = useState(false);
      return h(
        'div',
        { className: 'quick-weather-card' },
        h('button', { 'data-pop-up': true, onClick: () => setOpen(true) }, 'History'),
        open && createPortal(h('div', { className: 'pop-up' }, 'Pop-up'), document.body)
      );
    },
  };
});

const { QuickAccess } = await import('../QuickAccess');

let root: Root;
const onOpenNow = vi.fn();
const back = () => vi.mocked(window.history.back);
const pick = (selector: string) => document.querySelector<HTMLElement>(selector);
const click = (selector: string) => act(async () => pick(selector)!.click());
const goBack = () => act(async () => void window.dispatchEvent(new Event('modalBackButton', { cancelable: true })));
const dialogName = () => pick('[role="dialog"]')?.getAttribute('aria-label');

const world: HassEntities = {
  'weather.forecast_home': {
    entity_id: 'weather.forecast_home',
    state: 'sunny',
    attributes: {},
    last_changed: '',
    last_updated: '',
  } as never,
};

beforeEach(() => {
  onOpenNow.mockReset();
  // The dashboard answers every step back in history by offering it to the topmost modal.
  vi.spyOn(window.history, 'back').mockImplementation(() => {
    window.dispatchEvent(new Event('modalBackButton', { cancelable: true }));
  });
  store.setState({ connection: { sendMessagePromise: async () => undefined }, entities: world });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null, entities: {} });
  vi.restoreAllMocks();
});

async function show() {
  await act(async () => root.render(createElement(QuickAccess, { hassUrl: null, callService: vi.fn(), onOpenNow })));
}

describe('the doors popover', () => {
  it('takes one history entry, which Back gives back', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await show();
    await click('[title="Access"]');
    expect(pick('.qa-doors')).not.toBeNull();
    expect(push.mock.calls.map(([state]) => state)).toEqual([{ modal: 'quick-access' }]);
    await goBack();
    expect(pick('.qa-doors')).toBeNull();
    expect(pick('.qa-doors-scrim')).toBeNull();
  });

  it('closes from its scrim and from the Access button by going back in history', async () => {
    await show();
    for (const closer of ['.qa-doors-scrim', '[title="Access"]']) {
      await click('[title="Access"]');
      expect(pick('.qa-doors')).not.toBeNull();
      await click(closer);
      expect(pick('.qa-doors')).toBeNull();
    }
    expect(back()).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Media controls', '.qa-modal.media'],
    ['Transit', '.qa-modal.transit'],
    ['Open weather', '.qa-modal.weather'],
  ])('gives way to the %s sheet on the same history entry', async (title, sheet) => {
    const push = vi.spyOn(window.history, 'pushState');
    await show();
    await click('[title="Access"]');
    await click(`[title="${title}"]`);
    expect(pick('.qa-doors')).toBeNull();
    expect(pick(sheet)).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(back()).not.toHaveBeenCalled();
    await goBack();
    expect(pick('.qa-overlay')).toBeNull();
  });

  it('gives way to the access panel on the same history entry', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    await show();
    await click('[title="Access"]');
    await click('[aria-label="Open the access panel"]');
    expect(pick('.qa-doors')).toBeNull();
    expect(pick('.qa-modal.intercom')).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    await goBack();
    expect(pick('.qa-overlay')).toBeNull();
  });

  it('leaves the timeline to a second tap, which adds a history entry of its own', async () => {
    await show();
    await click('[title="Access"]');
    await click('[title="Timeline"]');
    expect(onOpenNow).not.toHaveBeenCalled();
    expect(pick('.qa-doors')).toBeNull();
    expect(back()).toHaveBeenCalledTimes(1);
    await click('[title="Timeline"]');
    expect(onOpenNow).toHaveBeenCalledTimes(1);
  });
});

describe('a sheet', () => {
  it.each([
    ['Media controls', 'Media'],
    ['Transit', 'Transit'],
    ['Open weather', 'Weather'],
  ])('opened from the %s button names its dialog %s', async (title, name) => {
    await show();
    await click(`[title="${title}"]`);
    expect(dialogName()).toBe(name);
  });

  it('opened from the access panel names its dialog Apartment access', async () => {
    await show();
    await click('[title="Access"]');
    await click('[aria-label="Open the access panel"]');
    expect(dialogName()).toBe('Apartment access');
  });

  it('closes by going back in history, from the floating button as from the scrim', async () => {
    await show();
    for (const closer of ['.qa-floating-close', '.qa-overlay']) {
      await click('[title="Media controls"]');
      await click(closer);
      expect(pick('.qa-overlay')).toBeNull();
    }
    expect(back()).toHaveBeenCalledTimes(2);
  });
});

describe('the weather sheet', () => {
  async function openWeather() {
    await show();
    await click('[title="Open weather"]');
    await vi.waitFor(() => expect(pick('.quick-weather-card')).not.toBeNull());
  }

  it('closes from a tap beside its card', async () => {
    await openWeather();
    await click('.qa-modal-body');
    expect(back()).toHaveBeenCalledTimes(1);
    expect(pick('.qa-overlay')).toBeNull();
  });

  it('stays open for a tap on its card, and for one on a pop-up the card portals to the body', async () => {
    await openWeather();
    await click('.quick-weather-card');
    await click('[data-pop-up]');
    await click('.pop-up');
    expect(back()).not.toHaveBeenCalled();
    expect(pick('.qa-modal.weather')).not.toBeNull();
  });

  it('leaves the other sheets to their own frame', async () => {
    await show();
    await click('[title="Media controls"]');
    await click('.qa-modal');
    await click('.qa-modal-body');
    expect(back()).not.toHaveBeenCalled();
    expect(pick('.qa-modal.media')).not.toBeNull();
  });
});
