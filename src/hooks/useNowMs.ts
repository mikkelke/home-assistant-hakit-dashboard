import { useSyncExternalStore } from 'react';

/** How often the shared clock moves on, in ms. */
export const CLOCK_TICK_MS = 30_000;

let nowMs = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
  nowMs = Date.now();
  listeners.forEach(listener => listener());
}

function tickIfVisible() {
  if (!document.hidden) tick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    nowMs = Date.now();
    timer = setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', tickIfVisible);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener('visibilitychange', tickIfVisible);
    }
  };
}

const getSnapshot = () => nowMs;

/** Epoch ms from one clock every caller shares: it moves every `CLOCK_TICK_MS` and when the page
 * becomes visible again, so relative times and ETAs stay current without a timer per component. */
export function useNowMs(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
