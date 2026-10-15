/** Which ring archive entry a doorbell row in the house feed reports. Pure. */

/** How far an archive entry's ring time may lie from the start of the feed episode that reports the same ring. */
export const RING_MATCH_WINDOW_MS = 10_000;

/** How long after a ring its archive entry may still be on its way. The bridge writes the entry once the ring's clip
 * is on disk, about 10 s after the ring, and a ring without a clip when its episode closes, 75 s after the ring. */
export const RING_ENTRY_WAIT_MS = 90_000;

/** Whether a ring without an archive entry may still get one: within the wait after the ring, and never longer than
 * that after the sheet opened, so a phone clock running behind cannot keep it waiting. */
export function ringEntryMayArrive(startMs: number, openedMs: number, nowMs: number): boolean {
  return nowMs - startMs < RING_ENTRY_WAIT_MS && nowMs - openedMs < RING_ENTRY_WAIT_MS;
}

/** What matching reads of an archive entry. The bridge writes `ts` in epoch seconds. */
export interface RingEntry {
  ts?: unknown;
  datetime?: string;
  door?: string;
}

/** An entry's ring time in epoch ms, from `ts`, else `datetime`; null without either. */
export function ringEntryMs(entry: RingEntry): number | null {
  if (typeof entry.ts === 'number' && Number.isFinite(entry.ts)) return entry.ts * 1000;
  const ms = entry.datetime ? Date.parse(entry.datetime) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** The entry whose ring time is closest to `startMs` within the window, among entries at the door `cause` names;
 * an entry without a door may be any door. Null when none qualifies: a ring without its own entry never shows
 * another ring's visitor. */
export function matchRingEntry<T extends RingEntry>(entries: readonly T[], startMs: number, cause: string): T | null {
  const said = cause.toLowerCase();
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const entry of entries) {
    const atMs = ringEntryMs(entry);
    const door = entry.door?.trim().toLowerCase();
    if (atMs == null || (door && !said.includes(door))) continue;
    const distance = Math.abs(atMs - startMs);
    if (distance <= RING_MATCH_WINDOW_MS && distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}
