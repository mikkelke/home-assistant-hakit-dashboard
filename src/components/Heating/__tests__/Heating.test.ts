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
    expect(document.querySelectorAll('button.heat-zone-row')).toHaveLength(5);
    const family = document.querySelector('.heat-zone-row') as HTMLElement;
    expect(icons(family)).toContain('mdi:white-balance-sunny');
    expect(family.textContent).toMatch(/22\.0 \d\d:00/);
    expect(document.querySelector('.heat-pill.is-alert')).toBeNull();
    expect(document.querySelector('.heating-page-header')?.textContent).toContain('Shadow');
  });

  it('places living after kitchen and dining, with separate comfort readings and the floor-cap mode', () => {
    renderPage(
      zone('living', '21.0', { control_air: 22.3, plan_mode: 'floor_cap' }),
      entity('climate.living_room_thermostat', 'heat', { hvac_action: 'heating' }),
      entity('sensor.kitchen_feel', '23.7', { headline: '23.7 °C · warm' }),
      entity('sensor.living_room_feel', '22.3', { headline: '22.3 °C · comfortable' })
    );
    const rows = [...document.querySelectorAll('button.heat-zone-row')];
    expect(rows.map(row => row.querySelector('.heat-zone-name')?.textContent)).toEqual([
      'Kitchen & dining',
      'Living room',
      "Kristine's room",
      "Claudia's room",
      'Bathroom',
      'Guest bathroom',
    ]);
    expect(icons(rows[0])).toContain('mdi:silverware-fork-knife');
    expect(rows[0].querySelector('.heat-zone-temps')?.classList.contains('tone-warn')).toBe(true);
    expect(icons(rows[1])).toEqual(['mdi:sofa-outline', 'mdi:fire', 'mdi:heat-wave', 'mdi:target']);
    expect(rows[1].querySelector('.heat-zone-temps')?.classList.contains('tone-fresh')).toBe(true);
    expect(rows[1].getAttribute('aria-label')).toBe('Living room, air 22.3 °C, target 21.0 °C, heating, Floor too warm');
  });

  it('opens the living plan safely without its target helper or nudge buttons', async () => {
    const callService = vi.fn();
    hass.callService = callService;
    renderPage(
      zone('living', '21.0', {
        base_target: 21,
        plan_mode: 'floor_cap',
        setpoint_now: 19,
        day_blocks: [{ start: '00:00', end: '24:00', mode: 'floor_cap', setpoint: '19' }],
      })
    );
    act(() => (document.querySelectorAll('button.heat-zone-row')[1] as HTMLElement).click());
    expect(document.querySelector('[aria-label="Living room heating details"]')).not.toBeNull();
    expect(document.querySelector('.heat-day-block.mode-floor_cap')?.textContent).toBe('19.0');
    expect(icons(document.querySelector('.heat-day-icons')!)).toEqual(['mdi:heat-wave']);
    expect(document.querySelector('.climate-target-value')?.textContent).toBe('21.0 °C');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.climate-step')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.disabled)).toBe(true);
    act(() => buttons.forEach(button => button.click()));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).not.toHaveBeenCalled();
  });

  it('writes the living target helper when it exists', async () => {
    const callService = vi.fn();
    hass.callService = callService;
    renderPage(
      zone('living', '21.0', { base_target: 21 }),
      entity('input_number.heating_target_living', '21', { min: 19, max: 24, step: 0.5 })
    );
    act(() => (document.querySelectorAll('button.heat-zone-row')[1] as HTMLElement).click());
    act(() => (document.querySelector('[aria-label="Raise base target by 0.5 degrees Celsius"]') as HTMLButtonElement).click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_number',
      service: 'set_value',
      target: { entity_id: 'input_number.heating_target_living' },
      serviceData: { value: 21.5 },
    });
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

describe('the living room heating controls', () => {
  function openLiving(...extra: ReturnType<typeof entity>[]) {
    const callService = vi.fn();
    const list = [
      entity('sensor.heating_controller', 'live'),
      entity('input_boolean.heating_season', 'on'),
      entity('climate.living_room_thermostat', 'heat', { temperature: 21, current_temperature: 22.3, min_temp: 5, max_temp: 40 }),
      zone('living', '21.0', { live: 'true', lower_limit: 20.5, upper_limit: 21.5, nudge_min: '-1.0', nudge_max: '+1.0' }),
      zone('family', '24', { lower_limit: 23, upper_limit: 25 }),
      ...extra,
    ];
    const entities = Object.fromEntries(list.map(e => [e.entity_id, e]));
    act(() => root.render(createElement(RoomClimateHeader, { roomName: 'Living room', areaId: 'living_room', entities, callService })));
    act(() => (document.querySelector('.room-climate-chip') as HTMLButtonElement).click());
    return callService;
  }

  const shadowed = zone('living', '21.0', { live: 'false', lower_limit: 20.5, upper_limit: 21.5 });
  const targetHelper = (state: string, attributes: Record<string, unknown> = {}) =>
    entity('input_number.heating_target_living', state, { min: 19, max: 24, step: 0.5, ...attributes });
  const button = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
  const shownTarget = () => document.querySelector('.climate-target-value')?.textContent;

  it('steps its own thermostat within living limits while the zone is only shadowed', async () => {
    const callService = openLiving(shadowed, targetHelper('21'));
    expect(document.querySelector('.heat-dial')).not.toBeNull();
    expect(document.querySelector('.climate-shared')).toBeNull();
    expect(document.querySelector('[aria-label="Warmer"]')).toBeNull();
    expect(document.querySelector('.climate-control-heading strong')?.textContent).toBe('Heating target');
    expect(document.querySelector('[aria-label="Raise room target by 0.5 degrees Celsius"]')).toBeNull();
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
          target: { entity_id: 'climate.living_room_thermostat' },
          serviceData: { temperature: 21.5 },
        },
      ],
    ]);
  });

  it('steps the target helper instead of the locked thermostat once the zone is live', async () => {
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
          target: { entity_id: 'input_number.heating_target_living' },
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
    const callService = openLiving(zone('living', '21.0', { live: true, base_target: 21 }));
    expect(shownTarget()).toBe('21.0 °C');
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.climate-step')];
    expect(buttons).toHaveLength(2);
    expect(buttons.every(step => step.disabled)).toBe(true);
    act(() => buttons.forEach(step => step.click()));
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(callService).not.toHaveBeenCalled();
  });

  it('uses living nudge buttons when the live controller supplies both', () => {
    const callService = openLiving(
      entity('input_button.heating_living_warmer', 'unknown'),
      entity('input_button.heating_living_colder', 'unknown')
    );
    expect(document.querySelector('[aria-label="Raise heating target by 0.5 degrees Celsius"]')).toBeNull();
    expect(document.querySelector('[aria-label="Raise room target by 0.5 degrees Celsius"]')).toBeNull();
    act(() => (document.querySelector('[aria-label="Warmer"]') as HTMLButtonElement).click());
    expect(callService).toHaveBeenCalledWith({
      domain: 'input_button',
      service: 'press',
      target: { entity_id: 'input_button.heating_living_warmer' },
    });
  });
});

