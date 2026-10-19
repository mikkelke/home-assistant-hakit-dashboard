import { useCallback } from 'react';
import type { CallServiceFunction, HassEntities } from '../../types';
import { usePendingWrite } from '../../hooks/usePendingWrite';
import { hapticTick } from '../../utils/haptics';
import {
  NUDGE_STEP_C,
  heatNum,
  heatingSeasonOn,
  isHeating,
  nudgeButtonIds,
  nudgeControl,
  zoneSensorId,
  zoneThermostatId,
  type HeatingZone,
  type NudgeControl,
} from '../../utils/heating';

export interface ResidentHeatState {
  seasonOn: boolean;
  heating: boolean;
  target: number | null;
  control: NudgeControl;
  waiting: boolean;
  lower: number | null;
  upper: number | null;
  warmer: () => void;
  colder: () => void;
}

/** A resident's room heating: the zone's comfort target, whether its thermostat heats, and the
 * warmer/colder buttons with an optimistic nudge until the controller publishes the new one. */
export function useResidentHeat(
  entities: HassEntities,
  zone: HeatingZone | null,
  callService: CallServiceFunction | undefined
): ResidentHeatState | null {
  const sensor = zone ? entities[zoneSensorId(zone)] : undefined;
  const attrs = sensor?.attributes;
  const actualNudge = heatNum(attrs?.nudge) ?? 0;
  const target = heatNum(sensor?.state);

  const press = useCallback(
    (value: number) => {
      if (!zone || !callService) return;
      const buttons = nudgeButtonIds(zone);
      callService({
        domain: 'input_button',
        service: 'press',
        target: { entity_id: value > actualNudge ? buttons.warmer : buttons.colder },
      });
    },
    [zone, callService, actualNudge]
  );
  const { shown: nudge, waiting, request } = usePendingWrite(actualNudge, press);

  if (!zone || !sensor) return null;
  const shownTarget = target == null ? null : target + (nudge - actualNudge);
  const control = nudgeControl({ ...attrs, nudge }, shownTarget);
  const step = (direction: 1 | -1) => {
    hapticTick();
    request(Math.round((nudge + direction * NUDGE_STEP_C) * 2) / 2);
  };
  return {
    seasonOn: heatingSeasonOn(entities),
    heating: isHeating(entities[zoneThermostatId(zone)]),
    target: shownTarget,
    control,
    waiting,
    lower: heatNum(attrs?.lower_limit),
    upper: heatNum(attrs?.upper_limit),
    warmer: () => step(1),
    colder: () => step(-1),
  };
}
