// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallServiceFunction, HassEntities } from '../../../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hass = vi.hoisted(() => ({ entities: {} as Record<string, unknown>, callService: (() => {}) as unknown }));

vi.mock('@hakit/core', () => ({
  useHass: <T>(selector: (state: { helpers: { callService: unknown } }) => T): T =>
    selector({ helpers: { callService: hass.callService } }),
}));
vi.mock('@iconify/react', async () => {
  const { createElement: h } = await import('react');
  return { Icon: ({ icon }: { icon: string }) => h('i', { 'data-icon': icon }) };
});
vi.mock('../../../hooks/useTrackedEntities', () => ({ useTrackedEntities: () => hass.entities }));
vi.mock('../../../hooks/useViewer', () => ({ useViewer: () => ({ isAdmin: true, name: 'Mikkel' }) }));
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => true, useMediaQuery: () => true }));

const { HeatingPage } = await import('../HeatingPage');
const { HeatDial, NudgeStepper } = await import('../ResidentHeat');
const { useResidentHeat } = await import('../useResidentHeat');

const entity = (entity_id: string, state: string, attributes: Record<string, unknown> = {}) => ({ entity_id, state, attributes });
const zone = (id: string, state: string, attributes: Record<string, unknown>) =>
  entity(`sensor.heating_zone_${id}`, state, {
    plan_mode: 'hold',
    live: 'false',
    nudge: '+0.0',
    nudge_min: '+0.0',
    nudge_max: '+0.0',
    lower_limit: 19,
    upper_limit: 24,
    cut_window: ['<none>'],
    stale_inputs: ['<none>'],
    reasons: ['Heating season is off: nothing would be written', 'Setpoint 21.5 (trim +0.00)'],
    ...attributes,
  });

/** Live states of 19.10.2026, off season. */
function offSeason(): HassEntities {
  const list = [
    entity('sensor.heating_controller', 'off_season', {
      alerts_active: ['<none>'],
      would_writes_today: '9',
      season_advice: 'none',
      season_advice_reason: 'no_data',
      season_forecast_mean: '10.3',
      season_morning_means: { family: ['n/a', 'n/a'], kristines_room: ['23.9', 'n/a'], claudias_room: ['n/a', 'n/a'] },
    }),
    entity('input_boolean.heating_season', 'off'),
    zone('family', '22.0', {
      base_target: 21.5,
      control_air: 23.7,
      setpoint_now: 21.5,
      next_change_at: '2026-10-20T06:00:00+02:00',
      next_setpoint: 22,
      plan_mode: 'sun_cut',
      day_blocks: [
        { start: '00:04', end: '01:04', mode: 'hold', setpoint: '21.5' },
        { start: '01:04', end: '15:04', mode: 'sun_cut', setpoint: '21.0' },
        { start: '15:04', end: '15:04', mode: 'hold', setpoint: '22.5' },
        { start: '15:04', end: '24:00', mode: 'hold', setpoint: '21.5' },
      ],
      budget_today_h: '2.6',
      call_hours_today: '0.1',
      sun_credit_h: '1.6',
      yesterday: { day: '2026-10-18', call_hours: '0.0', would_writes: '0', h_pred: 1.72, trim: 0.5 },
    }),
    zone('kristines_room', '21.5', { base_target: 21.5, control_air: 24.2, nudge: '-0.5', nudge_min: '-1.0', nudge_max: '+1.0' }),
    zone('claudias_room', '21.5', { base_target: 21.5, control_air: 24.5, nudge_min: '-1.0', nudge_max: '+1.0' }),
    zone('bathroom', '19.0', { control_air: 20.9 }),
    zone('guest_bathroom', '20.0', { control_air: 24.7 }),
    entity('input_number.heating_target_family', '21.5', { min: 19, max: 24, step: 0.5 }),
    entity('climate.family_room_thermostat', 'off', { hvac_action: 'idle' }),
    entity('climate.kristines_room_thermostat', 'heat', { hvac_action: 'heating' }),
  ];
  return Object.fromEntries(list.map(e => [e.entity_id, e]));
}

