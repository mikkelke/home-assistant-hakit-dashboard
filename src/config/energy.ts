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
