import type { TransitAggregateAlertThresholds, TransitStatus } from '../config/transit';
import { TRANSIT_AGGREGATE_HEAVY_DEFAULT, TRANSIT_DENSE_DEPARTURE_COUNT_MIN, TRANSIT_DENSITY_WINDOW_MINUTES } from '../config/transit';
import type { HassEntities } from '../types';

/** Matches QuickAccess departure chips: include “Now” grace for deps just past scheduled time. */
export const TRANSIT_UPCOMING_MIN_MINS = -1;

/**
 * Must match AppDaemon `delay_threshold_min` on each route (e.g. 10 for S-tog / IC).
 * Smaller delays still show +Nm on chips but do not set line Delayed / badge / Home Pulse.
 */
export const TRANSIT_DELAY_ALERT_MIN_MINUTES = 10;

export interface TransitDepartureForDisplay {
  time: string;
  delay_min: number;
  cancelled: boolean;
  problematic: boolean;
}

export function minsFromNow(hhmm: string, now: Date): number {
  const [h, min] = hhmm.split(':').map(Number);
  const depMins = h * 60 + min;
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let diff = depMins - nowMins;
  if (diff < -60) diff += 24 * 60;
  return diff;
}

/** Soonest first; at the same clock minute, non-cancelled before cancelled (viable train first). */
function sortUpcomingForNextViableTrain(upcoming: readonly TransitDepartureForDisplay[], now: Date): TransitDepartureForDisplay[] {
  return [...upcoming].sort((a, b) => {
    const ma = minsFromNow(a.time, now);
    const mb = minsFromNow(b.time, now);
    if (ma !== mb) return ma - mb;
    if (a.cancelled !== b.cancelled) return a.cancelled ? 1 : -1;
    return 0;
  });
}

/**
 * **Sparse / infrequent routes:** next viable train only — each slot “weighs” more, so one bad
 * next departure is enough to alert; later issues are ignored if you still have a good earlier option.
 *
 * Note: AppDaemon `input_select` may still differ; this is UI-only.
 */
export function deriveTransitDisplayStatus(
  departures: readonly TransitDepartureForDisplay[],
  backendStatus: TransitStatus,
  now: Date
): TransitStatus {
  if (departures.length === 0) {
    return backendStatus;
  }

  const upcoming = departures.filter(d => minsFromNow(d.time, now) >= TRANSIT_UPCOMING_MIN_MINS);
  if (upcoming.length === 0) {
    return 'OK';
  }

  const sorted = sortUpcomingForNextViableTrain(upcoming, now);
  const next = sorted[0];
  if (next.cancelled) {
    return 'Disrupted';
  }
  if (next.delay_min >= TRANSIT_DELAY_ALERT_MIN_MINUTES) {
    return 'Delayed';
  }
  return 'OK';
}

/** How many departures are in the near window (same grace as chips). Used to choose dense vs sparse rules. */
export function countDeparturesInDensityWindow(departures: readonly TransitDepartureForDisplay[], now: Date): number {
  return departures.filter(d => {
    const m = minsFromNow(d.time, now);
    return m >= TRANSIT_UPCOMING_MIN_MINS && m <= TRANSIT_DENSITY_WINDOW_MINUTES;
  }).length;
}

/**
 * **Busy corridor:** many departures in the next ~30 min — need several cancelled / delayed / combined
 * before line status changes. Thresholds: {@link TRANSIT_AGGREGATE_HEAVY_DEFAULT}.
 */
function deriveAggregateTransitDisplayStatus(
  departures: readonly TransitDepartureForDisplay[],
  backendStatus: TransitStatus,
  now: Date,
  thresholds: TransitAggregateAlertThresholds
): TransitStatus {
  if (departures.length === 0) {
    return backendStatus;
  }
  const upcoming = departures.filter(d => minsFromNow(d.time, now) >= TRANSIT_UPCOMING_MIN_MINS);
  if (upcoming.length === 0) {
    return 'OK';
  }

  const cancelled = upcoming.filter(d => d.cancelled).length;
  const delayed = upcoming.filter(d => !d.cancelled && d.delay_min >= TRANSIT_DELAY_ALERT_MIN_MINUTES).length;
  const combined = cancelled + delayed;

  if (cancelled >= thresholds.minCancelledDisrupted) {
    return 'Disrupted';
  }
  if (delayed >= thresholds.minDelayedAloneDisrupted) {
    return 'Disrupted';
  }
  if (combined >= thresholds.minCombinedDisrupted) {
    return 'Disrupted';
  }
  if (delayed >= thresholds.minDelayedDelayed) {
    return 'Delayed';
  }
  if (combined >= thresholds.minCombinedDelayed) {
    return 'Delayed';
  }
  return 'OK';
}

/** AppDaemon `high_frequency` routes: no Delayed from delays; Disrupted if ≥2 upcoming cancellations. */
function deriveHighFrequencyTransitDisplayStatus(
  departures: readonly TransitDepartureForDisplay[],
  backendStatus: TransitStatus,
  now: Date
): TransitStatus {
  if (departures.length === 0) {
    return backendStatus;
  }
  const upcoming = departures.filter(d => minsFromNow(d.time, now) >= TRANSIT_UPCOMING_MIN_MINS);
  if (upcoming.length === 0) {
    return 'OK';
  }
  if (upcoming.filter(d => d.cancelled).length >= 2) {
    return 'Disrupted';
  }
  return 'OK';
}

export function getTransitLineDisplayStatus(
  line: { sensorEntityId: string; statusEntityId: string; highFrequency?: boolean },
  entities: HassEntities | undefined,
  now: Date
): TransitStatus {
  const sensor = entities?.[line.sensorEntityId];
  const departures = (sensor?.attributes?.departures ?? []) as TransitDepartureForDisplay[];
  const backend = (entities?.[line.statusEntityId]?.state ?? 'Unavailable') as TransitStatus;
  if (line.highFrequency) {
    return deriveHighFrequencyTransitDisplayStatus(departures, backend, now);
  }
  const dense = countDeparturesInDensityWindow(departures, now) >= TRANSIT_DENSE_DEPARTURE_COUNT_MIN;
  if (dense) {
    return deriveAggregateTransitDisplayStatus(departures, backend, now, TRANSIT_AGGREGATE_HEAVY_DEFAULT);
  }
  return deriveTransitDisplayStatus(departures, backend, now);
}
