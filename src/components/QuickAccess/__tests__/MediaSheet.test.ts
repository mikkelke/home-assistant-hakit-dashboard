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
vi.mock('../../Intercom', () => ({ IntercomCard: () => null }));
vi.mock('../../Request', () => ({ RequestSheet: () => null, RequestTile: () => null, useRequestAccess: () => false }));
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

const PHONE = 'media_player.mikkels_phone';

let root: Root;

beforeEach(() => {
  viewer.name = 'Mikkel';
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  store.setState({ connection: null, entities: {} });
});

const player = (id: string, state = 'idle', attributes: Record<string, unknown> = {}) => ({
  entity_id: id,
  state,
  attributes: { group_members: [id], ...attributes },
});

/** Every speaker idle and reachable, except those in `overrides`. */
const house = (overrides: HassEntities = {}): HassEntities => ({
  ...Object.fromEntries(
    ['living_room', 'kitchen', 'dining_room', 'bedroom', 'bathroom', 'guest_bathroom', 'claudias_room', 'kristines_room', 'rooftop'].map(
      room => [`media_player.${room}`, player(`media_player.${room}`)]
    )
  ),
  ...overrides,
});

const settle = () =>
  act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

/** Opens the Media sheet for the viewer, with `entities` in the store; a new connection makes the viewer be looked up again. */
async function openMedia(entities: HassEntities) {
  store.setState({ connection: { sendMessagePromise: async () => undefined }, entities });
  await act(async () => {
    root.render(createElement(QuickAccess, { hassUrl: 'https://ha.example', callService: vi.fn(), onOpenNow: vi.fn() }));
  });
  await settle();
  await act(async () => document.querySelector<HTMLElement>('[title="Media controls"]')?.click());
}

const rows = () => [...document.querySelectorAll('.qa-speaker-line')].map(row => row.textContent);
const row = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.qa-speaker-line')].find(line => line.textContent?.startsWith(name));
const pick = (selector: string) => document.querySelector<HTMLElement>(selector);
const choose = (name: string) => act(async () => row(name)?.click());

describe("the viewer's own phone in the speaker list", () => {
  it('follows the speakers, with a phone glyph, while its player is reachable', async () => {
    await openMedia(house({ [PHONE]: player(PHONE, 'playing') }));
    expect(rows()).toEqual([
      'Bathroom',
      'Bedroom',
      'Claudias room',
      'Dining room',
      'Guest bathroom',
      'Kitchen',
      'Kristines room',
      'Living Room',
      'Rooftop',
      'My phone',
    ]);
    expect(row('My phone')?.querySelector('[data-icon="mdi:cellphone"]')).not.toBeNull();
  });

  it('is left out while the app is closed or the player does not exist', async () => {
    await openMedia(house({ [PHONE]: player(PHONE, 'unavailable') }));
    expect(rows()).not.toContain('My phone');
    store.setState({ entities: house() });
    await settle();
    expect(rows()).not.toContain('My phone');
  });

  it("is never shown to a housemate, though Mikkel's player exists", async () => {
    for (const name of ['Kristine', 'Claudia', 'Guest', null]) {
      viewer.name = name;
      await openMedia(house({ [PHONE]: player(PHONE, 'playing') }));
      expect(rows()).toHaveLength(9);
      expect(rows()).not.toContain('My phone');
      act(() => root.unmount());
      document.body.innerHTML = '';
      root = createRoot(document.body.appendChild(document.createElement('div')));
    }
  });

  it('opens the phone card, named in the Back row, with the reachable speakers to move to', async () => {
    await openMedia(
      house({
        [PHONE]: player(PHONE, 'playing'),
        'media_player.bathroom': player('media_player.bathroom', 'unavailable'),
      })
    );
    await choose('My phone');
    expect(pick('[data-card="phone"]')?.getAttribute('data-entity')).toBe(PHONE);
    expect(pick('[data-card="sonos"]')).toBeNull();
    expect(pick('.qa-media-head .qa-back-button')?.textContent).toBe('Back');
    expect(pick('.qa-media-head .qa-media-label-text')?.textContent).toBe('My phone');
    expect(pick('.qa-media-head [data-icon="mdi:cellphone"]')).not.toBeNull();
    expect(pick('[data-card="phone"]')?.getAttribute('data-targets')).toBe(
      ['bedroom', 'claudias_room', 'dining_room', 'guest_bathroom', 'kitchen', 'kristines_room', 'living_room', 'rooftop']
        .map(room => `media_player.${room}`)
        .join(',')
    );
  });

  it('moves to speakers that lead a group, never to one that follows', async () => {
    const group = ['media_player.kitchen', 'media_player.dining_room'];
    await openMedia(
      house({
        [PHONE]: player(PHONE, 'playing'),
        'media_player.kitchen': player('media_player.kitchen', 'idle', { group_members: group }),
        'media_player.dining_room': player('media_player.dining_room', 'idle', { group_members: group }),
      })
    );
    await choose('My phone');
    const targets = pick('[data-card="phone"]')?.getAttribute('data-targets')?.split(',');
    expect(targets).toContain('media_player.kitchen');
    expect(targets).not.toContain('media_player.dining_room');
  });
});

describe('the name of the speaker the card controls', () => {
  it('shows in the Back row, in the typography of the playing list', async () => {
    await openMedia(house());
    await choose('Kitchen');
    expect(pick('[data-card="sonos"]')?.getAttribute('data-entity')).toBe('media_player.kitchen');
    expect(pick('.qa-media-head .qa-media-label-text')?.textContent).toBe('Kitchen');
    expect(pick('.qa-media-head [data-icon="mdi:speaker"]')).not.toBeNull();
    expect(pick('.qa-media-head .qa-media-badge')).toBeNull();
  });

  it('carries the size of the group it leads', async () => {
    const group = ['media_player.kitchen', 'media_player.dining_room', 'media_player.living_room'];
    await openMedia(house(Object.fromEntries(group.map(id => [id, player(id, 'idle', { group_members: group })]))));
    await choose('Kitchen');
    expect(pick('.qa-media-head .qa-media-label-text')?.textContent).toBe('Kitchen');
    expect(pick('.qa-media-head .qa-media-badge')?.textContent).toBe('3 speakers');
  });

  it('goes with Back to the list', async () => {
    await openMedia(house());
    await choose('Bedroom');
    await act(async () => pick('.qa-media-head .qa-back-button')?.click());
    expect(pick('.qa-media-head')).toBeNull();
    expect(rows()).toContain('Bedroom');
  });
});