describe('the kitchen heating controls', () => {
  function openKitchen(...extra: ReturnType<typeof entity>[]) {
    const callService = vi.fn();
    const list = [
      entity('sensor.heating_controller', 'live'),
      entity('input_boolean.heating_season', 'on'),
      entity('climate.family_room_thermostat', 'heat', { temperature: 22, current_temperature: 23.1, min_temp: 5, max_temp: 40 }),
      zone('family', '22.0', { live: 'true', base_target: 22 }),
      entity('input_number.heating_target_family', '22', { min: 19, max: 24, step: 0.5 }),
      ...extra,
    ];
    const entities = Object.fromEntries(list.map(e => [e.entity_id, e]));
    act(() => root.render(createElement(RoomClimateHeader, { roomName: 'Kitchen', areaId: 'kitchen', entities, callService })));
    act(() => (document.querySelector('.room-climate-chip') as HTMLButtonElement).click());
    return callService;
  }

  it('steps the shared family target helper while that zone is live', async () => {
    const callService = openKitchen();
    expect(document.querySelector('.climate-shared')?.textContent).toBe('Shared by the kitchen, dining and hallway');
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

type Published = ReturnType<typeof entity>;

/** The page over the off-season fixture with `extra` entities added (or replaced). */
function renderPage(...extra: Published[]) {
  const entities = offSeason();
  for (const e of extra) entities[e.entity_id] = e;
  hass.entities = entities;
  act(() => root.render(createElement(HeatingPage, { onClose: () => {} })));
}

describe('the pipe probes', () => {
  const SUPPLY = 'sensor.heating_room_floor_heating_supply';
  const RETURN = 'sensor.heating_room_floor_heating_return';
  const header = () => document.querySelector('.heating-page-header') as HTMLElement;
  const probeIcons = () => icons(header()).filter(icon => icon?.startsWith('mdi:thermometer-chevron'));

  it('shows supply and return in the header with one decimal', () => {
    renderPage(entity(SUPPLY, '28.34'), entity(RETURN, '24.06'));
    expect(header().querySelector('[aria-label="Supply pipe 28.3 °C"]')?.textContent).toBe('28.3°');
    expect(header().querySelector('[aria-label="Return pipe 24.1 °C"]')?.textContent).toBe('24.1°');
    expect(probeIcons()).toEqual(['mdi:thermometer-chevron-up', 'mdi:thermometer-chevron-down']);
    expect(header().textContent).toContain('Shadow');
  });

  const hidden: [string, Published[], string[]][] = [
    ['an unavailable supply', [entity(SUPPLY, 'unavailable'), entity(RETURN, '24.1')], ['mdi:thermometer-chevron-down']],
    ['an unknown return', [entity(SUPPLY, '28.3'), entity(RETURN, 'unknown')], ['mdi:thermometer-chevron-up']],
    ['a missing supply', [entity(RETURN, '24.1')], ['mdi:thermometer-chevron-down']],
    ['a missing return', [entity(SUPPLY, '28.3')], ['mdi:thermometer-chevron-up']],
    ['both probes when neither exists', [], []],
  ];
  it.each(hidden)('hides %s', (_name, probes, shown) => {
    renderPage(...probes);
    expect(probeIcons()).toEqual(shown);
    expect(header().querySelector('.heat-probes') !== null).toBe(shown.length > 0);
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
    expect(row().querySelector('.heat-zone-target, .heat-badge')).toBeNull();
    expect(row().getAttribute('aria-label')).toBe('Bedroom, air 21.3 °C, not heated');
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
