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

// Price Advisor ("Power" indicator in StatusBar + "Best time to run" modal) constants. `dayEndHour`
// and `nightStartHour` are deliberately the same instant (21:00) — one pivot between "run it today,
// during the day" and "delay it into the overnight window", not two independently-tunable knobs;
// `nightEndHour` (06:00) is how far into tomorrow morning the overnight search reaches, since a
// delay-start knob dialled at bedtime commonly reaches into the cheap early-morning hours.
// `saveThresholdPct` gates every "wait, it's cheaper later" claim in the UI: below it, the
// difference isn't worth advertising as a saving, so the UI says "now is fine" instead. `hours` per
// appliance are generous whole-hour cycle-length assumptions (rounded up), not exact durations — the
// point is a delay-start estimate a housemate can dial in, not a lab-precise runtime. `typicalKwh` is
// a typical FULL-CYCLE energy draw, used only to turn a kr/kWh rate into a "kr per run" figure a
// non-technical housemate can actually compare across machines — a per-appliance kr/kWh average over
// different window lengths reads as nonsense otherwise ("why is the dishwasher's rate different from
// the washer's?"). Provenance (2026-07-15): dishwasher 0.7 — recent ECO runs measure ~0.72 kWh, but
// the feedback-history file is currently empty after a migration, so this is a recent-observation
// estimate rather than a large sample; washer 0.7 — the median over 59 recorded cycles; dryer 1.5 —
// no house data yet, a Miele TCB150 WP heat-pump-dryer estimate, to be refined once cycle history
// accumulates.
//
// `profile` is each appliance's own per-cycle-hour ENERGY-weight curve — the fraction of the whole
// cycle's energy drawn in that cycle-hour, index-aligned with `hours` (profile[0] is the first hour
// after start, profile[1] the second, etc.), summing to ≈1. `cheapestWindow` uses it to weight its
// average instead of treating every cycle-hour as equally expensive, so a front-loaded machine's
// cheapest-start search is priced by the hour(s) it actually draws power in, not diluted by an
// idle/residual-heat tail — this is also why two appliances with different `hours` can now land on
// the SAME cheapest start hour instead of picking different troughs for no user-visible reason.
// Provenance (2026-07-15): dishwasher [0.35, 0.6, 0.05, 0] — measured from the 2026-07-15 ECO run's
// hourly plug statistics (34%/65%/~1%/0%: wash-heat lives in hours 1–2; the ECO dry phase uses
// residual heat, ~zero draw); washer [0.7, 0.25, 0.05] — measured from the 2026-07-14 run
// (79%/21%; heating is front-loaded; typical cycles are shorter than the 3 h envelope); dryer
// [0.4, 0.35, 0.25] — heat-pump, fairly flat draw; assumption, no recent cycle data yet.
export const PRICE_ADVICE = {
  dayEndHour: 21,
  nightStartHour: 21,
  nightEndHour: 6,
  saveThresholdPct: 15,
  appliances: [
    { key: 'dishwasher', label: 'Dishwasher', icon: 'mdi:dishwasher', hours: 4, typicalKwh: 0.7, profile: [0.35, 0.6, 0.05, 0] },
    { key: 'washer', label: 'Washer', icon: 'mdi:washing-machine', hours: 3, typicalKwh: 0.7, profile: [0.7, 0.25, 0.05] },
    { key: 'dryer', label: 'Dryer', icon: 'mdi:tumble-dryer', hours: 3, typicalKwh: 1.5, profile: [0.4, 0.35, 0.25] },
  ],
} as const;

export type ApplianceKey = (typeof PRICE_ADVICE.appliances)[number]['key'];
