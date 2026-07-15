// Energy page constants. `PRICE_BAND_THRESHOLDS` are fixed absolute price-band thresholds used to
// color consumption bars by their bucket's price — color follows price level, never rank: < lowMax
// = billig, up to and including midMax = normal, above midMax = dyr.
export const PRICE_BAND_THRESHOLDS = { lowMaxKrPerKWh: 1.0, midMaxKrPerKWh: 1.75 } as const;

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

// Price Advisor ("Power" home-screen strip + "Best time to run" modal) constants. `dayEndHour` and
// `nightStartHour` are deliberately the same instant (21:00) — one pivot between "run it today,
// during the day" and "delay it into the overnight window", not two independently-tunable knobs;
// `nightEndHour` (06:00) is how far into tomorrow morning the overnight search reaches, since a
// delay-start knob dialled at bedtime commonly reaches into the cheap early-morning hours.
// `saveThresholdPct` gates every "wait, it's cheaper later" claim in the UI: below it, the
// difference isn't worth advertising as a saving, so the UI says "now is fine" instead. `hours` per
// appliance are generous whole-hour cycle-length assumptions (rounded up), not exact durations — the
// point is a delay-start estimate a housemate can dial in, not a lab-precise runtime.
export const PRICE_ADVICE = {
  dayEndHour: 21,
  nightStartHour: 21,
  nightEndHour: 6,
  saveThresholdPct: 15,
  appliances: [
    { key: 'dishwasher', label: 'Dishwasher', icon: 'mdi:dishwasher', hours: 4 },
    { key: 'washer', label: 'Washer', icon: 'mdi:washing-machine', hours: 3 },
    { key: 'dryer', label: 'Dryer', icon: 'mdi:tumble-dryer', hours: 3 },
  ],
} as const;

export type ApplianceKey = (typeof PRICE_ADVICE.appliances)[number]['key'];
