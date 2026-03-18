import { TRACKED_WINDOWS } from '../config/dashboard';
import { ROBOT_PAUSED_BOOLEAN_ENTITY, ROBOT_PAUSE_REASON_ENTITY, VACUUM_CURRENT_ROOM_INPUT, VACUUM_CURRENT_ROOM_SENSOR } from '../config/entities';
import type { Area, HassEntities, HassEntity, HomePulseSummary, PulseChip, PulseNarrative } from '../types';
import { deriveBatteryItems } from './batteryAlerts';

const APPLIANCE_READY_STATES = ['complete', 'finished', 'done', 'ready', 'end', 'completed', 'end of cycle', 'unemptied'];
const APPLIANCE_INACTIVE_STATES = ['off', 'idle', 'emptied', 'standby', 'unknown', 'unavailable'];
const APARTMENT_LOCK_ENTITY = 'lock.yale_bt';
const APARTMENT_DOOR_ENTITY = 'binary_sensor.yale_door';
const ROBOT_WAITING_ENTITY = 'input_boolean.rober2_waiting_for_empty_home';

const RAIN_RATE_ENTITY = 'sensor.gw2000a_rain_rate_piezo';
const WIND_SPEED_ENTITY = 'sensor.gw2000a_wind_speed';
const WIND_GUST_ENTITY = 'sensor.gw2000a_wind_gust';
const WIND_DIRECTION_ENTITY = 'sensor.gw2000a_wind_direction';
const ROOFTOP_DOOR_IDS = ['binary_sensor.rooftop_door_1_contact', 'binary_sensor.rooftop_door_2_contact'] as const;

const LIVE_RAIN_THRESHOLD_MM_H = 0.1;
const DRIVEN_RAIN_WIND_MS = 4.5;
const DRIVEN_RAIN_GUST_MS = 7;

interface ApplianceConfig {
  id: 'dishwasher' | 'washer' | 'dryer';
  sensorId: string;
  label: string;
  areaId: string;
  icon: string;
}

interface ApplianceChipCandidate extends PulseChip {
  priority: number;
}

interface InsightCandidate {
  priority: number;
  narrative: PulseNarrative;
}

interface WindExposureBand {
  start: number;
  end: number;
}

interface OpenWindowSnapshot {
  entityId: string;
  areaName?: string;
}

const APPLIANCES: ApplianceConfig[] = [
  { id: 'dishwasher', sensorId: 'sensor.dishwasher_state', label: 'Dishwasher', areaId: 'kitchen', icon: 'mdi:dishwasher' },
  { id: 'washer', sensorId: 'sensor.washer_state', label: 'Washer', areaId: 'guest_bathroom', icon: 'mdi:washing-machine' },
  { id: 'dryer', sensorId: 'sensor.dryer_state', label: 'Dryer', areaId: 'guest_bathroom', icon: 'mdi:tumble-dryer' },
];

// These tracked dining-room windows are treated as west-facing for driven-rain alerts.
// If the facade orientation changes in practice, adjust the exposure bands here.
const WINDOW_RAIN_EXPOSURE: Record<string, WindExposureBand[]> = {
  'binary_sensor.dining_room_window_1_contact': [{ start: 225, end: 315 }],
  'binary_sensor.dining_room_window_2_contact': [{ start: 225, end: 315 }],
  'binary_sensor.dining_room_window_3_contact': [{ start: 225, end: 315 }],
};

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

function getAreasBySpecificity(areas: Area[]): Area[] {
  return [...areas].sort((a, b) => {
    const aKey = `${a.area_id} ${normalizeAreaName(a.name)}`;
    const bKey = `${b.area_id} ${normalizeAreaName(b.name)}`;
    return bKey.length - aKey.length;
  });
}

function inferAreaNameForEntity(entityId: string, entity: HassEntity | undefined, areas: Area[]): string | undefined {
  const haystack = `${entityId} ${String(entity?.attributes?.friendly_name ?? '')}`.toLowerCase();

  if (haystack.includes('front_door')) {
    const hallway = areas.find(area => normalizeAreaName(area.name) === 'hallway' || area.area_id === 'hallway');
    return hallway ? formatAreaName(hallway.name) : undefined;
  }

  for (const area of getAreasBySpecificity(areas)) {
    const normalized = normalizeAreaName(area.name);
    const tokens = [area.area_id.toLowerCase(), normalized, area.name.toLowerCase()];
    if (tokens.some(token => token.length > 0 && haystack.includes(token))) {
      return formatAreaName(area.name);
    }
  }

  return undefined;
}

function getApplianceStatus(state: string | undefined): 'ready' | 'running' | null {
  if (!state || typeof state !== 'string') return null;
  const lowered = state.toLowerCase().trim();
  if (APPLIANCE_INACTIVE_STATES.includes(lowered)) return null;
  if (APPLIANCE_READY_STATES.some(keyword => lowered.includes(keyword))) return 'ready';
  return 'running';
}

