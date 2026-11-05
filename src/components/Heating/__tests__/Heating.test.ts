// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CallServiceFunction, HassEntities } from '../../../types';
import {
  BUILDING_RETURN_TEMP_SENSOR,
  BUILDING_SUPPLY_TEMP_SENSOR,
  HEATING_RETURN_TEMP_SENSOR,
  HEATING_SUPPLY_TEMP_SENSOR,
  HEATING_ZONES,
  loopReturnSensorId,
  zoneCallSensorId,
  type HeatingZone,
} from '../../../utils/heating';
import { BEDROOM_FLOOR_ENTITY } from '../zoneMeta';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hass = vi.hoisted(() => {
  const state: {
    entities: Record<string, unknown>;
    callService: unknown;
    history: (request: Record<string, unknown>) => Promise<unknown>;
    connection: { sendMessagePromise: (request: Record<string, unknown>) => Promise<unknown> };
  } = {
    entities: {},
    callService: () => {},
    history: () => new Promise(() => {}),
    connection: { sendMessagePromise: request => state.history(request) },
  };
  return state;
});

vi.mock('@hakit/core', () => ({
  useHass: <T>(selector: (state: { helpers: { callService: unknown }; connection: unknown }) => T): T =>
    selector({ helpers: { callService: hass.callService }, connection: hass.connection }),
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
const { RoomClimateHeader } = await import('../../RoomDetail/RoomClimateHeader');

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

const LIVING_FLOOR = 'sensor.living_room_floor_thermometer_temperature';
const DINING_FLOOR = 'sensor.dining_room_floor_thermometer_temperature';

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
  vi.setSystemTime(new Date(2026, 10, 5, 11, 35));
  hass.history = vi.fn(() => new Promise(() => {}));
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
    expect(document.querySelectorAll('button.heat-zone-row')).toHaveLength(5);
    const family = document.querySelector('.heat-zone-row') as HTMLElement;
    expect(icons(family)).toContain('mdi:white-balance-sunny');
    expect(family.textContent).toMatch(/22\.0 \d\d:00/);
    expect(document.querySelector('.heat-pill.is-alert')).toBeNull();
    expect(document.querySelector('.heating-page-header')?.textContent).toContain('Shadow');
  });

  it('shows the open family room as one row, with the floor at its cap and both floors in its label', () => {
    renderPage(
      zone('family', '21.5', {
        control_air: 23.7,
        plan_mode: 'floor_cap',
        floor_temp: 24.5,
        floor_max_c: 24.5,
        floor_temps: { [LIVING_FLOOR]: 24, [DINING_FLOOR]: 24.5 },
      }),
      entity('climate.family_room_thermostat', 'heat', { hvac_action: 'heating' })
    );
    const rows = [...document.querySelectorAll('button.heat-zone-row')];
    expect(rows.map(row => row.querySelector('.heat-zone-name')?.textContent)).toEqual([
      'Family',
      "Kristine's room",
      "Claudia's room",
      'Bathroom',
      'Guest bathroom',
    ]);
    expect(icons(rows[0])).toEqual(['mdi:sofa-outline', 'mdi:heating-coil', 'mdi:chevron-right']);
    expect(rows[0].getAttribute('aria-label')).toBe(
      'Family, air 23.7 °C, target 21.5 °C, 2.2 °C above target, floor 24.5 °C (living room 24.0 °C, dining room 24.5 °C), heating, Floor too warm'
    );
  });

  it('keeps the floor of a zone with one floor thermometer in its label, and off the row while it is below its cap', () => {
    renderPage(zone('kristines_room', '21.5', { control_air: 24.2, floor_temp: 22.1, floor_max_c: 24.5 }));
    const row = document.querySelectorAll('button.heat-zone-row')[1];
    expect(row.getAttribute('aria-label')).toBe(
      "Kristine's room, air 24.2 °C, target 21.5 °C, 2.7 °C above target, floor 22.1 °C, heating"
    );
    expect(row.querySelector('.heat-zone-chips')).toBeNull();
    expect(row.textContent).not.toContain('22.1');
  });

  it('opens the floor-cap plan of the family zone, and writes nothing without its target helper', async () => {
    const callService = vi.fn();
    hass.callService = callService;
    const entities = offSeason();
    delete entities['input_number.heating_target_family'];
    entities['sensor.heating_zone_family'] = zone('family', '21.5', {
      base_target: 21.5,
      plan_mode: 'floor_cap',
      setpoint_now: 19,
      day_blocks: [{ start: '00:00', end: '24:00', mode: 'floor_cap', setpoint: '19' }],
    });
    hass.entities = entities;
    act(() => root.render(createElement(HeatingPage, { onClose: () => {} })));
    act(() => (document.querySelector('button.heat-zone-row') as HTMLElement).click());
    expect(document.querySelector('[aria-label="Family heating details"]')).not.toBeNull();
    expect(document.querySelector('.heat-day-block.mode-floor_cap')?.textContent).toBe('19.0');
    expect(icons(document.querySelector('.heat-day-icons')!)).toEqual(['mdi:heat-wave']);
    expect(document.querySelector('.climate-target-value')?.textContent).toBe('21.5 °C');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.climate-step')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.disabled)).toBe(true);
    act(() => buttons.forEach(button => button.click()));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).not.toHaveBeenCalled();
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

/** The room's climate header over `list`, with its climate sheet open. */
function openRoom(roomName: string, areaId: string, list: ReturnType<typeof entity>[]) {
  const callService = vi.fn();
  const entities = Object.fromEntries(list.map(e => [e.entity_id, e]));
  act(() => root.render(createElement(RoomClimateHeader, { roomName, areaId, entities, callService })));
  act(() => (document.querySelector('.room-climate-chip') as HTMLButtonElement).click());
  return callService;
}

describe('the living room heating controls', () => {
  /** The living room thermostat has no actuator; it sits in the fixture with another target so a read or write through it would show. */
  function openLiving(...extra: ReturnType<typeof entity>[]) {
    return openRoom('Living room', 'living_room', [
      entity('sensor.heating_controller', 'live'),
      entity('input_boolean.heating_season', 'on'),
      entity('climate.family_room_thermostat', 'heat', { temperature: 21, current_temperature: 22.3, min_temp: 5, max_temp: 40 }),
      entity('climate.living_room_thermostat', 'heat', { temperature: 18, current_temperature: 22.3, min_temp: 5, max_temp: 40 }),
      zone('family', '21.0', { live: 'true', lower_limit: 20.5, upper_limit: 21.5 }),
      ...extra,
    ]);
  }

  const shadowed = zone('family', '21.0', { live: 'false', lower_limit: 20.5, upper_limit: 21.5 });
  const targetHelper = (state: string, attributes: Record<string, unknown> = {}) =>
    entity('input_number.heating_target_family', state, { min: 19, max: 24, step: 0.5, ...attributes });
  const button = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  const shownTarget = () => document.querySelector('.climate-target-value')?.textContent;

  it('steps the shared family thermostat within the family limits while the zone is only shadowed', async () => {
    const callService = openLiving(shadowed, targetHelper('21'));
    expect(document.querySelector('.heat-dial')).not.toBeNull();
    expect(document.querySelector('.climate-shared')?.textContent).toBe('Shared with the kitchen, dining and hallway');
    expect(document.querySelector('[aria-label="Warmer"]')).toBeNull();
    expect(document.querySelector('.climate-control-heading strong')?.textContent).toBe('Heating target');
    expect(document.querySelector('[aria-label="Raise room target by 0.5 degrees Celsius"]')).toBeNull();
    expect(shownTarget()).toBe('21.0 °C');
    const raise = button('Raise heating target by 0.5 degrees Celsius');
    expect(raise.disabled).toBe(false);
    act(() => raise.click());
    expect(raise.disabled).toBe(true);
    expect(document.querySelector('.climate-target-label')?.textContent).toBe('Waiting for thermostat');
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService.mock.calls).toEqual([
      [
        {
          domain: 'climate',
          service: 'set_temperature',
          target: { entity_id: 'climate.family_room_thermostat' },
          serviceData: { temperature: 21.5 },
        },
      ],
    ]);
  });

  it('steps the family target helper instead of the locked thermostat once the zone is live', async () => {
    const callService = openLiving(targetHelper('21'));
    expect(document.querySelector('.heat-dial')).not.toBeNull();
    expect(document.querySelector('[aria-label="Warmer"]')).toBeNull();
    expect(document.querySelector('.climate-control-heading strong')?.textContent).toBe('Room target');
    expect(document.querySelector('[aria-label="Raise heating target by 0.5 degrees Celsius"]')).toBeNull();
    expect(shownTarget()).toBe('21.0 °C');
    const raise = button('Raise room target by 0.5 degrees Celsius');
    expect(raise.disabled).toBe(false);
    act(() => raise.click());
    expect(shownTarget()).toBe('21.5 °C');
    expect(document.querySelector('.climate-target-label')?.textContent).toBe('Saving target');
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService.mock.calls).toEqual([
      [
        {
          domain: 'input_number',
          service: 'set_value',
          target: { entity_id: 'input_number.heating_target_family' },
          serviceData: { value: 21.5 },
        },
      ],
    ]);
  });

  it('lowers the live target in the helper step', async () => {
    const callService = openLiving(targetHelper('22', { step: 2 }));
    act(() => button('Lower room target by 2 degrees Celsius').click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith(expect.objectContaining({ service: 'set_value', serviceData: { value: 20 } }));
  });

  it('is not held by the thermostat limits once the zone is live, only by the helper range', async () => {
    const callService = openLiving(targetHelper('21.5'));
    const raise = button('Raise room target by 0.5 degrees Celsius');
    expect(raise.disabled).toBe(false);
    act(() => raise.click());
    act(() => raise.click());
    expect(shownTarget()).toBe('22.5 °C');
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).toHaveBeenCalledTimes(1);
    expect(callService).toHaveBeenCalledWith(expect.objectContaining({ serviceData: { value: 22.5 } }));
  });

  it.each([
    ['maximum', '24', 'Raise', 'Lower'],
    ['minimum', '19', 'Lower', 'Raise'],
  ])('stops the live target at the helper %s', (_edge, state, blocked, free) => {
    openLiving(targetHelper(state));
    expect(button(`${blocked} room target by 0.5 degrees Celsius`).disabled).toBe(true);
    expect(button(`${free} room target by 0.5 degrees Celsius`).disabled).toBe(false);
  });

  it('shows the live base target but writes nothing without the target helper', async () => {
    const callService = openLiving(zone('family', '21.0', { live: true, base_target: 21 }));
    expect(shownTarget()).toBe('21.0 °C');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.climate-step')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(step => step.disabled)).toBe(true);
    act(() => buttons.forEach(step => step.click()));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).not.toHaveBeenCalled();
  });
});

