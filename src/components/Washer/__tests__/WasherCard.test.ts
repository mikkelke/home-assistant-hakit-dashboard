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

const { WasherCard } = await import('../WasherCard');

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });

const PROGRAMMES = ['Auto (unconfirmed)', 'Bomuld', 'Ekspres', 'ECO', 'Uld'];
const SHORT = 'input_boolean.washer_option_short';

interface Wash {
  state?: string;
  programme?: string;
  short?: 'on' | 'off' | null;
}

function house({ state = 'Running', programme = 'Bomuld', short = 'off' }: Wash = {}): HassEntities {
  return {
    'sensor.washer_state': entity('sensor.washer_state', state, {
      programme_label: programme,
      programme_duration_min: 150,
      estimated_remaining_min: 90,
      energy_used: 0.4,
      cycle_start_time: '2026-11-21T08:22:00+00:00',
    }),
    'input_select.washer_confirmed_programme': entity('input_select.washer_confirmed_programme', programme, { options: PROGRAMMES }),
    'input_select.washer_temperature': entity('input_select.washer_temperature', '60°C', { options: ['40°C', '60°C'] }),
    'input_select.washer_spin_speed': entity('input_select.washer_spin_speed', '1400 rpm', { options: ['1000 rpm', '1400 rpm'] }),
    ...(short && { [SHORT]: entity(SHORT, short) }),
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

function show(entities: HassEntities) {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  window.localStorage.setItem('washercard-collapsed', 'false');
  root = createRoot(document.body.appendChild(document.createElement('div')));
  act(() => root?.render(createElement(WasherCard, { entities, callService })));
}

const chips = () => Array.from(document.querySelectorAll<HTMLElement>('.appliance-chip'));
const chip = (label: string) => chips().find(el => el.textContent === label);

describe('the Washer Kort chip', () => {
  it('sits among the settings of a confirmed programme that has Kort, off to start with', () => {
    show(house());
    expect(chips().map(el => el.textContent)).toEqual(['Bomuld', '60°C', '1400 rpm', 'Kort']);
    expect(chip('Kort')?.classList.contains('on')).toBe(false);
  });

  it('is tinted while Kort is on', () => {
    show(house({ short: 'on' }));
    expect(chip('Kort')?.classList.contains('on')).toBe(true);
  });

  it('switches Kort on and off', () => {
    show(house({ short: 'off' }));
    act(() => chip('Kort')?.click());
    expect(callService).toHaveBeenLastCalledWith({ domain: 'input_boolean', service: 'turn_on', target: { entity_id: SHORT } });

    show(house({ short: 'on' }));
    act(() => chip('Kort')?.click());
    expect(callService).toHaveBeenLastCalledWith({ domain: 'input_boolean', service: 'turn_off', target: { entity_id: SHORT } });
  });

  it('is left out of programmes without a Kort switch', () => {
    for (const programme of ['Ekspres', 'ECO', 'Uld']) {
      show(house({ programme }));
      expect(chip('Kort'), programme).toBeUndefined();
    }
  });

  it('is left out until the programme is confirmed', () => {
    show(house({ programme: 'Auto (unconfirmed)' }));
    expect(chip('Kort')).toBeUndefined();
  });

  it('is left out where Home Assistant has no such helper', () => {
    show(house({ short: null }));
    expect(chip('Kort')).toBeUndefined();
  });

  it('stays when the wash is done, so a finished wash can still be marked', () => {
    show(house({ state: 'Unemptied', short: 'off' }));
    act(() => chip('Kort')?.click());
    expect(callService).toHaveBeenLastCalledWith({ domain: 'input_boolean', service: 'turn_on', target: { entity_id: SHORT } });
  });
});
