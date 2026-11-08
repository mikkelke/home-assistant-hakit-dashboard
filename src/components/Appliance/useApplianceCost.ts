import { useRunCost } from '../../energy';
import type { HassEntity } from '../../types';
import { stateSinceIso } from '../../utils/stateSince';
import type { ApplianceState } from './applianceFormat';

export interface ApplianceRunFigures {
  energyKwh: number | undefined;
  runTimeMinutes: number | undefined;
  /** Minutes between the real end of a run and the sensor flipping to Unemptied, when the monitor reports it. */
  idleMinutes?: number | undefined;
}

/** The cost so far of a running cycle and the cost of a finished one. */
export function useApplianceCost(
  entity: HassEntity | undefined,
  state: ApplianceState,
  { energyKwh, runTimeMinutes, idleMinutes }: ApplianceRunFigures
): { runCostKr: number | null; liveCostKr: number | null } {
  const attrs = entity?.attributes ?? {};
  const runCostKr = useRunCost({
    mode: 'finished',
    active: state === 'Unemptied',
    endDetectedIso: stateSinceIso(entity),
    runTimeMinutes,
    idleMinutes,
    energyKwh,
  });
  const liveCostKr = useRunCost({
    mode: 'live',
    active: state === 'Running',
    startIso: typeof attrs.cycle_start_time === 'string' && attrs.cycle_start_time ? attrs.cycle_start_time : undefined,
    endAnchorIso: entity?.last_updated,
    energyKwh,
  });
  return { runCostKr, liveCostKr };
}
