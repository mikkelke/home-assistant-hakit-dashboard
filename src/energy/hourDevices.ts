/** The devices behind one Usage bar: which used power in its slot, against the slot's total. Pure. */
import { ENERGY_DEVICE_ICONS } from '../config/energy';
import { PLAN_APPLIANCES } from '../config/plan';
import { assembleDevices } from './assemble';
import { homeMonthStartMs, nextHomeDayStartMs } from './homeTime';
import type { DevicePref, DeviceUsage, Period, StatisticsResponse } from './types';

export const SLOT_TOP_DEVICES = 5;
/** kWh; a smaller remainder is left out. */
export const SLOT_UNMETERED_MIN_KWH = 0.05;

export interface SlotDevices {
  /** The biggest top-level devices with use in the slot, kWh descending. */
  top: DeviceUsage[];
  /** The rest of them, kWh descending. */
  more: DeviceUsage[];
  moreKWh: number;
  /** The slot's total minus the devices; 0 when it is not above `SLOT_UNMETERED_MIN_KWH`. */
  unmeteredKWh: number;
  /** kr of `more` and of the unmetered remainder, as each device's `costKr`; null where kr is left out. */
  moreCostKr: number | null;
  unmeteredCostKr: number | null;
}

/** End of the bar slot starting at `startMs`: the hour on the day view, else the home-time day or month. */
export function slotEndMs(period: Period, startMs: number): number {
  if (period === 'day') return startMs + 3_600_000;
  return period === 'year' ? homeMonthStartMs(startMs, 1) : nextHomeDayStartMs(startMs);
}

/** A device row counts towards the slot it starts in, so hourly and 5-minute rows land in the same
 * slot as the bar. A child meter stays inside its parent, as in `assembleDevices`. Null when no device
 * has a row in the slot.
 *
 * `price` is the hour's all-in kr/kWh. An hour has one price, so its kr is exact: kWh times it. A day
 * or month spans hours at different prices, so its kr is left out (null) rather than approximated. */
export function slotDevices(
  prefs: DevicePref[],
  rows: StatisticsResponse,
  period: Period,
  startMs: number,
  totalKWh: number,
  price: number | null = null
): SlotDevices | null {
  const endMs = slotEndMs(period, startMs);
  const inSlot: StatisticsResponse = {};
  let found = false;
  for (const { statId } of prefs) {
    inSlot[statId] = (rows[statId] ?? []).filter(row => row.start >= startMs && row.start < endMs);
    found ||= inSlot[statId].length > 0;
  }
  if (!found) return null;

  const rate = period === 'day' ? price : null;
  const cost = (kWh: number) => (rate == null ? null : kWh * rate);
  const { devices, untracked } = assembleDevices(prefs, inSlot, [], { kWh: totalKWh, costKr: 0 });
  const used = devices.filter(device => device.kWh > 0).map(device => ({ ...device, costKr: cost(device.kWh), costExact: rate != null }));
  const more = used.slice(SLOT_TOP_DEVICES);
  const moreKWh = more.reduce((sum, device) => sum + device.kWh, 0);
  const unmeteredKWh = untracked.kWh > SLOT_UNMETERED_MIN_KWH ? untracked.kWh : 0;
  return {
    top: used.slice(0, SLOT_TOP_DEVICES),
    more,
    moreKWh,
    unmeteredKWh,
    moreCostKr: cost(moreKWh),
    unmeteredCostKr: cost(unmeteredKWh),
  };
}

/** The icon of an energy device whose kind is clear: listed in `ENERGY_DEVICE_ICONS`, or a plan
 * appliance by its power sensor. Undefined for the rest. */
export function deviceIcon(prefs: readonly DevicePref[], statId: string): string | undefined {
  const power = prefs.find(pref => pref.statId === statId)?.powerEntityId;
  return ENERGY_DEVICE_ICONS[statId] ?? PLAN_APPLIANCES.find(appliance => appliance.powerEntityId === power)?.icon;
}
