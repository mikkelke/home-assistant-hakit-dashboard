import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { assembleDevices } from './assemble';
import type { EnergyDevices, EnergyView, Period, StatisticsResponse } from './types';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';
import { rangeFor } from './period';

/** Devices are fetched at PERIOD granularity (never finer, to keep the 41-id payload tiny): day,
 * week and month each get exactly one bucket per device spanning the whole period; year gets up
 * to 12 monthly buckets. This intentionally differs from `bucketPeriodFor` in period.ts, which
 * requests hourly buckets for the day view's chart bars. */
function deviceBucketPeriodFor(period: Period): 'day' | 'week' | 'month' {
  switch (period) {
    case 'day':
      return 'day';
    case 'week':
      return 'week';
    case 'month':
      return 'month';
    case 'year':
      return 'month';
  }
}

/** Identifies "what rows should be fetched" — mirrors useEnergyView's request-key pattern.
 * Deliberately excludes anything derived from `view`: a view refresh (e.g. the day view's partial
 * bar growing every 5 minutes) must re-assemble the already-fetched rows against the new bars,
 * never re-fetch the device statistics themselves. */
function buildRequestKey(gridStatId: string | undefined, period: Period, anchorStartMs: number, reloadTick: number): string {
  return `${gridStatId ?? ''}|${period}|${anchorStartMs}|${reloadTick}`;
}

interface FetchResult {
  key: string;
  rows: StatisticsResponse | null;
  error: string | null;
}

const EMPTY_RESULT: FetchResult = { key: '', rows: null, error: null };

export interface UseEnergyDevicesResult {
  data: EnergyDevices | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useEnergyDevices(period: Period, anchorStartMs: number, view: EnergyView | null): UseEnergyDevicesResult {
  const connection = useHass(s => s.connection);
  const { config, loading: configLoading, error: configError } = useEnergyConfig();
  // A boolean gate, not the `view` object itself: `view` is a new object on every re-assemble
  // (e.g. the day view's partial-bar 5-minute growth), and including it directly here would
  // refetch devices on every one of those — the gate only needs to flip once, from "not ready yet"
  // to "ready".
  const hasView = view != null;

  const [result, setResult] = useState<FetchResult>(EMPTY_RESULT);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeqRef = useRef(0);

  const reload = useCallback(() => setReloadTick(tick => tick + 1), []);

  useEffect(() => {
    if (!connection || !config || !hasView || config.devices.length === 0) return;

    const { endMs } = rangeFor(period, anchorStartMs);
    const key = buildRequestKey(config.gridStatId, period, anchorStartMs, reloadTick);
    const requestId = ++requestSeqRef.current;

    fetchStatistics(connection, {
      startTimeIso: new Date(anchorStartMs).toISOString(),
      endTimeIso: new Date(endMs).toISOString(),
      statisticIds: config.devices.map(device => device.statId),
      period: deviceBucketPeriodFor(period),
      types: ['change'],
    })
      .then(response => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request
        setResult({ key, rows: response, error: null });
      })
      .catch((err: unknown) => {
        if (requestId !== requestSeqRef.current) return;
        setResult({ key, rows: null, error: String(err) });
      });
  }, [connection, config, period, anchorStartMs, reloadTick, hasView]);

  useEffect(() => {
    if (!connection) return;
    const onReady = () => reload();
    connection.addEventListener('ready', onReady);
    return () => connection.removeEventListener('ready', onReady);
  }, [connection, reload]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [reload]);

  const requestKey = buildRequestKey(config?.gridStatId, period, anchorStartMs, reloadTick);
  // config.devices.length === 0 never fetches (see the effect above), so it must not count towards
  // "pending" either — otherwise loading would never resolve for a (hypothetical) deviceless config.
  const fetchPending = config != null && hasView && config.devices.length > 0 && result.key !== requestKey;
  const rows = result.key === requestKey ? result.rows : null;

  // Split from the fetch above: re-assembles whenever `view` changes (new bars/totals) without
  // triggering a refetch, since the fetch effect above never depends on `view` itself.
  const data = useMemo(() => {
    if (!config || !view || !rows) return null;
    return assembleDevices(config.devices, rows, view.bars, view.totals);
  }, [config, view, rows]);

  return {
    data,
    loading: configLoading || !hasView || fetchPending,
    error: configError ?? (result.key === requestKey ? result.error : null),
    reload,
  };
}
