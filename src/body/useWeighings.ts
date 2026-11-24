import { useEffect, useMemo, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { fetchStatistics } from '../energy/ws';
import type { StatisticsResponse } from '../energy/types';
import {
  FAT_STAT,
  IMPEDANCE_STAT,
  LAST_MEASUREMENT_ENTITY,
  WEIGHT_STAT,
  ownWeighings,
  weighingsFromStatistics,
  withLiveReading,
  type Weighing,
} from './weighings';

/** The imported history starts in May 2018. */
const HISTORY_START_ISO = '2018-01-01T00:00:00Z';
const CACHE_TTL_MS = 10 * 60_000;

let cached: { at: number; promise: Promise<Weighing[]> } | null = null;

function loadWeighings(conn: Connection): Promise<Weighing[]> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.promise;
  const promise = fetchStatistics(conn, {
    startTimeIso: HISTORY_START_ISO,
    statisticIds: [WEIGHT_STAT, FAT_STAT, IMPEDANCE_STAT],
    period: 'hour',
    types: ['mean', 'min', 'max'],
  })
    .then((answer: StatisticsResponse) =>
      weighingsFromStatistics(answer[WEIGHT_STAT] ?? [], answer[FAT_STAT] ?? [], answer[IMPEDANCE_STAT] ?? [])
    )
    .catch(error => {
      cached = null;
      throw error;
    });
  cached = { at: Date.now(), promise };
  return promise;
}

const asNumber = (state: string | undefined): number | null => {
  const n = state == null ? NaN : Number(state);
  return Number.isFinite(n) ? n : null;
};

export type WeighingsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; weighings: Weighing[] };

/** Mikkel's own weighings, oldest first, with the latest reading from the live sensors. */
export function useWeighings(): WeighingsState {
  const connection = useHass(s => s.connection) as Connection | null;
  const kgState = useHass(s => s.entities[WEIGHT_STAT]?.state);
  const fatState = useHass(s => s.entities[FAT_STAT]?.state);
  const atState = useHass(s => s.entities[LAST_MEASUREMENT_ENTITY]?.state);
  const [loaded, setLoaded] = useState<{ conn: Connection; weighings: Weighing[] | null } | null>(null);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    loadWeighings(connection).then(
      weighings => !cancelled && setLoaded({ conn: connection, weighings }),
      () => !cancelled && setLoaded({ conn: connection, weighings: null })
    );
    return () => {
      cancelled = true;
    };
  }, [connection]);

  return useMemo(() => {
    if (!loaded || loaded.conn !== connection) return { status: 'loading' };
    if (!loaded.weighings) return { status: 'error' };
    const kg = asNumber(kgState);
    const atMs = atState ? new Date(atState).getTime() : NaN;
    const live = kg != null && Number.isFinite(atMs) ? { ts: atMs, kg, fatPct: asNumber(fatState) } : null;
    return { status: 'ready', weighings: ownWeighings(withLiveReading(loaded.weighings, live)) };
  }, [loaded, connection, kgState, fatState, atState]);
}
