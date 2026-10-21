import { useMemo } from 'react';
import { useHass } from '@hakit/core';
import { HOUSE_UPCOMING_ENTITY } from '../config/entities';
import { dueRows, parseHouseUpcoming, type HouseUpcomingRow } from '../home/houseUpcoming';
import { useNowMs } from './useNowMs';
import { useViewer } from './useViewer';

/** What needs doing in the rooms: the `sensor.house_upcoming` rows that are due and name a room, which this viewer sees as
 * the Now timeline shows them to this viewer. */
export function useDueRows(): HouseUpcomingRow[] {
  const attributes = useHass(s => s.entities[HOUSE_UPCOMING_ENTITY]?.attributes);
  const nowMs = useNowMs();
  const viewer = useViewer();
  return useMemo(() => dueRows(parseHouseUpcoming(attributes, nowMs), viewer), [attributes, nowMs, viewer]);
}
