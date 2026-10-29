import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStaleChunk, loadedByUpdate } from '../updateCheck';

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

describe('handleStaleChunk', () => {
  function staleChunkWindow() {
    const store = new Map<string, string>();
    const replace = vi.fn();
    vi.stubGlobal('__APP_BUILD_VERSION__', 'build-1');
    vi.stubGlobal('window', {
      location: { href: 'https://ha.example/local/ha-dashboard/index.html', replace },
      sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) },
    });
    return replace;
  }

  it('reloads the page once and swallows the error', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const replace = staleChunkWindow();
    const event = new Event('vite:preloadError', { cancelable: true });
    handleStaleChunk(event);
    expect(event.defaultPrevented).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
    expect(replace.mock.calls[0][0]).toContain('_v=');
  });

  it('lets the error through when the reload did not help', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const replace = staleChunkWindow();
    handleStaleChunk(new Event('vite:preloadError', { cancelable: true }));
    const again = new Event('vite:preloadError', { cancelable: true });
    handleStaleChunk(again);
    expect(again.defaultPrevented).toBe(false);
    expect(replace).toHaveBeenCalledOnce();
  });
});
