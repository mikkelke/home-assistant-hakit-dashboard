// Energy page constants — fixed absolute price-band thresholds used to color consumption bars
// by their bucket's price. Color follows price level, never rank: < lowMax = billig, up to and
// including midMax = normal, above midMax = dyr. More energy-cost constants (fixed subscription
// fees) join here in Phase 5.
export const PRICE_BAND_THRESHOLDS = { lowMaxKrPerKWh: 1.0, midMaxKrPerKWh: 1.75 } as const;