describe('the kitchen heating controls', () => {
  function openKitchen(...extra: ReturnType<typeof entity>[]) {
    return openRoom('Kitchen', 'kitchen', [
      entity('sensor.heating_controller', 'live'),
      entity('input_boolean.heating_season', 'on'),
      entity('climate.family_room_thermostat', 'heat', { temperature: 22, current_temperature: 23.1, min_temp: 5, max_temp: 40 }),
      zone('family', '22.0', { live: 'true', base_target: 22 }),
      entity('input_number.heating_target_family', '22', { min: 19, max: 24, step: 0.5 }),
      ...extra,
    ]);
  }

  it('steps the shared family target helper while that zone is live', async () => {
    const callService = openKitchen();
    expect(document.querySelector('.climate-shared')?.textContent).toBe('Shared with the living area');
    expect(document.querySelector('.climate-control-heading strong')?.textContent).toBe('Room target');
    act(() => (document.querySelector('[aria-label="Lower room target by 0.5 degrees Celsius"]') as HTMLButtonElement).click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService.mock.calls).toEqual([
      [
        {
          domain: 'input_number',
          service: 'set_value',
          target: { entity_id: 'input_number.heating_target_family' },
          serviceData: { value: 21.5 },
        },
      ],
    ]);
  });

  it('steps the family thermostat while that zone is only shadowed', async () => {
    const callService = openKitchen(zone('family', '22.0', { live: 'false', base_target: 22 }));
    expect(document.querySelector('.climate-control-heading strong')?.textContent).toBe('Heating target');
    act(() => (document.querySelector('[aria-label="Lower heating target by 0.5 degrees Celsius"]') as HTMLButtonElement).click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService.mock.calls).toEqual([
      [
        {
          domain: 'climate',
          service: 'set_temperature',
          target: { entity_id: 'climate.family_room_thermostat' },
          serviceData: { temperature: 21.5 },
        },
      ],
    ]);
  });
});

