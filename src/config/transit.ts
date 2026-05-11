export type TransitStatus = 'OK' | 'Delayed' | 'Disrupted' | 'Unavailable' | string;

/** Counts upcoming departures (after UI “upcoming” filter) for heavy vs sparse routes. */
export interface TransitAggregateAlertThresholds {
  /** Disrupted when ≥ this many cancellations. */
  minCancelledDisrupted: number;
  /** Disrupted when ≥ this many heavy delays alone (each train counted once, excludes cancelled rows). */
  minDelayedAloneDisrupted: number;
  /** Disrupted when (cancelled + delayed) ≥ this. */
  minCombinedDisrupted: number;
  /** Delayed when ≥ this many heavy delays, if not already Disrupted. */
  minDelayedDelayed: number;
  /** Delayed when (cancelled + delayed) ≥ this, if not already Disrupted. */
  minCombinedDelayed: number;
}

export const TRANSIT_AGGREGATE_HEAVY_DEFAULT: TransitAggregateAlertThresholds = {
  minCancelledDisrupted: 2,
  minDelayedAloneDisrupted: 4,
  minCombinedDisrupted: 5,
  minDelayedDelayed: 3,
  minCombinedDelayed: 4,
};

/**
 * UI picks “busy corridor” vs “sparse” from the live departure list (not per-line config).
 * Aligns with backend `duration_min` (often 60): many deps in the near window ⇒ aggregate rules.
 */
export const TRANSIT_DENSITY_WINDOW_MINUTES = 30;

/** If ≥ this many departures fall within {@link TRANSIT_DENSITY_WINDOW_MINUTES}, use aggregate thresholds. */
export const TRANSIT_DENSE_DEPARTURE_COUNT_MIN = 5;

export interface TransitLineConfig {
  name: string;
  icon: string;
  station: string;
  destination: string;
  statusEntityId: string;
  sensorEntityId: string;
  enabledEntityId: string;
  /** Matches AppDaemon `high_frequency`: ignore per-train delays; Disrupted only if ≥2 cancellations. */
  highFrequency?: boolean;
}

export const QUICK_ACCESS_OPEN_EVENT = 'openQuickAccess';

export const TRANSIT_LINES: TransitLineConfig[] = [
  {
    name: 'IC/Re',
    icon: 'mdi:train',
    station: 'København H',
    destination: 'Odense',
    statusEntityId: 'input_select.transit_kbh_ic_odense_status',
    sensorEntityId: 'sensor.transit_kbh_ic_odense',
    enabledEntityId: 'input_boolean.transit_kbh_ic_odense_enabled',
  },
  {
    name: 'S-tog',
    icon: 'mdi:train',
    station: 'Carlsberg',
    destination: 'KBH H (København H)',
    statusEntityId: 'input_select.transit_carlsberg_stog_kbh_status',
    sensorEntityId: 'sensor.transit_carlsberg_stog_kbh',
    enabledEntityId: 'input_boolean.transit_carlsberg_stog_kbh_enabled',
  },
  {
    name: 'S-tog',
    icon: 'mdi:train',
    station: 'Carlsberg',
    destination: 'Malmparken',
    statusEntityId: 'input_select.transit_carlsberg_stog_malmparken_status',
    sensorEntityId: 'sensor.transit_carlsberg_stog_malmparken',
    enabledEntityId: 'input_boolean.transit_carlsberg_stog_malmparken_enabled',
  },
  {
    name: 'Metro M3',
    icon: 'mdi:subway-variant',
    station: 'Enghave Plads',
    destination: 'København H',
    statusEntityId: 'input_select.transit_enghave_metro_kbh_status',
    sensorEntityId: 'sensor.transit_enghave_metro_kbh',
    enabledEntityId: 'input_boolean.transit_enghave_metro_kbh_enabled',
    highFrequency: true,
  },
];

const TRANSIT_ALERT_STATUSES = new Set(['Delayed', 'Disrupted']);

export function isTransitAlert(status: TransitStatus): boolean {
  return TRANSIT_ALERT_STATUSES.has(status);
}

export function getTransitSeverity(status: TransitStatus): number {
  switch (status) {
    case 'Disrupted':
      return 2;
    case 'Delayed':
      return 1;
    default:
      return 0;
  }
}
