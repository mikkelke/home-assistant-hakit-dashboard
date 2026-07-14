import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { assembleDevices } from './assemble';
import {
  clearCached,
  clearPersisted,
  dedupeFetch,
  getCached,
  hashIds,
  persistClosed,
  readPersisted,
  setCached,
  statsCacheKey,
} from './cache';
import type { EnergyDevices, EnergyView, Period, StatisticsResponse } from './types';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';
import { isImmutablePeriod, rangeFor } from './period';

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
  /** True while `rows` is a stale cache hit shown instantly and a real fetch is still in flight —
   * never true for an immutable-period cache hit, since that's the final, authoritative value. */
  refreshing: boolean;
}

const EMPTY_RESULT: FetchResult = { key: '', rows: null, error: null, refreshing: false };

/** Mirrors useEnergyView's own reload-coalescing guard — see there for why it lives at the
 * `reload()` call site rather than inside dedupeFetch's key. */
const RELOAD_COALESCE_MS = 2000;

export interface UseEnergyDevicesResult {
  data: EnergyDevices | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  /** Bypasses both the reload coalescing guard and the persisted (L3) cache for the current
   * period — wired to the PeriodPicker's long-press force-refresh. */
  forceReload: () => void;
}

export function useEnergyDevices(period: Period, anchorStartMs: number, view: EnergyView | null): UseEnergyDevicesResult {
  const connection = useHass(s => s.connection);
  const { config, loading: configLoading, error: configError } = useEnergyConfig();
  // A boolean gate, not the `view` object itself: `view` is a new object on every re-assemble
  // (e.g. the day view's partial-bar 5-minute growth), and including it directly here would
  // refetch devices on every one of those — the gate only needs to flip once, from "not ready yet"
  // to "ready".
  const hasView = view != null;

  // Cache-key inputs — memoized so the fetch effect and forceReload can share one identity without
  // recomputing the id list / hash on every render. The assembled EnergyDevices view-model is NOT
  // what's cached (its assembly depends on the live view's bars); the fetched `rowsByStatId` is.
  const deviceStatIds = useMemo(() => config?.devices.map(device => device.statId) ?? [], [config]);
  const cacheKey = useMemo(
    () => statsCacheKey(hashIds(deviceStatIds), period, anchorStartMs, 'dev'),
    [deviceStatIds, period, anchorStartMs]
  );

  const [result, setResult] = useState<FetchResult>(EMPTY_RESULT);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeqRef = useRef(0);
  const lastReloadAtMsRef = useRef(0);

  const reload = useCallback(() => {
    const nowMs = Date.now(); // event-handler read — purity lint only constrains render itself
    if (nowMs - lastReloadAtMsRef.current < RELOAD_COALESCE_MS) return;
    lastReloadAtMsRef.current = nowMs;
    setReloadTick(tick => tick + 1);
  }, []);

  const forceReload = useCallback(() => {
    // Both layers: L1 has no TTL, so leaving an immutable period's in-memory hit in place would
    // still short-circuit the fetch below even after L3 is cleared.
    clearCached(cacheKey);
    clearPersisted(cacheKey);
    lastReloadAtMsRef.current = Date.now();
    setReloadTick(tick => tick + 1);
  }, [cacheKey]);

  useEffect(() => {
    if (!connection || !config || !hasView || config.devices.length === 0) return;

    const { endMs } = rangeFor(period, anchorStartMs);
    const key = buildRequestKey(config.gridStatId, period, anchorStartMs, reloadTick);
    const requestId = ++requestSeqRef.current;
    const effectNowMs = Date.now();
    const immutable = isImmutablePeriod(period, anchorStartMs, endMs, effectNowMs);

    if (immutable) {
      // Closed period, at least two periods old — L1 first (fast reopen), then L3 (survives a
      // page reload). A hit is the final, authoritative value: never touch the network for it.
      const cachedEntry = getCached<StatisticsResponse>(cacheKey) ?? readPersisted<StatisticsResponse>(cacheKey);
      if (cachedEntry) {
        if (!getCached<StatisticsResponse>(cacheKey)) setCached(cacheKey, cachedEntry.value, effectNowMs); // backfill L1 from L3
        Promise.resolve(cachedEntry.value).then(rows => {
          if (requestId !== requestSeqRef.current) return; // superseded by a newer request
          setResult({ key, rows, error: null, refreshing: false });
        });
        return;
      }
    } else {
      // Current/previous period (or any period seen for the first time this session): show any L1
      // stale rows instantly while the real fetch runs, so the breakdown never goes blank.
      const stale = getCached<StatisticsResponse>(cacheKey);
      if (stale) {
        Promise.resolve(stale.value).then(rows => {
          if (requestId !== requestSeqRef.current) return;
          setResult({ key, rows, error: null, refreshing: true });
        });
      }
    }

    dedupeFetch(cacheKey, effectNowMs, () =>
      fetchStatistics(connection, {
        startTimeIso: new Date(anchorStartMs).toISOString(),
        endTimeIso: new Date(endMs).toISOString(),
        statisticIds: deviceStatIds,
        period: deviceBucketPeriodFor(period),
        types: ['change'],
      })
    )
      .then(rows => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request
        const persistNowMs = Date.now();
        setCached(cacheKey, rows, persistNowMs);
        if (immutable) persistClosed(cacheKey, rows, persistNowMs);
        setResult({ key, rows, error: null, refreshing: false });
      })
      .catch((err: unknown) => {
        if (requestId !== requestSeqRef.current) return;
        setResult({ key, rows: null, error: String(err), refreshing: false });
      });
  }, [connection, config, period, anchorStartMs, reloadTick, hasView, deviceStatIds, cacheKey]);

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
  const resultMatchesRequest = result.key === requestKey;
  // config.devices.length === 0 never fetches (see the effect above), so it must not count towards
  // "pending" either — otherwise loading would never resolve for a (hypothetical) deviceless config.
  const fetchPending = config != null && hasView && config.devices.length > 0 && !resultMatchesRequest;
  const rows = resultMatchesRequest ? result.rows : null;

  // Split from the fetch above: re-assembles whenever `view` changes (new bars/totals) without
  // triggering a refetch, since the fetch effect above never depends on `view` itself.
  const data = useMemo(() => {
    if (!config || !view || !rows) return null;
    return assembleDevices(config.devices, rows, view.bars, view.totals);
  }, [config, view, rows]);

  return {
    data,
    loading: configLoading || !hasView || fetchPending,
    refreshing: resultMatchesRequest && result.refreshing,
    error: configError ?? (resultMatchesRequest ? result.error : null),
    reload,
    forceReload,
  };
}
