/** What comes next on the timeline: running appliances, the wake alarm (admin only) and the Rober2
 * queue, which is display only. Pure. */
import { COFFEE_AREA_ID, COFFEE_STATE_ENTITY } from '../coffee/entities';
import { coffeeCycle } from '../coffee/state';
import { formatRoberRoomName } from '../components/Vacuum/rooms';
import { ROBOT_CLEAN_PREFIX, ROBOT_CLEANING_NARRATIVE_ENTITY, VACUUM_ENTITY } from '../config/entities';
import { PLAN_APPLIANCES, type PlanApplianceConfig, type PlanApplianceKey } from '../config/plan';
import { readApplianceCycle, type ApplianceCycle } from '../energy/applianceRun';
import { nextHomeClockMs } from '../energy/homeTime';
import { nowFocusAt, type NowFocus } from '../utils/navigation';
import { canViewerSeeKind, type HouseEventViewer } from './houseEvents';
import { HOUSEHOLD } from './household';
import type { NowCandidate } from './nowResolve';

export type UpcomingEntity = { state: string; attributes: Record<string, unknown> };
export type UpcomingReader = (entityId: string) => UpcomingEntity | undefined;

export type ApplianceKind = 'washer' | 'dryer' | 'dish' | 'coffee';

/** What Home shows of an appliance: its name, icon and state entity. The planned ones carry their Energy plan config. */
export type HomeApplianceConfig = Pick<PlanApplianceConfig, 'label' | 'icon' | 'stateEntityId'>;

export interface HomeAppliance {
  kind: ApplianceKind;
  config: HomeApplianceConfig;
  /** Its state entity read as a run. */
  cycle: (entity: UpcomingEntity | undefined, nowMs: number) => ApplianceCycle;
  /** State entity values while a run or a finished run shows. */
  activeStates: ReadonlySet<string>;
  /** Speaks the finish while on; null when the appliance has no such switch. */
  announceEntityId: string | null;
  /** HA area id of the room it stands in. */
  areaId: string;
}

const planConfig = (key: PlanApplianceKey) => PLAN_APPLIANCES.find(appliance => appliance.key === key)!;

const MONITOR_ACTIVE_STATES: ReadonlySet<string> = new Set(['Running', 'Paused', 'Unemptied']);

function planned(
  kind: Exclude<ApplianceKind, 'coffee'>,
  key: PlanApplianceKey,
  announceEntityId: string | null,
  areaId: string
): HomeAppliance {
  const config = planConfig(key);
  return {
    kind,
    config,
    cycle: (entity, nowMs) => readApplianceCycle(entity, config.etaFormat, nowMs),
    activeStates: MONITOR_ACTIVE_STATES,
    announceEntityId,
    areaId,
  };
}

export const HOME_APPLIANCES: readonly HomeAppliance[] = [
  planned('washer', 'washer', 'input_boolean.washer_announce', 'guest_bathroom'),
  planned('dryer', 'dryer', 'input_boolean.dryer_announce', 'guest_bathroom'),
  planned('dish', 'dishwasher', null, 'kitchen'),
  {
    kind: 'coffee',
    config: { label: 'Coffee', icon: 'mdi:coffee', stateEntityId: COFFEE_STATE_ENTITY },
    cycle: coffeeCycle,
    activeStates: new Set(['grinding', 'brewing', 'paused', 'ready']),
    announceEntityId: null,
    areaId: COFFEE_AREA_ID,
  },
];

export const WAKE_ENABLED_ENTITY = 'input_boolean.wakeup_bedroom';
export const WAKE_TIME_ENTITY = 'input_datetime.wakeup_bedroom';

/** Room keys of the `input_boolean.rober2_clean_<key>` queue switches. */
export const ROBER2_QUEUE_KEYS = [
  'hallway',
  'kitchen',
  'kitchen_2',
  'living_room',
  'dining_room',
  'claudias_room',
  'kristines_room',
  'bedroom',
  'bathroom',
  'guest_bathroom',
] as const;

export interface UpcomingAppliance {
  type: 'appliance';
  id: ApplianceKind;
  appliance: HomeAppliance;
  cycle: ApplianceCycle;
  /** null without an announce switch, or while it reads neither on nor off. */
  announce: boolean | null;
  /** The ETA; null while it is unknown. */
  atMs: number | null;
}

export interface UpcomingWake {
  type: 'wake';
  id: 'wake';
  areaId: 'bedroom';
  /** Off disables the recurring alarm, not one morning. */
  enabled: boolean;
  /** "HH:MM" on the house clock. */
  clock: string;
  /** The next time the alarm would ring. */
  atMs: number;
}

export interface UpcomingRober2 {
  type: 'rober2';
  id: 'rober2';
  areaId: 'kitchen';
  /** Display names of the rooms queued for cleaning. */
  rooms: string[];
  vacuumState: string | null;
  narrative: string | null;
  atMs: null;
}

export type UpcomingItem = UpcomingAppliance | UpcomingWake | UpcomingRober2;