function buildApplianceChip(config: ApplianceConfig, entity: HassEntity | undefined): ApplianceChipCandidate | null {
  const status = getApplianceStatus(entity?.state);
  if (!status) return null;

  const remainingMin = toNumber(entity?.attributes?.estimated_remaining_min);
  const label =
    status === 'ready'
      ? `${config.label} ready`
      : remainingMin && remainingMin > 0
        ? `${config.label} ${formatMinutesCompact(remainingMin)} left`
        : `${config.label} running`;

  return {
    id: `appliance-${config.id}`,
    icon: config.icon,
    label,
    tone: status === 'ready' ? 'attention' : 'active',
    areaId: config.areaId,
    pulse: status === 'ready',
    priority: status === 'ready' ? 90 : 70,
  };
}

function toMetersPerSecond(value: unknown): number | null {
  const numeric = toNumber(value);
  if (numeric === null) return null;
  return numeric / 3.6;
}

function normalizeBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function isBearingWithinBand(direction: number, band: WindExposureBand): boolean {
  const normalizedDirection = normalizeBearing(direction);
  const normalizedStart = normalizeBearing(band.start);
  const normalizedEnd = normalizeBearing(band.end);

  if (normalizedStart <= normalizedEnd) {
    return normalizedDirection >= normalizedStart && normalizedDirection <= normalizedEnd;
  }

  return normalizedDirection >= normalizedStart || normalizedDirection <= normalizedEnd;
}

function getDirectionLabel(deg: number | null): string | null {
  if (deg === null || Number.isNaN(deg)) return null;
  const normalized = normalizeBearing(deg);
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(normalized / 45) % 8];
}

function trimTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.!?]+$/u, '');
}

function formatRobotLocation(value: string | undefined): string | null {
  if (!value || typeof value !== 'string') return null;

  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^stuck_trying_to_leave_the_/, '')
    .replace(/^stuck_in_the_/, '')
    .replace(/^trying_to_leave_the_/, '')
    .replace(/^the_/, '')
    .replace(/_/g, ' ');

  if (!cleaned || ['unknown', 'unavailable', 'none', 'docked', 'charging'].includes(cleaned)) {
    return null;
  }

  return formatAreaName(cleaned);
}

function buildRainInsight(areas: Area[], entities: HassEntities): InsightCandidate | null {
  const rainRate = toNumber(entities?.[RAIN_RATE_ENTITY]?.state);
  if (rainRate === null || rainRate < LIVE_RAIN_THRESHOLD_MM_H) return null;

  const rooftopOpenCount = ROOFTOP_DOOR_IDS.filter(entityId => entities?.[entityId]?.state === 'on').length;
  if (rooftopOpenCount > 0) {
    return {
      priority: 120,
      narrative: {
        text:
          rooftopOpenCount === 1
            ? 'Rain is falling and a rooftop door is open.'
            : `Rain is falling and ${rooftopOpenCount} rooftop doors are open.`,
        tone: 'attention',
      },
    };
  }

  const windDirection = toNumber(entities?.[WIND_DIRECTION_ENTITY]?.state);
  const windSpeedMs = toMetersPerSecond(entities?.[WIND_SPEED_ENTITY]?.state);
  const gustMs = toMetersPerSecond(entities?.[WIND_GUST_ENTITY]?.state);
  const hasDrivenRain = (windSpeedMs !== null && windSpeedMs >= DRIVEN_RAIN_WIND_MS) || (gustMs !== null && gustMs >= DRIVEN_RAIN_GUST_MS);

  if (!hasDrivenRain || windDirection === null) return null;

  const drivenRainWindows: OpenWindowSnapshot[] = TRACKED_WINDOWS.flatMap(entityId => {
    const entity = entities?.[entityId];
    if (!entity || entity.state !== 'on') return [];
    const exposureBands = WINDOW_RAIN_EXPOSURE[entityId];
    if (!exposureBands?.some(band => isBearingWithinBand(windDirection, band))) return [];

    return [
      {
        entityId,
        areaName: inferAreaNameForEntity(entityId, entity, areas),
      },
    ];
  });

  if (drivenRainWindows.length === 0) return null;

  const directionLabel = getDirectionLabel(windDirection);
  const firstAreaName = drivenRainWindows[0]?.areaName;
  const sameArea = drivenRainWindows.every(window => window.areaName === firstAreaName);
  const locationText =
    sameArea && firstAreaName ? `${firstAreaName.toLowerCase()} window${drivenRainWindows.length > 1 ? 's' : ''}` : 'open windows';
  const countText = drivenRainWindows.length > 1 && !(sameArea && firstAreaName) ? `${drivenRainWindows.length} ` : '';
  const windText = directionLabel ? `${directionLabel} wind` : 'wind';

  return {
    priority: 100,
    narrative: {
      text: `Rain and ${windText} are reaching ${countText}${locationText}.`,
      tone: 'attention',
    },
  };
}

