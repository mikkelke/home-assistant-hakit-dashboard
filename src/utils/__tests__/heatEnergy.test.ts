import { describe, expect, it } from 'vitest';
import type { HassEntities } from '../../types';
import { HEATING_ZONES, zoneSensorId, type HeatingZone } from '../heating';
import { KW_FIT, heatCostKr, heatEnergy, heatScale, spreadLabels, type HeatEnergy } from '../heatEnergy';

const zoneSensor = (zone: HeatingZone, attributes: Record<string, unknown>) => ({
  entity_id: zoneSensorId(zone),
  state: '21.5',
  attributes,
});

const entitiesOf = (attrs: Partial<Record<HeatingZone, Record<string, unknown>>>): HassEntities =>
  Object.fromEntries(HEATING_ZONES.flatMap(zone => (attrs[zone] ? [[zoneSensorId(zone), zoneSensor(zone, attrs[zone])]] : [])));

const hoursToday = { family: 3.8, kristines_room: 0.6, claudias_room: 0.5, bathroom: 1.5, guest_bathroom: 0.9 };
const todayOf = (hours: Record<HeatingZone, number>) =>
  entitiesOf(Object.fromEntries(HEATING_ZONES.map(zone => [zone, { call_hours_today: hours[zone] }])));

describe('KW_FIT', () => {
  it('holds the season fit of every zone, and none for the guest bathroom', () => {
    expect(KW_FIT).toEqual({ family: 1.11, kristines_room: 0.37, claudias_room: 0.45, bathroom: 0.16, guest_bathroom: 0 });
  });
});

describe('heatEnergy', () => {
  it('weights each zone’s call hours by its kW and sums the zones', () => {
    const today = heatEnergy(todayOf(hoursToday)).today;
    expect(today?.hours).toBeCloseTo(7.3, 9);
    expect(today?.kwh).toBeCloseTo(3.8 * 1.11 + 0.6 * 0.37 + 0.5 * 0.45 + 1.5 * 0.16, 9);
    expect(today?.kwh).toBeCloseTo(4.905, 9);
  });

  it('adds nothing for the guest bathroom’s hours', () => {
    const entities = entitiesOf({ guest_bathroom: { call_hours_today: 6 } });
    expect(heatEnergy(entities).today).toEqual({ hours: 6, kwh: 0 });
  });

  it('reads the hours the controller publishes as strings', () => {
    const entities = entitiesOf({ family: { call_hours_today: '2.0' }, bathroom: { call_hours_today: '1.0' } });
    expect(heatEnergy(entities).today?.kwh).toBeCloseTo(2 * 1.11 + 1 * 0.16, 9);
  });

  it('counts a zone without the figure as zero', () => {
    const entities = entitiesOf({
      family: { call_hours_today: '2.0' },
      kristines_room: { call_hours_today: 'unknown' },
      claudias_room: {},
      bathroom: { call_hours_today: null },
    });
    expect(heatEnergy(entities).today).toEqual({ hours: 2, kwh: 2 * 1.11 });
  });

  it('is null for a series that no zone publishes', () => {
    const energy = heatEnergy(entitiesOf({ family: { call_hours_today: 1 }, kristines_room: { call_hours_today: 'unavailable' } }));
    expect(energy.today).not.toBeNull();
    expect(energy.yesterday).toBeNull();
    expect(energy.plan).toBeNull();
    expect(energy.sunless).toBeNull();
    expect(heatEnergy({})).toEqual({ today: null, yesterday: null, plan: null, sunless: null });
  });

  it('reads yesterday from the nested attribute, the plan from the budget and a sunless day from the dull budget', () => {
    const energy = heatEnergy(
      entitiesOf({
        family: { call_hours_today: 1, yesterday: { day: '2026-11-04', call_hours: '2.0' }, budget_today_h: '4.0', budget_dull_h: 8 },
        bathroom: { yesterday: { call_hours: 3 }, budget_today_h: 2, budget_dull_h: '5.0' },
        guest_bathroom: { yesterday: 'n/a', budget_today_h: 9 },
      })
    );
    expect(energy.today?.kwh).toBeCloseTo(1.11, 9);
    expect(energy.yesterday?.kwh).toBeCloseTo(2 * 1.11 + 3 * 0.16, 9);
    expect(energy.plan?.kwh).toBeCloseTo(4 * 1.11 + 2 * 0.16, 9);
    expect(energy.plan?.hours).toBeCloseTo(15, 9);
    expect(energy.sunless?.kwh).toBeCloseTo(8 * 1.11 + 5 * 0.16, 9);
  });
});

