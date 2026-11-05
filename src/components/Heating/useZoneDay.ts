import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { LocalDay } from '../../utils/heatCalls';
import type { HeatingZone } from '../../utils/heating';
import { CALL_HISTORY_REFRESH_MS } from './useCallHistory';
import { loadZoneDay, type ZoneDayData } from './zoneDay';

export type ZoneDayState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: ZoneDayData };

/** One day of one zone from the recorder. A day that is over is read once and remembered; today is read when the
 * sheet opens and every five minutes after, and a failed read of today keeps what was last read. */
export function useZoneDay(zone: HeatingZone, day: LocalDay): ZoneDayState {
  const connection = useHass(state => state.connection);
  const { startMs, endMs } = day;
  const key = `${zone}|${startMs}`;
  const [loaded, setLoaded] = useState<{ key: string; data: ZoneDayData | null } | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    const load = () => {
      loadZoneDay(connection, zone, { startMs, endMs }, Date.now()).then(
        data => {
          if (!cancelled) setLoaded({ key, data });
        },
        () => {
          if (!cancelled) setLoaded(previous => (previous?.key === key && previous.data ? previous : { key, data: null }));
        }
      );
    };
    load();
    const timer = endMs > Date.now() ? setInterval(load, CALL_HISTORY_REFRESH_MS) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection, zone, startMs, endMs, key]);

  if (loaded?.key !== key) return { status: 'loading' };
  return loaded.data ? { status: 'ready', data: loaded.data } : { status: 'error' };
}