let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const icons = (scope: ParentNode = document) => [...scope.querySelectorAll('[data-icon]')].map(node => node.getAttribute('data-icon'));

describe('the heating page', () => {
  it('shows the advisor and one row per controller zone off season', () => {
    hass.entities = offSeason();
    act(() => root.render(createElement(HeatingPage, { onClose: () => {} })));
    expect(document.querySelector('.heat-advisor-title')?.textContent).toBe('Not yet');
    expect(document.querySelectorAll('.heat-scale')).toHaveLength(3);
    expect(document.querySelectorAll('.heat-scale-dot')).toHaveLength(1);
    expect(document.querySelectorAll('.heat-zone-row')).toHaveLength(5);
    expect(document.body.textContent).not.toContain('Bedroom');
    const family = document.querySelector('.heat-zone-row') as HTMLElement;
    expect(icons(family)).toContain('mdi:white-balance-sunny');
    expect(family.textContent).toMatch(/22\.0 \d\d:00/);
    expect(document.querySelector('.heat-pill.is-alert')).toBeNull();
    expect(document.querySelector('.heating-page-header')?.textContent).toContain('Shadow');
  });

  it('opens a zone sheet with the strip, and the base stepper writes the target helper', async () => {
    hass.entities = offSeason();
    const callService = vi.fn();
    hass.callService = callService;
    act(() => root.render(createElement(HeatingPage, { onClose: () => {} })));
    act(() => (document.querySelector('.heat-zone-row') as HTMLElement).click());
    expect(document.querySelectorAll('.heat-day-block')).toHaveLength(3);
    expect(document.querySelector('.heat-reasons')?.textContent).toContain('Heating season is off');
    const raise = document.querySelector('[aria-label="Raise base target by 0.5 degrees Celsius"]') as HTMLButtonElement;
    act(() => raise.click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_number',
      service: 'set_value',
      target: { entity_id: 'input_number.heating_target_family' },
      serviceData: { value: 22 },
    });
  });
});

function Resident({ entities, callService }: { entities: HassEntities; callService: CallServiceFunction }) {
  const heat = useResidentHeat(entities, 'kristines_room', callService);
  if (!heat) return null;
  return createElement(
    'div',
    null,
    createElement(HeatDial, { tempC: 21.3, heat }),
    heat.seasonOn && createElement(NudgeStepper, { heat, disabled: false })
  );
}

describe('the resident controls', () => {
  const inSeason = (nudge: string) => {
    const entities = offSeason();
    entities['sensor.heating_controller'] = entity('sensor.heating_controller', 'shadow');
    entities['input_boolean.heating_season'] = entity('input_boolean.heating_season', 'on');
    entities['sensor.heating_zone_kristines_room'] = zone('kristines_room', '21.5', { nudge, nudge_min: '-1.0', nudge_max: '+1.0' });
    return entities;
  };

  it('presses the warmer button, then waits for the controller before another press', () => {
    const callService = vi.fn();
    act(() => root.render(createElement(Resident, { entities: inSeason('+0.0'), callService })));
    expect(icons()).toContain('mdi:fire');
    const warmer = document.querySelector('[aria-label="Warmer"]') as HTMLButtonElement;
    act(() => warmer.click());
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.heating_kristines_room_warmer' },
    });
    expect(document.querySelector('.nudge-target')?.textContent).toBe('22.0°');
    expect(warmer.disabled).toBe(true);
    expect(document.querySelectorAll('.nudge-pips .is-up')).toHaveLength(1);
  });

  it('disables warmer at the top of the nudge range', () => {
    act(() => root.render(createElement(Resident, { entities: inSeason('+1.0'), callService: vi.fn() })));
    expect((document.querySelector('[aria-label="Warmer"]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[aria-label="Colder"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows only the heating-off dial off season', () => {
    act(() => root.render(createElement(Resident, { entities: offSeason(), callService: vi.fn() })));
    expect(document.querySelector('[aria-label="Warmer"]')).toBeNull();
    expect(icons()).toContain('mdi:radiator-off');
    expect(document.querySelector('.heat-dial-tick')).toBeNull();
  });
});
