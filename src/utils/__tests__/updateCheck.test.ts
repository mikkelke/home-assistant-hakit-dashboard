import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadedByUpdate } from '../updateCheck';

const NOW = Date.parse('2026-10-16T08:00:00Z');

/** A window whose sessionStorage holds the update guard as `raw`, or throws when `raw` is an Error. */
function withGuard(raw: string | null | Error) {
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: () => {
        if (raw instanceof Error) throw raw;
        return raw;
      },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('loadedByUpdate', () => {
  it('is true for the page an update reload has just brought up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    withGuard(JSON.stringify({ version: 'abc123', at: NOW - 20_000 }));
    expect(loadedByUpdate()).toBe(true);
  });

  it('is false once the reload is old news', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    withGuard(JSON.stringify({ version: 'abc123', at: NOW - 3 * 60_000 }));
    expect(loadedByUpdate()).toBe(false);
  });

  it('is false with no guard, a broken one, a time in the future, or no storage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const raw of [
      null,
      'not json',
      '{}',
      JSON.stringify({ at: 'soon' }),
      JSON.stringify({ at: NOW + 60_000 }),
      new Error('blocked'),
    ]) {
      withGuard(raw);
      expect(loadedByUpdate()).toBe(false);
    }
  });
});
