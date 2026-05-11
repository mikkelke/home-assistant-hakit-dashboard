import { APARTMENT_DOOR_OPEN_ENTITY, resolveHallwayDoorSensorId, resolveHallwayLockEntityId } from '../config/entities';
import { TRANSIT_LINES, getTransitSeverity, isTransitAlert } from '../config/transit';
import { getTransitLineDisplayStatus } from './transitDisplay';
import type { Area, HassEntities, HassEntity, HomePulseSummary, PulseChip } from '../types';
import { deriveBatteryItems } from './batteryAlerts';
import { resolveDishwasherSemanticState } from './dishwasherSemanticState';

const APPLIANCE_READY_STATES = ['complete', 'finished', 'done', 'ready', 'end', 'completed', 'end of cycle', 'unemptied'];
const APPLIANCE_INACTIVE_STATES = ['off', 'idle', 'emptied', 'standby', 'unknown', 'unavailable'];
const WEATHER_ALERT_ACTIVE_ENTITY = 'binary_sensor.weather_opening_alert_active';
const WEATHER_ALERT_PRIORITY_ENTITY = 'sensor.weather_opening_alert_priority';
const WEATHER_ALERT_TARGET_AREA_ENTITY = 'sensor.weather_opening_alert_target_area';

interface ApplianceConfig {
  id: 'dishwasher' | 'washer' | 'dryer';
  sensorId: string;
  label: string;
  areaId: string;
  icon: string;
}

interface ChipCandidate extends PulseChip {
  priority: number;
}

const APPLIANCES: ApplianceConfig[] = [
  { id: 'dishwasher', sensorId: 'sensor.dishwasher_state', label: 'Dishwasher', areaId: 'kitchen', icon: 'mdi:dishwasher' },
  { id: 'washer', sensorId: 'sensor.washer_state', label: 'Washer', areaId: 'guest_bathroom', icon: 'mdi:washing-machine' },
  { id: 'dryer', sensorId: 'sensor.dryer_state', label: 'Dryer', areaId: 'guest_bathroom', icon: 'mdi:tumble-dryer' },
];

function normalizeAreaName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '_');
}