function buildBatteryInsight(entities: HassEntities): InsightCandidate | null {
  const lowBatteries = deriveBatteryItems(entities).filter(item => item.isLow);
  if (lowBatteries.length === 0) return null;

  if (lowBatteries.length === 1) {
    const battery = lowBatteries[0];
    return {
      priority: 90,
      narrative: {
        text: `${battery.name} battery is at ${battery.value}% and needs changing.`,
        tone: 'attention',
      },
    };
  }

  const lowestBattery = lowBatteries[0];
  return {
    priority: 90,
    narrative: {
      text: `${lowBatteries.length} devices need battery changes. Lowest is ${lowestBattery.name} at ${lowestBattery.value}%.`,
      tone: 'attention',
    },
  };
}

function buildRobotAttentionInsight(entities: HassEntities): InsightCandidate | null {
  if (entities?.[ROBOT_PAUSED_BOOLEAN_ENTITY]?.state !== 'on') return null;

  const reason = trimTrailingPunctuation(String(entities?.[ROBOT_PAUSE_REASON_ENTITY]?.state ?? ''));
  const location =
    formatRobotLocation(entities?.[VACUUM_CURRENT_ROOM_SENSOR]?.state) ?? formatRobotLocation(entities?.[VACUUM_CURRENT_ROOM_INPUT]?.state);

  const hasCustomReason = reason.length > 0 && reason.toLowerCase() !== 'automation paused';
  const text = location && hasCustomReason
    ? `Rober2 needs attention in ${location}: ${reason}.`
    : hasCustomReason
      ? `Rober2 needs attention: ${reason}.`
      : location
        ? `Rober2 needs attention in ${location}.`
        : 'Rober2 needs attention and cannot continue.';

  return {
    priority: 115,
    narrative: {
      text,
      tone: 'attention',
    },
  };
}

function buildLockInsight(entities: HassEntities, homePeopleCount: number): InsightCandidate | null {
  if (homePeopleCount > 0) return null;

  const apartmentLock = entities?.[APARTMENT_LOCK_ENTITY];
  const apartmentDoor = entities?.[APARTMENT_DOOR_ENTITY];
  const lockOpenMinutes = minutesSince(apartmentLock?.last_changed ?? apartmentLock?.last_updated);

  if (apartmentLock?.state !== 'unlocked' || apartmentDoor?.state !== 'off') return null;
  if (lockOpenMinutes !== null && lockOpenMinutes < 4) return null;

  const duration = lockOpenMinutes !== null ? ` for ${formatMinutesCompact(lockOpenMinutes)}` : '';
  return {
    priority: 110,
    narrative: {
      text: `Apartment lock has been unlocked${duration} while nobody is home.`,
      tone: 'attention',
    },
  };
}

function buildRobotInsight(entities: HassEntities, homePeopleCount: number): InsightCandidate | null {
  if (entities?.[ROBOT_WAITING_ENTITY]?.state !== 'on' || homePeopleCount === 0) return null;

  return {
    priority: 60,
    narrative: {
      text: 'Rober2 will start cleaning when the apartment is empty.',
      tone: 'calm',
    },
  };
}

function buildInsight(areas: Area[], entities: HassEntities, homePeopleCount: number): PulseNarrative | null {
  const candidates = [
    buildRainInsight(areas, entities),
    buildRobotAttentionInsight(entities),
    buildLockInsight(entities, homePeopleCount),
    buildBatteryInsight(entities),
    buildRobotInsight(entities, homePeopleCount),
  ]
    .filter((candidate): candidate is InsightCandidate => candidate !== null)
    .sort((a, b) => b.priority - a.priority);

  return candidates[0]?.narrative ?? null;
}

export function deriveHomePulseSummary(areas: Area[], entities: HassEntities): HomePulseSummary {
  const homePeopleCount = Object.keys(entities || {}).filter(
    entityId => entityId.startsWith('person.') && entities[entityId]?.state === 'home'
  ).length;

  const chips = APPLIANCES.map(config => buildApplianceChip(config, entities?.[config.sensorId]))
    .filter((chip): chip is ApplianceChipCandidate => chip !== null)
    .sort((a, b) => b.priority - a.priority)
    .map(({ priority, ...chip }) => chip);

  const insight = buildInsight(areas, entities, homePeopleCount);
  const tone = insight?.tone ?? chips[0]?.tone ?? 'neutral';

  return {
    insight,
    chips,
    tone,
  };
}
