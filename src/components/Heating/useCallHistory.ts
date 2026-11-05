import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import { fetchCallPoints, type CallPoint } from '../../utils/heatCalls';
import type { HeatingZone } from '../../utils/heating';

/** How often the day's call history is read again while the page stays open, in ms. */
export const CALL_HISTORY_REFRESH_MS = 5 * 60 * 1000;

type CallHistory = Partial<Record<HeatingZone, CallPoint[]>>;

/** Every zone's call history since `dayStartMs`: read when the page opens, every five minutes after, and again when
 * the day turns. Null until the first read of the day lands; a failed read keeps the last one. */
export function useCallHistory(dayStartMs: number): CallHistory | null {
  const connection = useHass(state => state.connection);
  const [loaded, setLoaded] = useState<{ dayStartMs: number; points: CallHistory } | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const load = () => {
      fetchCallPoints(connection, dayStartMs, Date.now())
        .then(points => {
          if (!cancelled) setLoaded({ dayStartMs, points });
        })
        .catch(() => {
          // The lanes keep what they have; the next read tries again.
        });
    };
    load();
    const timer = setInterval(load, CALL_HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, dayStartMs]);

  return loaded?.dayStartMs === dayStartMs ? loaded.points : null;
}
