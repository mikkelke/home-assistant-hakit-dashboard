import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { assembleBars, assemblePriceSeries, synthesizePartialBar, type RawTodayPoint } from './assemble';
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
import type { EnergyView, Period } from './types';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';
import { bucketPeriodFor, isImmutablePeriod, rangeFor, startOfLocalDay } from './period';

/** Identifies "what should be fetched" so loading/committed state can be compared without a
 * synchronous setState at the top of the effect (react-hooks/set-state-in-effect). */
function buildRequestKey(gridStatId: string | undefined, period: Period, anchorStartMs: number, reloadTick: number): string {
  return `${gridStatId ?? ''}|${period}|${anchorStartMs}|${reloadTick}`;
}

/** Drops null/undefined ids — a config's cost/price stat may legitimately be absent. */
function pickIds(...ids: Array<string | null | undefined>): string[] {
  return ids.filter((id): id is string => id != null);
}

/** ms of the next HH:12:30 wall-clock instant strictly after `nowMs` — the recorder's observed
 * compile point for the in-progress hour's statistics row. */
function nextCompileMs(nowMs: number): number {
  const d = new Date(nowMs);
  const candidate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 12, 30, 0);
  if (candidate.getTime() <= nowMs) candidate.setHours(candidate.getHours() + 1);
  return candidate.getTime();
}

/** Defensive parse of one of the live price entity's hourly point-array attributes (`raw_today`,
 * `raw_tomorrow`, or the Carnot `forecast` attribute — all three share this `{hour, price}` shape)
 * — external data, never trusted blind. */
export function parseRawPoints(value: unknown): RawTodayPoint[] | null {
  if (!Array.isArray(value)) return null;
  const points = value.filter(
    (item): item is RawTodayPoint =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as RawTodayPoint).hour === 'string' &&
      typeof (item as RawTodayPoint).price === 'number'
  );
  return points.length > 0 ? points : null;
}

