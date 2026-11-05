import type { HassEntities } from '../types';
import { HEATING_ZONES, heatNum, zoneSensorId, type HeatingZone } from './heating';

/** The kW each zone draws from the district heat while its thermostat calls: a season fit of the ista meter against
 * call hours. The guest bathroom is too small to show in the meter. */
export const KW_FIT: Record<HeatingZone, number> = {
  family: 1.11,
  kristines_room: 0.37,
  claudias_room: 0.45,
  bathroom: 0.16,
  guest_bathroom: 0,
};

/** DKK per kWh of district heat, the price the Energy page's Utilities tab uses. */
export const HEAT_PRICE_SENSOR = 'sensor.ista_heat_price';

/** Mains power of the floor-heating pump and actuators, in W. */
export const HEAT_RELAY_POWER_SENSOR = 'sensor.floor_heating_relay_power';

export interface HeatTotal {
  /** Call hours summed over the zones. */
  hours: number;
  /** Each zone's hours x its kW fit, summed: an estimate of the district heat. */
  kwh: number;
}

/** The four figures the heat card compares: the hours called so far today, the hours called yesterday, the
 * controller's budget for today, and its budget for a sunless day. */
export type HeatSeries = 'today' | 'yesterday' | 'plan' | 'sunless';

export type HeatEnergy = Record<HeatSeries, HeatTotal | null>;

const hoursOf: Record<HeatSeries, (attrs: Record<string, unknown>) => unknown> = {
  today: attrs => attrs.call_hours_today,
  yesterday: attrs =>
    typeof attrs.yesterday === 'object' && attrs.yesterday !== null ? (attrs.yesterday as Record<string, unknown>).call_hours : null,
  plan: attrs => attrs.budget_today_h,
  sunless: attrs => attrs.budget_dull_h,
};

/** One series over all zones. A zone without the figure counts as 0, and a series no zone has is null. */
function total(entities: HassEntities, series: HeatSeries): HeatTotal | null {
  let known = false;
  const sum: HeatTotal = { hours: 0, kwh: 0 };
  for (const zone of HEATING_ZONES) {
    const hours = heatNum(hoursOf[series](entities[zoneSensorId(zone)]?.attributes ?? {}));
    if (hours == null) continue;
    known = true;
    sum.hours += hours;
    sum.kwh += hours * KW_FIT[zone];
  }
  return known ? sum : null;
}

export function heatEnergy(entities: HassEntities): HeatEnergy {
  return {
    today: total(entities, 'today'),
    yesterday: total(entities, 'yesterday'),
    plan: total(entities, 'plan'),
    sunless: total(entities, 'sunless'),
  };
}

/** DKK for `kwh` at `pricePerKwh`; null while the price is unknown. */
export const heatCostKr = (kwh: number, pricePerKwh: number | null): number | null => (pricePerKwh == null ? null : kwh * pricePerKwh);

export interface ScaleTick {
  key: 'yesterday' | 'plan' | 'sunless';
  kwh: number;
  /** Where the tick sits on the scale, 0 to 100. */
  at: number;
}

export interface HeatScale {
  /** Where today's bar ends, 0 to 100. */
  fill: number;
  ticks: ScaleTick[];
}

/** Today's bar and the reference ticks on one scale, which ends at the largest of them. A tick whose series no zone
 * publishes is left out. */
export function heatScale(energy: HeatEnergy): HeatScale {
  const ticks = (['yesterday', 'plan', 'sunless'] as const).flatMap(key => {
    const entry = energy[key];
    return entry ? [{ key, kwh: entry.kwh }] : [];
  });
  const end = Math.max(energy.today?.kwh ?? 0, ...ticks.map(tick => tick.kwh));
  const at = (kwh: number) => (end > 0 ? (kwh / end) * 100 : 0);
  return { fill: at(energy.today?.kwh ?? 0), ticks: ticks.map(tick => ({ ...tick, at: at(tick.kwh) })) };
}

/** Centres for labels that belong at `at` (percent), pushed apart to at least `gap` and kept inside [lo, hi]; in the
 * order given. */
export function spreadLabels(at: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = at.map((_, index) => index).sort((a, b) => at[a] - at[b]);
  const centres = order.map(index => Math.min(hi, Math.max(lo, at[index])));
  for (let i = 1; i < centres.length; i += 1) centres[i] = Math.max(centres[i], centres[i - 1] + gap);
  for (let i = centres.length - 1; i >= 0; i -= 1) {
    centres[i] = Math.min(centres[i], i === centres.length - 1 ? hi : centres[i + 1] - gap);
  }
  const spread = new Array<number>(at.length);
  order.forEach((index, rank) => {
    spread[index] = Math.max(lo, centres[rank]);
  });
  return spread;
}
