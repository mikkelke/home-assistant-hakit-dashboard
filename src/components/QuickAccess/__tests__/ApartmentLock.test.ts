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
const viewer = vi.hoisted(() => ({ name: 'Mikkel' as string | null }));

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
vi.mock('home-assistant-js-websocket', () => ({ getUser: () => Promise.resolve({ is_admin: false, name: viewer.name }) }));
vi.mock('../../../utils/trackUiTap', () => ({ trackUiTap: vi.fn() }));
vi.mock('../../Intercom/doorbellArchive', () => ({ fetchDoorbellIndex: () => Promise.resolve([]), formatRingTime: () => '' }));
vi.mock('../../Request', () => ({
  RequestSheet: () => null,
  RequestTile: () => null,
  useRequestAccess: () => ({ allowed: false, drtv: false }),
}));
vi.mock('../../GuestCodes/useGuestAccess', () => ({ useGuestAccess: () => null }));
vi.mock('../../Weather/QuickWeatherCard', () => ({ QuickWeatherCard: () => null }));
vi.mock('../../MediaPlayer', async () => {
  const { createElement: h } = await import('react');
  return {
    PHONE_PLAYER_NAME: 'My phone',
    TVCard: () => null,
    SonosPlayer: ({ entityId }: { entityId: string }) => h('div', { 'data-card': 'sonos', 'data-entity': entityId }),
    PhonePlayer: ({ entityId, targets }: { entityId: string; targets: Array<{ entityId: string }> }) =>
      h('div', { 'data-card': 'phone', 'data-entity': entityId, 'data-targets': targets.map(target => target.entityId).join(',') }),
  };
});

const { QuickAccess } = await import('../QuickAccess');
const { IntercomCard } = await import('../../Intercom/IntercomCard');

let root: Root;
const callService = vi.fn();
const sendCommand = vi.fn();
const NOW = Date.parse('2026-10-22T15:03:50+02:00');
const iso = (age = 0) => new Date(NOW - age).toISOString();
const entity = (entity_id: string, state: string, attributes = {}, last_changed = iso(60_000)) => ({
  entity_id,
  state,
  attributes,
  last_changed,
});
const world = (semantic: string, ble: string, cloud = semantic): HassEntities => ({
  'sensor.apartment_lock': entity('sensor.apartment_lock', semantic, { computed_at: iso() }),
  'lock.yale_bt': entity('lock.yale_bt', ble, {}, iso(3_600_000)),
  'lock.yale': entity('lock.yale', cloud),
  'binary_sensor.apartment_door_open': entity('binary_sensor.apartment_door_open', 'off'),
  'binary_sensor.apartment_entry_secure': entity('binary_sensor.apartment_entry_secure', 'off', {
    lock_state: ble,
    lock_source_used: 'fallback_ble',
  }),
});

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  callService.mockClear();
  sendCommand.mockReset().mockResolvedValue(undefined);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null, entities: {} });
  vi.restoreAllMocks();
});

