export type Period = 'day' | 'week' | 'month' | 'year';

export interface StatisticValue {
  start: number;
  end: number;
  change?: number | null;
  state?: number | null;
  sum?: number | null;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
}

export type StatisticsResponse = Record<string, StatisticValue[]>;

/** Shared fields of a grid source, whichever shape it's nested in (see EnergyPrefsSource). */
export interface EnergyPrefsGridFlow {
  stat_energy_from: string;
  entity_energy_price?: string | null;
  stat_cost?: string | null;
}

/** Live-observed shape: grid source carries stat_energy_from etc. directly. */
export interface EnergyPrefsSourceFlat extends EnergyPrefsGridFlow {
  type: string;
}

/** HA's documented schema: grid source nests flow entries under flow_from[]. */
export interface EnergyPrefsSourceNested {
  type: string;
  flow_from: EnergyPrefsGridFlow[];
}

export type EnergyPrefsSource = EnergyPrefsSourceFlat | EnergyPrefsSourceNested;

export interface EnergyPrefsDevice {
  stat_consumption: string;
  stat_rate?: string | null;
  name?: string | null;
  included_in_stat?: string | null;
}

export interface EnergyPrefs {
  energy_sources: EnergyPrefsSource[];
  device_consumption: EnergyPrefsDevice[];
}

export interface EnergyInfo {
  cost_sensors: Record<string, string>;
}

export interface DevicePref {
  statId: string;
  name: string;
  parentStatId?: string;
}

export interface EnergyConfig {
  gridStatId: string;
  costStatId: string | null;
  priceStatId: string | null;
  priceEntityId: string | null;
  devices: DevicePref[];
}

export interface EnergyBar {
  startMs: number;
  endMs: number;
  kWh: number;
  costKr: number;
  price: number | null;
  level: 'low' | 'mid' | 'high' | 'unknown';
  partial?: boolean;
}

/** One hour's price, ms-keyed — used for the day view's price curve. */
export interface PricePoint {
  ms: number;
  price: number;
}

export interface PriceSeries {
  points: PricePoint[]; // hourly, step-constant per hour
  min: PricePoint;
  max: PricePoint;
  peakStartMs: number; // 17:00 of the anchor day
  peakEndMs: number; // 21:00 of the anchor day
  now?: { ms: number; price: number }; // only when viewing today
}

export interface EnergyView {
  period: Period;
  startMs: number;
  endMs: number;
  bars: EnergyBar[];
  totals: { kWh: number; costKr: number };
  price?: PriceSeries; // day view only
  complete: boolean;
}
