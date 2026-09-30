import type { HassEntities } from '../types';
import { peekEntities } from '../hooks/useTrackedEntities';

export interface BatteryAlertItem {
  entityId: string;
  name: string;
  value: number;
  isLow: boolean;
}

export const ALERT_BATTERY_THRESHOLD = 12;
const MOBILE_BATTERY_EXCLUDE_KEYWORDS = ['iphone', 'ipad', 'oppopad', 'ofx9p', 'phone', 'tablet'];

export function deriveBatteryItems(entities: HassEntities): BatteryAlertItem[] {
  const grouped = new Map<string, { entityId: string; name: string; value: number; isBt: boolean }>();

  // Finding the battery sensors means looking at the attributes of every sensor. Do that on the untracked map and read only the
  // ones that turn out to be batteries through `entities`, so it is their changes (not every sensor's) that re-render the caller.
  // A sensor that only starts qualifying later (attributes gained after a restart) is picked up on the next re-render, which
  // useTrackedEntities' heartbeat keeps from being far away.
  for (const [entityId, candidate] of Object.entries(peekEntities(entities || {}))) {
    if (!entityId.startsWith('sensor.')) continue;
    if (candidate.attributes?.device_class !== 'battery') continue;
    if (candidate.attributes?.unit_of_measurement !== '%') continue;

    const entity = entities[entityId];

    const value = Number(entity.state);
    if (!Number.isFinite(value) || value < 0) continue;

    const isBt = /_bt$/i.test(entityId);
    const groupKey = entityId.replace(/_bt$/i, '');
    const existing = grouped.get(groupKey);

    if (!existing || (isBt && !existing.isBt)) {
      const rawName = String(entity.attributes?.friendly_name ?? entityId);
      const searchText = `${entityId} ${rawName}`.toLowerCase();
      if (MOBILE_BATTERY_EXCLUDE_KEYWORDS.some(keyword => searchText.includes(keyword))) continue;

      const name = rawName.replace(/\s+battery(\s+bt)?$/i, '').trim();
      grouped.set(groupKey, { entityId, name, value, isBt });
    }
  }

  return [...grouped.values()]
    .map(item => ({ entityId: item.entityId, name: item.name, value: item.value, isLow: item.value <= ALERT_BATTERY_THRESHOLD }))
    .sort((a, b) => {
      if (a.isLow !== b.isLow) return a.isLow ? -1 : 1;
      return a.value - b.value;
    });
}