function formatAreaName(value: string): string {
  return value.replace(/\b(\p{L})(\p{L}*)/gu, (_, first: string, rest: string) => first.toUpperCase() + rest.toLowerCase());
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMinutesCompact(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function minutesSince(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, (Date.now() - parsed) / 60000);
}

function getApplianceStatus(state: string | undefined): 'ready' | 'running' | null {
  if (!state || typeof state !== 'string') return null;
  const lowered = state.toLowerCase().trim();
  if (APPLIANCE_INACTIVE_STATES.includes(lowered)) return null;
  if (APPLIANCE_READY_STATES.some(keyword => lowered.includes(keyword))) return 'ready';
  return 'running';
}

/** Pulse copy while a cycle is active (dryer dries; washer/dishwasher wash). */
function getApplianceRunningLabel(config: ApplianceConfig, remainingMin: number | null): string {
  const activity = config.id === 'dryer' ? 'drying' : 'washing';
  if (remainingMin != null && remainingMin > 0) {
    return `${config.label} ${activity} · ${formatMinutesCompact(remainingMin)} left`;
  }
  return `${config.label} ${activity}`;
}

function buildApplianceChip(config: ApplianceConfig, entity: HassEntity | undefined, entities: HassEntities): ChipCandidate | null {
  let status: ReturnType<typeof getApplianceStatus>;
  if (config.id === 'dishwasher' && entity) {
    const sem = resolveDishwasherSemanticState(entity, entities['input_select.dishwasher_state']);
    if (sem === 'Off' || sem === 'Emptied') status = null;
    else if (sem === 'Unemptied') status = 'ready';
    else if (sem === 'Running' || sem === 'Paused') status = 'running';
    else status = getApplianceStatus(entity.state);
  } else {
    status = getApplianceStatus(entity?.state);
  }
  if (!status) return null;

  const remainingMin = toNumber(entity?.attributes?.estimated_remaining_min);
  const label =
    status === 'ready'
      ? `${config.label} ready to be emptied`
      : getApplianceRunningLabel(config, remainingMin != null && remainingMin > 0 ? remainingMin : null);

  return {
    id: `appliance-${config.id}`,
    icon: config.icon,
    label,
    tone: status === 'ready' ? 'active' : config.id === 'dryer' ? 'attention' : 'calm',
    areaId: config.areaId,
    pulse: status === 'ready',
    priority: status === 'ready' ? 90 : 70,
  };
}

function resolveArea(areas: Area[], value: string): Area | null {
  const normalizedValue = normalizeAreaName(value);
  return (
    areas.find(area => {
      const normalizedName = normalizeAreaName(area.name);
      return area.area_id === value || normalizeAreaName(area.area_id) === normalizedValue || normalizedName === normalizedValue;
    }) ?? null
  );
}

function resolveAreaId(areas: Area[], value: string | null): string | undefined {
  if (!value) return undefined;
  const area = resolveArea(areas, value);
  if (area) return area.area_id;

  const normalizedValue = normalizeAreaName(value);
  return normalizedValue && normalizedValue !== 'none' ? normalizedValue : undefined;
}

function resolveAreaLabel(areas: Area[], value: string | null): string | null {
  if (!value) return null;
  const area = resolveArea(areas, value);
  if (area) return formatAreaName(area.name);

  const normalizedValue = normalizeAreaName(value);
  if (!normalizedValue || normalizedValue === 'none') return null;
  return formatAreaName(normalizedValue.replace(/_/g, ' '));
}

function buildWeatherAlertChip(areas: Area[], entities: HassEntities): ChipCandidate | null {
  if (entities?.[WEATHER_ALERT_ACTIVE_ENTITY]?.state !== 'on') return null;

  const priorityState = entities?.[WEATHER_ALERT_PRIORITY_ENTITY]?.state ?? '';
  if (priorityState === 'none') return null;

  const targetAreaRaw = String(entities?.[WEATHER_ALERT_TARGET_AREA_ENTITY]?.state ?? '').trim();
  const areaLabel = resolveAreaLabel(areas, targetAreaRaw);
  const targetAreaId = resolveAreaId(areas, targetAreaRaw);

  if (priorityState === 'rooftop_rain') {
    const rooftopAreaId = targetAreaId ?? resolveAreaId(areas, 'rooftop');
    return {
      id: 'weather-alert-rooftop',
      icon: 'mdi:weather-pouring',
      label: 'Rooftop rain risk',
      tone: 'attention',
      areaId: rooftopAreaId,
      action: rooftopAreaId ? undefined : 'weather',
      pulse: true,
      priority: 120,
    };
  }

  return {
    id: 'weather-alert-window',
    icon: 'mdi:window-open-variant',
    label: areaLabel ? `${areaLabel} rain risk` : 'Window rain risk',
    tone: 'attention',
    areaId: targetAreaId,
    action: targetAreaId ? undefined : 'weather',
    pulse: true,
    priority: 100,
  };
}

function buildBatteryChip(entities: HassEntities): ChipCandidate | null {
  const lowBatteries = deriveBatteryItems(entities).filter(item => item.isLow);
  if (lowBatteries.length === 0) return null;

  return {
    id: 'battery-alert',
    icon: 'mdi:battery-alert',
    label: lowBatteries.length === 1 ? `${lowBatteries[0].name} battery low` : `${lowBatteries.length} batteries low`,
    tone: 'attention',
    pulse: true,
    priority: 88,
  };
}

function buildLockChip(entities: HassEntities, homePeopleCount: number): ChipCandidate | null {
  if (homePeopleCount > 0) return null;

  const lockEntityId = resolveHallwayLockEntityId(entities);
  const apartmentLock = lockEntityId ? entities?.[lockEntityId] : undefined;
  const doorEntityId = resolveHallwayDoorSensorId(entities) ?? APARTMENT_DOOR_OPEN_ENTITY;
  const apartmentDoor = entities?.[doorEntityId];
  const lockOpenMinutes = minutesSince(apartmentLock?.last_changed ?? apartmentLock?.last_updated);

  if (apartmentLock?.state !== 'unlocked' || apartmentDoor?.state !== 'off') return null;
  if (lockOpenMinutes !== null && lockOpenMinutes < 4) return null;

  return {
    id: 'lock-alert',
    icon: 'mdi:lock-open-alert',
    label: lockOpenMinutes !== null ? `Unlocked ${formatMinutesCompact(lockOpenMinutes)}` : 'Apartment unlocked',
    tone: 'attention',
    pulse: true,
    priority: 110,
  };
}

function buildTransitAlertChip(entities: HassEntities): ChipCandidate | null {
  const now = new Date();
  const alertLines = TRANSIT_LINES.filter(line => {
    const enabled = entities?.[line.enabledEntityId]?.state !== 'off';
    if (!enabled) return false;
    const displayStatus = getTransitLineDisplayStatus(line, entities, now);
    return isTransitAlert(displayStatus);
  }).sort((a, b) => {
    const severityDiff =
      getTransitSeverity(getTransitLineDisplayStatus(b, entities, now)) - getTransitSeverity(getTransitLineDisplayStatus(a, entities, now));
    if (severityDiff !== 0) return severityDiff;
    return a.name.localeCompare(b.name);
  });

  const topLine = alertLines[0];
  if (!topLine) return null;

  const status = getTransitLineDisplayStatus(topLine, entities, now);
  const tone = status === 'Disrupted' ? 'attention' : 'calm';

  return {
    id: 'transit-alert',
    icon: topLine.icon,
    label: `${topLine.name} ${String(status).toLowerCase()}`,
    tone,
    pulse: status === 'Disrupted',
    action: 'transit',
    priority: status === 'Disrupted' ? 96 : 84,
  };
}

export function deriveHomePulseSummary(areas: Area[], entities: HassEntities): HomePulseSummary {
  const homePeopleCount = Object.keys(entities || {}).filter(
    entityId => entityId.startsWith('person.') && entities[entityId]?.state === 'home'
  ).length;

  const chips = [
    buildWeatherAlertChip(areas, entities),
    buildTransitAlertChip(entities),
    buildLockChip(entities, homePeopleCount),
    buildBatteryChip(entities),
    ...APPLIANCES.map(config => buildApplianceChip(config, entities?.[config.sensorId], entities)),
  ]
    .filter((chip): chip is ChipCandidate => chip !== null)
    .sort((a, b) => b.priority - a.priority)
    .map(({ priority, ...chip }) => chip);

  const tone = chips[0]?.tone ?? 'neutral';

  return {
    insight: null,
    chips,
    tone,
  };
}