describe("Kristine's room heating controls", () => {
  it('presses the nudge buttons of a live zone that has them instead of stepping a target', () => {
    const callService = openRoom("Kristine's room", 'kristines_room', [
      entity('sensor.heating_controller', 'live'),
      entity('input_boolean.heating_season', 'on'),
      entity('climate.kristines_room_thermostat', 'heat', { temperature: 21.5, current_temperature: 22.3, min_temp: 5, max_temp: 40 }),
      zone('kristines_room', '21.5', { live: 'true', nudge_min: '-1.0', nudge_max: '+1.0' }),
      entity('input_button.heating_kristines_room_warmer', 'unknown'),
      entity('input_button.heating_kristines_room_colder', 'unknown'),
    ]);
    expect(document.querySelector('[aria-label="Raise heating target by 0.5 degrees Celsius"]')).toBeNull();
    expect(document.querySelector('[aria-label="Raise room target by 0.5 degrees Celsius"]')).toBeNull();
    act(() => (document.querySelector('[aria-label="Warmer"]') as HTMLButtonElement).click());
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.heating_kristines_room_warmer' },
    });
  });
});

type Published = ReturnType<typeof entity>;

/** The page over the off-season fixture with `extra` entities added (or replaced). */
function renderPage(...extra: Published[]) {
  const entities = offSeason();
  for (const e of extra) entities[e.entity_id] = e;
  hass.entities = entities;
  act(() => root.render(createElement(HeatingPage, { onClose: () => {} })));
}

const clock = (hour: number, minute = 0) => new Date(2026, 10, 5, hour, minute);
const unixSeconds = (hour: number, minute = 0) => clock(hour, minute).getTime() / 1000;
/** A moment of 5 November as a share of the day, in percent. */
const percent = (minutes: number) => (minutes / 1440) * 100;
const flush = () => act(async () => {});

/** Call hours of 5 November per zone: so far today, yesterday, the plan for today and a sunless day. */
const HEAT_HOURS: Record<string, [number, number, number, number]> = {
  family: [3.8, 5.1, 5.2, 9],
  kristines_room: [0.6, 0.4, 1.6, 2],
  claudias_room: [0.5, 0.9, 3.2, 3.5],
  bathroom: [1.5, 2, 2.4, 3],
  guest_bathroom: [0.9, 1, 1, 1],
};

const heatDay = () =>
  Object.entries(HEAT_HOURS).map(([id, [today, yesterday, plan, sunless]]) =>
    zone(id, '21.5', {
      control_air: 21.5,
      call_hours_today: today,
      budget_today_h: plan,
      budget_dull_h: sunless,
      yesterday: { day: '2026-11-04', call_hours: yesterday },
    })
  );

const calling = (room: string) => entity(`climate.${room}_thermostat`, 'heat', { hvac_action: 'heating' });
const idle = (room: string) => entity(`climate.${room}_thermostat`, 'heat', { hvac_action: 'idle' });

describe('the header', () => {
  const header = () => document.querySelector('.heating-page-header') as HTMLElement;
  const pills = () => [...header().querySelectorAll('.heat-pill')].map(pill => pill.getAttribute('aria-label'));

  it('has the live pill, the writes and the alerts, and none of the pipe probes', () => {
    renderPage(
      entity('sensor.heating_controller', 'off_season', { alerts_active: ['stale input', 'no reading'], would_writes_today: '9' }),
      entity(HEATING_SUPPLY_TEMP_SENSOR, '28.34'),
      entity(HEATING_RETURN_TEMP_SENSOR, '24.06'),
      entity(BUILDING_SUPPLY_TEMP_SENSOR, '48.6'),
      entity(BUILDING_RETURN_TEMP_SENSOR, '33.9')
    );
    expect(pills()).toEqual(['Shadow mode', '9 would-writes today', '2 active alerts']);
    expect(icons(header())).toEqual(['mdi:radiator-off', 'mdi:eye-outline', 'mdi:pencil-outline', 'mdi:alert']);
    expect(header().querySelector('.heat-probes')).toBeNull();
    expect(header().querySelector('[aria-label*="pipe"], [aria-label*="Building"]')).toBeNull();
  });

  it('counts the zones that are live', () => {
    renderPage(zone('family', '21.5', { live: 'true' }));
    expect(pills()).toEqual(['1 of 5 zones live', '9 writes today']);
    expect(header().textContent).toContain('1/5');
    expect(icons(header())).toContain('mdi:access-point');
  });
});

