import { useEffect, useMemo, useRef, useState } from 'react';
import { useHass } from '@hakit/core';
import { buildWindowPriceMap, estimateRunCost } from './runCost';
import { dedupeFetch } from './cache';
import { useEnergyConfig } from './useEnergyConfig';
import { parseRawPoints } from './useEnergyView';
import { fetchStatistics } from './ws';

const HOUR_MS = 3_600_000;

export interface UseRunCostParams {
  /** Only compute/fetch while the card actually shows the post-run stats line — an appliance's
   * card mounts (and its entity exists) long before/after that, and there's nothing to price then. */
  active: boolean;
  /** The state sensor's `last_changed` at the moment it entered the post-run state — cycle-end
   * detection time, not the real cycle end (see `idleMinutes`). */
  endDetectedIso: string | undefined;
  runTimeMinutes: number | undefined;
  /** Minutes between the real cycle end and detection (the washer's `idle_min`); subtracted from
   * `endDetectedIso` to recover the real end-of-run instant. Omit for an appliance whose
   * detection is immediate (its Running→post-run span already equals `runTimeMinutes`). */
  idleMinutes?: number;
  energyKwh: number | undefined;
}

interface RunCostResult {
  key: string;
  costKr: number | null;
}

const EMPTY_RESULT: RunCostResult = { key: '', costKr: null };

/** Estimates one finished appliance run's electricity cost by joining its run window against the
 * Energi Data Service price entity — settled hourly statistics where the recorder has compiled
 * them, the entity's live raw/current-price attributes for the trailing edge that hasn't compiled
 * yet (see `runCost.ts`'s merge precedence). Returns null whenever there's nothing worth rendering:
 * the card isn't showing its stats line, the run window can't be established, or the priced
 * coverage is too thin to trust (see `estimateRunCost`) — the caller should simply omit the "≈ …
 * kr" span in all of those cases, never render a zero or a stale value. */
export function useRunCost(params: UseRunCostParams): number | null {
  const { active, endDetectedIso, runTimeMinutes, idleMinutes, energyKwh } = params;
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

  // The run's [startMs, endMs) window, anchored on detection time minus any known detection lag.
  // Null whenever the inputs aren't a real, prices-worth run yet.
  const runWindow = useMemo(() => {
    const detectedEndMs = endDetectedIso ? Date.parse(endDetectedIso) : NaN;
    if (!Number.isFinite(detectedEndMs)) return null;
    if (runTimeMinutes == null || !(runTimeMinutes > 0)) return null;
    if (energyKwh == null || !Number.isFinite(energyKwh) || energyKwh < 0) return null;

    const clampedIdleMinutes = Math.max(0, idleMinutes ?? 0);
    const endMs = detectedEndMs - clampedIdleMinutes * 60_000;
    const startMs = endMs - runTimeMinutes * 60_000;
    return { startMs, endMs };
  }, [endDetectedIso, runTimeMinutes, idleMinutes, energyKwh]);

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
    // even though the run itself may begin mid-hour.
    const flooredStartMs = Math.floor(runWindow.startMs / HOUR_MS) * HOUR_MS;
    const cacheKey = `runcost|${priceStatId}|${flooredStartMs}|${runWindow.endMs}`;

    dedupeFetch(cacheKey, Date.now(), () =>
      fetchStatistics(connection, {
        startTimeIso: new Date(flooredStartMs).toISOString(),
        endTimeIso: new Date(runWindow.endMs).toISOString(),
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
