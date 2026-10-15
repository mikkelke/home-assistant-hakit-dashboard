interface Sentinel {
  release: () => Promise<void>;
}

/** Asks the browser to keep the screen on until the returned function is called. Where the browser has no wake lock, or
 * refuses it, nothing happens. */
export function keepScreenOn(): () => void {
  let sentinel: Sentinel | null = null;
  let released = false;
  const quietly = (lock: Sentinel) => void lock.release().catch(() => {});
  try {
    navigator.wakeLock?.request('screen').then(
      lock => {
        if (released) quietly(lock);
        else sentinel = lock;
      },
      () => {}
    );
  } catch {
    // Not supported here.
  }
  return () => {
    released = true;
    if (sentinel) quietly(sentinel);
    sentinel = null;
  };
}
