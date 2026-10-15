import { describe, expect, it } from 'vitest';
import type { Advert } from '../bermuda';
import { emptyTracker, freshScanners, observe, overallFreshness, scannerFreshness, type FreshnessTracker } from '../freshness';

const advert = (scanner: string, stamp: number): Advert => ({ scanner, stamp, rssi: -60, dist: 2 });

function poll(tracker: FreshnessTracker, stamps: Record<string, number>): FreshnessTracker {
  return observe(
    tracker,
    Object.entries(stamps).map(([scanner, stamp]) => advert(scanner, stamp))
  );
}

describe('client observed freshness', () => {
  it('is unknown for the first poll, whatever the stamps are', () => {
    const tracker = poll(emptyTracker(), { A: 10, B: 11 });
    expect(overallFreshness(tracker)).toBe('unknown');
    expect(scannerFreshness(tracker, 'A')).toBe('unknown');
  });

  it('is fresh once two scanners have moved their stamps between two polls', () => {
    const tracker = poll(poll(emptyTracker(), { A: 10, B: 11, C: 12 }), { A: 15, B: 16, C: 12 });
    expect(overallFreshness(tracker)).toBe('fresh');
    expect(freshScanners(tracker).sort()).toEqual(['A', 'B']);
    expect(scannerFreshness(tracker, 'C')).toBe('stale');
  });

  it('is stale when fewer than two scanners are fresh', () => {
    const tracker = poll(poll(emptyTracker(), { A: 10, B: 11 }), { A: 15, B: 11 });
    expect(overallFreshness(tracker)).toBe('stale');
  });

  it('turns stale within three polls of the stamps stopping, which is 15 seconds at one poll in five', () => {
    let tracker = poll(emptyTracker(), { A: 10, B: 10 });
    tracker = poll(tracker, { A: 15, B: 15 });
    expect(overallFreshness(tracker)).toBe('fresh');
    const states = [];
    for (let i = 0; i < 3; i += 1) {
      tracker = poll(tracker, { A: 15, B: 15 });
      states.push(overallFreshness(tracker));
    }
    expect(states).toEqual(['fresh', 'fresh', 'stale']);
  });

  it('turns fresh again when the stamps move again', () => {
    let tracker = poll(poll(emptyTracker(), { A: 10, B: 10 }), { A: 10, B: 10 });
    expect(overallFreshness(tracker)).toBe('stale');
    tracker = poll(tracker, { A: 20, B: 21 });
    expect(overallFreshness(tracker)).toBe('fresh');
  });

  it('counts a scanner that disappears from the dump as not fresh', () => {
    let tracker = poll(poll(emptyTracker(), { A: 10, B: 10 }), { A: 15, B: 15 });
    for (let i = 0; i < 3; i += 1) tracker = poll(tracker, { A: 15 + 5 * (i + 1) });
    expect(scannerFreshness(tracker, 'A')).toBe('fresh');
    expect(scannerFreshness(tracker, 'B')).toBe('stale');
    expect(overallFreshness(tracker)).toBe('stale');
  });

  it('treats a scanner first seen later as stale until it moves', () => {
    let tracker = poll(poll(emptyTracker(), { A: 10 }), { A: 15, B: 3 });
    expect(scannerFreshness(tracker, 'B')).toBe('stale');
    tracker = poll(tracker, { A: 20, B: 8 });
    expect(scannerFreshness(tracker, 'B')).toBe('fresh');
  });

  it('does not change a tracker it was given', () => {
    const before = poll(emptyTracker(), { A: 10 });
    const snapshot = JSON.stringify(before);
    poll(before, { A: 20 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
