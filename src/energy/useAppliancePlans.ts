import { useEffect, useMemo, useState } from 'react';
import { PLAN_APPLIANCES, PLAN_TICK_MS, RUN_PROFILES_ENTITY_ID, type DoneByHour, type PlanApplianceKey } from '../config/plan';
import { useTrackedEntities } from '../hooks/useTrackedEntities';
import { assembleAppliancePlan, readApplianceRun, type AppliancePlan } from './appliancePlan';
import type { PricePointMs } from './priceTimeline';
import { cheapestAhead, peakHoursFromTariffs } from './planView';
import { buildHourlyPrices } from './priceTimeline';
import { parseRunProfiles } from './runProfiles';
import type { PriceBlock } from './startPlan';
import { useEnergyConfig } from './useEnergyConfig';
import { parseRawPoints } from './useEnergyView';

export type AppliancePlanSelection = Partial<Record<PlanApplianceKey, { programmeKey?: string | null; doneBy?: DoneByHour }>>;

export interface UseAppliancePlansResult {
  nowMs: number;
  /** Every known hour, elapsed ones included. */
  timeline: PricePointMs[];
  /** Cheapest `CHEAPEST_BLOCK_HOURS` consecutive hours from the current hour until the end of tomorrow. */
  cheapest: PriceBlock | null;
  /** Tomorrow's day-ahead prices are published (until then tomorrow comes from the forecast). */
  tomorrowValid: boolean;
  /** Home-time hours of the grid's peak tariff; null when the tariff table is unavailable. */
  peakHours: number[] | null;
  /** Why no profiles are available (entity missing or malformed); null when they are. */
  profilesError: string | null;
  appliances: AppliancePlan[];
}

/** Start advice for every configured appliance from live entities only (no recorder or history
 * calls), recomputed each minute and whenever a read entity changes. */
export function useAppliancePlans(selection: AppliancePlanSelection = {}): UseAppliancePlansResult {
  const entities = useTrackedEntities();
  const { config } = useEnergyConfig();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), PLAN_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const priceEntity = config?.priceEntityId ? entities[config.priceEntityId] : undefined;
  const timeline = useMemo(() => {
    const attrs = priceEntity?.attributes;
    return buildHourlyPrices(
      parseRawPoints(attrs?.raw_today),
      parseRawPoints(attrs?.raw_tomorrow),
      attrs?.tomorrow_valid === true,
      parseRawPoints(attrs?.forecast)
    );
  }, [priceEntity]);

  const tomorrowValid = priceEntity?.attributes?.tomorrow_valid === true;
  const tariffs = priceEntity?.attributes?.tariffs;
  const peakHours = useMemo(() => peakHoursFromTariffs(tariffs), [tariffs]);

  const profilesEntity = entities[RUN_PROFILES_ENTITY_ID];
  const parsed = useMemo(
    () => (profilesEntity ? parseRunProfiles(profilesEntity.attributes) : { ok: false as const, error: 'profiles entity missing' }),
    [profilesEntity]
  );

  const selectionKey = JSON.stringify(selection);

  const appliances = useMemo(() => {
    const chosen = JSON.parse(selectionKey) as AppliancePlanSelection;
    return PLAN_APPLIANCES.map(appliance =>
      assembleAppliancePlan({
        config: appliance,
        run: readApplianceRun(entities[appliance.stateEntityId], appliance.etaFormat, nowMs),
        programmes: parsed.ok ? (parsed.profiles.appliances[appliance.key] ?? []) : [],
        programmeKey: chosen[appliance.key]?.programmeKey,
        doneBy: chosen[appliance.key]?.doneBy,
        timeline,
        nowMs,
      })
    );
  }, [entities, parsed, timeline, nowMs, selectionKey]);

  const cheapest = useMemo(() => cheapestAhead(timeline, nowMs), [timeline, nowMs]);

  return { nowMs, timeline, cheapest, tomorrowValid, peakHours, profilesError: parsed.ok ? null : parsed.error, appliances };
}
