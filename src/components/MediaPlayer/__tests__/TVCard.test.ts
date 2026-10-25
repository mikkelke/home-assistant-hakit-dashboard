// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallServiceFunction, HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});
vi.mock('../../../hooks', async () => {
  const { useState } = await import('react');
  return {
    useLocalStorageBoolean: () => useState(false),
    useTouchScrollSlopGuard: () => ({ consumeBlockClick: () => false }),
    useModalBackButton: ({ onRequestClose }: { onRequestClose: () => void }) => ({ requestClose: onRequestClose }),
  };
});

const { TVCard } = await import('../TVCard');
const TV = 'media_player.living_room_tv';
const APPLE = 'media_player.living_room_apple_tv';
const REMOTE = 'remote.living_room_apple_tv';
const CAST = 'media_player.living_room_cast';
const VIDAA = 'media_player.living_room_vidaa_tv';
const COMMAND = 'script.living_room_apple_tv_command';
const APPLE_TITLE = 'An Apple TV programme';

let root: Root;
let callService: Mock<CallServiceFunction>;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  callService = vi.fn<CallServiceFunction>();
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

const entity = (entity_id: string, state = 'on', attributes: Record<string, unknown> = {}) => ({
  entity_id,
  state,
  attributes,
});
const house = (source: string | null, state = 'on', appleState = 'playing'): HassEntities => ({
  [TV]: entity(TV, state, { source, active_child: VIDAA, volume_level: 0.36 }),
  [VIDAA]: entity(VIDAA, 'on', { source: 'HDMI4' }), // deliberately stale child cache
  [APPLE]: entity(APPLE, appleState, {
    media_title: APPLE_TITLE,
    media_artist: 'The Apple artist',
    media_duration: 1200,
    media_position: 100,
  }),
  [CAST]: entity(CAST, 'playing'),
  [REMOTE]: entity(REMOTE),
});
async function show(entities: HassEntities, bedroom = false) {
  await act(async () => {
    root.render(
      createElement(TVCard, {
        entityId: bedroom ? 'media_player.bedroom_tv' : TV,
        entities,
        hassUrl: 'https://ha.example',
        callService,
        appleRemoteEntityId: bedroom ? 'remote.bedroom_apple_tv' : REMOTE,
        appleMediaPlayerEntityId: bedroom ? 'media_player.bedroom_apple_tv' : APPLE,
        ...(!bedroom
          ? {
              appleTvSourceName: 'HDMI2',
              chromecastEntityId: CAST,
              chromecastSourceName: 'HDMI1',
              wirelessUsbCSourceName: 'HDMI4',
              appleCommandScriptEntityId: COMMAND,
            }
          : {}),
      })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}
const text = (selector: string) => document.querySelector(selector)?.textContent;
const click = async (selector: string) => {
  const target = document.querySelector<HTMLElement>(selector);
  expect(target, selector).not.toBeNull();
  await act(async () => target!.click());
};
async function selectSource(name: string) {
  await click('.tv-source-toggle');
  const target = Array.from(document.querySelectorAll<HTMLButtonElement>('.tv-source-row')).find(button => button.textContent === name);
  expect(target).not.toBeUndefined();
  await act(async () => target!.click());
}

describe('living room physical input and playback context', () => {
  it('does not show Apple TV playback or seek controls while HDMI1 is displayed', async () => {
    await show(house('HDMI1'));
    expect(text('.tv-source-toggle-label')).toBe('Chromecast');
    expect(document.body.textContent).not.toContain(APPLE_TITLE);
    expect(document.querySelector('.tv-seeker')).toBeNull();
    expect(document.querySelector('button[aria-label="Pause"]')).toBeNull();
  });

  it('rejects cached aggregate Apple metadata after switching to Chromecast', async () => {
    const entities = house('HDMI1');
    entities[TV].attributes = {
      ...entities[TV].attributes,
      active_child: APPLE,
      media_title: APPLE_TITLE,
      media_duration: 1200,
      media_position: 100,
    };
    entities[TV].state = 'playing';
    await show(entities);
    expect(text('.tv-source-toggle-label')).toBe('Chromecast');
    expect(document.body.textContent).not.toContain(APPLE_TITLE);
    expect(document.querySelector('.tv-seeker')).toBeNull();
    expect(document.querySelector('button[aria-label="Pause"]')).toBeNull();
  });

  it('shows paused Apple TV content only when the panel is on HDMI2', async () => {
    await show(house('HDMI2', 'on', 'paused'));
    expect(text('.tv-source-toggle-label')).toBe('Apple TV');
    expect(text('.tv-hero-title')).toBe(APPLE_TITLE);
    expect(text('.tv-hero-sub')).toBe('The Apple artist');
    await click('button[aria-label="Play"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'media_play',
      target: { entity_id: APPLE },
    });
  });

  it('does not infer a physical input on VIDAA Home from a stale child signal', async () => {
    await show(house(null));
    expect(text('.tv-source-toggle-label')).toBe('Select source');
    expect(document.body.textContent).not.toContain(APPLE_TITLE);
    expect(document.querySelector('.tv-seeker')).toBeNull();
  });

  it.each([
    ['Apple TV', 'HDMI2'],
    ['Chromecast', 'HDMI1'],
    ['Wireless USB-C', 'HDMI4'],
  ])('routes %s to the aggregate as raw %s', async (name, source) => {
    await show(house('HDMI1'));
    await selectSource(name);
    expect(callService).toHaveBeenCalledExactlyOnceWith({
      domain: 'media_player',
      service: 'select_source',
      target: { entity_id: TV },
      serviceData: { source },
    });
  });

  it.each([
    ['unknown', 'Unknown'],
    ['unavailable', 'Unavailable'],
  ])('shows %s truthfully despite Apple TV playing', async (state, label) => {
    const entities = house('HDMI2', state);
    entities[TV].attributes = {
      ...entities[TV].attributes,
      media_title: APPLE_TITLE,
      media_duration: 1200,
      media_position: 100,
    };
    await show(entities);
    expect(text('.tv-word')).toBe(label);
    expect(text('.tv-hero-title')).toBe(label);
    expect(document.body.textContent).not.toContain(APPLE_TITLE);
    expect(document.querySelector('.tv-seeker')).toBeNull();
    expect(document.querySelector('button[aria-label="Pause"]')).toBeNull();
  });

  it('uses the queued backend remote script and aggregate volume and power', async () => {
    await show(house('HDMI2'));
    await click('.tv-footer-action');
    await click('button[aria-label="Up"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'script',
      service: 'turn_on',
      target: { entity_id: COMMAND },
      serviceData: { variables: { command: 'up' } },
    });
    await click('button[aria-label="Volume Up"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'volume_up',
      target: { entity_id: TV },
    });
    await click('button[aria-label="Volume Down"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'volume_down',
      target: { entity_id: TV },
    });
    await click('.apple-remote-container button[aria-label="Mute"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'volume_mute',
      target: { entity_id: TV },
      serviceData: { is_volume_muted: true },
    });
    await click('button[aria-label="Power"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'turn_off',
      target: { entity_id: TV },
    });
  });
});

