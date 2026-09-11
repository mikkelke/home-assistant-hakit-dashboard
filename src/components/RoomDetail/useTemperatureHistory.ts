import { useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import {
  fetchRoomTemperatureSeries,
  fetchTemperatureSeries,
  type HistoryFallback,
  type TemperatureRange,
  type TempPoint,
} from '../../utils/temperatureHistory';

export interface TemperatureHistoryState {
  roomSeries: TempPoint[];
  outdoorSeries: TempPoint[];
  loading: boolean;
  error: boolean;
}

const EMPTY_STATE: TemperatureHistoryState = { roomSeries: [], outdoorSeries: [], loading: false, error: false };

/** Fetches the room + outdoor temperature series for the chosen range. The caller only mounts
 * this (via TemperatureHistoryChart) while the climate sheet is open, so "refetch when the sheet
 * opens" falls out of the normal mount effect - fetchTemperatureSeries' own 5-minute cache keeps
 * a quick reopen from re-fetching. */
export function useTemperatureHistory(
  roomSensorId: string | null,
  outdoorSensorId: string | null,
  historyEntityId: string | null,
  historyAttribute: string | null,
  range: TemperatureRange
): TemperatureHistoryState {
  const connection = useHass(s => s.connection);
  const [state, setState] = useState<TemperatureHistoryState>(EMPTY_STATE);

  useEffect(() => {
    if (!connection || !roomSensorId) return; // nothing to fetch - state stays at its EMPTY_STATE default

    let cancelled = false;
    // Deferred a tick so the "loading" transition happens inside a callback rather than
    // synchronously in the effect body (react-hooks/set-state-in-effect).
    Promise.resolve().then(() => {
      if (!cancelled) setState(prev => ({ ...prev, loading: true, error: false }));
    });

    const fallback: HistoryFallback | null = historyEntityId ? { entityId: historyEntityId, attribute: historyAttribute } : null;

    Promise.all([
      fetchRoomTemperatureSeries(connection, roomSensorId, fallback, range),
      outdoorSensorId ? fetchTemperatureSeries(connection, outdoorSensorId, range) : Promise.resolve([] as TempPoint[]),
    ])
      .then(([roomSeries, outdoorSeries]) => {
        if (cancelled) return;
        setState({ roomSeries, outdoorSeries, loading: false, error: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ roomSeries: [], outdoorSeries: [], loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [connection, roomSensorId, outdoorSensorId, historyEntityId, historyAttribute, range]);

  return state;
}
