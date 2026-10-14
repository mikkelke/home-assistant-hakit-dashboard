/** The devices behind one Usage bar: which used power in its slot, against the slot's total. Pure. */
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
  /** The slot's total minus the devices; 0 when it is not above `SLOT_UNMETERED_MIN_KWH`. */
  unmeteredKWh: number;
}

/** End of the bar slot starting at `startMs`: the hour on the day view, else the home-time day or month. */
export function slotEndMs(period: Period, startMs: number): number {
  if (period === 'day') return startMs + 3_600_000;
  return period === 'year' ? homeMonthStartMs(startMs, 1) : nextHomeDayStartMs(startMs);
}

/** A device row counts towards the slot it starts in, so hourly and 5-minute rows land in the same
 * slot as the bar. A child meter stays inside its parent, as in `assembleDevices`. Null when no device
 * has a row in the slot. */
export function slotDevices(
  prefs: DevicePref[],
  rows: StatisticsResponse,
  period: Period,
  startMs: number,
  totalKWh: number
): SlotDevices | null {
  const endMs = slotEndMs(period, startMs);
  const inSlot: StatisticsResponse = {};
  let found = false;
  for (const { statId } of prefs) {
    inSlot[statId] = (rows[statId] ?? []).filter(row => row.start >= startMs && row.start < endMs);
    found ||= inSlot[statId].length > 0;
  }
  if (!found) return null;

  const { devices, untracked } = assembleDevices(prefs, inSlot, [], { kWh: totalKWh, costKr: 0 });
  const used = devices.filter(device => device.kWh > 0);
  return {
    top: used.slice(0, SLOT_TOP_DEVICES),
    more: used.slice(SLOT_TOP_DEVICES),
    unmeteredKWh: untracked.kWh > SLOT_UNMETERED_MIN_KWH ? untracked.kWh : 0,
  };
}