/** "HH:MM" or "HH:MM:SS"; null for anything else. */
export function parseClock(text: string | undefined): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text?.trim() ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** The first instant after `nowMs` the house clock reads `clock` ("HH:MM" or "HH:MM:SS"); null for
 * anything else. A time the autumn fall-back repeats rings at its first occurrence. */
export function nextWakeMs(clock: string | undefined, nowMs: number): number | null {
  const time = parseClock(clock);
  return time ? nextHomeClockMs(nowMs, time.hour, time.minute) : null;
}

const switchState = (entity: UpcomingEntity | undefined): boolean | null =>
  entity?.state === 'on' ? true : entity?.state === 'off' ? false : null;

const textState = (entity: UpcomingEntity | undefined): string | null => {
  const text = entity?.state?.trim() ?? '';
  return text && text !== 'unknown' && text !== 'unavailable' ? text : null;
};

/** Attribution methods that name a person on evidence: the only person home, or the HA user who tapped. */
const RELIABLE_ACTOR_METHODS: ReadonlySet<string> = new Set(['sole_occupant', 'dashboard_action']);

/** The resident who started a run, from its monitor's `started_by` and `started_by_method`; null unless a
 * resident was named by a reliable method. */
export function applianceStarter(startedBy: unknown, method: unknown): string | null {
  if (typeof method !== 'string' || !RELIABLE_ACTOR_METHODS.has(method)) return null;
  return HOUSEHOLD.find(member => member.key === startedBy)?.name ?? null;
}

function readAppliances(read: UpcomingReader, nowMs: number): UpcomingAppliance[] {
  return HOME_APPLIANCES.flatMap(appliance => {
    const cycle = appliance.cycle(read(appliance.config.stateEntityId), nowMs);
    if (cycle.status !== 'running' && cycle.status !== 'paused') return [];
    const announce = appliance.announceEntityId ? switchState(read(appliance.announceEntityId)) : null;
    return [{ type: 'appliance' as const, id: appliance.kind, appliance, cycle, announce, atMs: cycle.etaMs }];
  });
}

function readWake(read: UpcomingReader, nowMs: number): UpcomingWake | null {
  const enabled = switchState(read(WAKE_ENABLED_ENTITY));
  const time = parseClock(read(WAKE_TIME_ENTITY)?.state);
  if (enabled == null || time == null) return null;
  const clock = `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
  return { type: 'wake', id: 'wake', areaId: 'bedroom', enabled, clock, atMs: nextHomeClockMs(nowMs, time.hour, time.minute) };
}

function readRober2(read: UpcomingReader): UpcomingRober2 | null {
  const rooms = ROBER2_QUEUE_KEYS.filter(key => read(`${ROBOT_CLEAN_PREFIX}${key}`)?.state === 'on').map(
    key => formatRoberRoomName(key) ?? key
  );
  const vacuumState = textState(read(VACUUM_ENTITY));
  if (rooms.length === 0 && vacuumState !== 'cleaning' && vacuumState !== 'returning') return null;
  return {
    type: 'rober2',
    id: 'rober2',
    areaId: 'kitchen',
    rooms,
    vacuumState,
    narrative: textState(read(ROBOT_CLEANING_NARRATIVE_ENTITY)),
    atMs: null,
  };
}

/** Upcoming items `viewer` may see, soonest first; untimed items last. */
export function readUpcoming(read: UpcomingReader, nowMs: number, viewer: HouseEventViewer): UpcomingItem[] {
  const wake = canViewerSeeKind('wake', viewer) ? readWake(read, nowMs) : null;
  const rober2 = readRober2(read);
  const items: UpcomingItem[] = [...readAppliances(read, nowMs), ...(wake ? [wake] : []), ...(rober2 ? [rober2] : [])];
  return items.sort((a, b) => (a.atMs ?? Infinity) - (b.atMs ?? Infinity) || 0);
}

/** The item the next chip shows: the soonest one with a time, other than a disabled alarm. */
export function nextTimedItem(items: readonly UpcomingItem[]): UpcomingItem | null {
  return items.find(item => item.atMs != null && !(item.type === 'wake' && !item.enabled)) ?? null;
}

/** The identity a link to `item` carries: a running appliance's cycle start, the alarm's time. */
export function upcomingFocus(item: UpcomingItem): NowFocus | null {
  if (item.type === 'appliance') return item.cycle.startMs != null ? nowFocusAt(item.id, item.cycle.startMs) : null;
  if (item.type === 'wake') return nowFocusAt('wake', item.atMs);
  return null;
}

/** Live resolver candidates, at the same identity times as `upcomingFocus`. */
export function upcomingCandidates(items: readonly UpcomingItem[]): NowCandidate[] {
  return items.flatMap(item => {
    const focus = upcomingFocus(item);
    const atMs = item.type === 'appliance' ? item.cycle.startMs : item.atMs;
    return focus && atMs != null ? [{ id: item.id, kind: focus.kind, atMs, live: true }] : [];
  });
}
