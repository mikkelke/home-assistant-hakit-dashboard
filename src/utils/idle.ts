/** Runs `callback` once the browser is idle, or after `fallbackMs` where `requestIdleCallback` is
 * missing (Safari and iOS). Returns the cancel. */
export function onIdle(callback: () => void, fallbackMs: number, timeoutMs = 3000): () => void {
  const idle = window.requestIdleCallback;
  if (typeof idle === 'function') {
    const handle = idle(callback, { timeout: timeoutMs });
    return () => window.cancelIdleCallback?.(handle);
  }
  const timer = window.setTimeout(callback, fallbackMs);
  return () => window.clearTimeout(timer);
}
