import { useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { buildWindowPriceMap, estimateRunCost } from './runCost';
import { dedupeFetch } from './cache';
import { useEnergyConfig } from './useEnergyConfig';
import { parseRawPoints } from './useEnergyView';
import { fetchStatistics } from './ws';

const HOUR_MS = 3_600_000;

interface UseRunCostSharedParams {
  /** Only compute/fetch while the card actually shows a stats line — an appliance's card mounts
   * (and its entity exists) long before/after that, and there's nothing to price then. */
  active: boolean;
  energyKwh: number | undefined;
}

/**
 * Discriminated union on `mode`, sharing `{ active, energyKwh }`:
 * - `'finished'` — a completed run (existing semantics). The window is anchored back from
 *   `endDetectedIso` — the state sensor's `last_changed` at the moment it entered the post-run
 *   state, i.e. cycle-end *detection* time, not necessarily the real cycle end (see
 *   `idleMinutes`) — spanning back `runTimeMinutes`.
 * - `'live'` — a run still in progress. The window is the exact
 *   `[Date.parse(startIso), Date.parse(endAnchorIso))` span: the cycle's start and the most recent
 *   attribute republish. Recomputed every render as `endAnchorIso` ticks forward roughly every
 *   ~60 s while Running.
 */
export type UseRunCostParams = UseRunCostSharedParams &
  (
    | {
        mode: 'finished';
        /** The state sensor's `last_changed` at the moment it entered the post-run state —
         * cycle-end detection time, not the real cycle end (see `idleMinutes`). */
        endDetectedIso: string | undefined;
        runTimeMinutes: number | undefined;
        /** Minutes between the real cycle end and detection (the washer's `idle_min`); subtracted
         * from `endDetectedIso` to recover the real end-of-run instant. Omit for an appliance whose
         * detection is immediate (its Running→post-run span already equals `runTimeMinutes`). */
        idleMinutes?: number;
      }
    | {
        mode: 'live';
        /** Cycle start, UTC ISO (the entity's `cycle_start_time` attribute). */
        startIso: string | undefined;
        /** The republish tick to price up to — the state entity's `last_updated`, bumped by the
         * AppDaemon on every attribute republish (~60 s) while Running. */
        endAnchorIso: string | undefined;
      }
  );

interface RunCostResult {
  key: string;
  costKr: number | null;
}

const EMPTY_RESULT: RunCostResult = { key: '', costKr: null };

/** Estimates one appliance run's electricity cost — a finished run's total, or a still-Running
 * run's cost-so-far — by joining its run window against the Energi Data Service price entity:
 * settled hourly statistics where the recorder has compiled them, the entity's live raw/current-price
 * attributes for the trailing edge that hasn't compiled yet (see `runCost.ts`'s merge precedence).
 * Returns null whenever there's nothing worth rendering: the card isn't showing its stats line, the
 * run window can't be established (including a live run's early moments, where the republish tick
 * hasn't advanced past cycle start), or the priced coverage is too thin to trust (see
 * `estimateRunCost`) — the caller should simply omit the "≈ … kr" span in all of those cases, never
 * render a zero or a stale value. */
export function useRunCost(params: UseRunCostParams): number | null {
  const { active, energyKwh } = params;
  const connection = useHass(s => s.connection);
  const { config } = useEnergyConfig();

  // Selected as the entity object (mirrors useEnergyView's own priceAttrs) so the memo below only
  // re-derives when this entity actually changes, and a `current_price` tick naturally refreshes it.
  const priceEntity = useHass(s => (config?.priceEntityId ? s.entities[config.priceEntityId] : undefined));
  const { rawToday, rawTomorrow, currentPrice } = useMemo(() => {
    const attrs = priceEntity?.attributes;
    return {
      rawToday: parseRawPoints(attrs?.raw_today),
      rawTomorrow: parseRawPoints(attrs?.raw_tomorrow),
      currentPrice: typeof attrs?.current_price === 'number' ? attrs.current_price : null,
    };
  }, [priceEntity]);

  // Mode-specific inputs flattened to primitives BEFORE the window memo: `params` is a fresh object
  // literal on every card render (and these cards re-render on every entities-map change), so a
  // memo keyed on `params` itself would produce a new `runWindow` identity each render and re-run
  // the fetch effect below continuously — dedupeFetch's 2s window would then let a statistics fetch
  // through every couple of seconds for as long as a card is active.
  const mode = params.mode;
  const endDetectedIso = params.mode === 'finished' ? params.endDetectedIso : undefined;
  const runTimeMinutes = params.mode === 'finished' ? params.runTimeMinutes : undefined;
  const idleMinutes = params.mode === 'finished' ? params.idleMinutes : undefined;
  const startIso = params.mode === 'live' ? params.startIso : undefined;
  const endAnchorIso = params.mode === 'live' ? params.endAnchorIso : undefined;

  // The run's [startMs, endMs) window: 'finished' anchors it back from detection time (minus any
  // known detection lag); 'live' is the exact [cycle start, last republish) span. Null whenever the
  // inputs aren't a real, prices-worth window yet — including a live run's early moments, where
  // `last_updated` can still equal (or precede) `cycle_start_time`.
  const runWindow = useMemo(() => {
    if (energyKwh == null || !Number.isFinite(energyKwh) || energyKwh < 0) return null;

    if (mode === 'finished') {
      const detectedEndMs = endDetectedIso ? Date.parse(endDetectedIso) : NaN;
      if (!Number.isFinite(detectedEndMs)) return null;
      if (runTimeMinutes == null || !(runTimeMinutes > 0)) return null;

      const clampedIdleMinutes = Math.max(0, idleMinutes ?? 0);
      const endMs = detectedEndMs - clampedIdleMinutes * 60_000;
      const startMs = endMs - runTimeMinutes * 60_000;
      return { startMs, endMs };
    }

    const startMs = startIso ? Date.parse(startIso) : NaN;
    const endMs = endAnchorIso ? Date.parse(endAnchorIso) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return { startMs, endMs };
  }, [mode, endDetectedIso, runTimeMinutes, idleMinutes, startIso, endAnchorIso, energyKwh]);

  // Identifies "what should be priced" so the fetch effect and the render-time result check can be
  // compared without a synchronous setState at the top of the effect (react-hooks/set-state-in-effect).
  const requestKey = useMemo(() => {
    if (!config?.priceStatId || !runWindow) return '';
    return `${config.priceStatId}|${runWindow.startMs}|${runWindow.endMs}|${energyKwh}`;
  }, [config, runWindow, energyKwh]);

  const [result, setResult] = useState<RunCostResult>(EMPTY_RESULT);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const priceStatId = config?.priceStatId;
    if (!active || !connection || !priceStatId || !runWindow) return;

    const requestId = ++requestSeqRef.current;
    const key = requestKey;
    // Statistics are hourly-bucketed, so the fetch must start at the floor of the run's first hour
    // even though the run itself may begin mid-hour. The fetch end — and the dedupeFetch cache key
    // — is ceiled to the next hour boundary too, rather than the exact (ever-advancing) window end:
    // a live run's end moves roughly every ~60s as the AppDaemon republishes, and pricing is hourly
    // anyway, so this keeps the requested window stable across those ticks instead of treating every
    // tick as a distinct fetch. `estimateRunCost` below still prices the exact [startMs, endMs) span
    // — fetching an end time in the future is harmless, the recorder just returns whatever rows
    // already exist, and the in-progress hour is priced from the live raw attributes
    // (`buildWindowPriceMap`'s current-price/raw-points fallback).
    const flooredStartMs = Math.floor(runWindow.startMs / HOUR_MS) * HOUR_MS;
    const ceiledEndMs = Math.ceil(runWindow.endMs / HOUR_MS) * HOUR_MS;
    const cacheKey = `runcost|${priceStatId}|${flooredStartMs}|${ceiledEndMs}`;

    dedupeFetch(cacheKey, Date.now(), () =>
      fetchStatistics(connection, {
        startTimeIso: new Date(flooredStartMs).toISOString(),
        endTimeIso: new Date(ceiledEndMs).toISOString(),
        statisticIds: [priceStatId],
        period: 'hour',
        types: ['state'],
      })
    )
      .catch(() => null) // a failed stats fetch degrades to raw-attribute-only pricing, not an error
      .then(rows => {
        if (requestId !== requestSeqRef.current) return; // superseded by a newer request
        const priceByHourStart = buildWindowPriceMap(rows?.[priceStatId] ?? null, [rawToday, rawTomorrow], currentPrice, Date.now());
        const estimate = estimateRunCost(runWindow.startMs, runWindow.endMs, energyKwh ?? 0, priceByHourStart);
        setResult({ key, costKr: estimate?.costKr ?? null });
      });
  }, [active, connection, config?.priceStatId, runWindow, requestKey, rawToday, rawTomorrow, currentPrice, energyKwh]);

  return result.key === requestKey ? result.costKr : null;
}
