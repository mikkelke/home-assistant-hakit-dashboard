import { useMemo } from 'react';
import { useHass } from '@hakit/core';
import { HOME_DELIVERY_ENTITY } from '../config/entities';
import { useViewer } from '../hooks/useViewer';
import { parseDeliveryFeed, visibleDeliveries, type DeliveryFeed } from './model';

/** What is on its way to the flat, as far as the viewer may see it. */
export function useHomeDelivery(): DeliveryFeed {
  const entity = useHass(store => store.entities?.[HOME_DELIVERY_ENTITY]);
  const { name } = useViewer();
  const feed = useMemo(() => parseDeliveryFeed(entity), [entity]);
  return useMemo(() => visibleDeliveries(feed, { name }), [feed, name]);
}
