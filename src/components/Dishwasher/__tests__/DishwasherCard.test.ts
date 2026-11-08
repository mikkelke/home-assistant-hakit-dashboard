// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@hakit/core', () => ({ useHass: Object.assign(() => undefined, { getState: () => ({ connection: null }) }) }));
vi.mock('@iconify/react', async () => {
  const { createElement } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => createElement('i', { 'data-icon': icon }) };
});
vi.mock('../../../energy', () => ({ useRunCost: () => null }));

const { DishwasherCard } = await import('../DishwasherCard');

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });

const PROGRAMME = entity('input_select.dishwasher_confirmed_programme', 'ECO', { options: ['ECO', 'Quick'] });
const ANNOUNCE = 'input_boolean.dishwasher_announce';

function house(state: string, announce?: 'on' | 'off'): HassEntities {
  return {
    'sensor.dishwasher_state': entity('sensor.dishwasher_state', state, {
      programme_label: 'ECO',
      progress_pct: 40,
      programme_duration_min: 180,
      estimated_remaining_min: 108,
      energy_used: 0.3,
    }),
    [PROGRAMME.entity_id]: PROGRAMME,
    ...(announce && { [ANNOUNCE]: entity(ANNOUNCE, announce) }),
  };
}

let root: Root | undefined;
const callService = vi.fn();
beforeEach(() => {
  const kept = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    },
  });
  callService.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

/** Mounts a fresh card: whether it starts open is read from storage once, at mount. */
function show(entities: HassEntities, { open }: { open: boolean }) {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  window.localStorage.setItem('dishwashercard-collapsed', String(!open));
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root?.render(createElement(DishwasherCard, { entities, callService })));
}
const press = (selector: string) => act(() => (document.querySelector(selector) as HTMLElement).click());
const bell = (selector: string) => document.querySelector<HTMLElement>(selector);

describe('the Dishwasher announce bell', () => {
  it('sits in the collapsed header while it runs and turns the announcement off', () => {
    show(house('Running', 'on'), { open: false });
    const quick = bell('.appliance-quick-btn');
    expect(quick?.getAttribute('aria-label')).toBe('Turn off announce when finished');
    expect(quick?.getAttribute('aria-pressed')).toBe('true');
    press('.appliance-quick-btn');
    expect(callService).toHaveBeenCalledWith({ domain: 'input_boolean', service: 'turn_off', target: { entity_id: ANNOUNCE } });
  });

  it('turns the announcement on from the footer of the open card', () => {
    show(house('Running', 'off'), { open: true });
    expect(document.querySelector('.appliance-quick-btn')).toBeNull();
    const footer = bell('.appliance-footer-icon-btn[aria-pressed]');
    expect(footer?.getAttribute('aria-label')).toBe('Turn on announce when finished');
    press('.appliance-footer-icon-btn[aria-pressed]');
    expect(callService).toHaveBeenCalledWith({ domain: 'input_boolean', service: 'turn_on', target: { entity_id: ANNOUNCE } });
  });

  it('is left out where Home Assistant has no such helper', () => {
    show(house('Running'), { open: false });
    expect(document.querySelector('.appliance-quick-btn')).toBeNull();
    show(house('Running'), { open: true });
    expect(document.querySelector('.appliance-footer')).not.toBeNull();
    expect(document.querySelector('.appliance-footer-icon-btn[aria-pressed]')).toBeNull();
  });

  it('gives way to the mark-emptied button once the run is done', () => {
    show(house('Unemptied', 'on'), { open: false });
    const quick = bell('.appliance-quick-btn');
    expect(quick?.getAttribute('aria-label')).toBe('Mark the dishwasher as emptied');
    expect(quick?.hasAttribute('aria-pressed')).toBe(false);
    press('.appliance-quick-btn');
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.dishwasher_emptied' },
    });
  });
});
