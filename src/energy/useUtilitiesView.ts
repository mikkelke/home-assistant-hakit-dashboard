import { useCallback, useEffect, useState } from 'react';
import { useHass } from '@hakit/core';
import type { Connection } from 'home-assistant-js-websocket';
import { UTILITY_METERS, UTILITY_STATS_SOURCE } from '../config/utilities';
import { dedupeFetch, getCached, setCached } from './cache';
import type { Period } from './types';
import {
  assembleUtilityView,
  periodDataEndMs,
  UTILITY_CALENDAR,
  utilityStatIds,
  utilityStatsWindows,
  yearEarlier,
  type UtilityStatMap,
  type UtilityView,
} from './utilities';
import { fetchStatistics } from './ws';

interface StatisticIdMeta {
  statistic_id: string;
  source: string;
}

// Module-level: the meters' statistic ids are looked up once per page load.
let statIdsPromise: Promise<UtilityStatMap> | null = null;

function loadStatIds(connection: Connection): Promise<UtilityStatMap> {
  if (!statIdsPromise) {
    statIdsPromise = connection
      .sendMessagePromise<StatisticIdMeta[]>({ type: 'recorder/list_statistic_ids', statistic_type: 'sum' })
      .then(list => {
        const ids = utilityStatIds(list.filter(item => item.source === UTILITY_STATS_SOURCE).map(item => item.statistic_id));
        if (Object.keys(ids).length === 0) throw new Error('No water or heat statistics in Home Assistant');
        return ids;
      });
    statIdsPromise.catch(() => {
      statIdsPromise = null; // don't cache a failure; the next load looks again
    });
  }
  return statIdsPromise;
}

async function loadView(
  connection: Connection,
  ids: UtilityStatMap,
  period: Period,
  startMs: number,
  endMs: number,
  dataEndMs: number
): Promise<UtilityView> {
  const statisticIds = UTILITY_METERS.flatMap(({ kind }) => {
    const meter = ids[kind];
    if (!meter) return [];
    return meter.cost ? [meter.amount, meter.cost] : [meter.amount];
  });
  const responses = await Promise.all(
    utilityStatsWindows(period, startMs, dataEndMs).map(window =>
      fetchStatistics(connection, {
        startTimeIso: new Date(window.startMs).toISOString(),
        endTimeIso: new Date(window.endMs).toISOString(),
        statisticIds,
        period: window.bucket,
        types: ['change'],
      })
    )
  );
  return assembleUtilityView(period, startMs, endMs, dataEndMs, ids, responses);
}

export interface UtilitiesData {
  view: UtilityView;
  /** The same span a year earlier, cut at the same point. */
  lastYear: UtilityView;
}

interface FetchResult {
  key: string;
  data: UtilitiesData | null;
  error: string | null;
  refreshing: boolean;
}

export interface UseUtilitiesViewResult {
  data: UtilitiesData | null;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
}

/** The meters over one period from `anchorStartMs` (a `UTILITY_CALENDAR` start) and over the same span
 * a year earlier, both counted up to `dataEndMs` when that falls inside the period. Cached in memory
 * only: ista rewrites its cost rows when a year's prices settle. */
export function useUtilitiesView(period: Period, anchorStartMs: number, dataEndMs: number | null): UseUtilitiesViewResult {
  const connection = useHass(s => s.connection);
  const [result, setResult] = useState<FetchResult>({ key: '', data: null, error: null, refreshing: false });
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => setReloadTick(tick => tick + 1), []);

  const endMs = UTILITY_CALENDAR.step(period, anchorStartMs, 1);
  const cutMs = periodDataEndMs(anchorStartMs, endMs, dataEndMs);
  const key = `utilities:${period}:${anchorStartMs}:${cutMs}`;

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    // Show what this session last fetched at once, while the real fetch runs.
    const stale = getCached<UtilitiesData>(key);
    if (stale) {
      Promise.resolve(stale.value).then(data => {
        if (!cancelled) setResult({ key, data, error: null, refreshing: true });
      });
    }
    dedupeFetch(key, Date.now(), async () => {
      const ids = await loadStatIds(connection);
      const [view, lastYear] = await Promise.all([
        loadView(connection, ids, period, anchorStartMs, endMs, cutMs),
        loadView(connection, ids, period, yearEarlier(period, anchorStartMs), yearEarlier(period, endMs), yearEarlier(period, cutMs)),
      ]);
      return { view, lastYear };
    }).then(
      data => {
        if (cancelled) return;
        setCached(key, data, Date.now());
        setResult({ key, data, error: null, refreshing: false });
      },
      (err: unknown) => {
        if (!cancelled) setResult({ key, data: null, error: String(err), refreshing: false });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [connection, period, anchorStartMs, endMs, cutMs, key, reloadTick]);

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

  const current = result.key === key;
  return {
    data: current ? result.data : null,
    refreshing: current && result.refreshing,
    error: current ? result.error : null,
    reload,
  };
}
