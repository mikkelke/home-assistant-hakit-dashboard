/**
 * Formatting helpers and cycle-attribute readers shared by the washer, dryer and dishwasher cards.
 * If a future appliance needs different behaviour, fork it there rather than branching inside these.
 */

import { applianceStarter } from '../../home/upcoming';

type Attrs = Record<string, unknown>;

/** The values of the washer, dryer and dishwasher state sensors. */
export type ApplianceState = 'Off' | 'Running' | 'Paused' | 'Unemptied' | 'Emptied';

const hasText = (value: unknown): boolean => !!value && String(value).trim() !== '';

/** "HH:MM" from a backend time-only string (used as-is) or a UTC ISO timestamp (parsed and
 * converted to the browser's local time). Falls back to a naive slice when parsing fails. */
export function formatTimeOnly(isoOrTime: string | undefined): string {
  if (!isoOrTime) return '--:--';
  const s = String(isoOrTime).trim();
  // Local "HH:MM" from backend (e.g. estimated_end_time) — use as-is
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.slice(0, 5);
  try {
    // UTC ISO (e.g. cycle_start_time with +00:00 or Z): parse as UTC, convert to browser local
    const d = new Date(isoOrTime);
    if (Number.isNaN(d.getTime())) return s.slice(0, 5);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return s.slice(0, 5);
  }
}

/** "45 min" / "1h 5m" / "2h" from a minute count. */
export function formatDuration(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null || Number.isNaN(minutes)) return '--';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? `${h}h ${min}m` : `${h}h`;
}

/** "Aug 7, 14:32" for a cycle-history row timestamp. */
export function formatCycleTs(ts: string): string {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts.slice(0, 16);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts.slice(0, 16);
  }
}

/** "Started by Claudia · 15:10", "Started 15:10" or null. A name only from a reliable attribution
 * method; the time is left out when the card has none. */
export function startedLine(attrs: Record<string, unknown>, startedDisplay: string, hasStartedDisplay: boolean): string | null {
  const name = applianceStarter(attrs.started_by, attrs.started_by_method);
  if (name) return hasStartedDisplay ? `Started by ${name} · ${startedDisplay}` : `Started by ${name}`;
  return hasStartedDisplay ? `Started ${startedDisplay}` : null;
}

/** "HH:MM" the run started: `started_at_display` when it is a clock time or a timestamp, else the
 * start timestamp (`cycle_start_time_local` before `cycle_start_time`). "--:--" when none parses. */
export function startedTime(attrs: Attrs): string {
  const fromTimestamp = () => formatTimeOnly((attrs.cycle_start_time_local || attrs.cycle_start_time) as string | undefined);
  const text = hasText(attrs.started_at_display) ? String(attrs.started_at_display).trim() : '';
  if (!text) return fromTimestamp();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(text)) return text.slice(0, 5);
  if (/^\d{4}-\d{2}/.test(text) || text.includes('T')) return formatTimeOnly(text);
  return fromTimestamp();
}

/** "HH:MM" the run ended: when the sensor entered its finished state, less the lag the monitor
 * reports as `idle_min` between the real end and detecting it. Null when that moment is unknown. */
export function doneAtDisplay(sinceIso: string | undefined, idleMinutes?: number): string | null {
  const sinceMs = Date.parse(sinceIso ?? '');
  if (!Number.isFinite(sinceMs)) return null;
  return new Date(sinceMs - (idleMinutes ?? 0) * 60_000).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "1h 27m left", or "Almost done" once nothing remains; null while the remaining time is unknown. */
export function countdownLabel(remainingMin: number | undefined): string | null {
  if (remainingMin == null) return null;
  return remainingMin <= 0 ? 'Almost done' : `${formatDuration(remainingMin)} left`;
}

/** The icon of the finishing step: the basket to empty, or the open door of a drum to air. */
export const finishIcon = (aired: boolean): string => (aired ? 'mdi:door-open' : 'mdi:basket-outline');

/** What the monitors publish about a run's timing and progress. */
export interface CycleReading {
  remainingMin: number | undefined;
  totalMin: number | undefined;
  /** 0 to 100, and 0 unless the run is going and the monitor gave a percentage or a length. */
  progressPct: number;
  /** "HH:MM", or "--:--" when the monitor published no usable start. */
  startedDisplay: string;
  hasStartedDisplay: boolean;
  /** The monitor published a start time. */
  hasStart: boolean;
  /** `estimated_end_time` as published: a house "HH:MM" or an ISO timestamp. */
  estimatedEndTime: string | undefined;
}

export function readCycle(attrs: Attrs, running: boolean): CycleReading {
  const remainingMin = attrs.estimated_remaining_min != null ? Number(attrs.estimated_remaining_min) : undefined;
  const totalMin = attrs.programme_duration_min != null ? Number(attrs.programme_duration_min) : undefined;
  const hasPct = attrs.progress_pct != null && attrs.progress_pct !== '';
  const hasBar = running && ((totalMin != null && totalMin > 0) || hasPct);
  const elapsedMin =
    hasBar && remainingMin != null && totalMin != null
      ? totalMin - remainingMin
      : attrs.elapsed_minutes != null
        ? Number(attrs.elapsed_minutes)
        : 0;
  const progressPct = !hasBar
    ? 0
    : hasPct
      ? Math.min(100, Math.max(0, Number(attrs.progress_pct)))
      : totalMin != null && totalMin > 0
        ? Math.min(100, (elapsedMin / totalMin) * 100)
        : 0;
  const startedDisplay = startedTime(attrs);
  return {
    remainingMin,
    totalMin,
    progressPct,
    startedDisplay,
    hasStartedDisplay: startedDisplay !== '--:--',
    hasStart: hasText(attrs.cycle_start_time) || hasText(attrs.started_at_display),
    estimatedEndTime: attrs.estimated_end_time as string | undefined,
  };
}
