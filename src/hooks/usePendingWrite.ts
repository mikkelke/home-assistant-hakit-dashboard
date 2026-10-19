import { useCallback, useEffect, useRef, useState } from 'react';

const ACK_TIMEOUT_MS = 8000;

/** An optimistic value for a write Home Assistant has not confirmed yet. `request(value)` shows
 * `value` at once and calls `write(value)` after `debounceMs` (at once if the caller unmounts
 * first); the value stays shown while HA still reports what it reported at the request, for at
 * most `ackMs`, then whatever HA holds wins. */
export function usePendingWrite<T>(actual: T, write: (value: T) => void, debounceMs = 0, ackMs = ACK_TIMEOUT_MS) {
  const [pending, setPending] = useState<{ value: T; base: T } | null>(null);
  const writeRef = useRef(write);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsent = useRef<(() => void) | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  useEffect(
    () => () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
      if (ackTimer.current) clearTimeout(ackTimer.current);
      unsent.current?.();
    },
    []
  );

  const waiting = pending != null && Object.is(pending.base, actual);
  const shown = waiting ? pending.value : actual;

  const request = useCallback(
    (value: T) => {
      setPending({ value, base: actual });
      if (writeTimer.current) clearTimeout(writeTimer.current);
      if (ackTimer.current) clearTimeout(ackTimer.current);
      const send = () => {
        unsent.current = null;
        writeRef.current(value);
      };
      if (debounceMs > 0) {
        unsent.current = send;
        writeTimer.current = setTimeout(send, debounceMs);
      } else send();
      ackTimer.current = setTimeout(() => setPending(null), ackMs);
    },
    [actual, debounceMs, ackMs]
  );

  return { shown, waiting, request };
}
