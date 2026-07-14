import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { assembleBars, assemblePriceSeries, synthesizePartialBar, type RawTodayPoint } from './assemble';
import type { EnergyView, Period } from './types';
import { useEnergyConfig } from './useEnergyConfig';
import { fetchStatistics } from './ws';
import { bucketPeriodFor, rangeFor, startOfLocalDay } from './period';

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

/** Defensive parse of the live price entity's `raw_today` attribute — external data, never trusted blind. */
function parseRawToday(value: unknown): RawTodayPoint[] | null {
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

  // Live price-entity attributes (raw_today/current_price) — selected as the entity object so the
  // memo below only re-derives when THIS entity actually changes.
  const priceEntity = useHass(s => (config?.priceEntityId ? s.entities[config.priceEntityId] : undefined));
  const priceAttrs = useMemo(() => {
    const attrs = priceEntity?.attributes;
    return {
      rawToday: parseRawToday(attrs?.raw_today),
      currentPrice: parseCurrentPrice(attrs?.current_price),
      // Reserved for Phase 5 (Prisprognose) — not consumed yet, kept alongside its siblings so
      // this memo doesn't need re-deriving when that phase lands.
      tomorrowValid: attrs?.tomorrow_valid === true,
    };
  }, [priceEntity]);

  const [result, setResult] = useState<FetchResult>(EMPTY_RESULT);
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeqRef = useRef(0);

  const reload = useCallback(() => setReloadTick(tick => tick + 1), []);

  useEffect(() => {
    if (!connection || !config) return;

    const { endMs } = rangeFor(period, anchorStartMs);
    const key = buildRequestKey(config.gridStatId, period, anchorStartMs, reloadTick);
    const requestId = ++requestSeqRef.current;
    const isDay = period === 'day';
    const statisticIds = isDay
      ? pickIds(config.gridStatId, config.costStatId, config.priceStatId)
      : pickIds(config.gridStatId, config.costStatId);

    fetchStatistics(connection, {
      startTimeIso: new Date(anchorStartMs).toISOString(),
      endTimeIso: new Date(endMs).toISOString(),
      statisticIds,
      period: bucketPeriodFor(period),
      types: isDay ? ['change', 'state'] : ['change'],
    })
      .then(async response => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request

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
            if (requestId !== requestSeqRef.current) return;

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

        setResult({
          key,
          data: { period, startMs: anchorStartMs, endMs, bars, totals, price: priceSeries ?? undefined, complete: endMs <= nowMs },
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (requestId !== requestSeqRef.current) return;
        setResult({ key, data: null, error: String(err) });
      });
  }, [connection, config, period, anchorStartMs, reloadTick, priceAttrs]);

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
  const fetchPending = config != null && result.key !== requestKey;

  return {
    data: result.key === requestKey ? result.data : null,
    loading: configLoading || fetchPending,
    error: configError ?? (result.key === requestKey ? result.error : null),
    reload,
  };
}
