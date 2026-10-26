import { HOTPLATE_ICON, OVEN_ICON } from './kitchenIcons';

// Energy page constants. Price bands are relative to each day; see energy/priceBands.ts.

// Sanity ceiling for a single kr/kWh reading, applied wherever a price arrives from outside this
// app — the price entity's `raw_today`/`raw_tomorrow`/`forecast` attributes and its long-term
// statistics. Real Danish retail prices don't get near this even at worst-case ToU peak plus a spot
// spike, so it exists purely to catch a glitched upstream value (sensor.energi_data_service briefly
// published 109.57 — the raw spot in EUR/MWh, unconverted and un-tariffed — for one refresh on
// 2026-09-02) before it reaches a chart, a bill or a "best time to run" suggestion. Mirrors the
// same-value ceiling added that day in washer_monitor.py and smart_cooling.py on the AppDaemon side.
export const PRICE_SANITY_CEILING_KR = 15;

// "Regning" card constants (Phase 5). HA's cost stat (every `costKr` in this app) is built on the
// EDS all-in price, which is already inkl. moms — only these fixed fee constants need ×MOMS_FACTOR
// applied, in assembly (see `energy/bill.ts`).
export const MOMS_FACTOR = 1.25;
/** Faste månedlige gebyrer fra elregningen (Vindstød), ekskl. moms — spejler fakturaens linjer. */
export const FIXED_FEES_EXCL_MOMS_KR_PER_MONTH = {
  vindstoedAbonnement: 0,
  radiusNetAboC: 40.84,
  energinetTso: 15.58,
} as const;

// Live tab constants. Below this, a device's (or the grid's) live power reading is noise, not
// "drawing" — used by `assembleLivePower` to decide which rows belong in the "Drawing now" list.
export const LIVE_POWER_MIN_WATTS = 1;

/** Live tab flow diagram: at most this many room nodes; beyond it the smallest rooms share one node. */
export const FLOW_MAX_ROOMS = 8;

/** Icons for the energy devices whose kind is clear, by statistic id; the washer, dishwasher and dryer
 * take theirs from `PLAN_APPLIANCES`. Every other device keeps its room's icon. */
export const ENERGY_DEVICE_ICONS: Readonly<Record<string, string>> = {
  'sensor.oven_plug_switch_0_energy': OVEN_ICON,
  'sensor.hotplate_power_monitor_total_active_energy': HOTPLATE_ICON,
  'sensor.microwave_plug_energy': 'mdi:microwave',
  'sensor.fridge_plug_energy': 'mdi:fridge',
  'sensor.wine_fridge_energy': 'mdi:fridge',
  'sensor.living_room_tv_relay_energy': 'mdi:television',
  'sensor.bedroom_tv_relay_energy': 'mdi:television',
  'sensor.technical_relay_energy': 'mdi:server-network',
};

/** First month the bill history shows (the meter's statistics start in December 2025). */
export const BILL_HISTORY_START = { year: 2025, monthIndex: 11 } as const;
export const BILL_HISTORY_MAX_MONTHS = 12;