describe('heatCostKr', () => {
  it('multiplies the kWh by the heat price', () => {
    expect(heatCostKr(4.905, 1.031)).toBeCloseTo(5.057055, 9);
    expect(heatCostKr(0, 1.031)).toBe(0);
  });

  it('is unknown while the price is', () => {
    expect(heatCostKr(4.9, null)).toBeNull();
  });
});

describe('heatScale', () => {
  const energy = (today: number | null, yesterday: number | null, plan: number | null, sunless: number | null): HeatEnergy => {
    const total = (kwh: number | null) => (kwh == null ? null : { hours: kwh, kwh });
    return { today: total(today), yesterday: total(yesterday), plan: total(plan), sunless: total(sunless) };
  };

  it('ends at the largest tick and places today’s bar and the ticks in percent of it', () => {
    const scale = heatScale(energy(3.2, 4.3, 8, 12.5));
    expect(scale.fill).toBeCloseTo((3.2 / 12.5) * 100, 9);
    expect(scale.ticks.map(tick => tick.key)).toEqual(['yesterday', 'plan', 'sunless']);
    expect(scale.ticks.map(tick => tick.kwh)).toEqual([4.3, 8, 12.5]);
    expect(scale.ticks.map(tick => tick.at)).toEqual([(4.3 / 12.5) * 100, (8 / 12.5) * 100, 100]);
  });

  it('ends at today when today has outgrown every tick', () => {
    const scale = heatScale(energy(14, 4.3, 8, 12.5));
    expect(scale.fill).toBe(100);
    expect(scale.ticks.map(tick => tick.at)).toEqual([(4.3 / 14) * 100, (8 / 14) * 100, (12.5 / 14) * 100]);
  });

  it('leaves out a tick that has no figure, and keeps the others', () => {
    const scale = heatScale(energy(3, null, 6, null));
    expect(scale.ticks.map(tick => tick.key)).toEqual(['plan']);
    expect(scale.ticks[0].at).toBe(100);
    expect(scale.fill).toBe(50);
  });

  it('has an empty bar on a day with no kWh to compare', () => {
    expect(heatScale(energy(0, 0, 0, 0))).toEqual({
      fill: 0,
      ticks: [
        { key: 'yesterday', kwh: 0, at: 0 },
        { key: 'plan', kwh: 0, at: 0 },
        { key: 'sunless', kwh: 0, at: 0 },
      ],
    });
  });
});

describe('spreadLabels', () => {
  it('leaves labels that are far enough apart where they are', () => {
    expect(spreadLabels([20, 50, 90], 12, 5, 95)).toEqual([20, 50, 90]);
  });

  it('pushes labels that crowd each other apart by the gap', () => {
    expect(spreadLabels([40, 42], 12, 5, 95)).toEqual([40, 52]);
    expect(spreadLabels([10, 12, 14], 12, 5, 95)).toEqual([10, 22, 34]);
  });

  it('keeps labels inside the edges, moving earlier ones to make room', () => {
    expect(spreadLabels([96, 99], 12, 5, 95)).toEqual([83, 95]);
    expect(spreadLabels([0, 1], 12, 5, 95)).toEqual([5, 17]);
  });

  it('returns the centres in the order the labels were given', () => {
    expect(spreadLabels([80, 20, 22], 12, 5, 95)).toEqual([80, 20, 32]);
  });

  it('handles no labels and one label', () => {
    expect(spreadLabels([], 12, 5, 95)).toEqual([]);
    expect(spreadLabels([50], 12, 5, 95)).toEqual([50]);
  });
});
