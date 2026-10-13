// @vitest-environment happy-dom
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOCK_TICK_MS, useNowMs } from '../useNowMs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const seen: number[] = [];

function Clock() {
  const nowMs = useNowMs();
  useEffect(() => {
    seen.push(nowMs);
  }, [nowMs]);
  return null;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe('useNowMs', () => {
  it('moves on every tick while the page shows, not while it is hidden, and catches up when it shows again', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-13T16:00:00Z'));
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Clock)));
    const first = seen.length;

    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS));
    expect(seen.length).toBe(first + 1);

    setHidden(true);
    act(() => vi.advanceTimersByTime(CLOCK_TICK_MS * 4));
    expect(seen.length).toBe(first + 1);

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(seen.length).toBe(first + 2);
    expect(seen.at(-1)).toBe(Date.parse('2026-10-13T16:02:30Z'));

    act(() => root.unmount());
  });
});