describe('the heat card', () => {
  const card = () => document.querySelector('.heat-demand') as HTMLElement;
  const labelled = (text: string) => card().querySelector(`[aria-label="${text}"]`) as HTMLElement | null;

  it('shows the estimated kWh so far today with its cost and the hours called', () => {
    renderPage(...heatDay(), entity('sensor.ista_heat_price', '1.031'));
    expect(card().getAttribute('aria-label')).toBe('Heat today');
    expect(card().querySelector('.heat-demand-kwh')?.textContent).toBe('4.9kWh');
    expect(labelled('About 5.1 kroner')?.textContent).toBe('5.1 kr');
    expect(labelled('7.3 hours called today')?.textContent).toBe('7.3 h');
  });

  it('leaves the cost out while the heat price is unknown', () => {
    renderPage(...heatDay(), entity('sensor.ista_heat_price', 'unavailable'));
    expect(card().querySelector('[aria-label^="About"]')).toBeNull();
    expect(labelled('7.3 hours called today')).not.toBeNull();
  });

  it('puts yesterday, the plan and a sunless day on the scale of today as ticks in kWh', () => {
    renderPage(...heatDay());
    const values = [...card().querySelectorAll('.heat-demand-tick-value')];
    expect(values.map(value => value.textContent)).toEqual(['6.5', '8.2', '12.8']);
    expect(values.map(value => value.getAttribute('aria-label'))).toEqual([
      'Yesterday 6.5 kilowatt hours',
      'Planned for today 8.2 kilowatt hours',
      'A sunless day 12.8 kilowatt hours',
    ]);
    expect(icons(card().querySelector('.heat-demand-scale')!)).toEqual([
      'mdi:calendar-arrow-left',
      'mdi:robot-outline',
      'mdi:weather-cloudy',
    ]);
    expect(card().querySelectorAll('.heat-demand-tick')).toHaveLength(3);
    const fill = card().querySelector('.heat-demand-fill') as HTMLElement;
    expect(parseFloat(fill.style.width)).toBeCloseTo((4.905 / 12.785) * 100, 3);
    const ticks = [...card().querySelectorAll<HTMLElement>('.heat-demand-tick')].map(tick => parseFloat(tick.style.left));
    expect(ticks[2]).toBe(100);
    expect(ticks[1]).toBeCloseTo((8.188 / 12.785) * 100, 3);
  });

  it('leaves out a tick whose series no zone publishes', () => {
    renderPage(zone('family', '21.5', { call_hours_today: 1, budget_today_h: 4 }));
    expect([...card().querySelectorAll('.heat-demand-tick-value')].map(value => value.textContent)).toEqual(['4.4']);
  });

  it('is hidden while no zone publishes its call hours today, and the rest of the page stays', () => {
    renderPage(zone('family', '21.5', { budget_today_h: 4 }));
    expect(document.querySelector('.heat-demand')).toBeNull();
    expect(document.querySelectorAll('button.heat-zone-row')).toHaveLength(5);
  });

  it('lights the zones that call now and shows what the pump draws', () => {
    renderPage(...heatDay(), entity('sensor.floor_heating_relay_power', '16.3'), calling('family_room'));
    const callers = card().querySelector('.heat-demand-callers') as HTMLElement;
    expect(callers.getAttribute('aria-label')).toBe("Calling now: Family, Kristine's room");
    expect([...callers.querySelectorAll('.heat-zone-glyph')].map(glyph => glyph.classList.contains('is-calling'))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    const pump = labelled('Floor heating pump 16 watts');
    expect(pump?.textContent).toBe('16 W');
    expect(pump?.classList.contains('is-calling')).toBe(true);
    expect(icons(pump!)).toEqual(['mdi:fire']);
  });

  it('shows the pump at rest, with nothing lit, while no zone calls', () => {
    renderPage(...heatDay(), idle('kristines_room'), entity('sensor.floor_heating_relay_power', '1.5'));
    const callers = card().querySelector('.heat-demand-callers') as HTMLElement;
    expect(callers.getAttribute('aria-label')).toBe('Calling now: none');
    expect(callers.querySelector('.is-calling')).toBeNull();
    const pump = labelled('Floor heating pump 1.5 watts');
    expect(pump?.textContent).toBe('1.5 W');
    expect(pump?.classList.contains('is-calling')).toBe(false);
    expect(icons(pump!)).toEqual(['mdi:fire-off']);
  });

  it('has no pump chip without the relay sensor', () => {
    renderPage(...heatDay());
    expect(card().querySelector('[aria-label^="Floor heating pump"]')).toBeNull();
  });

  it('draws one lane per zone with its hours against its budget, and where the day is now', () => {
    renderPage(...heatDay(), idle('kristines_room'));
    const lanes = [...card().querySelectorAll('.heat-demand-lane')];
    expect(lanes.map(lane => lane.getAttribute('aria-label'))).toEqual([
      'Family, called 3.8 h today, of 5.2 h planned',
      "Kristine's room, called 0.6 h today, of 1.6 h planned",
      "Claudia's room, called 0.5 h today, of 3.2 h planned",
      'Bathroom, called 1.5 h today, of 2.4 h planned',
      'Guest bathroom, called 0.9 h today, of 1.0 h planned',
    ]);
    expect([...card().querySelectorAll('.heat-demand-hours')].map(hours => hours.textContent)).toEqual([
      '3.8/5.2',
      '0.6/1.6',
      '0.5/3.2',
      '1.5/2.4',
      '0.9/1.0',
    ]);
    expect([...card().querySelectorAll('.heat-demand-axis span')].map(tick => tick.textContent)).toEqual(['00', '06', '12', '18', '24']);
    const lanesBox = card().querySelector('.heat-demand-lanes') as HTMLElement;
    expect(parseFloat(lanesBox.style.getPropertyValue('--now'))).toBeCloseTo(percent(11 * 60 + 35), 6);
  });

  it('marks the lane of a zone that is calling now', () => {
    renderPage(...heatDay(), idle('kristines_room'), calling('bathroom'));
    const labels = [...card().querySelectorAll('.heat-demand-lane')].map(lane => lane.getAttribute('aria-label'));
    expect(labels.filter(label => label?.endsWith('calling now'))).toEqual(['Bathroom, called 1.5 h today, of 2.4 h planned, calling now']);
  });

  it('draws the planned cuts of a zone faintly behind its calls, and the holds not at all', () => {
    renderPage(
      ...heatDay(),
      zone('family', '21.5', {
        call_hours_today: 3.8,
        day_blocks: [
          { start: '00:00', end: '06:00', mode: 'hold', setpoint: '21.5' },
          { start: '06:00', end: '15:00', mode: 'sun_cut', setpoint: '21.0' },
          { start: '15:00', end: '24:00', mode: 'hold', setpoint: '21.5' },
        ],
      })
    );
    const bands = [...document.querySelectorAll<HTMLElement>('.heat-demand-lane')[0].querySelectorAll<HTMLElement>('.heat-demand-band')];
    expect(bands.map(band => band.className)).toEqual(['heat-demand-band mode-sun_cut']);
    expect(parseFloat(bands[0].style.left)).toBeCloseTo(25, 6);
    expect(parseFloat(bands[0].style.width)).toBeCloseTo(37.5, 6);
  });
});

describe('the call lanes', () => {
  const lane = (index: number) => document.querySelectorAll('.heat-demand-lane')[index];
  const spans = (index: number) =>
    [...lane(index).querySelectorAll<HTMLElement>('.heat-demand-call')].map(span => [
      parseFloat(span.style.left),
      parseFloat(span.style.width),
    ]);
  const expectSpans = (actual: number[][], expected: number[][]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((span, i) => {
      expect(span[0]).toBeCloseTo(expected[i][0], 6);
      expect(span[1]).toBeCloseTo(expected[i][1], 6);
    });
  };
  const live = (zoneId: HeatingZone, state: string, changedAt: Date) => ({
    ...entity(zoneCallSensorId(zoneId), state),
    last_changed: changedAt.toISOString(),
  });
  const requests = () => (hass.history as Mock).mock.calls;
  const lastRequest = () => requests()[requests().length - 1][0];

  it("reads today's history of the five call sensors when the page opens", async () => {
    renderPage(...heatDay());
    await flush();
    expect(lastRequest()).toEqual({
      type: 'history/history_during_period',
      start_time: clock(0).toISOString(),
      end_time: clock(11, 35).toISOString(),
      entity_ids: HEATING_ZONES.map(zoneCallSensorId),
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
  });

  it('draws the stretches each zone called from its history', async () => {
    hass.history = vi.fn().mockResolvedValue({
      [zoneCallSensorId('family')]: [
        { s: 'off', lu: unixSeconds(0) },
        { s: 'on', lu: unixSeconds(6) },
        { s: 'off', lu: unixSeconds(7, 30) },
        { s: 'on', lu: unixSeconds(9) },
        { s: 'off', lu: unixSeconds(9, 20) },
      ],
      [zoneCallSensorId('bathroom')]: [
        { s: 'on', lu: unixSeconds(0) },
        { s: 'off', lu: unixSeconds(1) },
      ],
    });
    renderPage(...heatDay(), idle('kristines_room'));
    await flush();
    expectSpans(spans(0), [
      [percent(360), percent(90)],
      [percent(540), percent(20)],
    ]);
    expectSpans(spans(1), []);
    expectSpans(spans(3), [[0, percent(60)]]);
  });

  it('extends a call in progress to now, and ends one that stopped since the history was read', async () => {
    hass.history = vi.fn().mockResolvedValue({
      [zoneCallSensorId('family')]: [
        { s: 'off', lu: unixSeconds(0) },
        { s: 'on', lu: unixSeconds(10) },
      ],
      [zoneCallSensorId('bathroom')]: [
        { s: 'off', lu: unixSeconds(0) },
        { s: 'on', lu: unixSeconds(10) },
      ],
    });
    renderPage(...heatDay(), live('family', 'on', clock(10)), live('bathroom', 'off', clock(11)));
    await flush();
    expectSpans(spans(0), [[percent(600), percent(95)]]);
    expectSpans(spans(3), [[percent(600), percent(60)]]);
  });

  it('draws the call in progress from the live sensor before the history arrives', () => {
    renderPage(...heatDay(), live('family', 'on', clock(10)));
    expectSpans(spans(0), [[percent(600), percent(95)]]);
    expectSpans(spans(1), []);
  });

  it('reads the history again every five minutes and moves the call in progress along', async () => {
    hass.history = vi.fn().mockResolvedValue({
      [zoneCallSensorId('family')]: [
        { s: 'off', lu: unixSeconds(0) },
        { s: 'on', lu: unixSeconds(10) },
      ],
    });
    renderPage(...heatDay(), live('family', 'on', clock(10)));
    await flush();
    const before = requests().length;
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60 * 1000));
    expect(requests()).toHaveLength(before + 1);
    expectSpans(spans(0), [[percent(600), percent(100)]]);
  });

  it('keeps what it has when a read fails', async () => {
    hass.history = vi.fn().mockRejectedValue(new Error('connection closed'));
    renderPage(...heatDay(), live('family', 'on', clock(10)));
    await flush();
    expectSpans(spans(0), [[percent(600), percent(95)]]);
  });

  it('reads the history of the new day when the day turns', async () => {
    vi.setSystemTime(new Date(2026, 10, 5, 23, 58));
    renderPage(...heatDay());
    await flush();
    expect(lastRequest().start_time).toBe(clock(0).toISOString());
    await act(async () => vi.advanceTimersByTimeAsync(3 * 60 * 1000));
    expect(lastRequest().start_time).toBe(new Date(2026, 10, 6).toISOString());
  });

  it('draws the calls of a zone under the plan strip of its sheet', async () => {
    hass.history = vi.fn().mockResolvedValue({
      [zoneCallSensorId('family')]: [
        { s: 'off', lu: unixSeconds(0) },
        { s: 'on', lu: unixSeconds(6) },
        { s: 'off', lu: unixSeconds(7, 30) },
      ],
    });
    renderPage(
      ...heatDay(),
      zone('family', '21.5', { call_hours_today: 3.8, day_blocks: [{ start: '00:00', end: '24:00', mode: 'hold', setpoint: '21.5' }] })
    );
    await flush();
    act(() => (document.querySelector('button.heat-zone-row') as HTMLElement).click());
    const sheet = document.querySelector('.heat-zone-sheet') as HTMLElement;
    const calls = [...sheet.querySelectorAll<HTMLElement>('.heat-day-calls .heat-day-call')];
    expectSpans(
      calls.map(call => [parseFloat(call.style.left), parseFloat(call.style.width)]),
      [[percent(360), percent(90)]]
    );
  });
});

describe('the zone rows', () => {
  const rows = () => [...document.querySelectorAll('button.heat-zone-row')];
  const chips = (row: Element) => [...row.querySelectorAll('.heat-badge')];
  const gapOf = (row: Element) => row.querySelector('.heat-zone-gap');

  it('shows the air big and under it how far it is from the target, with the sign', () => {
    renderPage(
      zone('family', '22.5', { control_air: 22.1 }),
      zone('kristines_room', '22.5', { control_air: 23.1 }),
      zone('claudias_room', '22.5', { control_air: 21.9 }),
      zone('bathroom', '22.5', { control_air: 22.5 }),
      zone('guest_bathroom', 'unavailable', { control_air: 22.4 })
    );
    expect(rows().map(row => row.querySelector('.heat-zone-air')?.textContent)).toEqual(['22.1°', '23.1°', '21.9°', '22.5°', '22.4°']);
    expect(rows().map(row => gapOf(row)?.textContent ?? null)).toEqual(['−0.4', '+0.6', '−0.6', '0.0', null]);
    expect(rows().map(row => gapOf(row)?.className ?? null)).toEqual([
      'heat-zone-gap is-ok',
      'heat-zone-gap is-warm',
      'heat-zone-gap is-cold',
      'heat-zone-gap is-ok',
      null,
    ]);
    expect(rows().map(row => row.getAttribute('aria-label'))).toEqual([
      'Family, air 22.1 °C, target 22.5 °C, 0.4 °C below target',
      "Kristine's room, air 23.1 °C, target 22.5 °C, 0.6 °C above target, heating",
      "Claudia's room, air 21.9 °C, target 22.5 °C, 0.6 °C below target",
      'Bathroom, air 22.5 °C, target 22.5 °C, on target',
      'Guest bathroom, air 22.4 °C',
    ]);
  });

  it('keeps half a degree either way as on target, grey', () => {
    renderPage(zone('family', '22.5', { control_air: 23 }), zone('kristines_room', '22.5', { control_air: 22 }));
    const [warmest, coldest] = rows();
    expect([warmest, coldest].map(row => gapOf(row)?.className)).toEqual(['heat-zone-gap is-ok', 'heat-zone-gap is-ok']);
    expect([warmest, coldest].map(row => gapOf(row)?.textContent)).toEqual(['+0.5', '−0.5']);
  });

  it('shows the floor against its cap and nothing else when the floor is at the cap', () => {
    renderPage(
      zone('family', '21.5', {
        control_air: 23.7,
        plan_mode: 'floor_cap',
        floor_temp: 24.3,
        floor_max_c: 24.5,
        setpoint_now: 19,
        next_setpoint: 21.5,
        next_change_at: '23:00',
      })
    );
    const [family] = rows();
    expect(chips(family)).toHaveLength(1);
    expect(chips(family)[0].className).toBe('heat-badge is-floor');
    expect(chips(family)[0].textContent).toBe('24.3/24.5');
    expect(icons(chips(family)[0])).toEqual(['mdi:heating-coil']);
  });

  it('shows the plan mode with its next change when the floor is not at its cap', () => {
    renderPage(
      zone('kristines_room', '21.5', {
        control_air: 21.9,
        plan_mode: 'window',
        floor_temp: 22.1,
        floor_max_c: 24.5,
        setpoint_now: 19,
        next_setpoint: 21.5,
        next_change_at: '06:30',
      })
    );
    const chip = chips(rows()[1]);
    expect(chip).toHaveLength(1);
    expect(chip[0].className).toBe('heat-badge is-mode mode-window');
    expect(chip[0].textContent).toBe('21.5 06:30');
    expect(icons(chip[0])).toEqual(['mdi:window-open-variant', 'mdi:arrow-up']);
  });

  it('shows the next setpoint change as an arrow and a time while the plan is held', () => {
    renderPage(zone('claudias_room', '21.5', { setpoint_now: 21.5, next_setpoint: 19, next_change_at: '23:00' }));
    const chip = chips(rows()[2]);
    expect(chip).toHaveLength(1);
    expect(chip[0].className).toBe('heat-badge');
    expect(chip[0].textContent).toBe('19.0 23:00');
    expect(icons(chip[0])).toEqual(['mdi:arrow-down']);
  });

  it('shows no chip when the plan is held and nothing is coming', () => {
    renderPage(zone('bathroom', '21.5', {}));
    expect(chips(rows()[3])).toEqual([]);
    expect(rows()[3].querySelector('.heat-zone-chips')).toBeNull();
  });

  it('never shows more than one chip on a row, and no loop returns or floor trio', () => {
    renderPage(
      zone('family', '21.5', {
        control_air: 23.7,
        plan_mode: 'floor_cap',
        floor_temp: 24.5,
        floor_max_c: 24.5,
        floor_temps: { [LIVING_FLOOR]: 24, [DINING_FLOOR]: 24.5 },
        next_setpoint: 21,
        next_change_at: '23:00',
      }),
      zone('kristines_room', '21.5', { plan_mode: 'guard', floor_temp: 22, floor_max_c: 24.5, next_setpoint: 19, next_change_at: '23:00' }),
      entity(loopReturnSensorId(1), '32.4'),
      entity(loopReturnSensorId(4), '34.7'),
      entity(HEATING_SUPPLY_TEMP_SENSOR, '41.3')
    );
    for (const row of rows()) expect(chips(row).length).toBeLessThanOrEqual(1);
    expect(document.querySelector('.heat-loop, .heat-zone-floor, .heat-zone-target, .heat-zone-loops')).toBeNull();
  });
});

describe('the plant strip', () => {
  const strip = () => document.querySelector('.heat-plant-strip') as HTMLElement;
  const readings = () => [...strip().querySelectorAll('.heat-plant-probe')].map(probe => probe.textContent);

  it('lists the four probes in the order the water passes them, with an icon for whether it flows', () => {
    renderPage(
      entity(BUILDING_RETURN_TEMP_SENSOR, '21.06'),
      entity(HEATING_RETURN_TEMP_SENSOR, '24.4'),
      entity(BUILDING_SUPPLY_TEMP_SENSOR, '22.69'),
      entity(HEATING_SUPPLY_TEMP_SENSOR, '25.1'),
      idle('kristines_room')
    );
    expect(readings()).toEqual(['22.7', '25.1', '24.4', '21.1']);
    expect([...strip().querySelectorAll('.heat-plant-probe')].flatMap(probe => icons(probe))).toEqual([
      'mdi:home-import-outline',
      'mdi:thermometer-chevron-up',
      'mdi:thermometer-chevron-down',
      'mdi:home-export-outline',
    ]);
    expect(icons(strip())).toContain('mdi:pause');
    expect(icons(strip())).not.toContain('mdi:waves-arrow-right');
    expect(strip().getAttribute('aria-label')).toBe(
      'Plant: building supply 22.7 °C, floor supply 25.1 °C, floor return 24.4 °C, building return 21.1 °C, idle'
    );
  });

  it('shows the water flowing while a zone calls', () => {
    renderPage(entity(HEATING_SUPPLY_TEMP_SENSOR, '25.1'));
    expect(icons(strip())).toContain('mdi:waves-arrow-right');
    expect(icons(strip())).not.toContain('mdi:pause');
    expect(strip().getAttribute('aria-label')).toMatch(/, water flowing$/);
  });

  it('keeps a probe without a reading in place as a dash', () => {
    renderPage(
      entity(BUILDING_SUPPLY_TEMP_SENSOR, '22.7'),
      entity(HEATING_SUPPLY_TEMP_SENSOR, 'unavailable'),
      entity(HEATING_RETURN_TEMP_SENSOR, 'unknown'),
      idle('kristines_room')
    );
    expect(readings()).toEqual(['22.7', '—', '—', '—']);
    expect([...strip().querySelectorAll('.heat-plant-probe.is-unavailable')]).toHaveLength(3);
    expect(strip().getAttribute('aria-label')).toBe(
      'Plant: building supply 22.7 °C, floor supply unavailable, floor return unavailable, building return unavailable, idle'
    );
  });

  it('is hidden when the flat has none of the probes', () => {
    renderPage();
    expect(strip()).toBeNull();
  });

  it('closes the page below the zone rows, and opens the plant view', () => {
    renderPage(entity(HEATING_SUPPLY_TEMP_SENSOR, '25.1'));
    expect(strip().previousElementSibling?.classList.contains('heat-zones')).toBe(true);
    expect(strip().nextElementSibling).toBeNull();
    expect(document.querySelector('.heat-plant-sheet')).toBeNull();
    act(() => strip().click());
    expect(document.querySelector('.heat-plant-sheet [role="dialog"][aria-label="Plant"]')).not.toBeNull();
  });
});

describe('the plant view', () => {
  const RETURNS = [32.4, 31.1, 30.2, 34.7, 22.1, 33, 36.8];
  const plant = (...extra: Published[]) => {
    renderPage(
      entity(BUILDING_SUPPLY_TEMP_SENSOR, '48.6'),
      entity(HEATING_SUPPLY_TEMP_SENSOR, '41.3'),
      entity(HEATING_RETURN_TEMP_SENSOR, '33.8'),
      entity(BUILDING_RETURN_TEMP_SENSOR, '33.9'),
      ...RETURNS.map((tempC, index) => entity(loopReturnSensorId(index + 1), String(tempC))),
      idle('kristines_room'),
      ...extra
    );
    act(() => (document.querySelector('.heat-plant-strip') as HTMLElement).click());
  };
  const loops = () =>
    [...document.querySelectorAll('.heat-plant-loops tbody tr')].map(row =>
      [...row.querySelectorAll('th, td')].map(cell => cell.textContent)
    );
  const watts = () => loops().map(cells => cells[5]);

  it('shows the supply and return of the building and of the floor with the drop across each', () => {
    plant();
    const label = (text: string) => document.querySelector(`.heat-plant-sheet [aria-label="${text}"]`);
    expect(label('Building supply 48.6 °C')?.textContent).toBe('Building48.6');
    expect(label('Floor supply 41.3 °C')?.textContent).toBe('Floor41.3');
    expect(label('Floor return 33.8 °C')?.textContent).toBe('Floor33.8');
    expect(label('Building return 33.9 °C')?.textContent).toBe('Building33.9');
    expect(label('Building supply to return 14.7 °C')?.textContent).toBe('Δ 14.7');
    expect(label('Building supply to floor supply 7.3 °C')?.textContent).toBe('Δ 7.3');
    expect(label('Floor supply to return 7.5 °C')?.textContent).toBe('Δ 7.5');
  });

  it('has one row per loop with its flow, its return, the drop from the floor supply and its power', () => {
    plant(calling('family_room'));
    expect(loops()).toEqual([
      ['1', '', '1.2', '32.4', '8.9', '745'],
      ['2', 'K', '1.0', '31.1', '10.2', '—'],
      ['3', 'C', '0.8', '30.2', '11.1', '—'],
      ['4', '', '1.7', '34.7', '6.6', '783'],
      ['5', '', '1.1', '22.1', '19.2', '—'],
      ['6', '', '0.3', '33.0', '8.3', '—'],
      ['7', '', '1.2', '36.8', '4.5', '—'],
    ]);
    expect([...document.querySelectorAll('.heat-plant-loops tbody tr')].map(row => row.className)).toEqual([
      'is-calling',
      'is-idle',
      'is-idle',
      'is-calling',
      'is-idle',
      'is-idle',
      'is-idle',
    ]);
  });

  it('gives a loop a power only while its zone calls', () => {
    plant(calling('claudias_room'), calling('guest_bathroom'));
    expect(watts()).toEqual([
      '—',
      '—',
      String(Math.round(0.8 * (41.3 - 30.2) * 69.8)),
      '—',
      '—',
      String(Math.round(0.3 * (41.3 - 33) * 69.8)),
      '—',
    ]);
  });

  it('reads the bedroom loop from the bedroom thermostat', () => {
    plant(calling('bedroom'));
    expect(watts()).toEqual(['—', '—', '—', '—', String(Math.round(1.1 * (41.3 - 22.1) * 69.8)), '—', '—']);
  });

  it('gives no loop a power while no zone calls, however warm its return reads', () => {
    plant();
    expect(watts()).toEqual(['—', '—', '—', '—', '—', '—', '—']);
    expect(document.querySelector('.heat-plant-loops tr.is-calling')).toBeNull();
  });

  it('gives a calling loop a dash while its return has no reading', () => {
    plant(calling('bathroom'), entity(loopReturnSensorId(7), 'unavailable'));
    expect(loops()[6]).toEqual(['7', '', '1.2', '—', '—', '—']);
  });

  it('shows the pump with whether the water flows', () => {
    plant(entity('sensor.floor_heating_relay_power', '1.5'));
    const pump = () => document.querySelector('.heat-plant-sheet [aria-label^="Pump"]') as HTMLElement;
    expect(pump().getAttribute('aria-label')).toBe('Pump 1.5 watts, idle');
    plant(entity('sensor.floor_heating_relay_power', '16.3'), calling('family_room'));
    expect(pump().getAttribute('aria-label')).toBe('Pump 16 watts, water flowing');
  });
});

describe('the bedroom row', () => {
  const AC = 'climate.air_conditioner_thermostat';
  const feel = entity('sensor.bedroom_feel', '21.34', { headline: '21.3 °C · comfortable' });
  const thermostat = entity('climate.bedroom_thermostat', 'off', { current_temperature: 22.9, hvac_action: 'off' });
  const row = () => document.querySelector('.heat-zone-row.is-monitor') as HTMLElement;
  const air = () => row().querySelector('.heat-zone-air')?.textContent;

  it('closes the zone list as a read-only row with the room temperature and a no-heat icon', () => {
    renderPage(feel, thermostat);
    const rows = [...document.querySelectorAll('.heat-zones > .heat-zone-row')];
    expect(rows).toHaveLength(6);
    expect(rows[5]).toBe(row());
    expect(row().tagName).toBe('DIV');
    expect(row().querySelector('.heat-zone-name')?.textContent).toBe('Bedroom');
    expect(air()).toBe('21.3°');
    expect(row().querySelector('.heat-zone-temps')?.classList.contains('tone-fresh')).toBe(true);
    expect(icons(row())).toEqual(['mdi:bed-outline', 'mdi:radiator-off']);
    expect([...row().querySelectorAll('.heat-badge')].map(chip => chip.className)).toEqual(['heat-badge is-off']);
    expect(row().querySelector('.heat-zone-gap, .heat-zone-target, .heat-zone-floor')).toBeNull();
    expect(row().getAttribute('aria-label')).toBe('Bedroom, air 21.3 °C, not heated');
  });

  it('keeps the floor of the room in its label and off the row', () => {
    renderPage(feel, entity(BEDROOM_FLOOR_ENTITY, '22.34'));
    expect(row().getAttribute('aria-label')).toBe('Bedroom, air 21.3 °C, floor 22.3 °C, not heated');
    expect(row().textContent).not.toContain('22.3');
  });

  it('reads the thermostat when the feel sensor has no reading', () => {
    renderPage(entity('sensor.bedroom_feel', 'unavailable'), thermostat);
    expect(air()).toBe('22.9°');
    renderPage(thermostat);
    expect(air()).toBe('22.9°');
    renderPage();
    expect(air()).toBe('—');
    expect(row().getAttribute('aria-label')).toBe('Bedroom, air unknown, not heated');
  });

  it('adds a snowflake only while the A/C is cooling', () => {
    renderPage(feel, entity(AC, 'cool', { hvac_action: 'cooling' }));
    expect(icons(row())).toEqual(['mdi:bed-outline', 'mdi:radiator-off', 'mdi:snowflake']);
    expect(row().getAttribute('aria-label')).toBe('Bedroom, air 21.3 °C, not heated, A/C cooling');
    renderPage(feel, entity(AC, 'cool', { hvac_action: 'idle' }));
    expect(icons(row())).not.toContain('mdi:snowflake');
    renderPage(feel, entity(AC, 'unavailable'));
    expect(icons(row())).not.toContain('mdi:snowflake');
    renderPage(feel);
    expect(icons(row())).not.toContain('mdi:snowflake');
  });

  it('does nothing when tapped, unlike a zone row', () => {
    renderPage(feel);
    act(() => row().click());
    expect(document.querySelector('.heat-zone-sheet')).toBeNull();
    act(() => (document.querySelector('button.heat-zone-row') as HTMLElement).click());
    expect(document.querySelector('.heat-zone-sheet')).not.toBeNull();
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
