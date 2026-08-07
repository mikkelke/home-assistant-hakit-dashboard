/**
 * Formatting helpers shared by the washer, dryer and dishwasher cards. Verified byte-identical
 * (modulo comments) across all three cards before extraction — see the Appliance dedup work that
 * introduced this module. If a future appliance needs different behaviour, fork it there rather
 * than branching inside these.
 */

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
