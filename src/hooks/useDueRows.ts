import { useMemo } from 'react';
import { useHass } from '@hakit/core';
import { HOUSE_UPCOMING_ENTITY } from '../config/entities';
import { dueRows, parseHouseUpcoming, type HouseUpcomingRow } from '../home/houseUpcoming';
import { ICE_BATH_ROW_ID } from '../home/terrace';
import { useNowMs } from './useNowMs';
import { useViewer } from './useViewer';

/** What needs doing in the rooms: the `sensor.house_upcoming` rows that are due and name a room, which this viewer sees as
 * the Now timeline shows them to this viewer. Ice on the ice bath is not a task: the frost on the Rooftop card and on the
 * weather chip say it, so its row is not among these. */
export function useDueRows(): HouseUpcomingRow[] {
  const attributes = useHass(s => s.entities[HOUSE_UPCOMING_ENTITY]?.attributes);
  const nowMs = useNowMs();
  const viewer = useViewer();
  return useMemo(
    () => dueRows(parseHouseUpcoming(attributes, nowMs), viewer).filter(row => row.id !== ICE_BATH_ROW_ID),
    [attributes, nowMs, viewer]
  );
}