for (const surface of ['quick access', 'intercom'] as const) {
  describe(`${surface} apartment controls`, () => {
    async function show(entities: HassEntities) {
      store.setState({ entities, connection: { connected: true, sendMessagePromise: sendCommand } });
      await act(async () => {
        root.render(
          surface === 'quick access'
            ? createElement(QuickAccess, { hassUrl: null, callService, onOpenNow: vi.fn() })
            : createElement(IntercomCard, { entities, callService, showHeader: true })
        );
      });
      if (surface === 'quick access') {
        act(() => document.querySelector<HTMLButtonElement>('[title="Access"]')!.click());
      }
    }
    const button = () =>
      document.querySelector<HTMLButtonElement>(surface === 'quick access' ? '.qa-door.is-lock' : '.access-quick-btn.is-lock')!;

    it.each([
      ['locked', 'unlocked', 'Unlock the apartment', 'unlock', 'mdi:lock'],
      ['unlocked', 'locked', 'Lock the apartment', 'lock', 'mdi:lock-open-variant'],
    ])('renders and commands semantic %s despite raw %s', async (state, ble, label, service, icon) => {
      await show(world(state, ble));
      expect(button().getAttribute('aria-label')).toBe(label);
      expect(button().querySelector('i')?.getAttribute('data-icon')).toBe(icon);
      expect(document.querySelector('.access-alert')).toBeNull();
      await act(async () => button().click());
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith({
        type: 'call_service',
        domain: 'lock',
        service,
        target: { entity_id: 'lock.yale_bt' },
      });
    });

    it.each(['unknown', 'jammed', 'locking', 'unlocking'])('disables %s without calling it unlocked', async state => {
      await show(world(state, 'unlocked', 'locked'));
      expect(button().disabled).toBe(true);
      expect(button().classList.contains('is-unlocked')).toBe(false);
      expect(document.querySelector('.access-alert')).toBeNull();
      await act(async () => button().click());
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('disables contradictory raw fallback after the publisher stops', async () => {
      const entities = world('locked', 'unlocked', 'locked');
      entities['sensor.apartment_lock'].attributes.computed_at = iso(180_001);
      await show(entities);
      expect(button().disabled).toBe(true);
      expect(button().getAttribute('aria-label')).toBe('Apartment lock unknown');
    });

    it('rechecks freshness on click before showing a success check', async () => {
      await show(world('locked', 'unlocked', 'locked'));
      vi.mocked(Date.now).mockReturnValue(NOW + 180_001);
      await act(async () => button().click());
      expect(sendCommand).not.toHaveBeenCalled();
      expect(button().classList.contains('is-done')).toBe(false);
    });

    it('falls back to one reachable apartment command target', async () => {
      await show(world('locked', 'unavailable', 'locked'));
      await act(async () => button().click());
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith({
        type: 'call_service',
        domain: 'lock',
        service: 'unlock',
        target: { entity_id: 'lock.yale' },
      });
    });

    it('never queues an unlock while the connection is down', async () => {
      await show(world('locked', 'locked'));
      store.setState({ connection: { connected: false, sendMessagePromise: sendCommand } });
      await act(async () => button().click());
      expect(sendCommand).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not unlock');
    });

    it('reads current truth at the tap and never reverses the displayed action', async () => {
      const entities = world('locked', 'locked');
      await show(entities);
      entities['sensor.apartment_lock'] = { ...entities['sensor.apartment_lock'], state: 'unlocked' };
      await act(async () => button().click());
      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('reports a failed request without a success check or second transport attempt', async () => {
      sendCommand.mockRejectedValueOnce(new Error('Request failed'));
      await show(world('locked', 'locked'));
      await act(async () => button().click());
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not unlock the apartment');
      expect(button().classList.contains('is-done')).toBe(false);
      expect(button().querySelector('[data-icon="mdi:check"]')).toBeNull();
      expect(button().disabled).toBe(false);
    });

    it('blocks duplicate taps while the request is pending', async () => {
      let finish!: () => void;
      sendCommand.mockReturnValueOnce(
        new Promise<void>(resolve => {
          finish = resolve;
        })
      );
      await show(world('locked', 'locked'));
      await act(async () => button().click());
      expect(button().disabled).toBe(true);
      expect(button().getAttribute('aria-busy')).toBe('true');
      await act(async () => button().click());
      expect(sendCommand).toHaveBeenCalledTimes(1);
      await act(async () => finish());
      expect(button().disabled).toBe(false);
      expect(button().querySelector('[data-icon="mdi:check"]')).toBeNull();
    });

    it('keeps the two building-door command identities unchanged', async () => {
      await show({
        ...world('locked', 'locked'),
        'lock.intercomproxy_front_door': entity('lock.intercomproxy_front_door', 'locked'),
        'lock.intercomproxy_back_door': entity('lock.intercomproxy_back_door', 'locked'),
      });
      act(() => document.querySelector<HTMLButtonElement>('[aria-label="Open the front building door"]')!.click());
      expect(callService).toHaveBeenLastCalledWith({
        domain: 'button',
        service: 'press',
        target: { entity_id: 'button.abb_welcome_gateway_outdoor_station_2_1' },
      });
      act(() => document.querySelector<HTMLButtonElement>('[aria-label="Open the back building door"]')!.click());
      expect(callService).toHaveBeenLastCalledWith({
        domain: 'lock',
        service: 'unlock',
        target: { entity_id: 'lock.intercomproxy_back_door' },
      });
      expect(callService).toHaveBeenCalledTimes(2);
    });
  });
}
