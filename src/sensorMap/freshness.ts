import type { Advert } from './bermuda';

export type Freshness = 'unknown' | 'fresh' | 'stale';

/** A scanner counts as fresh when its stamp advanced in one of the last three polls. */
export const FRESH_WITHIN_POLLS = 3;
export const FRESH_SCANNERS_NEEDED = 2;

interface Seen {
  stamp: number;
  advancedAt: number | null;
}

/** What the browser can tell about a phone's adverts from successive dumps alone: whether each scanner's stamp
 * moved. The stamps are on the host's clock, so nothing is ever compared with the browser's. */
export interface FreshnessTracker {
  polls: number;
  scanners: Record<string, Seen>;
}

export const emptyTracker = (): FreshnessTracker => ({ polls: 0, scanners: {} });

export function observe(tracker: FreshnessTracker, adverts: readonly Advert[]): FreshnessTracker {
  const polls = tracker.polls + 1;
  const scanners: Record<string, Seen> = {};
  for (const [scanner, seen] of Object.entries(tracker.scanners)) scanners[scanner] = seen;
  for (const advert of adverts) {
    const before = scanners[advert.scanner];
    if (!before) scanners[advert.scanner] = { stamp: advert.stamp, advancedAt: null };
    else if (advert.stamp > before.stamp) scanners[advert.scanner] = { stamp: advert.stamp, advancedAt: polls };
  }
  return { polls, scanners };
}

export function scannerFreshness(tracker: FreshnessTracker, scanner: string): Freshness {
  if (tracker.polls < 2) return 'unknown';
  const seen = tracker.scanners[scanner];
  return seen && seen.advancedAt !== null && tracker.polls - seen.advancedAt < FRESH_WITHIN_POLLS ? 'fresh' : 'stale';
}

export function freshScanners(tracker: FreshnessTracker): string[] {
  return Object.keys(tracker.scanners).filter(scanner => scannerFreshness(tracker, scanner) === 'fresh');
}

/** Unknown until two polls have been seen; then fresh when at least two scanners are, otherwise stale. */
export function overallFreshness(tracker: FreshnessTracker): Freshness {
  if (tracker.polls < 2) return 'unknown';
  return freshScanners(tracker).length >= FRESH_SCANNERS_NEEDED ? 'fresh' : 'stale';
}
