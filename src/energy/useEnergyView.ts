import { useCallback, useEffect, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import type { EnergyBar, EnergyView, Period } from './types';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';
import { bucketPeriodFor, rangeFor } from './period';

/** Identifies "what should be fetched" so loading/committed state can be compared without a
 * synchronous setState at the top of the effect (react-hooks/set-state-in-effect). */
function buildRequestKey(gridStatId: string | undefined, period: Period, anchorStartMs: number, reloadTick: number): string {
  return `${gridStatId ?? ''}|${period}|${anchorStartMs}|${reloadTick}`;
}

interface FetchResult {
  key: string;
  data: EnergyView | null;
  error: string | null;
}

const EMPTY_RESULT: FetchResult = { key: '', data: null, error: null };

export interface UseEnergyViewResult {
  data: EnergyView | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useEnergyView(period: Period, anchorStartMs: number): UseEnergyViewResult {
  const connection = useHass(s => s.connection);
  const { config, loading: configLoading, error: configError } = useEnergyConfig();
  const [result, setResult] = useState<FetchResult>(EMPTY_RESULT);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeqRef = useRef(0);

  const reload = useCallback(() => setReloadTick(tick => tick + 1), []);

  useEffect(() => {
    if (!connection || !config) return;

    const { endMs } = rangeFor(period, anchorStartMs);
    const key = buildRequestKey(config.gridStatId, period, anchorStartMs, reloadTick);
    const requestId = ++requestSeqRef.current;

    fetchStatistics(connection, {
      startTimeIso: new Date(anchorStartMs).toISOString(),
      endTimeIso: new Date(endMs).toISOString(),
      statisticIds: [config.gridStatId],
      period: bucketPeriodFor(period),
      types: ['change'],
    })
      .then(response => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request
        const rows = response[config.gridStatId] ?? [];
        const bars: EnergyBar[] = rows.map(row => ({
          startMs: row.start,
          endMs: row.end,
          kWh: Math.max(0, row.change ?? 0),
        }));
        const totalKWh = bars.reduce((sum, bar) => sum + bar.kWh, 0);
        const nowMs = Date.now();
        setResult({
          key,
          data: { period, startMs: anchorStartMs, endMs, bars, totals: { kWh: totalKWh }, complete: endMs <= nowMs },
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (requestId !== requestSeqRef.current) return;
        setResult({ key, data: null, error: String(err) });
      });
  }, [connection, config, period, anchorStartMs, reloadTick]);

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
  const fetchPending = config != null && result.key !== requestKey;

  return {
    data: result.key === requestKey ? result.data : null,
    loading: configLoading || fetchPending,
    error: configError ?? (result.key === requestKey ? result.error : null),
    reload,
  };
}