function parseCurrentPrice(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** The live price entity's attributes this page consumes, pre-parsed once per entity change —
 * `rawToday`/`currentPrice` drive the day view's settled price curve (`StatTiles`, `PriceStrip`);
 * `rawTomorrow`/`tomorrowValid`/`carnotForecast` drive the "Price forecast" strip
 * (`assembleForecast` in `bill.ts`). */
export interface EnergyPriceAttrs {
  rawToday: RawTodayPoint[] | null;
  rawTomorrow: RawTodayPoint[] | null;
  tomorrowValid: boolean;
  carnotForecast: RawTodayPoint[] | null;
  currentPrice: number | null;
}

interface FetchResult {
  key: string;
  data: EnergyView | null;
  error: string | null;
  /** True while `data` is a stale cache hit shown instantly and a real fetch is still in flight —
   * never true for an immutable-period cache hit, since that's the final, authoritative value. */
  refreshing: boolean;
}

const EMPTY_RESULT: FetchResult = { key: '', data: null, error: null, refreshing: false };

/** Two rapid reload() calls (e.g. `ready` and `visibilitychange` firing moments apart) would
 * otherwise each bump `reloadTick` to a distinct value and bypass dedupeFetch's own recent-resolve
 * guard (which is keyed without the tick — see below). Coalescing at the source keeps a single
 * cache key stable across those double-triggers instead. */
const RELOAD_COALESCE_MS = 2000;

export interface UseEnergyViewResult {
  data: EnergyView | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  /** Bypasses both the reload coalescing guard and the persisted (L3) cache for the current
   * period — wired to the PeriodPicker's long-press force-refresh. */
  forceReload: () => void;
  priceAttrs: EnergyPriceAttrs;
}

export function useEnergyView(period: Period, anchorStartMs: number): UseEnergyViewResult {
  const connection = useHass(s => s.connection);
  const { config, loading: configLoading, error: configError } = useEnergyConfig();

  // Live price-entity attributes (raw_today/raw_tomorrow/forecast/current_price) — selected as the
  // entity object so the memo below only re-derives when THIS entity actually changes. Kept as one
  // memo rather than split: it's also the fetch effect's own dependency below, so raw_tomorrow
  // landing at ~13:35 (or the hourly current_price tick) naturally triggers a refetch — desirable,
  // not churn.
  const priceEntity = useHass(s => (config?.priceEntityId ? s.entities[config.priceEntityId] : undefined));
  const priceAttrs = useMemo<EnergyPriceAttrs>(() => {
    const attrs = priceEntity?.attributes;
    return {
      rawToday: parseRawPoints(attrs?.raw_today),
      rawTomorrow: parseRawPoints(attrs?.raw_tomorrow),
      tomorrowValid: attrs?.tomorrow_valid === true,
      carnotForecast: parseRawPoints(attrs?.forecast),
      currentPrice: parseCurrentPrice(attrs?.current_price),
    };
  }, [priceEntity]);

  const isDay = period === 'day';
  // Cache-key inputs — memoized so the fetch effect and forceReload can share one identity without
  // recomputing the id list / hash on every render.
  const statisticIds = useMemo(
    () =>
      config
        ? isDay
          ? pickIds(config.gridStatId, config.costStatId, config.priceStatId)
          : pickIds(config.gridStatId, config.costStatId)
        : [],
    [config, isDay]
  );
  const cacheKey = useMemo(
    () => statsCacheKey(hashIds(statisticIds), period, anchorStartMs, 'view'),
    [statisticIds, period, anchorStartMs]
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
    if (!connection || !config) return;

    const { endMs } = rangeFor(period, anchorStartMs);
    const key = buildRequestKey(config.gridStatId, period, anchorStartMs, reloadTick);
    const requestId = ++requestSeqRef.current;
    const effectNowMs = Date.now();
    const immutable = isImmutablePeriod(period, anchorStartMs, endMs, effectNowMs);

    if (immutable) {
      // Closed period, at least two periods old — L1 first (fast reopen), then L3 (survives a
      // page reload). A hit is the final, authoritative value: never touch the network for it.
      const cachedEntry = getCached<EnergyView>(cacheKey) ?? readPersisted<EnergyView>(cacheKey);
      if (cachedEntry) {
        if (!getCached<EnergyView>(cacheKey)) setCached(cacheKey, cachedEntry.value, effectNowMs); // backfill L1 from L3
        Promise.resolve(cachedEntry.value).then(view => {
          if (requestId !== requestSeqRef.current) return; // superseded by a newer request
          setResult({ key, data: view, error: null, refreshing: false });
        });
        return;
      }
    } else {
      // Current/previous period (or any period seen for the first time this session): show any L1
      // stale value instantly while the real fetch runs, so the frame never goes blank on refetch.
      const stale = getCached<EnergyView>(cacheKey);
      if (stale) {
        Promise.resolve(stale.value).then(view => {
          if (requestId !== requestSeqRef.current) return;
          setResult({ key, data: view, error: null, refreshing: true });
        });
      }
    }

    dedupeFetch(cacheKey, effectNowMs, () =>
      fetchStatistics(connection, {
        startTimeIso: new Date(anchorStartMs).toISOString(),
        endTimeIso: new Date(endMs).toISOString(),
        statisticIds,
        period: bucketPeriodFor(period),
        types: isDay ? ['change', 'state'] : ['change'],
      }).then(async response => {
        const gridRows = response[config.gridStatId] ?? [];
        const costRows = config.costStatId ? (response[config.costStatId] ?? []) : [];
        const priceRows = isDay && config.priceStatId ? (response[config.priceStatId] ?? []) : null;

        let bars = assembleBars(period, anchorStartMs, endMs, gridRows, costRows, priceRows);
        const nowMs = Date.now();
        const priceSeries = isDay
          ? assemblePriceSeries(anchorStartMs, priceRows ?? [], priceAttrs.rawToday, nowMs, priceAttrs.currentPrice)
          : null;

        const isTodayDayView = isDay && anchorStartMs === startOfLocalDay(nowMs);
        const currentHourStartMs = Math.floor(nowMs / 3_600_000) * 3_600_000;

        if (isTodayDayView && !bars.some(bar => bar.startMs === currentHourStartMs)) {
          try {
            const fiveMinIds = pickIds(config.gridStatId, config.costStatId);
            const fiveMinResponse = await fetchStatistics(connection, {
              startTimeIso: new Date(currentHourStartMs).toISOString(),
              endTimeIso: new Date(nowMs).toISOString(),
              statisticIds: fiveMinIds,
              period: '5minute',
              types: ['change'],
            });

            const fiveMinGridRows = fiveMinResponse[config.gridStatId] ?? [];
            const fiveMinCostRows = config.costStatId ? (fiveMinResponse[config.costStatId] ?? []) : [];
            const partialPrice =
              priceSeries?.points.find(point => point.ms === currentHourStartMs)?.price ?? priceAttrs.currentPrice ?? null;
            const partialBar = synthesizePartialBar(currentHourStartMs, fiveMinGridRows, fiveMinCostRows, partialPrice);
            if (partialBar) bars = [...bars, partialBar];
          } catch {
            // 5-minute fetch failed — omit the partial bar rather than fabricate one.
          }
        }

        const totals = bars.reduce((sum, bar) => ({ kWh: sum.kWh + bar.kWh, costKr: sum.costKr + bar.costKr }), { kWh: 0, costKr: 0 });

        const view: EnergyView = {
          period,
          startMs: anchorStartMs,
          endMs,
          bars,
          totals,
          price: priceSeries ?? undefined,
          complete: endMs <= nowMs,
        };
        return view;
      })
    )
      .then(view => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request
        const persistNowMs = Date.now();
        setCached(cacheKey, view, persistNowMs);
        // CAVEAT: only an immutable (fully past) period is ever persisted — a today-view carries
        // `price.now`/partial-bar runtime artifacts that must never survive to a later reload; that
        // invariant holds by construction here since `immutable` is always false for "today".
        if (immutable) persistClosed(cacheKey, view, persistNowMs);
        setResult({ key, data: view, error: null, refreshing: false });
      })
      .catch((err: unknown) => {
        if (requestId !== requestSeqRef.current) return;
        setResult({ key, data: null, error: String(err), refreshing: false });
      });
  }, [connection, config, period, anchorStartMs, reloadTick, priceAttrs, isDay, statisticIds, cacheKey]);

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

  // In-progress periods only: re-poll around the recorder's hourly compile point and every
  // 5 minutes so the partial bar grows live. Closed periods (complete: true) get no timers.
  useEffect(() => {
    if (!result.data || result.data.complete) return;

    const nowMs = Date.now();
    const compileTimeoutId = window.setTimeout(reload, Math.max(0, nextCompileMs(nowMs) - nowMs));
    const growIntervalId = window.setInterval(reload, 5 * 60_000);

    return () => {
      window.clearTimeout(compileTimeoutId);
      window.clearInterval(growIntervalId);
    };
  }, [result, reload]);

  const requestKey = buildRequestKey(config?.gridStatId, period, anchorStartMs, reloadTick);
  const resultMatchesRequest = result.key === requestKey;
  const fetchPending = config != null && !resultMatchesRequest;

  return {
    data: resultMatchesRequest ? result.data : null,
    loading: configLoading || fetchPending,
    refreshing: resultMatchesRequest && result.refreshing,
    error: configError ?? (resultMatchesRequest ? result.error : null),
    reload,
    forceReload,
    priceAttrs,
  };
}
