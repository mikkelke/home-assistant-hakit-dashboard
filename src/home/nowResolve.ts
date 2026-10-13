/** Which timeline item a `#now` link focuses. Pure. */
import type { NowFocus, NowFocusKind } from '../utils/navigation';

/** Something the timeline can focus, at its own event time. */
export interface NowCandidate {
  /** Timeline item id; the rows of one episode share it. */
  id: string;
  kind: NowFocusKind;
  atMs: number;
  /** A live item (a running appliance, the wake alarm) rather than a feed row. */
  live: boolean;
}

export type NowResolution = { status: 'none' } | { status: 'pending' } | { status: 'found'; id: string } | { status: 'unavailable' };

/** How long the timeline waits for the viewer and the feed before a miss counts as settled. */
export const NOW_RESOLVE_GIVE_UP_MS = 3_000;

/** How far a candidate's time may lie from the focus time: an in-app `evt` tap carries the row's
 * own time, a push carries the time its event shares with the feed row. */
export function focusWindowMs(kind: NowFocusKind): number {
  return kind === 'evt' ? 2_000 : 120_000;
}

/** Identity-strict: only a candidate of the focus kind whose own time lies within the window, a live
 * item before a feed row, then the nearest. An `evt` focus matches any feed row and no live item.
 * Pass only candidates the viewer may see. Until `settled` (viewer and feed loaded, or the wait
 * given up) a miss is `pending`, after it `unavailable`. */
export function resolveNowFocus(focus: NowFocus | null, candidates: readonly NowCandidate[], settled: boolean): NowResolution {
  if (!focus) return { status: 'none' };
  const targetMs = focus.epochS * 1000;
  const windowMs = focusWindowMs(focus.kind);
  let best: NowCandidate | null = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (focus.kind === 'evt' ? candidate.live : candidate.kind !== focus.kind) continue;
    const distance = Math.abs(candidate.atMs - targetMs);
    if (distance > windowMs) continue;
    const better = best == null || (candidate.live !== best.live ? candidate.live : distance < bestDistance);
    if (better) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best) return { status: 'found', id: best.id };
  return settled ? { status: 'unavailable' } : { status: 'pending' };
}
