import type { HassEntities } from '../types';

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

  for (const [entityId, entity] of Object.entries(entities || {})) {
    if (!entityId.startsWith('sensor.')) continue;
    if (entity.attributes?.device_class !== 'battery') continue;
    if (entity.attributes?.unit_of_measurement !== '%') continue;

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
