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

/**
 * On a busy corridor a cancelled departure that another train covers within a few minutes costs
 * almost no waiting time, so it must not count toward line status — the backend already absorbs it
 * ("cancellation absorbed by alternative departure") and the UI must not override that OK with a
 * Disrupted.
 *
 * The live window comes from the route sensor's `rescue_window_min` attribute (`_rescue_window_for`
 * in apps/transit/transit_alarm.py), so changing `rescue_window_min` in transit_alarm.yaml moves
 * backend and dashboard together. This constant is only the fallback for when that attribute is
 * missing — chiefly the seconds after an AppDaemon restart, before the transient sensor is
 * recreated. Keep it equal to the yaml default.
 */
export const TRANSIT_RESCUE_WINDOW_FALLBACK_MINUTES = 5;

/** HA attributes arrive as strings as readily as numbers (`cancelled: "true"`); take a usable number or nothing. */
function readPositiveNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

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
 * Cancellations that actually cost the traveller time: no non-cancelled departure follows within
 * `rescueWindow` minutes. A train leaving *before* the cancelled one does not rescue it — you
 * cannot travel back in time to catch it.
 */
function countUnrescuedCancellations(
  upcoming: readonly TransitDepartureForDisplay[],
  now: Date,
  rescueWindow: number
): number {
  const viableMins = upcoming.filter(d => !d.cancelled).map(d => minsFromNow(d.time, now));
  return upcoming.filter(d => {
    if (!d.cancelled) return false;
    const cancelledAt = minsFromNow(d.time, now);
    return !viableMins.some(v => v >= cancelledAt && v - cancelledAt < rescueWindow);
  }).length;
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
 * before line status changes. Thresholds: {@link TRANSIT_AGGREGATE_HEAVY_DEFAULT}. Cancellations only
 * count when unrescued (see {@link countUnrescuedCancellations}); on a 2-minute headway a cancelled
 * train that the next one absorbs is not a disruption.
 */
function deriveAggregateTransitDisplayStatus(
  departures: readonly TransitDepartureForDisplay[],
  backendStatus: TransitStatus,
  now: Date,
  thresholds: TransitAggregateAlertThresholds,
  rescueWindow: number
): TransitStatus {
  if (departures.length === 0) {
    return backendStatus;
  }
  const upcoming = departures.filter(d => minsFromNow(d.time, now) >= TRANSIT_UPCOMING_MIN_MINS);
  if (upcoming.length === 0) {
    return 'OK';
  }

  const cancelled = countUnrescuedCancellations(upcoming, now, rescueWindow);
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

/**
 * AppDaemon `high_frequency` routes: no Delayed from delays; Disrupted if ≥2 upcoming cancellations
 * that no following departure absorbs. On the M3's 2-4 minute headway a cancelled train the next
 * one picks up is a non-event, and the backend's `high_frequency` evaluator applies the same
 * `rescue_window_min`, so the two must agree.
 */
function deriveHighFrequencyTransitDisplayStatus(
  departures: readonly TransitDepartureForDisplay[],
  backendStatus: TransitStatus,
  now: Date,
  rescueWindow: number
): TransitStatus {
  if (departures.length === 0) {
    return backendStatus;
  }
  const upcoming = departures.filter(d => minsFromNow(d.time, now) >= TRANSIT_UPCOMING_MIN_MINS);
  if (upcoming.length === 0) {
    return 'OK';
  }
  if (countUnrescuedCancellations(upcoming, now, rescueWindow) >= 2) {
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
  const rescueWindow =
    readPositiveNumber(sensor?.attributes?.rescue_window_min) ?? TRANSIT_RESCUE_WINDOW_FALLBACK_MINUTES;
  if (line.highFrequency) {
    return deriveHighFrequencyTransitDisplayStatus(departures, backend, now, rescueWindow);
  }
  const dense = countDeparturesInDensityWindow(departures, now) >= TRANSIT_DENSE_DEPARTURE_COUNT_MIN;
  if (dense) {
    return deriveAggregateTransitDisplayStatus(
      departures,
      backend,
      now,
      TRANSIT_AGGREGATE_HEAVY_DEFAULT,
      rescueWindow
    );
  }
  return deriveTransitDisplayStatus(departures, backend, now);
}