describe('bedroom without a physical input mapping', () => {
  const bedroom = (activeChild = 'media_player.bedroom_apple_tv'): HassEntities => ({
    'media_player.bedroom_tv': entity('media_player.bedroom_tv', 'on', { active_child: activeChild }),
    'media_player.bedroom_apple_tv': entity('media_player.bedroom_apple_tv', 'playing', { media_title: APPLE_TITLE }),
    'remote.bedroom_apple_tv': entity('remote.bedroom_apple_tv'),
  });
  it('keeps bedroom source and remote routing when Apple TV is the active child', async () => {
    await show(bedroom(), true);
    expect(text('.tv-hero-title')).toBe(APPLE_TITLE);
    await selectSource('Apple TV');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'media_player',
      service: 'turn_on',
      target: { entity_id: 'media_player.bedroom_apple_tv' },
    });
    await click('.tv-footer-action');
    await click('button[aria-label="Up"]');
    expect(callService).toHaveBeenLastCalledWith({
      domain: 'remote',
      service: 'send_command',
      target: { entity_id: 'remote.bedroom_apple_tv' },
      serviceData: { command: 'up' },
    });
  });
  it('does not fall back to an unrelated playing Apple TV', async () => {
    await show(bedroom('media_player.bedroom_hisense'), true);
    expect(text('.tv-hero-title')).toBe('On');
    expect(text('.tv-source-toggle-label')).toBe('Select source');
    expect(document.body.textContent).not.toContain(APPLE_TITLE);
  });
});
