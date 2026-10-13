import { useMemo } from 'react';
import { useTrackedEntities } from '../hooks/useTrackedEntities';
import { assembleLivePower, type LivePowerView } from './assemble';
import type { EnergyConfig } from './types';

export interface LivePower {
  gridW: number | null;
  /** Usable readings by device statId. */
  powerByStatId: Record<string, number>;
  live: LivePowerView | null;
}

export function readWatts(entity: { state: string } | undefined): number | null {
  const state = entity?.state;
  if (state == null || state === '' || state === 'unavailable' || state === 'unknown') return null;
  const value = Number(state);
  return Number.isFinite(value) ? value : null;
}

/** Live draw of the grid and every configured device, re-read when one of those entities changes. */
export function useLivePower(config: EnergyConfig | null): LivePower {
  const entities = useTrackedEntities();
  return useMemo(() => {
    if (!config) return { gridW: null, powerByStatId: {}, live: null };
    const gridW = config.gridPowerEntityId ? readWatts(entities[config.gridPowerEntityId]) : null;
    const powerByStatId: Record<string, number> = {};
    for (const device of config.devices) {
      const watts = device.powerEntityId ? readWatts(entities[device.powerEntityId]) : null;
      if (watts != null) powerByStatId[device.statId] = watts;
    }
    return { gridW, powerByStatId, live: assembleLivePower(config.devices, powerByStatId, gridW) };
  }, [config, entities]);
}
